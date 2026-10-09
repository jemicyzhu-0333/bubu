'use strict';

const { stepCompletionRewardId } = require('../../../core/reward-ledger');
const {
  applyProgressDay,
  applyDomainReward,
  monotonicRewardDay
} = require('./progress-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('step reward requires a finite non-negative time');
  }
  return value;
}

/**
 * Record the reward owned by progress after work has sealed a checkpoint in
 * the same draft. Source identity is lifetime-stable; daily growth deduplicates
 * all real advances of the parent task without a lifetime payout allowance.
 */
function recordStepCompletion(state, task, step, { now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('step reward requires a state draft');
  }
  if (!task || typeof task !== 'object' || !task.id
      || !step || typeof step !== 'object' || !step.id || step.done !== true) {
    throw new TypeError('step reward requires a completed step fact');
  }
  const completedAt = requireTimestamp(now);
  const rewardDay = monotonicRewardDay(state, completedAt);
  const reward = applyDomainReward(state, {
    eventId: stepCompletionRewardId(task, step.id, rewardDay),
    source: 'step-complete',
    amount: 10,
    at: completedAt,
    dateKey: rewardDay,
    metadata: { taskId: task.id, stepId: step.id, cycle: step.completionCycle }
  });
  if (reward.recorded) applyProgressDay(state, completedAt);
  return { reward, rewardDay };
}

module.exports = { recordStepCompletion };
