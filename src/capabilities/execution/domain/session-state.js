'use strict';

const FOCUS_SESSION_VERSION = 1;
const STATUS = Object.freeze({
  IDLE: 'idle',
  FOCUS: 'focus',
  QUICK_START: 'quick-start',
  BREAK: 'break',
  PAUSED: 'paused'
});
const ACTIVE_STATUSES = new Set([STATUS.FOCUS, STATUS.QUICK_START, STATUS.BREAK]);
const FOCUS_KIND_STATUSES = new Set([STATUS.FOCUS, STATUS.QUICK_START]);
const DEFAULT_DURATION_MS = Object.freeze({
  [STATUS.FOCUS]: 25 * 60 * 1000,
  [STATUS.QUICK_START]: 2 * 60 * 1000,
  [STATUS.BREAK]: 5 * 60 * 1000
});
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function finiteTimestamp(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function requireTimestamp(value, name = 'now') {
  const timestamp = finiteTimestamp(value, null);
  if (timestamp === null) throw new TypeError(`${name} must be a finite non-negative timestamp`);
  return timestamp;
}

function normalizedDuration(value, fallback) {
  const number = Number(value === undefined ? fallback : value);
  if (!Number.isFinite(number) || number <= 0 || number > MAX_DURATION_MS) return null;
  return Math.round(number);
}

function createIdleSession(now) {
  const transitionAt = requireTimestamp(now);
  return {
    version: FOCUS_SESSION_VERSION,
    status: STATUS.IDLE,
    sessionId: null,
    taskId: null,
    plannedDurationMs: 0,
    elapsedBeforeStartMs: 0,
    activeSegments: [],
    startedAt: null,
    endsAt: null,
    pausedAt: null,
    pausedFrom: null,
    awaitingOfflineConfirmation: false,
    recoveryReason: null,
    createdAt: null,
    updatedAt: transitionAt
  };
}

function normalizeActiveSegments(raw, plannedDurationMs) {
  if (!Array.isArray(raw)) return [];
  const candidates = raw.slice(-1000).map(segment => {
    if (!segment || typeof segment !== 'object') return null;
    const startedAt = finiteTimestamp(segment.startedAt, null);
    const endedAt = finiteTimestamp(segment.endedAt, null);
    if (startedAt === null || endedAt === null || endedAt <= startedAt) return null;
    return { startedAt, endedAt };
  }).filter(Boolean).sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt);

  const merged = [];
  for (const segment of candidates) {
    const previous = merged[merged.length - 1];
    if (previous && segment.startedAt <= previous.endedAt) {
      previous.endedAt = Math.max(previous.endedAt, segment.endedAt);
    } else {
      merged.push({ ...segment });
    }
  }

  let remaining = plannedDurationMs;
  const result = [];
  for (const segment of merged) {
    if (remaining <= 0) break;
    const duration = Math.min(remaining, segment.endedAt - segment.startedAt);
    result.push({ startedAt: segment.startedAt, endedAt: segment.startedAt + duration });
    remaining -= duration;
  }
  return result;
}

function normalizeFocusSession(raw, options = {}) {
  const now = requireTimestamp(options.now, 'options.now');
  if (!raw || typeof raw !== 'object') return createIdleSession(now);
  // Idle snapshots retain their last transition time so canonical validation
  // stays byte-stable across launches at different wall-clock times.
  if (raw.status === STATUS.IDLE) {
    return createIdleSession(finiteTimestamp(raw.updatedAt, now));
  }

  const status = raw.status;
  const pausedFrom = ACTIVE_STATUSES.has(raw.pausedFrom) ? raw.pausedFrom : null;
  if (!ACTIVE_STATUSES.has(status) && !(status === STATUS.PAUSED && pausedFrom)) {
    return createIdleSession(now);
  }

  const kind = status === STATUS.PAUSED ? pausedFrom : status;
  const plannedDurationMs = normalizedDuration(raw.plannedDurationMs, DEFAULT_DURATION_MS[kind]);
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId.trim() : null;
  if (!plannedDurationMs || !sessionId) return createIdleSession(now);

  const elapsedBeforeStartMs = Math.min(
    plannedDurationMs,
    Math.max(0, finiteTimestamp(raw.elapsedBeforeStartMs, 0))
  );
  const taskId = typeof raw.taskId === 'string' && raw.taskId.trim() ? raw.taskId.trim() : null;
  const createdAt = finiteTimestamp(raw.createdAt, finiteTimestamp(raw.startedAt, now));
  const updatedAt = finiteTimestamp(raw.updatedAt, now);
  // Closed history is immutable evidence of already-active time. A wall-clock
  // rollback must not truncate it and make a valid persisted snapshot drift.
  const activeSegments = normalizeActiveSegments(raw.activeSegments, plannedDurationMs);

  if (status === STATUS.PAUSED) {
    const awaitingOfflineConfirmation = raw.awaitingOfflineConfirmation === true
      || elapsedBeforeStartMs >= plannedDurationMs;
    return {
      version: FOCUS_SESSION_VERSION,
      status,
      sessionId,
      taskId,
      plannedDurationMs,
      elapsedBeforeStartMs,
      activeSegments,
      startedAt: null,
      endsAt: null,
      pausedAt: finiteTimestamp(raw.pausedAt, updatedAt),
      pausedFrom,
      awaitingOfflineConfirmation,
      recoveryReason: awaitingOfflineConfirmation
        ? (typeof raw.recoveryReason === 'string' && raw.recoveryReason.trim()
            ? raw.recoveryReason.trim().slice(0, 80)
            : 'offline-session-due')
        : null,
      createdAt,
      updatedAt
    };
  }

  const startedAt = finiteTimestamp(raw.startedAt, null);
  if (startedAt === null) return createIdleSession(now);
  const remainingAtStart = Math.max(0, plannedDurationMs - elapsedBeforeStartMs);

  return {
    version: FOCUS_SESSION_VERSION,
    status,
    sessionId,
    taskId,
    plannedDurationMs,
    elapsedBeforeStartMs,
    activeSegments,
    startedAt,
    // Derive the deadline instead of trusting an arbitrary persisted value.
    endsAt: startedAt + remainingAtStart,
    pausedAt: null,
    pausedFrom: null,
    awaitingOfflineConfirmation: false,
    recoveryReason: null,
    createdAt,
    updatedAt
  };
}

function isActiveSession(session) {
  return Boolean(session && ACTIVE_STATUSES.has(session.status));
}

function isPausedSession(session) {
  return Boolean(session && session.status === STATUS.PAUSED);
}

// PAUSED is only a wrapper; the kind it interrupted is kept in `pausedFrom`.
// Every caller asking "focus or break?" has to come through here, otherwise
// pausing reads as a third kind and the answer changes behind their back.
function sessionKind(session) {
  if (!session) return null;
  return session.status === STATUS.PAUSED ? session.pausedFrom : session.status;
}

// "Focus time is on the clock right now" — a paused focus round is deliberately
// not one. Left to each caller this rule drifts: `running && kind !== BREAK` in
// one place, `running && kind === FOCUS` in another, and those two disagree on
// quick-start rounds.
function isActiveFocusSession(session) {
  return isActiveSession(session) && FOCUS_KIND_STATUSES.has(session.status);
}

// "A round is on the clock" covers running and paused alike. A label and the
// action behind it must ask this single question, or the tray ends up offering
// to stop a timer and starting a second one instead.
function isTimingSession(session) {
  return isActiveSession(session) || isPausedSession(session);
}

function elapsedMs(rawSession, now) {
  const observedAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: observedAt });
  if (session.status === STATUS.IDLE) return 0;
  if (session.status === STATUS.PAUSED) return session.elapsedBeforeStartMs;
  const activeElapsed = Math.max(0, observedAt - session.startedAt);
  return Math.min(session.plannedDurationMs, session.elapsedBeforeStartMs + activeElapsed);
}

function remainingMs(session, now) {
  const observedAt = requireTimestamp(now);
  const normalized = normalizeFocusSession(session, { now: observedAt });
  return Math.max(0, normalized.plannedDurationMs - elapsedMs(normalized, observedAt));
}

function completionFor(session, now, reason) {
  const completedAt = requireTimestamp(now);
  const normalized = normalizeFocusSession(session, { now: completedAt });
  const elapsed = elapsedMs(normalized, completedAt);
  const currentSegmentDuration = normalized.status === STATUS.PAUSED
    ? 0
    : Math.max(0, elapsed - normalized.elapsedBeforeStartMs);
  const activeSegments = normalizeActiveSegments([
    ...normalized.activeSegments,
    ...(currentSegmentDuration > 0 ? [{
      startedAt: normalized.startedAt,
      endedAt: normalized.startedAt + currentSegmentDuration
    }] : [])
  ], normalized.plannedDurationMs);
  return {
    sessionId: normalized.sessionId,
    kind: sessionKind(normalized),
    taskId: normalized.taskId,
    createdAt: normalized.createdAt,
    endedAt: completedAt,
    plannedDurationMs: normalized.plannedDurationMs,
    elapsedMs: elapsed,
    activeSegments,
    reason,
    completed: reason === 'completed' && elapsed >= normalized.plannedDurationMs
  };
}

module.exports = {
  FOCUS_SESSION_VERSION,
  STATUS,
  ACTIVE_STATUSES,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  requireTimestamp,
  normalizedDuration,
  createIdleSession,
  normalizeActiveSegments,
  normalizeFocusSession,
  isActiveSession,
  isPausedSession,
  sessionKind,
  isActiveFocusSession,
  isTimingSession,
  elapsedMs,
  remainingMs,
  completionFor
};
