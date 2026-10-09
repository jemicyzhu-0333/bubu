'use strict';

const ACTION_ALIASES = Object.freeze({
  stop: 'done',
  enough: 'done',
  continue: 'extend-8',
  extend: 'extend-8',
  full: 'full-session',
  'full-round': 'full-session'
});
const RESOLUTION_ACTIONS = Object.freeze(['done', 'extend-8', 'full-session']);

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('quick-start resolution requires a finite non-negative time');
  }
  return value;
}

function normalizeAction(action) {
  return ACTION_ALIASES[action] || action;
}

function prepareResolution(state, { sessionId, action, resolvedAt } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('quick-start resolution requires a state draft');
  }
  const decision = state.quickStartDecision;
  if (!decision || decision.status !== 'pending') {
    return { ok: false, reason: 'no-pending-quick-start' };
  }
  if (typeof sessionId !== 'string' || decision.sessionId !== sessionId) {
    return { ok: false, reason: 'quick-start-decision-changed' };
  }
  const normalizedAction = normalizeAction(action);
  if (!RESOLUTION_ACTIONS.includes(normalizedAction)) {
    return { ok: false, reason: 'invalid-action' };
  }
  const at = requireTimestamp(resolvedAt);
  return {
    ok: true,
    action: normalizedAction,
    decision: { ...decision },
    resolvedDecision: {
      ...decision,
      status: normalizedAction,
      resolvedAt: at
    }
  };
}

function applyResolution(state, prepared) {
  if (!prepared || prepared.ok !== true || !prepared.resolvedDecision) {
    throw new TypeError('quick-start resolution must be prepared before it is applied');
  }
  const current = state.quickStartDecision;
  if (!current
      || current.status !== 'pending'
      || current.sessionId !== prepared.decision.sessionId) {
    return { ok: false, reason: 'no-pending-quick-start' };
  }
  state.quickStartDecision = { ...prepared.resolvedDecision };
  return { ok: true, decision: state.quickStartDecision };
}

module.exports = {
  RESOLUTION_ACTIONS,
  normalizeAction,
  prepareResolution,
  applyResolution
};
