'use strict';

const guidance = require('../domain/energy-check-in');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const ADJUST_ENERGY_WRITES = Object.freeze(['energyCheckIn', 'energySelfReports']);

function createAdjustEnergyCommand({
  unitOfWork,
  clock,
  currentLevelFor,
  capturePlanningEstimate = () => null,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('adjust-energy command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function' || typeof currentLevelFor !== 'function') {
    throw new TypeError('adjust-energy command requires clock and current-level ports');
  }
  if (typeof capturePlanningEstimate !== 'function' || typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('adjust-energy command effects must be functions');
  }

  function execute({ direction, expectedRevision } = {}) {
    const adjustedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: ADJUST_ENERGY_WRITES,
      expectedRevision,
      context: { now: adjustedAt },
      transition: state => guidance.adjustEnergyCheckIn(state, {
        direction,
        currentLevel: currentLevelFor(state, adjustedAt),
        timestamp: adjustedAt,
        estimate: capturePlanningEstimate(state, adjustedAt)
      })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const checkIn = transaction.checkIn || transaction.state.energyCheckIn;
    if (transaction.committed) {
      runPostCommitEffect(publish, Object.freeze({
        type: 'energy-adjusted',
        direction,
        checkIn,
        adjustedAt,
        revision: transaction.revision
      }), reportEffectError);
    }
    return { ok: true, changed: transaction.committed, checkIn };
  }

  return Object.freeze({ execute });
}

module.exports = { ADJUST_ENERGY_WRITES, createAdjustEnergyCommand };
