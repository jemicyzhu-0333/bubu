'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultCompanionState } = require('../src/core/companion-state');
const { selectSurprise, recordIssued, cueEligibility } = require('../src/core/surprise-rules');

function cue(id, overrides = {}) {
  return {
    id, familyId: overrides.familyId || 'family-a', kind: overrides.kind || 'attention',
    weight: overrides.weight || 1, priority: 1, cost: overrides.cost || 1,
    globalCooldownMs: overrides.globalCooldownMs ?? 0,
    familyCooldownMs: overrides.familyCooldownMs ?? 0,
    cooldownMs: overrides.cooldownMs ?? 0,
    focusAllowed: overrides.focusAllowed === true,
    discoveryId: null,
    variants: [
      { id: 'default', animationId: 'workout', message: 'move', durationMs: 1000, assetIds: [], static: false },
      { id: 'static', animationId: 'static-pose', message: 'still', durationMs: 1000, assetIds: [], static: true }
    ]
  };
}

const openContext = { visible: true, activityMode: 'balanced' };

test('selection uses injected clock and deterministic weighted RNG', () => {
  const manifest = { cues: [cue('cue-a', { weight: 1 }), cue('cue-b', { weight: 3, familyId: 'family-b' })] };
  const clock = { now: () => 1000, dayKey: () => '2026-08-31' };
  assert.equal(selectSurprise({ companion: defaultCompanionState(), manifest, context: openContext, clock, rng: () => 0 }).cue.id, 'cue-a');
  assert.equal(selectSurprise({ companion: defaultCompanionState(), manifest, context: openContext, clock, rng: () => 0.99 }).cue.id, 'cue-b');
});

test('local day rollover resets budgets once while clock rollback cannot refresh them', () => {
  const manifest = { cues: [cue('cue-a')] };
  const companion = defaultCompanionState();
  companion.surprise.budgetDay = '2026-08-31';
  companion.surprise.attentionSpent = 12;
  let selected = selectSurprise({ companion, manifest, context: openContext, clock: { now: () => 10, dayKey: () => '2026-08-31' }, rng: () => 0 });
  assert.equal(selected.cue, null);
  selected = selectSurprise({ companion, manifest, context: openContext, clock: { now: () => 20, dayKey: () => '2026-09-01' }, rng: () => 0 });
  assert.equal(selected.cue.id, 'cue-a');
  assert.equal(selected.state.surprise.attentionSpent, 0);
  selected = selectSurprise({ companion, manifest, context: openContext, clock: { now: () => 5, dayKey: () => '2026-08-30' }, rng: () => 0 });
  assert.equal(selected.cue, null);
  assert.equal(selected.state.surprise.budgetDay, '2026-08-31');
});

test('global, family, cue cooldowns and recent de-duplication independently block selection', () => {
  const base = defaultCompanionState();
  const candidate = cue('cue-a', { globalCooldownMs: 100, familyCooldownMs: 200, cooldownMs: 300 });
  base.surprise.lastGlobalAt = 950;
  assert.equal(cueEligibility(candidate, base, openContext, 1000), 'global-cooldown');
  base.surprise.lastGlobalAt = 0;
  base.surprise.lastByFamily['family-a'] = 900;
  assert.equal(cueEligibility(candidate, base, openContext, 1000), 'family-cooldown');
  base.surprise.lastByFamily = {};
  base.surprise.recent.push({ decisionId: 'd-a', cueId: 'cue-a', familyId: 'family-a', finishedAt: 800, outcome: 'completed' });
  assert.equal(cueEligibility(candidate, base, openContext, 1000), 'cue-cooldown');
  candidate.cooldownMs = 0;
  assert.equal(cueEligibility(candidate, base, openContext, 1000), 'recent-repeat');
});

test('hard gates survive chaos and focus only permits quiet focusAllowed ambient cues', () => {
  const attention = cue('cue-attention');
  const ambient = cue('cue-ambient', { kind: 'ambient', focusAllowed: true });
  for (const context of [
    { ...openContext, activityMode: 'chaos', dnd: true },
    { ...openContext, activityMode: 'chaos', sensitiveForeground: true },
    { ...openContext, activityMode: 'chaos', lowStimulation: true },
    { ...openContext, activityMode: 'chaos', reduceMotion: true },
    { ...openContext, activityMode: 'chaos', focused: true }
  ]) assert.notEqual(cueEligibility(attention, defaultCompanionState(), context, 1000), null);
  assert.equal(cueEligibility(ambient, defaultCompanionState(), { ...openContext, lowStimulation: true }, 1000), 'low-stimulation');
  assert.equal(cueEligibility(ambient, defaultCompanionState(), { ...openContext, focused: true }, 1000), null);
  const selected = selectSurprise({
    companion: defaultCompanionState(), manifest: { cues: [ambient] },
    context: { ...openContext, reduceMotion: true },
    clock: { now: () => 1000, dayKey: () => '2026-08-31' }, rng: () => 0
  });
  assert.equal(selected.variant.id, 'static');
});

test('issuing a cue spends only its own budget and creates a bounded pending envelope state', () => {
  const attention = cue('cue-a');
  const state = recordIssued(defaultCompanionState(), attention, 1000, 'decision-a', 90_000);
  assert.equal(state.surprise.attentionSpent, 1);
  assert.equal(state.surprise.ambientSpent, 0);
  assert.equal(state.surprise.pending.expiresAt, 61_000);
  assert.equal(state.surprise.pending.attempts, 1);
});
