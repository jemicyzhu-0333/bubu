'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const companion = require('../src/capabilities/companion');

test('continuous meal sampling persists fractional satiation without retired decay fields', () => {
  const now = new Date(2026, 9, 6, 9).getTime();
  const persisted = normalizePersistedState({ pet: { satiation: 45.5 } }, { now });
  persisted.pet.care.lastObservedAt = now;
  const sample = companion.mealRhythm.sampleMealRhythm(persisted.pet, {
    now: now + 300000, dayKey: '2026-10-06', minuteOfDay: 545, workTotalMs: 0
  });
  persisted.pet = { ...persisted.pet, satiation: sample.satiation, care: sample.care };
  assert.equal(persisted.pet.satiation, 44.9);
  assert.equal(Object.hasOwn(persisted.pet, 'lastSatiationTick'), false);
  assert.equal(Object.hasOwn(persisted.pet, 'satiationDecayRemainder'), false);
  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.deepEqual(normalizePersistedState(serialized, { now: now + 86400000 }), serialized);
  const afterGap = companion.mealRhythm.sampleMealRhythm(persisted.pet, {
    now: now + 86400000, dayKey: '2026-10-07', minuteOfDay: 540, workTotalMs: 0
  });
  assert.equal(afterGap.satiation, 44.9, 'absence does not create an offline hunger debt');
});
