'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, START } = require('../test-support/growth-food-fixture');

test('feed queries remain pure after absence and never decay, refill or consume an allowance', () => {
  const f = fixture(); const before = f.read(); f.time(START + 40 * 86400000);
  for (let i = 0; i < 3; i++) {
    const view = f.view(); assert.equal(view.satiation, 65); assert.equal(view.foodTickets, 6);
    assert.equal(view.basicMeal.remaining, 3); assert.equal(view.basicMeal.eligible, false);
    assert.equal(view.basicMeal.reason, 'basic-meal-not-needed'); view.foodInventory.berry = 900;
  }
  assert.deepEqual(f.read(), before); assert.equal(f.revision(), 0); assert.equal(f.effects.length, 0);
});
test('feed projection uses the monotonic care day and fractional appetite without rewriting canonical care', () => {
  const f = fixture(); f.edit(s => { s.pet.care.mealDay = '2026-10-08'; s.pet.satiation = 45.5; });
  const before = f.read(), view = f.view(); assert.equal(view.basicMeal.dayKey, '2026-10-08');
  assert.equal(view.satiation, 45.5); assert.equal(view.basicMeal.eligible, false); assert.deepEqual(f.read(), before);
});
