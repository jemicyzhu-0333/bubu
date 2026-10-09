'use strict';

const work = require('../../capabilities/work');
const progress = require('../../capabilities/progress');
const companion = require('../../capabilities/companion');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const COMPLETE_WORK_STEP_WRITES = Object.freeze([
  'tasks',
  'xp',
  'level',
  'lastCompletedDate',
  'stats',
  'rewardLedger',
  'pet',
  'companion',
  'unlockedSkins'
]);

function createCompleteWorkStepWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('complete-work-step workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('complete-work-step workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('complete-work-step workflow effects must be functions');
  }

  function execute({ taskId, stepId, expectedRevision } = {}) {
    const completedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: COMPLETE_WORK_STEP_WRITES,
      expectedRevision,
      context: { now: completedAt },
      transition: state => {
        const completion = work.stepCompletion.completeStep(state, {
          taskId,
          stepId,
          now: completedAt
        });
        if (!completion.ok) return completion;

        const { reward } = progress.stepCompletion.recordStepCompletion(
          state,
          completion.task,
          completion.step,
          { now: completedAt }
        );
        const benefits = companion.completionBenefits.applyGrowthBenefits(state, { reward, now: completedAt });
        const newlyUnlockedSkins = reward.recorded
          ? companion.completionBenefits.unlockEligibleSkins(state)
          : [];
        return { ok: true, reward, ...benefits, newlyUnlockedSkins };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason, done: false };
    const awarded = transaction.reward.recorded ? transaction.reward.awardedReward : 0;
    const response = {
      ok: true,
      done: true,
      awarded,
      advanceGranted: transaction.reward.advanceGranted === true
    };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'work-step-completed',
      taskId,
      stepId,
      completedAt,
      revision: transaction.revision,
      reward: transaction.reward,
      bond: transaction.bond,
      ticketsGranted: transaction.ticketsGranted,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { COMPLETE_WORK_STEP_WRITES, createCompleteWorkStepWorkflow };
