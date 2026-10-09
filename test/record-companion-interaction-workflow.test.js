'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createRecordCompanionInteractionWorkflow } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const NOW = Date.parse('2026-09-09T12:00:00Z');

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function initialState() {
  return normalizePersistedState({
    pet: { foodInventory: { fish: 1 } },
    unlockedSkins: ['pink'],
    level: 2,
    streak: 0,
    stats: { totalTasksDone: 0, totalPomodoros: 0 },
    rewardLedger: { version: 3, events: [], seenEventIds: [], dailyBucketTotals: {}, stepBudgets: {} }
  }, { now: NOW });
}

function createWorkflow(repository, events = []) {
  return createRecordCompanionInteractionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    publish: fact => events.push(fact)
  });
}

test('interaction reward commits progress, bond and unlocks without touching retired feed counters', () => {
  const repository = createRepository(initialState());
  const events = [];
  const workflow = createWorkflow(repository, events);

  const first = workflow.execute({ interactionId: 'click-50' });
  const second = workflow.execute({ interactionId: 'click-50' });
  const persisted = repository.inspect();

  assert.equal(first.ok, true);
  assert.equal(first.gainedXp, 0);
  assert.equal(first.reward.recorded, true);
  assert.equal(first.bond.bondPoints, 1);
  assert.equal(second.gainedXp, 0);
  assert.equal(second.reward.recorded, false);
  assert.equal(persisted.commits, 1);
  assert.equal(Object.hasOwn(persisted.state.pet, 'dailyFeedXp'), false);
  assert.equal(Object.hasOwn(persisted.state.pet, 'dailyFeedXpDate'), false);
  assert.equal(persisted.state.xp, 0);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 1);
  assert.deepEqual(events.map(event => event.type), ['companion-interaction-recorded']);
});

test('unsupported interactions are a true no-op for canonical progress', () => {
  const repository = createRepository(initialState());
  const events = [];
  const workflow = createWorkflow(repository, events);

  const result = workflow.execute({ interactionId: 'unsupported' });
  const persisted = repository.inspect();

  assert.equal(result.ok, true);
  assert.equal(result.gainedXp, 0);
  assert.equal(result.reward.recorded, false);
  assert.equal(persisted.commits, 0);
  assert.equal(Object.hasOwn(persisted.state.pet, 'dailyFeedXpDate'), false);
  assert.equal(persisted.state.xp, 0);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 0);
  assert.deepEqual(events, []);
});
