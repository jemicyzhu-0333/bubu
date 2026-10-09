'use strict';

const { isPausedSession } = require('./session-state');

function authorizeSessionStart(state, {
  quickStartDecisionSessionId = null,
  allowFocusLanding = false
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('session start authorization requires a state draft');
  }
  if (isPausedSession(state.focusSession)
      && state.focusSession.awaitingOfflineConfirmation === true) {
    return { ok: false, reason: 'awaiting-confirmation' };
  }

  const pendingDecision = state.quickStartDecision;
  const authorizedDecision = Boolean(
    pendingDecision
    && pendingDecision.status === 'pending'
    && quickStartDecisionSessionId
    && pendingDecision.sessionId === quickStartDecisionSessionId
  );
  if (pendingDecision && pendingDecision.status === 'pending' && !authorizedDecision) {
    return { ok: false, reason: 'quick-start-decision-pending' };
  }
  if (!allowFocusLanding
      && state.focusLandingPrompt
      && state.focusLandingPrompt.status === 'pending') {
    return { ok: false, reason: 'focus-landing-pending' };
  }
  return { ok: true, pendingDecision: authorizedDecision ? { ...pendingDecision } : null };
}

function authorizeStart(state, options) {
  return authorizeSessionStart(state, options);
}

function authorizeBreakStart(state) {
  return authorizeSessionStart(state, { allowFocusLanding: true });
}

module.exports = { authorizeStart, authorizeBreakStart };
