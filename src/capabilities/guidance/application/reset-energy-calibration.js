'use strict';

// ARCHITECTURE「日常与能量」's way back: "一段异常时期（生病、倒时差）学出来的参数，用户要能一键丢掉".
//
// This is its own writer rather than a branch of the daily pass, because the two
// are opposite kinds of event. Calibration is something the application does to
// the user once a day, off a watermark, and must never be triggerable from a
// surface; a reset is something the user does on purpose, at a moment of their
// choosing, and has to reach the store the same way every other button does. A
// reset folded into `run-daily-reset` would either wait until midnight to take
// effect or give the daily pass a surface-reachable entry point.
//
// The write set is one path. `energyCheckIn` is deliberately not in it: the user
// is discarding what the model *inferred*, not the reports they made. Throwing
// their own history away with it would mean the next ten days of warm-up start
// from nothing even though the evidence is still on disk.

const guidance = require('../domain/energy-calibration');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const RESET_ENERGY_CALIBRATION_WRITES = Object.freeze(['energyProfile']);

function createResetEnergyCalibrationCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('reset-energy-calibration command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('reset-energy-calibration command requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('reset-energy-calibration command effects must be functions');
  }

  function execute() {
    const resetAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RESET_ENERGY_CALIBRATION_WRITES,
      context: { now: resetAt },
      transition: state => guidance.resetEnergyCalibration(state)
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    // Resetting an uncalibrated profile is a no-op, and says so. The panel needs
    // the difference: "丢掉了" and "本来就没学过" are different answers to the same
    // press, and a command that reported both as success would leave the user
    // unable to tell whether the button did anything.
    if (transaction.committed) {
      const fact = Object.freeze({ type: 'energy-calibration-reset', resetAt, revision: transaction.revision });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = {
  RESET_ENERGY_CALIBRATION_WRITES,
  createResetEnergyCalibrationCommand
};
