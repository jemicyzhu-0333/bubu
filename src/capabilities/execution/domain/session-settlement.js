'use strict';

const { isDeepStrictEqual } = require('node:util');
const {
  STATUS,
  ACTIVE_STATUSES,
  MAX_DURATION_MS,
  requireTimestamp,
  createIdleSession,
  normalizeFocusSession,
  isActiveSession,
  isPausedSession,
  completionFor
} = require('./session-state');

function isId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}

function validateCompletion(completion) {
  if (!completion || typeof completion !== 'object' || Array.isArray(completion)) {
    return { ok: false, reason: 'invalid-session-completion' };
  }
  if (!isId(completion.sessionId) || !ACTIVE_STATUSES.has(completion.kind)) {
    return { ok: false, reason: 'invalid-session-completion' };
  }
  if (completion.taskId !== null && completion.taskId !== undefined && !isId(completion.taskId)) {
    return { ok: false, reason: 'invalid-session-completion' };
  }
  if (typeof completion.completed !== 'boolean'
      || typeof completion.reason !== 'string'
      || !completion.reason.trim()
      || completion.reason.length > 80
      || !Number.isFinite(completion.elapsedMs)
      || completion.elapsedMs < 0
      || !Number.isFinite(completion.plannedDurationMs)
      || completion.plannedDurationMs <= 0
      || completion.plannedDurationMs > MAX_DURATION_MS
      || completion.elapsedMs > completion.plannedDurationMs
      || !Number.isFinite(completion.createdAt)
      || completion.createdAt < 0
      || !Number.isFinite(completion.endedAt)
      || completion.endedAt < completion.createdAt
      || !Array.isArray(completion.activeSegments)) {
    return { ok: false, reason: 'invalid-session-completion' };
  }
  const invalidSegment = completion.activeSegments.some(segment => (
    !segment
    || typeof segment !== 'object'
    || Array.isArray(segment)
    || !Number.isFinite(segment.startedAt)
    || !Number.isFinite(segment.endedAt)
    || segment.startedAt < 0
    || segment.endedAt <= segment.startedAt
  ));
  if (invalidSegment) return { ok: false, reason: 'invalid-session-completion' };
  return { ok: true };
}

function sameCompletion(expected, actual) {
  return expected.sessionId === actual.sessionId
    && expected.kind === actual.kind
    && expected.taskId === (actual.taskId || null)
    && expected.createdAt === actual.createdAt
    && expected.endedAt === actual.endedAt
    && expected.plannedDurationMs === actual.plannedDurationMs
    && expected.elapsedMs === actual.elapsedMs
    && expected.completed === actual.completed
    && isDeepStrictEqual(expected.activeSegments, actual.activeSegments);
}

function settleSession(state, {
  nextSession,
  completion,
  settledAt,
  alreadyRecorded = false
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('session settlement requires a state draft');
  }
  const validated = validateCompletion(completion);
  if (!validated.ok) return validated;
  const now = requireTimestamp(settledAt, 'settlement timestamp');
  if (now !== completion.endedAt
      || !nextSession
      || typeof nextSession !== 'object'
      || Array.isArray(nextSession)) {
    return { ok: false, reason: 'invalid-settlement-session' };
  }
  const normalizedNext = normalizeFocusSession(nextSession, { now });
  if (!isDeepStrictEqual(normalizedNext, createIdleSession(now))) {
    return { ok: false, reason: 'invalid-settlement-session' };
  }

  const current = normalizeFocusSession(state.focusSession, { now: completion.endedAt });
  if (!isActiveSession(current) && !isPausedSession(current)) {
    if (!alreadyRecorded) return { ok: false, reason: 'session-settlement-mismatch' };
  } else {
    const expected = completionFor(
      current,
      completion.endedAt,
      completion.completed ? 'completed' : 'stopped'
    );
    if (!sameCompletion(expected, completion)) {
      return { ok: false, reason: 'session-settlement-mismatch' };
    }
  }

  state.focusSession = normalizedNext;
  return { ok: true, duplicate: alreadyRecorded, session: normalizedNext };
}

function replaceSession(state, nextSession, now) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('session settlement requires a state draft');
  }
  if (!nextSession || typeof nextSession !== 'object' || Array.isArray(nextSession)) {
    throw new TypeError('session settlement requires a next session');
  }
  state.focusSession = normalizeFocusSession(nextSession, {
    now: requireTimestamp(now, 'settlement timestamp')
  });
  return state.focusSession;
}

function recordCompletionHandoff(state, completion) {
  if (completion.completed !== true) return { created: false, kind: completion.kind };
  if (completion.kind === STATUS.FOCUS) {
    if (state.focusLandingPrompt?.status === 'pending') {
      return { created: false, preserved: true, kind: completion.kind };
    }
    state.focusLandingPrompt = {
      sessionId: completion.sessionId,
      taskId: completion.taskId ?? null,
      completedAt: completion.endedAt,
      status: 'pending'
    };
    return { created: Boolean(state.focusLandingPrompt), kind: completion.kind };
  }
  if (completion.kind === STATUS.QUICK_START) {
    state.quickStartDecision = {
      sessionId: completion.sessionId,
      taskId: completion.taskId || null,
      completedAt: completion.endedAt,
      elapsedMs: completion.elapsedMs,
      status: 'pending',
      resolvedAt: null
    };
    return { created: true, kind: completion.kind };
  }
  return { created: false, kind: completion.kind };
}

module.exports = {
  validateCompletion,
  settleSession,
  replaceSession,
  recordCompletionHandoff
};
