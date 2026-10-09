'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sourceState, NOW, app, SKINS, PET_APPEARANCE_ITEMS } = require('../test-support/surface-sync-fixture');
function initialCareState() {
  const initial = sourceState();
  initial.pet.satiation = 44.9;
  initial.pet.care.lastObservedAt = NOW - 3_600_000;
  return initial;
}
for (const getter of ['getState', 'getFeedState']) test(`${getter} is a pure one-sample read with no offline hunger or quota mutation`, () => {
  const h = harness({ initial: initialCareState() }), before = h.state();
  h.resetCounts();
  const first = h.petQueries[getter]();
  assert.equal(first.satiation, 44.9); assert.equal(first.basicMeal.remaining, 3);
  assert.equal(first.foodTickets, 6);
  assert.equal(h.counts.snapshot, 1); assert.equal(h.counts.wall, 1); assert.equal(h.counts.projectSession, 1);
  h.setTime(NOW + 7 * 86_400_000);
  const second = h.petQueries[getter]();
  assert.equal(second.satiation, 44.9); assert.equal(second.basicMeal.remaining, 3);
  assert.equal(h.commits(), 0); assert.equal(h.publisher.readRevision(), 0);
  assert.deepEqual(h.messages, []); assert.deepEqual(h.state(), before);
});
test('pure project/read publication retains fractional satiation and independently bounded basic projection', () => {
  const h = harness({ initial: initialCareState() }), before = h.state();
  const sample = h.readSample();
  const context = app.projectPetContext(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: 0 });
  assert.deepEqual(context.basicMeal, sample.feedState.basicMeal);
  app.projectPetState(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: 0 });
  h.publish({ all: true });
  assert.equal(h.commits(), 0); assert.deepEqual(h.state(), before);
  assert.equal(h.message('pet').satiation, 44.9);
});
test('getter hydration carries current shared canonical fields without expanding private data', () => {
  const h = harness({ initial: initialCareState() });
  h.publish({ all: true });
  const state = h.petQueries.getState(), live = h.message('pet');
  assert.equal(state.contextRevision, live.contextRevision); assert.equal(state.contextRevision, 1);
  assert.equal(state.state, live.baseState); assert.equal(state.energy.level, live.energyLevel);
  for (const key of ['paused', 'focusRing', 'sessionDisplay', 'skin', 'level', 'theme', 'appearanceItemIds', 'work', 'satiation',
    'foodTickets', 'foodInventory', 'totalFeeds', 'basicMeal', 'motionMode', 'stimulationMode', 'dnd']) {
    assert.deepEqual(state[key], live[key]);
  }
  for (const key of ['snapshot', 'settings', 'coffeeBonusUntil', 'care']) assert.equal(Object.hasOwn(state, key), false);
});
for (const fault of ['sendPopover', 'sizeQuick', 'sendQuick', 'sendPet', 'projectPopover', 'projectPet', 'afterPet']) {
  test(`${fault} failure cannot make a getter mutate or retry care`, () => {
    const h = harness({ initial: initialCareState(), faults: { [fault]: true, report: true } });
    const before = h.state(); h.publish({ pet: true });
    assert.equal(h.petQueries.getState().satiation, 44.9);
    assert.equal(h.petQueries.getFeedState().satiation, 44.9);
    assert.equal(h.commits(), 0); assert.deepEqual(h.state(), before);
    assert.equal(h.publisher.readRevision(), 1);
  });
}
for (const getter of ['getState', 'getFeedState']) test(`${getter} requires a successful authoritative read and never writes on failure`, () => {
  const h = harness({ initial: initialCareState(), faults: { readSample: true, commit: true } }), before = h.state();
  assert.throws(() => h.petQueries[getter](), /readSample/);
  assert.equal(h.commits(), 0); assert.equal(h.publisher.readRevision(), 0);
  assert.deepEqual(h.messages, []); assert.deepEqual(h.state(), before);
});
