'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FOODS } = require('../src/content/legacy-pet-content');
const shop = require('../src/capabilities/companion/domain/food-shop');
const { prepareFeed } = require('../src/capabilities/companion/domain/feeding');

test('food restoration uses one-ticket berries and level-two rice', () => {
  assert.equal(shop.quoteFood('berry', FOODS).price, 1);
  assert.equal(shop.foodUnlocked('rice', 2), true);
});
test('basic food is cataloged at nominal thirty with bounded hungry-only feeding', () => {
  assert.equal(FOODS.basic?.satiation, 30);
});
test('manual feeding never charges elapsed offline hunger or grants coffee productivity', () => {
  const state = { currentSkin: 'pink', pet: { satiation: 45.5, totalFeeds: 0, foodInventory: { coffee: 1 }, lastSatiationTick: 0 } };
  const result = prepareFeed(state, { foodId: 'coffee', food: FOODS.coffee, now: 86400000 });
  assert.equal(result.satiation, 50.5);
  assert.equal(Object.hasOwn(result, 'coffeeBonusUntil'), false);
});

test('reconstructed food rituals are finite and refer only to existing actions and expressions', () => {
  const { foodRitual, appetiteLabel } = require('../src/content/food-rituals.mjs');
  const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
  const { EXPECTED_EXPRESSION_IDS } = require('../src/content/expressions.mjs');
  for (const id of Object.keys(FOODS)) {
    const ritual = foodRitual(id); assert.ok(PET_ACTIONS[ritual.actionId]);
    assert.equal(ritual.durations.length, 3); assert.equal(ritual.expressions.length, 3); assert.equal(ritual.lines.length, 3);
    assert.ok(ritual.durations.every(value => Number.isFinite(value) && value > 0 && value <= 5000));
    assert.ok(ritual.expressions.every(id => EXPECTED_EXPRESSION_IDS.includes(id)));
    assert.ok(ritual.lines.every(line => typeof line === 'string' && line.length <= 100));
  }
  assert.notEqual(appetiteLabel(45), appetiteLabel(45.5));
});
test('closing alone never claims daily tickets and later first advance still grants three', () => {
  const { fixture, START } = require('../test-support/growth-food-fixture');
  const benefits = require('../src/capabilities/companion/domain/completion-benefits');
  const { localDayKey } = require('../src/core/calendar');
  const f = fixture(), state = f.read(), dateKey = localDayKey(START);
  const close = benefits.applyGrowthBenefits(state, { now: START, reward: { closeGranted: true, firstAdvance: false, event: { dateKey } } });
  assert.equal(close.ticketsGranted, false); assert.equal(state.pet.foodTickets, 6); assert.equal(state.pet.lastTicketDay, null);
  assert.equal(state.companion.relationships.dango.bondPoints, 1);
  const advance = benefits.applyGrowthBenefits(state, { now: START, reward: { firstAdvance: true, event: { dateKey } } });
  assert.equal(advance.ticketsGranted, true); assert.equal(state.pet.foodTickets, 9);
  assert.equal(state.companion.relationships.dango.bondPoints, 3);
  assert.equal(benefits.applyGrowthBenefits(state, { now: START, reward: { firstAdvance: true, event: { dateKey } } }).ticketsGranted, false);
});
test('wallet overflow rejects an entire growth candidate without retaining earlier state changes', () => {
  const { fixture, START } = require('../test-support/growth-food-fixture');
  const benefits = require('../src/capabilities/companion/domain/completion-benefits');
  const { localDayKey } = require('../src/core/calendar');
  const f = fixture(); f.edit(s => { s.pet.foodTickets = Number.MAX_SAFE_INTEGER - 2; }); const before = f.read();
  assert.throws(() => f.unitOfWork.run({ writes: ['xp', 'pet', 'companion'], transition(state) {
    state.xp += 10;
    benefits.applyGrowthBenefits(state, { now: START, reward: { firstAdvance: true, event: { dateKey: localDayKey(START) } } });
    return { ok: true };
  } }), /food-wallet-capacity/);
  assert.deepEqual(f.read(), before); assert.equal(f.revision(), 0);
});
test('profile-wide care claims cannot replenish by switching role or reversing local day', () => {
  const { fixture, START } = require('../test-support/growth-food-fixture');
  const { applyBondToState } = require('../src/capabilities/companion/domain/completion-benefits');
  const f = fixture(), state = f.read();
  assert.equal(applyBondToState(state, { points: 1, kind: 'care', at: START }).granted, 1);
  state.currentSkin = 'usagi'; assert.equal(applyBondToState(state, { points: 1, kind: 'care', at: START }).granted, 0);
  assert.equal(applyBondToState(state, { points: 1, kind: 'advance', at: START - 86400000 }).granted, 0);
  assert.equal(applyBondToState(state, { points: 1, kind: 'care', at: START + 86400000 }).granted, 1);
});

test('growth bond uses effective reward day after rollback while preserving actual relationship timestamps', () => {
  const { fixture, START } = require('../test-support/growth-food-fixture');
  const benefits = require('../src/capabilities/companion/domain/completion-benefits');
  const { localDayKey } = require('../src/core/calendar');
  const state = fixture().read(), later = START + 86400000, dateKey = localDayKey(later);
  benefits.applyGrowthBenefits(state, { now: later, reward: { closeGranted: true, event: { dateKey } } });
  state.currentSkin = 'usagi';
  benefits.applyGrowthBenefits(state, { now: START, reward: { firstAdvance: true, event: { dateKey } } });
  assert.equal(state.pet.foodTickets, 9); assert.equal(state.companion.bondDay, dateKey);
  assert.deepEqual(state.companion.bondClaims, { advance: true, close: true, care: false });
  assert.equal(state.companion.relationships.dango.bondPoints, 1); assert.equal(state.companion.relationships.usagi.bondPoints, 2);
  assert.equal(state.companion.relationships.usagi.firstMetAt, START);
  state.currentSkin = 'pink'; benefits.applyGrowthBenefits(state, { now: later, reward: { firstAdvance: true, event: { dateKey } } });
  assert.equal(state.companion.relationships.dango.bondPoints, 1); assert.equal(state.pet.foodTickets, 9);
});
