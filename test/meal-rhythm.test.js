'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultMealCare, sampleMealRhythm, chooseAutoMeal, autoMealCandidates, SAMPLE_MS } = require('../src/capabilities/companion/domain/meal-rhythm');
const now = new Date(2026, 9, 6, 9).getTime();
const input = { now, dayKey: '2026-10-06', minuteOfDay: 540, workTotalMs: 0 };
test('opening after absence and gaps beyond six minutes never backcharge hunger', () => {
  for (const gap of [6 * 60000 + 1, 30 * 86400000]) {
    const pet = { satiation: 65, care: { ...defaultMealCare(), lastObservedAt: now - gap } };
    const result = sampleMealRhythm(pet, input); assert.equal(result.satiation, 65); assert.equal(result.slot, 'breakfast'); assert.equal(result.eligible, true);
  }
});
test('continuous five-minute appetite preserves fractions and charges real work separately', () => {
  const pet = { satiation: 45.5, care: { ...defaultMealCare(), lastObservedAt: now } };
  const idle = sampleMealRhythm(pet, { ...input, now: now + SAMPLE_MS });
  assert.equal(idle.satiation, 44.9); assert.equal(idle.eligible, true);
  const working = sampleMealRhythm(pet, { ...input, now: now + SAMPLE_MS, workTotalMs: SAMPLE_MS });
  assert.ok(working.satiation < idle.satiation);
  assert.equal(sampleMealRhythm({ ...pet, satiation: 25 }, { ...input, now: now + SAMPLE_MS }).satiation, 25);
});
test('duplicate time, rollback, auto day cap, fullness and one-hour cooldown prevent duplicate meals', () => {
  const care = { ...defaultMealCare(), lastObservedAt: now, lastMealAt: now, mealDay: input.dayKey, meals: ['breakfast'] };
  assert.equal(sampleMealRhythm({ satiation: 30, care }, input).changed, false);
  assert.equal(sampleMealRhythm({ satiation: 30, care }, { ...input, now: now - 1 }).changed, false);
  assert.equal(sampleMealRhythm({ satiation: 30, care }, { ...input, now: now + SAMPLE_MS }).eligible, false);
  assert.equal(sampleMealRhythm({ satiation: 100, care: defaultMealCare() }, input).eligible, false);
  assert.equal(sampleMealRhythm({ satiation: 30, care: { ...defaultMealCare(), autoFeeds: 6, mealDay: input.dayKey } }, input).eligible, false);
});
test('ordinary favorites win, special treats stay manual, and basic requires explicit checked availability', () => {
  const pet = { foodInventory: { carrot: 1, berry: 2, rice: 1, cake: 1 } };
  assert.equal(chooseAutoMeal(pet, 'usagi'), 'carrot'); assert.equal(chooseAutoMeal(pet, 'pink'), 'berry');
  assert.equal(chooseAutoMeal(pet, 'pink', 'cake'), 'berry'); assert.equal(chooseAutoMeal(pet, 'pink', 'rice'), 'rice');
  assert.deepEqual(autoMealCandidates({ foodInventory: { cake: 1, coffee: 1, donut: 1 } }, 'robot'), []);
  assert.equal(chooseAutoMeal({ foodInventory: {} }, 'pink'), null);
  assert.equal(chooseAutoMeal({ foodInventory: {} }, 'pink', null, true), 'basic');
});
test('meal windows are breakfast0900, lunch1230 and dinner1900 for ninety minutes', () => {
  for (const [minute, expected] of [[539,null],[540,'breakfast'],[629,'breakfast'],[630,null],[750,'lunch'],[839,'lunch'],[840,null],[1140,'dinner'],[1229,'dinner'],[1230,null]]) {
    assert.equal(sampleMealRhythm({ satiation: 65, care: defaultMealCare() }, { ...input, minuteOfDay: minute }).slot, expected);
  }
});
test('hungry overrides a still-valid accepted wait without a new decision', () => {
  const care = { ...defaultMealCare(), lastObservedAt: now, nextMealAt: now + 600000,
    plan: { foodId: 'berry', reactionIndex: 2, slot: 'breakfast', expiresAt: now + 960000 } };
  const sample = sampleMealRhythm({ satiation: 45.5, care }, { ...input, now: now + SAMPLE_MS });
  assert.equal(sample.satiation, 44.9); assert.equal(sample.eligible, true); assert.equal(sample.care.plan.foodId, 'berry');
});

test('meal timestamps are Date-bounded while version and counters remain safe-integer bounded', () => {
  const { normalizeMealCare, MAX_TIMESTAMP } = require('../src/capabilities/companion/domain/meal-rhythm');
  for (const field of ['lastObservedAt', 'lastMealAt', 'nextMealAt']) {
    assert.equal(normalizeMealCare({ ...defaultMealCare(), [field]: MAX_TIMESTAMP + 1 })[field], null);
    assert.equal(normalizeMealCare({ ...defaultMealCare(), [field]: MAX_TIMESTAMP })[field], MAX_TIMESTAMP);
  }
  assert.equal(normalizeMealCare({ ...defaultMealCare(), version: Number.MAX_SAFE_INTEGER }).version, Number.MAX_SAFE_INTEGER);
  assert.equal(normalizeMealCare({ ...defaultMealCare(), decision: { id: `${now}:1`, expiresAt: Number.MAX_SAFE_INTEGER, slot: 'breakfast' } }).decision, null);
  assert.equal(normalizeMealCare({ ...defaultMealCare(), plan: { foodId: 'berry', reactionIndex: 0, slot: null, expiresAt: Number.MAX_SAFE_INTEGER } }).plan, null);
  assert.throws(() => sampleMealRhythm({ satiation: 65, care: defaultMealCare() }, { ...input, now: MAX_TIMESTAMP + 1 }), /invalid-meal-sample/);
});
