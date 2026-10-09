'use strict';

const { taskCompletionRewardId } = require('../../../core/reward-ledger');
const {
  ensureStats,
  incrementDaily,
  applyProgressDay,
  applyDomainReward,
  monotonicRewardDay
} = require('./progress-state');

const TASK_REWARD_XP = 10;

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task reward requires a finite non-negative time');
  }
  return value;
}

function rewardDayFor(state, now) {
  return monotonicRewardDay(state, requireTimestamp(now));
}

/**
 * Record the progress owned by a completed work item. Callers must first seal
 * the task, then pass that immutable completion fact here in the same draft.
 */
function recordTaskCompletion(state, task, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task reward requires a state draft');
  }
  if (!task || typeof task !== 'object' || !task.done || !task.id) {
    throw new TypeError('task reward requires a completed task fact');
  }
  const now = requireTimestamp(options.now);
  const rewardDay = options.rewardDay || rewardDayFor(state, now);
  const reward = applyDomainReward(state, {
    eventId: taskCompletionRewardId(task, rewardDay),
    source: 'task-complete',
    amount: TASK_REWARD_XP,
    at: now,
    dateKey: rewardDay,
    metadata: {
      taskId: task.id,
      cycle: task.completionCycle,
      occurrenceDate: task.occurrenceDate
    }
  });
  if (reward.recorded) {
    const stats = ensureStats(state);
    stats.totalTasksDone = (Number(stats.totalTasksDone) || 0) + 1;
    incrementDaily(stats, 'dailyCompletions', rewardDay, 1);
    applyProgressDay(state, now);
  }
  return { reward, rewardDay };
}

module.exports = { TASK_REWARD_XP, rewardDayFor, recordTaskCompletion };
