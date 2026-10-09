'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, START } = require('../test-support/growth-food-fixture');
function enabled(f) { f.edit(s => { s.settings.aiBreakdownEnabled = s.settings.aiPetMealsEnabled = true; }); return f; }

test('local breakfast consumes ordinary stock once without XP, tickets, bond or manual-feed count', () => {
  const f = fixture(), result = f.advance.execute(), state = f.read();
  assert.equal(result.meal.foodId, 'berry'); assert.equal(state.pet.foodInventory.berry, 1);
  assert.equal(state.pet.totalFeeds, 0); assert.equal(state.pet.care.autoFeeds, 1); assert.deepEqual(state.pet.care.meals, ['breakfast']);
  assert.equal(state.xp, 0); assert.equal(state.pet.foodTickets, 6); assert.equal(state.companion.relationships.dango.bondPoints, 0);
  assert.equal(f.advance.execute().meal, null); f.time(START + 300000); assert.equal(f.advance.execute().meal, null);
});
test('empty ordinary pantry is free-food eligible only while hungry; reminder waits for permission', () => {
  const f = fixture(); f.edit(s => { s.pet.foodInventory.berry = 0; });
  assert.equal(f.advance.execute().meal, null); assert.equal(f.read().pet.care.reminderPending, false);
  f.edit(s => { s.pet.satiation = 40; }); f.time(START + 300000);
  assert.equal(f.advance.execute().meal.foodId, 'basic'); assert.equal(f.read().pet.care.reminderPending, true);
  f.time(START + 600000); assert.match(f.advance.execute({ canRemind: true }).reminder, /基础餐/);
  f.time(START + 900000); assert.equal(f.advance.execute({ canRemind: true }).reminder, null);
  assert.equal(f.read().pet.foodTickets, 6); assert.equal(f.read().pet.totalFeeds, 0);
});
test('stale expected version and failed commits cannot leave partial meal candidates or AI reservations', () => {
  const f = enabled(fixture()); const before = f.read();
  assert.equal(f.advance.execute({ expectedCareVersion: 1 }).reason, 'meal-care-changed'); assert.deepEqual(f.read(), before);
  f.fail(true); assert.throws(() => f.advance.execute({ aiAvailable: true }), /synthetic commit refusal/); assert.deepEqual(f.read(), before);
  f.fail(false); assert.equal(f.advance.execute({ aiAvailable: true }).intent.id, `${START}:1`); assert.equal(f.read().pet.care.aiCalls, 1);
});
test('bounded AI advice can wait then eat preferred accepted food without a second reservation', () => {
  const f = enabled(fixture()); f.edit(s => { s.pet.foodInventory.milk = 1; });
  const { intent } = f.advance.execute({ aiAvailable: true });
  assert.deepEqual(Object.keys(intent.payload).sort(), ['character','favorite','foods','meal','satiation']);
  assert.equal(intent.payload.character, 'dango'); assert.equal(f.read().pet.care.aiCalls, 1);
  assert.equal(f.resolve.execute({ decisionId: intent.id, advice: { foodId: 'milk', waitMinutes: 5, reactionIndex: 1 } }).meal, null);
  assert.equal(f.read().pet.care.plan.foodId, 'milk');
  const before = f.read(); assert.equal(f.resolve.execute({ decisionId: intent.id }).reason, 'meal-decision-expired'); assert.deepEqual(f.read(), before);
  f.time(START + 300000); assert.equal(f.advance.execute({ aiAvailable: true }).meal.foodId, 'milk');
  assert.equal(f.read().pet.foodInventory.milk, 0); assert.equal(f.read().pet.care.aiCalls, 1); assert.equal(f.read().pet.care.plan, null);
});
test('hungry transition45.5→44.9 overrides accepted ten-minute wait using the same reserved decision', () => {
  const f = enabled(fixture()); f.edit(s => { s.pet.satiation = 45.5; s.pet.foodInventory.milk = 1; });
  const { intent } = f.advance.execute({ aiAvailable: true });
  f.resolve.execute({ decisionId: intent.id, advice: { foodId: 'milk', waitMinutes: 10, reactionIndex: 2 } });
  f.time(START + 300000); const result = f.advance.execute({ aiAvailable: true });
  assert.equal(result.meal.foodId, 'milk'); assert.equal(result.meal.satiation, 56.9);
  assert.equal(result.intent, null); assert.equal(f.read().pet.care.aiCalls, 1);
});
test('manual feeding makes any delayed AI response stale without another inventory change', () => {
  const f = enabled(fixture()), { intent } = f.advance.execute({ aiAvailable: true });
  f.feed.execute(f.request('berry')); const before = f.read();
  assert.equal(f.resolve.execute({ decisionId: intent.id, advice: { foodId: 'berry', waitMinutes: 0, reactionIndex: 1 } }).reason, 'meal-decision-expired');
  assert.deepEqual(f.read(), before);
});
test('malformed, unavailable, expired and backward-time decisions use safe local fallback or refuse stale identity', () => {
  for (const advice of [{ foodId: 'cake', waitMinutes: 0, reactionIndex: 0 }, { foodId: 'berry', waitMinutes: 1, reactionIndex: 0 },
    { foodId: 'berry', waitMinutes: 5, reactionIndex: 3 }, { foodId: 'berry', waitMinutes: 5, reactionIndex: 1, extra: 'text' }]) {
    const f = enabled(fixture()), { intent } = f.advance.execute({ aiAvailable: true });
    assert.equal(f.resolve.execute({ decisionId: intent.id, advice }).meal.foodId, 'berry'); assert.equal(f.read().pet.care.plan, null);
  }
  for (const at of [START - 1, START + 30000]) {
    const f = enabled(fixture()), { intent } = f.advance.execute({ aiAvailable: true }); f.time(at); const before = f.read();
    assert.equal(f.resolve.execute({ decisionId: intent.id }).reason, 'meal-decision-expired'); assert.deepEqual(f.read(), before);
  }
});
test('three daily reserved decisions do not refill on rollback or failure and fourth eligible meal is local', () => {
  const f = enabled(fixture()); f.edit(s => { s.pet.foodInventory.berry = 10; });
  for (let i = 0; i < 3; i++) {
    f.time(START + i * 61 * 60000); f.edit(s => { s.pet.satiation = 35; });
    const { intent } = f.advance.execute({ aiAvailable: true }); assert.ok(intent); assert.equal(f.read().pet.care.aiCalls, i + 1);
    assert.ok(f.resolve.execute({ decisionId: intent.id }).meal);
  }
  f.time(START + 3 * 61 * 60000); f.edit(s => { s.pet.satiation = 35; });
  const result = f.advance.execute({ aiAvailable: true }); assert.equal(result.intent, null); assert.ok(result.meal); assert.equal(f.read().pet.care.aiCalls, 3);
});
test('resolver rechecks automatic cooldown and daily cap before serving captured food', () => {
  for (const mutate of [s => { s.pet.care.lastMealAt = START; }, s => { s.pet.care.autoFeeds = 6; }]) {
    const f = enabled(fixture()), { intent } = f.advance.execute({ aiAvailable: true }); f.edit(mutate);
    const before = f.read(); const result = f.resolve.execute({ decisionId: intent.id });
    assert.equal(result.meal, null); assert.deepEqual(f.read().pet.foodInventory, before.pet.foodInventory); assert.equal(f.read().pet.satiation, before.pet.satiation);
  }
});
test('failed meal effect does not reject committed food or repeat it on next identical sample', () => {
  let effects = 0; const f = fixture({ publish() { effects++; throw new Error('closed surface'); } });
  assert.equal(f.advance.execute().ok, true); assert.equal(f.advance.execute().meal, null);
  assert.equal(f.revision(), 1); assert.equal(effects, 1); assert.equal(f.read().pet.foodInventory.berry, 1);
});
