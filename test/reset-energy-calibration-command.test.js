'use strict';

// ARCHITECTURE「日常与能量」's way back, from the application side: one press has to be able to reach
// the store, and the panel has to be able to tell "丢掉了" from "本来就没学过".

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

const profile = Object.freeze({
  baseline: { wakeHour: 8, morningRampMinutes: 120, postLunchDipDepth: 10, chronotypeShift: 0 },
  effectScale: { 'stimulant-default': 1.2 },
  observations: 14,
  updatedAt: 9_000,
  lastResidualMae: 12
});

test('a reset discards the learned profile in one commit and publishes once', () => {
  const repository = createRepository({ energyProfile: structuredClone(profile), energyCheckIn: null });
  const facts = [];
  const command = guidance.resetEnergyCalibration.createResetEnergyCalibrationCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 12_000 },
    publish: fact => facts.push(fact)
  });

  const result = command.execute();

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(repository.commits(), 1);
  // Back to null, which is the one value everything downstream reads as
  // "not calibrated" — a default profile here would be indistinguishable from a
  // learned one.
  assert.equal(repository.read().energyProfile, null);
  assert.deepEqual(facts, [{ type: 'energy-calibration-reset', resetAt: 12_000, revision: 1 }]);
});

test('resetting an uncalibrated profile writes nothing and says so', () => {
  const repository = createRepository({ energyProfile: null, energyCheckIn: null });
  let publishes = 0;
  const command = guidance.resetEnergyCalibration.createResetEnergyCalibrationCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 12_000 },
    publish: () => { publishes += 1; }
  });

  assert.deepEqual(command.execute(), { ok: true, changed: false });
  assert.equal(repository.commits(), 0);
  // No revision bump means no projection push: a press that changed nothing must
  // not look like a press that did.
  assert.equal(publishes, 0);
});

test('the reset keeps the reports themselves — only what was inferred from them goes', () => {
  const checkIn = { level: 70, state: 'medium', timestamp: 8_000 };
  const repository = createRepository({ energyProfile: structuredClone(profile), energyCheckIn: checkIn });
  const command = guidance.resetEnergyCalibration.createResetEnergyCalibrationCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 12_000 }
  });

  command.execute();

  // `energyCheckIn` is not in the write set on purpose: throwing the user's own
  // reports away with the model's guesses would restart the ten-day warm-up from
  // nothing while the evidence is still on disk.
  assert.deepEqual(repository.read().energyCheckIn, checkIn);
  assert.deepEqual(
    guidance.resetEnergyCalibration.RESET_ENERGY_CALIBRATION_WRITES,
    ['energyProfile']
  );
});

test('the reset command refuses collaborators it cannot commit or report through', () => {
  const unitOfWork = createUnitOfWork({ repository: createRepository({ energyProfile: null }) });
  const create = guidance.resetEnergyCalibration.createResetEnergyCalibrationCommand;
  assert.throws(() => create(), /requires a unit of work/);
  assert.throws(() => create({ unitOfWork }), /requires a clock/);
  assert.throws(
    () => create({ unitOfWork, clock: { now: () => 1 }, publish: 'nope' }),
    /effects must be functions/
  );
});
