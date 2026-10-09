'use strict';

const guidance = require('../domain/energy-check-in');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const RECORD_ENERGY_CHECK_IN_WRITES = Object.freeze(['energyCheckIn', 'energySelfReports']);

function createRecordEnergyCheckInCommand({
  unitOfWork,
  clock,
  capturePlanningEstimate = () => null,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-energy-check-in command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-energy-check-in command requires a clock');
  }
  if (typeof capturePlanningEstimate !== 'function' || typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('record-energy-check-in command effects must be functions');
  }

  function execute({ checkIn, expectedRevision } = {}) {
    const recordedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_ENERGY_CHECK_IN_WRITES,
      expectedRevision,
      context: { now: recordedAt },
      transition: state => guidance.recordEnergyCheckIn(state, checkIn, { collectHistory: true, recordedAt,
        estimate: capturePlanningEstimate(state, checkIn?.timestamp) })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const value = transaction.checkIn || (transaction.state && transaction.state.energyCheckIn) || null;
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'energy-check-in-recorded',
        checkIn: value,
        recordedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, checkIn: value, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = {
  RECORD_ENERGY_CHECK_IN_WRITES,
  createRecordEnergyCheckInCommand
};
