'use strict';

const {
  STATUS,
  requireTimestamp,
  normalizeFocusSession
} = require('./session-state');
const {
  pauseSession,
  completeIfDue
} = require('./session-transitions');

function recoverSession(rawSession, options = {}) {
  const now = requireTimestamp(options.now, 'options.now');
  const session = normalizeFocusSession(rawSession, { now });
  if (session.status === STATUS.IDLE) return { action: 'idle', session };
  if (session.status === STATUS.PAUSED) return { action: 'paused', session };
  const due = completeIfDue(session, now);
  if (due.completed) return { action: 'completed', ...due };
  return { action: 'resume', session };
}

function pauseForConfirmation(rawSession, now, reason) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  const paused = pauseSession(session, transitionAt);
  if (!paused.ok || !paused.completion) return paused;
  const recoveryReason = typeof reason === 'string' && reason.trim()
    ? reason.trim().slice(0, 80)
    : 'offline-session-due';
  const held = normalizeFocusSession({
    ...session,
    status: STATUS.PAUSED,
    pausedFrom: session.status,
    elapsedBeforeStartMs: session.plannedDurationMs,
    activeSegments: paused.completion.activeSegments,
    startedAt: null,
    endsAt: null,
    pausedAt: transitionAt,
    awaitingOfflineConfirmation: true,
    recoveryReason,
    updatedAt: transitionAt
  }, { now: transitionAt });
  return { ok: true, due: true, completion: paused.completion, session: held };
}

function pauseForOfflineConfirmation(rawSession, now) {
  return pauseForConfirmation(rawSession, now, 'offline-session-due');
}

module.exports = {
  recoverSession,
  pauseForConfirmation,
  pauseForOfflineConfirmation
};
