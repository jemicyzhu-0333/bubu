'use strict';

const {
  STATUS,
  ACTIVE_STATUSES,
  DEFAULT_DURATION_MS,
  requireTimestamp,
  normalizedDuration,
  createIdleSession,
  normalizeActiveSegments,
  normalizeFocusSession,
  isActiveSession,
  isPausedSession,
  elapsedMs,
  remainingMs,
  completionFor
} = require('./session-state');

function transitionTime(input, options) {
  if (input && input.now !== undefined) return requireTimestamp(input.now, 'input.now');
  return requireTimestamp(options && options.now, 'options.now');
}

function resolveSessionId(input, options) {
  if (typeof input.sessionId === 'string' && input.sessionId.trim()) return input.sessionId.trim();
  if (!options || typeof options.idFactory !== 'function') {
    throw new TypeError('startSession requires input.sessionId or options.idFactory');
  }
  const generated = options.idFactory();
  if (typeof generated !== 'string' || !generated.trim()) {
    throw new TypeError('options.idFactory must return a non-empty string');
  }
  return generated.trim();
}

function startSession(rawCurrent, input = {}, options = {}) {
  const now = transitionTime(input, options);
  let current = normalizeFocusSession(rawCurrent, { now });
  if (current.awaitingOfflineConfirmation) {
    return { ok: false, reason: 'awaiting-confirmation', session: current };
  }

  let recoveredCompletion = null;
  if (isActiveSession(current) && elapsedMs(current, now) >= current.plannedDurationMs) {
    recoveredCompletion = completionFor(current, now, 'completed');
    current = createIdleSession(now);
  }

  const kind = input.kind || STATUS.FOCUS;
  if (!ACTIVE_STATUSES.has(kind)) return { ok: false, reason: 'invalid-kind', session: current };

  const durationMs = normalizedDuration(
    input.durationMs === undefined && input.minutes !== undefined
      ? Number(input.minutes) * 60000
      : input.durationMs,
    DEFAULT_DURATION_MS[kind]
  );
  if (!durationMs) return { ok: false, reason: 'invalid-duration', session: current };

  if (isActiveSession(current) || isPausedSession(current)) {
    const currentKind = current.status === STATUS.PAUSED ? current.pausedFrom : current.status;
    const sameRequest = currentKind === kind
      && current.taskId === (input.taskId || null)
      && current.plannedDurationMs === durationMs;
    if (sameRequest) {
      return { ok: false, duplicate: true, reason: 'already-running', session: current };
    }
    if (options.onConflict !== 'replace') {
      return { ok: false, duplicate: false, reason: 'session-active', session: current };
    }
  }

  const replacement = isActiveSession(current) || isPausedSession(current)
    ? completionFor(current, now, 'replaced')
    : null;
  const sessionId = resolveSessionId(input, options);
  const taskId = typeof input.taskId === 'string' && input.taskId.trim() ? input.taskId.trim() : null;
  const session = {
    version: current.version,
    status: kind,
    sessionId,
    taskId,
    plannedDurationMs: durationMs,
    elapsedBeforeStartMs: 0,
    activeSegments: [],
    startedAt: now,
    endsAt: now + durationMs,
    pausedAt: null,
    pausedFrom: null,
    awaitingOfflineConfirmation: false,
    recoveryReason: null,
    createdAt: now,
    updatedAt: now
  };
  return { ok: true, session, replaced: replacement, recoveredCompletion };
}

function startFocus(rawCurrent, input = {}, options = {}) {
  return startSession(rawCurrent, { ...input, kind: STATUS.FOCUS }, options);
}

function startQuickStart(rawCurrent, input = {}, options = {}) {
  return startSession(rawCurrent, {
    ...input,
    durationMs: DEFAULT_DURATION_MS[STATUS.QUICK_START],
    kind: STATUS.QUICK_START
  }, options);
}

function startBreak(rawCurrent, input = {}, options = {}) {
  return startSession(rawCurrent, { ...input, kind: STATUS.BREAK }, options);
}

function pauseSession(rawSession, now) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  if (!isActiveSession(session)) return { ok: false, reason: 'not-running', session };
  const elapsed = elapsedMs(session, transitionAt);
  if (elapsed >= session.plannedDurationMs) {
    return {
      ok: true,
      session: createIdleSession(transitionAt),
      completion: completionFor(session, transitionAt, 'completed')
    };
  }
  return {
    ok: true,
    session: {
      ...session,
      status: STATUS.PAUSED,
      elapsedBeforeStartMs: elapsed,
      activeSegments: normalizeActiveSegments([
        ...session.activeSegments,
        {
          startedAt: session.startedAt,
          endedAt: session.startedAt + Math.max(0, elapsed - session.elapsedBeforeStartMs)
        }
      ], session.plannedDurationMs),
      startedAt: null,
      endsAt: null,
      pausedAt: transitionAt,
      pausedFrom: session.status,
      awaitingOfflineConfirmation: false,
      recoveryReason: null,
      updatedAt: transitionAt
    }
  };
}

function resumeSession(rawSession, now) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  if (!isPausedSession(session)) return { ok: false, reason: 'not-paused', session };
  const remaining = Math.max(0, session.plannedDurationMs - session.elapsedBeforeStartMs);
  if (remaining === 0) {
    return {
      ok: true,
      session: createIdleSession(transitionAt),
      completion: completionFor(session, transitionAt, 'completed')
    };
  }
  return {
    ok: true,
    session: {
      ...session,
      status: session.pausedFrom,
      startedAt: transitionAt,
      endsAt: transitionAt + remaining,
      pausedAt: null,
      pausedFrom: null,
      updatedAt: transitionAt
    }
  };
}

/**
 * Re-plan a running or paused focus round without ending it. Invested time is
 * immutable; landing on or below it remains the explicit stop action.
 */
function adjustSessionDuration(rawSession, input = {}, options = {}) {
  const now = requireTimestamp(options.now, 'options.now');
  const session = normalizeFocusSession(rawSession, { now });
  if (!isActiveSession(session) && !isPausedSession(session)) {
    return { ok: false, reason: 'not-running', session };
  }
  if (session.awaitingOfflineConfirmation) {
    return { ok: false, reason: 'awaiting-confirmation', session };
  }
  const kind = isPausedSession(session) ? session.pausedFrom : session.status;
  if (kind !== STATUS.FOCUS) return { ok: false, reason: 'session-kind-not-adjustable', session };

  const plannedDurationMs = normalizedDuration(input.plannedDurationMs, null);
  if (!plannedDurationMs) return { ok: false, reason: 'invalid-duration', session };
  const investedMs = elapsedMs(session, now);
  if (plannedDurationMs <= investedMs) {
    return { ok: false, reason: 'duration-below-invested', session, investedMs };
  }
  if (plannedDurationMs === session.plannedDurationMs) {
    return { ok: true, changed: false, session, investedMs };
  }

  const running = isActiveSession(session);
  const liveSegmentMs = running ? Math.max(0, investedMs - session.elapsedBeforeStartMs) : 0;
  const activeSegments = normalizeActiveSegments([
    ...session.activeSegments,
    ...(liveSegmentMs > 0
      ? [{ startedAt: session.startedAt, endedAt: session.startedAt + liveSegmentMs }]
      : [])
  ], plannedDurationMs);

  return {
    ok: true,
    changed: true,
    investedMs,
    session: normalizeFocusSession({
      ...session,
      plannedDurationMs,
      elapsedBeforeStartMs: investedMs,
      activeSegments,
      startedAt: running ? now : null,
      endsAt: running ? now + (plannedDurationMs - investedMs) : null,
      updatedAt: now
    }, { now })
  };
}

function stopSession(rawSession, now) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  if (!isActiveSession(session) && !isPausedSession(session)) {
    return { ok: false, reason: 'not-running', session };
  }
  if (isActiveSession(session) && elapsedMs(session, transitionAt) >= session.plannedDurationMs) {
    return {
      ok: true,
      session: createIdleSession(transitionAt),
      completion: completionFor(session, transitionAt, 'completed')
    };
  }
  return {
    ok: true,
    session: createIdleSession(transitionAt),
    completion: completionFor(session, transitionAt, 'stopped')
  };
}

function completeIfDue(rawSession, now) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  if (!isActiveSession(session)) return { completed: false, session };
  if (remainingMs(session, transitionAt) > 0) return { completed: false, session };
  return {
    completed: true,
    session: createIdleSession(transitionAt),
    completion: completionFor(session, transitionAt, 'completed')
  };
}

module.exports = {
  startSession,
  startFocus,
  startQuickStart,
  startBreak,
  pauseSession,
  resumeSession,
  adjustSessionDuration,
  stopSession,
  completeIfDue
};
