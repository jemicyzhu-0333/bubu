'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const guidance = require('../src/capabilities/guidance');

function repositoryFrom(initial) {
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

test('relative energy calibration moves from the current estimate in ten-point steps', () => {
  const repository = repositoryFrom({ energyCheckIn: null });
  const events = [];
  let now = 1_000;
  const command = guidance.adjustEnergy.createAdjustEnergyCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => now++ },
    currentLevelFor: state => state.energyCheckIn ? state.energyCheckIn.level : 54.4,
    publish: fact => events.push(fact)
  });

  assert.equal(command.execute({ direction: 'higher' }).checkIn.level, 64);
  assert.equal(command.execute({ direction: 'lower' }).checkIn.level, 54);
  assert.equal(command.execute({ direction: 'same' }).checkIn.level, 54);
  assert.equal(repository.inspect().commits, 3);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event.direction), ['higher', 'lower', 'same']);
});

test('relative calibration cannot leave 10–90 or refresh an anchor at a hard edge', () => {
  for (const [currentLevel, direction, expected] of [
    [87.6, 'higher', 90],
    [12.2, 'lower', 10]
  ]) {
    const repository = repositoryFrom({ energyCheckIn: null });
    let current = currentLevel;
    const command = guidance.adjustEnergy.createAdjustEnergyCommand({
      unitOfWork: createUnitOfWork({ repository }),
      clock: { now: () => 2_000 },
      currentLevelFor: () => current
    });
    const first = command.execute({ direction });
    assert.equal(first.checkIn.level, expected);
    current = expected;
    const atBoundary = command.execute({ direction });
    assert.deepEqual(atBoundary, { ok: true, changed: false, checkIn: first.checkIn });
    assert.equal(repository.inspect().commits, 1);
  }
});

test('invalid directions and stale revisions have no writes or effects', () => {
  const repository = repositoryFrom({ energyCheckIn: null });
  let published = 0;
  const command = guidance.adjustEnergy.createAdjustEnergyCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 3_000 },
    currentLevelFor: () => 50,
    publish: () => { published += 1; }
  });

  assert.equal(command.execute({ direction: 'maximum' }).reason, 'energy-adjustment-invalid');
  assert.equal(command.execute({ direction: 'higher', expectedRevision: 4 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.equal(published, 0);
});
