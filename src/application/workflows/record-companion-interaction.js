'use strict';

const companion = require('../../capabilities/companion');
const progress = require('../../capabilities/progress');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RECORD_COMPANION_INTERACTION_WRITES = Object.freeze([
  'xp',
  'level',
  'rewardLedger',
  'companion',
  'unlockedSkins'
]);

function createRecordCompanionInteractionWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-companion-interaction workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-companion-interaction workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('record-companion-interaction workflow effects must be functions');
  }

  function execute({ interactionId, expectedRevision } = {}) {
    const interactedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_COMPANION_INTERACTION_WRITES,
      expectedRevision,
      context: { now: interactedAt },
      transition: state => {
        const rewardDay = progress.progressState.monotonicRewardDay(state, interactedAt);
        const reward = progress.interactionReward.recordInteractionReward(state, {
          interactionId,
          rewardDay,
          at: interactedAt
        });
        const bond = reward.recorded
          ? companion.completionBenefits.applyBondToState(state, {
              points: companion.completionBenefits.BOND_POINTS.interaction,
              counterId: 'interaction',
              at: interactedAt
            })
          : null;
        const newlyUnlockedSkins = reward.recorded
          ? companion.completionBenefits.unlockEligibleSkins(state)
          : [];
        return { ok: true, rewardDay, reward, bond, newlyUnlockedSkins };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };

    const response = {
      ok: true,
      interactionId,
      rewardDay: transaction.rewardDay,
      gainedXp: transaction.reward.awardedReward || 0,
      reward: transaction.reward,
      bond: transaction.bond,
      newlyUnlockedSkins: [...transaction.newlyUnlockedSkins]
    };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'companion-interaction-recorded',
        interactionId,
        interactedAt,
        rewardDay: transaction.rewardDay,
        reward: transaction.reward,
        bond: transaction.bond,
        newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins]),
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = {
  RECORD_COMPANION_INTERACTION_WRITES,
  createRecordCompanionInteractionWorkflow
};
