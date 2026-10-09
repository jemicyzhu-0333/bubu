'use strict';

const { compareDayKeys, localDayKey } = require('./calendar');
const { normalizeCompanionState, setLastByFamily } = require('./companion-state');

const MODE_BUDGETS = Object.freeze({
  off: { attention: 0, ambient: 0 },
  quiet: { attention: 0, ambient: 12 },
  balanced: { attention: 12, ambient: 36 },
  lively: { attention: 20, ambient: 60 },
  chaos: { attention: 36, ambient: 96 }
});
const RECENT_WINDOW = 5;

function normalizeContext(context = {}) {
  return {
    visible: context.visible !== false,
    menuOpen: context.menuOpen === true,
    dragging: context.dragging === true,
    dnd: context.dnd === true,
    sensitiveForeground: context.sensitiveForeground === true,
    lowStimulation: context.lowStimulation === true,
    reduceMotion: context.reduceMotion === true,
    focused: context.focused === true,
    activityMode: Object.prototype.hasOwnProperty.call(MODE_BUDGETS, context.activityMode)
      ? context.activityMode
      : 'balanced'
  };
}

function hardGateReason(cue, rawContext) {
  const context = normalizeContext(rawContext);
  if (!context.visible) return 'not-visible';
  if (context.menuOpen) return 'menu-open';
  if (context.dragging) return 'dragging';
  if (context.dnd) return 'dnd';
  if (context.sensitiveForeground) return 'sensitive-foreground';
  if (context.activityMode === 'off') return 'activity-off';
  if (context.lowStimulation) return 'low-stimulation';
  if (cue.kind === 'attention' && context.activityMode === 'quiet') return 'quiet-mode';
  if (cue.kind === 'attention' && context.focused) return 'focus';
  if (cue.kind === 'attention' && context.reduceMotion) return 'reduce-motion';
  if (context.focused && (!cue.focusAllowed || cue.kind !== 'ambient')) return 'focus';
  return null;
}

function rollBudgetForward(companion, dayKey) {
  const state = normalizeCompanionState(companion);
  const previous = state.surprise.budgetDay;
  if (previous === null || compareDayKeys(dayKey, previous) > 0) {
    state.surprise.budgetDay = dayKey;
    state.surprise.attentionSpent = 0;
    state.surprise.ambientSpent = 0;
  }
  return state;
}

function latestCueTime(recent, cueId) {
  let latest = null;
  for (const entry of recent) {
    if (entry.cueId === cueId && (latest === null || entry.finishedAt > latest)) latest = entry.finishedAt;
  }
  return latest;
}

function cueEligibility(cue, companion, rawContext, now) {
  const gate = hardGateReason(cue, rawContext);
  if (gate) return gate;
  const context = normalizeContext(rawContext);
  const budget = MODE_BUDGETS[context.activityMode];
  const spent = cue.kind === 'attention'
    ? companion.surprise.attentionSpent
    : companion.surprise.ambientSpent;
  if (spent + cue.cost > budget[cue.kind]) return `${cue.kind}-budget`;
  if (companion.surprise.lastGlobalAt !== null
      && now - companion.surprise.lastGlobalAt < cue.globalCooldownMs) return 'global-cooldown';
  const familyLast = companion.surprise.lastByFamily[cue.familyId];
  if (familyLast !== undefined && now - familyLast < cue.familyCooldownMs) return 'family-cooldown';
  const cueLast = latestCueTime(companion.surprise.recent, cue.id);
  if (cueLast !== null && now - cueLast < cue.cooldownMs) return 'cue-cooldown';
  if (cue.kind === 'ambient' && companion.surprise.nextAmbientAt !== null
      && now < companion.surprise.nextAmbientAt) return 'ambient-schedule';
  const recentIds = companion.surprise.recent.slice(-RECENT_WINDOW).map(item => item.cueId);
  if (recentIds.includes(cue.id)) return 'recent-repeat';
  return null;
}

function weightedChoice(cues, rng) {
  const total = cues.reduce((sum, cue) => sum + cue.weight, 0);
  if (total <= 0) return null;
  const sample = Number(rng());
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('RNG must return a number in [0, 1)');
  let cursor = sample * total;
  for (const cue of cues) {
    cursor -= cue.weight;
    if (cursor < 0) return cue;
  }
  return cues[cues.length - 1];
}

function selectSurprise({ companion, manifest, context = {}, clock, rng }) {
  if (!clock || typeof clock.now !== 'function') throw new TypeError('clock.now is required');
  if (typeof rng !== 'function') throw new TypeError('rng is required');
  const now = clock.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('clock.now must return a non-negative safe integer');
  const dayKey = typeof clock.dayKey === 'function' ? clock.dayKey(now) : localDayKey(now);
  const state = rollBudgetForward(companion, dayKey);
  if (state.surprise.pending) return { state, cue: null, variant: null, reason: 'pending' };
  const eligible = manifest.cues.filter(cue => cueEligibility(cue, state, context, now) === null);
  if (!eligible.length) return { state, cue: null, variant: null, reason: 'no-eligible-cue' };
  const cue = weightedChoice(eligible, rng);
  const normalizedContext = normalizeContext(context);
  const preferredVariant = normalizedContext.focused
    ? 'focus'
    : normalizedContext.reduceMotion ? 'static' : 'default';
  const variant = cue.variants.find(item => item.id === preferredVariant)
    || (normalizedContext.focused && cue.variants.find(item => item.static))
    || cue.variants.find(item => item.static === normalizedContext.reduceMotion)
    || cue.variants[0];
  return { state, cue, variant, reason: null };
}

function recordIssued(companion, cue, now, decisionId, ttlMs = 15_000) {
  let state = normalizeCompanionState(companion);
  const expiresAt = now + Math.max(1, Math.min(60_000, Math.round(ttlMs)));
  state.surprise.pending = {
    decisionId,
    cueId: cue.id,
    familyId: cue.familyId,
    issuedAt: now,
    expiresAt,
    status: 'issued',
    attempts: 1
  };
  state.surprise.lastGlobalAt = state.surprise.lastGlobalAt === null
    ? now
    : Math.max(state.surprise.lastGlobalAt, now);
  state = setLastByFamily(state, cue.familyId, now);
  if (cue.kind === 'attention') state.surprise.attentionSpent += cue.cost;
  else {
    state.surprise.ambientSpent += cue.cost;
    state.surprise.nextAmbientAt = now + 5 * 60_000;
  }
  return state;
}

module.exports = {
  MODE_BUDGETS,
  RECENT_WINDOW,
  normalizeContext,
  hardGateReason,
  rollBudgetForward,
  cueEligibility,
  weightedChoice,
  selectSurprise,
  recordIssued
};
