'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createAdvanceMealCareCommand, createResolveMealDecisionCommand,
  createUpdatePreferencesWorkflow } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { FOODS } = require('../src/content/legacy-pet-content');
const { localDayKey } = require('../src/core/calendar');
const START = new Date(2026, 9, 6, 9).getTime();
function fixture() {
  let now = START, state = normalizePersistedState({}, { now }), revision = 0, fail = false;
  state.settings.aiBreakdownEnabled = state.settings.aiPetMealsEnabled = true; state.pet.foodInventory.milk = 1;
  const effects = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) { if (fail) throw new Error('refused preferences commit');
      state = normalizePersistedState(candidate, { now }); revision++; return structuredClone(state); } };
  const ports = { unitOfWork: createUnitOfWork({ repository }), clock: { now: () => now }, foods: FOODS };
  const advance = createAdvanceMealCareCommand({ ...ports,
    calendar: () => ({ dayKey: localDayKey(now), minuteOfDay: 540 + (now - START) / 60000 }) });
  const resolve = createResolveMealDecisionCommand(ports);
  const settings = createUpdatePreferencesWorkflow({ ...ports, publish: fact => effects.push(fact) });
  const intent = advance.execute({ aiAvailable: true }).intent;
  return { advance, resolve, settings, intent, effects, read: () => structuredClone(state), revision: () => revision,
    delay() { return resolve.execute({ decisionId: intent.id, advice: { foodId: 'milk', waitMinutes: 5, reactionIndex: 2 } }); },
    edit: fn => { fn(state); }, time: value => { now = value; }, fail: () => { fail = true; } };
}
for (const flag of ['aiBreakdownEnabled', 'aiPetMealsEnabled']) test(`${flag} off/on atomically drops an accepted plan without spending food or refunding quota`, () => {
  const f = fixture(); assert.equal(f.delay().ok, true);
  const before = f.read(), revision = f.revision(); assert.equal(before.pet.care.plan.foodId, 'milk');
  const off = f.settings.execute({ patch: { [flag]: false } });
  assert.equal(off.ok, true); assert.equal(f.revision(), revision + 1);
  const state = f.read(); assert.equal(state.pet.care.plan, null); assert.equal(state.pet.care.nextMealAt, null);
  assert.equal(state.pet.care.decision, null); assert.equal(state.pet.care.aiCalls, 1);
  assert.deepEqual(state.pet.foodInventory, before.pet.foodInventory); assert.equal(state.pet.satiation, before.pet.satiation);
  assert.equal(state.pet.care.lastMealAt, before.pet.care.lastMealAt); assert.deepEqual(state.rewardLedger, before.rewardLedger);
  assert.equal(f.settings.execute({ patch: { [flag]: true } }).ok, true);
  f.time(START + 300000); assert.equal(f.advance.execute().meal.foodId, 'berry');
  assert.equal(f.read().pet.foodInventory.milk, 1); assert.equal(f.read().pet.care.aiCalls, 1);
});

test('an off/on transition invalidates a still-pending result by its original decision identity', () => {
  const f = fixture(); f.settings.execute({ patch: { aiPetMealsEnabled: false } });
  f.settings.execute({ patch: { aiPetMealsEnabled: true } }); const before = f.read();
  assert.equal(f.resolve.execute({ decisionId: f.intent.id, advice: { foodId: 'milk', waitMinutes: 0, reactionIndex: 2 } }).reason, 'meal-decision-expired');
  assert.deepEqual(f.read(), before);
});

test('failed or invalid preference updates cannot partially clear a meal plan', () => {
  const f = fixture(); f.delay(); const before = f.read(), revision = f.revision();
  assert.equal(f.settings.execute({ patch: { aiPetMealsEnabled: false, unknown: true } }).ok, false);
  assert.deepEqual(f.read(), before); f.fail();
  assert.throws(() => f.settings.execute({ patch: { aiPetMealsEnabled: false } }), /refused preferences commit/);
  assert.deepEqual(f.read(), before); assert.equal(f.revision(), revision); assert.equal(f.effects.length, 0);
});

test('unrelated preferences preserve enabled meal choices and explicit repeated opt-out is idempotent', () => {
  const f = fixture(); f.delay(); const care = f.read().pet.care;
  assert.equal(f.settings.execute({ patch: { dnd: true } }).ok, true); assert.deepEqual(f.read().pet.care, care);
  f.edit(state => { state.settings.aiPetMealsEnabled = false; });
  assert.equal(f.settings.execute({ patch: { aiPetMealsEnabled: false } }).changed, true);
  assert.equal(f.read().pet.care.plan, null); const revision = f.revision();
  assert.equal(f.settings.execute({ patch: { aiPetMealsEnabled: false } }).changed, false); assert.equal(f.revision(), revision);
});

test('meal version capacity cannot prevent disabling AI and clearing accepted work', () => {
  const f = fixture(); f.delay(); f.edit(state => { state.pet.care.version = Number.MAX_SAFE_INTEGER; });
  const result = f.settings.execute({ patch: { aiPetMealsEnabled: false } });
  assert.equal(result.ok, true); assert.equal(f.read().settings.aiPetMealsEnabled, false);
  assert.equal(f.read().pet.care.version, Number.MAX_SAFE_INTEGER); assert.equal(f.read().pet.care.plan, null);
});

test('the local sampler also discards a disabled restored choice before waiting or serving', () => {
  const f = fixture(); f.delay(); f.edit(state => { state.settings.aiPetMealsEnabled = false; });
  const before = f.read();
  const sample = f.advance.execute();
  assert.equal(sample.ok, true); assert.equal(sample.intent, null); assert.equal(sample.meal, null);
  assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.care.nextMealAt, null);
  assert.deepEqual(f.read().pet.foodInventory, before.pet.foodInventory); assert.equal(f.read().pet.care.aiCalls, 1);
});

test('disabled same-time and later sampler cleans stale advice at saturated version without any food effects', () => {
  for (const at of [START, START + 300000]) {
    const f = fixture(); f.delay(); f.edit(state => { state.settings.aiPetMealsEnabled = false; state.pet.care.version = Number.MAX_SAFE_INTEGER; });
    f.time(at); const before = f.read(); const result = f.advance.execute({ aiAvailable: true });
    assert.equal(result.ok, true); assert.equal(result.meal, null); assert.equal(result.intent, null);
    const state = f.read(); assert.equal(state.pet.care.plan, null); assert.equal(state.pet.care.nextMealAt, null);
    assert.equal(state.pet.care.version, Number.MAX_SAFE_INTEGER); assert.equal(state.pet.care.aiCalls, before.pet.care.aiCalls);
    assert.equal(state.pet.satiation, before.pet.satiation); assert.deepEqual(state.pet.foodInventory, before.pet.foodInventory);
    assert.deepEqual(state.companion, before.companion); assert.deepEqual(state.rewardLedger, before.rewardLedger);
  }
});
test('a late resolver while disabled clears pending choice with no fallback meal or quota refund', () => {
  const f = fixture(); f.edit(state => { state.settings.aiBreakdownEnabled = false; }); const before = f.read();
  const result = f.resolve.execute({ decisionId: f.intent.id, advice: { foodId: 'milk', waitMinutes: 0, reactionIndex: 2 } });
  assert.equal(result.ok, true); assert.equal(result.meal, null); assert.equal(f.read().pet.care.decision, null);
  assert.equal(f.read().pet.care.aiCalls, 1); assert.equal(f.read().pet.satiation, before.pet.satiation);
  assert.deepEqual(f.read().pet.foodInventory, before.pet.foodInventory); assert.deepEqual(f.read().companion, before.companion);
});
