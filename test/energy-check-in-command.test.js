'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const guidance = require('../src/capabilities/guidance');

function createRepository(initialState) {
  let state = structuredClone(initialState);
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
    read: () => structuredClone(state),
    commits: () => commits
  };
}

test('energy check-ins enter guidance ownership and publish only after one commit', () => {
  const repository = createRepository({ energyCheckIn: null });
  const events = [];
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 1_100 },
    publish: fact => events.push(['publish', fact.checkIn.level])
  });
  const checkIn = { level: 35, state: 'low', timestamp: 1_000 };

  const result = command.execute({ checkIn });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(repository.commits(), 1);
  assert.deepEqual(repository.read().energyCheckIn, checkIn);
  assert.deepEqual(events, [['publish', 35]]);
});

test('invalid, repeated and stale energy check-ins perform zero writes and effects', () => {
  const checkIn = { level: 60, state: 'medium', timestamp: 2_000 };
  const repository = createRepository({ energyCheckIn: checkIn });
  let publishes = 0;
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 2_100 },
    publish: () => { publishes += 1; }
  });

  assert.equal(command.execute({ checkIn: { ...checkIn, level: 101 } }).reason, 'energy-check-in-invalid');
  assert.equal(command.execute({ checkIn }).changed, false);
  assert.equal(command.execute({ checkIn: { ...checkIn, level: 50 }, expectedRevision: 8 }).reason, 'state-revision-conflict');
  assert.equal(repository.commits(), 0);
  assert.equal(publishes, 0);
});
