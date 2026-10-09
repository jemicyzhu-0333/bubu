'use strict';

const {
  STATUS,
  requireTimestamp,
  normalizeFocusSession,
  isActiveSession,
  isPausedSession
} = require('./session-state');
const { pauseSession, stopSession } = require('./session-transitions');
const { recordCompletionHandoff } = require('./session-settlement');

const LANDING_ACTIONS = new Set(['settled-completion', 'paused-focus', 'kept-paused']);

function settleForHealthyShutdown(rawSession, now) {
  const transitionAt = requireTimestamp(now);
  const session = normalizeFocusSession(rawSession, { now: transitionAt });
  const kind = session.status === STATUS.PAUSED ? session.pausedFrom : session.status;
  if (kind === STATUS.BREAK && (isActiveSession(session) || isPausedSession(session))) {
    const stopped = stopSession(session, transitionAt);
    return { ...stopped, action: 'stopped-break' };
  }
  if (isActiveSession(session)) {
    const paused = pauseSession(session, transitionAt);
    return { ...paused, action: paused.completion ? 'settled-completion' : 'paused-focus' };
  }
  if (isPausedSession(session)) return { ok: true, action: 'kept-paused', session };
  return { ok: true, action: 'idle', session };
}

function pendingHandoff(value) {
  return Boolean(value && value.status === 'pending');
}

function sessionKind(transition) {
  const { completion, session } = transition;
  return completion && completion.kind
    || (session && session.status === STATUS.PAUSED ? session.pausedFrom : session && session.status);
}

function offerFocusLanding(state, transition, options, kind) {
  if (!LANDING_ACTIONS.has(transition.action)) {
    return { created: false, preserved: false, pending: false, kind };
  }
  if (pendingHandoff(state.focusLandingPrompt)) {
    return { created: false, preserved: true, pending: true, kind };
  }

  const { completion, session } = transition;
  const taskId = completion ? completion.taskId ?? null : session?.taskId ?? null;
  const sessionId = completion ? completion.sessionId : session.sessionId;
  state.focusLandingPrompt = {
    sessionId,
    taskId,
    completedAt: completion ? completion.endedAt : options.settledAt,
    status: 'pending'
  };
  return { created: true, preserved: false, pending: true, kind, taskId };
}

function recordHandoff(state, transition, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('healthy shutdown handoff requires a state draft');
  }
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    throw new TypeError('healthy shutdown handoff requires a session transition');
  }

  const kind = sessionKind(transition);
  if (transition.completion && transition.completion.completed && kind === STATUS.QUICK_START) {
    if (pendingHandoff(state.quickStartDecision)) {
      return { created: false, preserved: true, pending: true, kind };
    }
    const handoff = recordCompletionHandoff(state, transition.completion);
    return { ...handoff, preserved: false, pending: handoff.created };
  }
  if (kind !== STATUS.FOCUS) {
    return { created: false, preserved: false, pending: false, kind };
  }

  const settledAt = requireTimestamp(options.settledAt, 'healthy shutdown timestamp');
  if (typeof options.dayKey !== 'string' || !options.dayKey) {
    throw new TypeError('healthy shutdown landing requires a day key');
  }
  return offerFocusLanding(state, transition, { ...options, settledAt }, kind);
}

module.exports = { settleForHealthyShutdown, recordHandoff };
