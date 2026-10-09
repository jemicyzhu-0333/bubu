'use strict';

const RESOLUTION_ACTIONS = Object.freeze(['save', 'skip']);

function resolvePrompt(state, { sessionId, action } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('focus landing resolution requires a state draft');
  }
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const prompt = state.focusLandingPrompt;
  if (!prompt
      || prompt.status !== 'pending'
      || !normalizedSessionId
      || prompt.sessionId !== normalizedSessionId) {
    return { ok: false, reason: 'no-matching-focus-landing' };
  }
  if (!RESOLUTION_ACTIONS.includes(action)) {
    return { ok: false, reason: 'invalid-action' };
  }

  state.focusLandingPrompt = null;
  return { ok: true, action, prompt: { ...prompt } };
}

module.exports = { RESOLUTION_ACTIONS, resolvePrompt };
