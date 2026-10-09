'use strict';

const { STEP_REWARD_BUDGET, DEFAULT_BASE_REWARDS, stepBudgetKey, stepBudgetSpent } = require('./reward-ledger');

const STEP_REWARD_BASE = DEFAULT_BASE_REWARDS['step-complete'];

/**
 * Project the step-reward allowance for one task occurrence.
 *
 * A task occurrence may only ever pay out `STEP_REWARD_BUDGET` XP for its steps,
 * no matter how many the user or an AI proposal adds. Splitting work into more
 * checkpoints is a planning aid, not a way to farm XP; conversely, deleting,
 * reordering, re-adding or retrying steps never hands the allowance back.
 */
function stepRewardPlan(ledger, task, dateKey, options = {}) {
  const cap = Number.isFinite(Number(options.cap)) ? Number(options.cap) : STEP_REWARD_BUDGET;
  const base = Number.isFinite(Number(options.base)) ? Number(options.base) : STEP_REWARD_BASE;
  const key = stepBudgetKey(task, dateKey);
  const spent = stepBudgetSpent(ledger, key);
  const remaining = Math.max(0, cap - spent);
  return {
    key,
    cap,
    base,
    spent,
    remaining,
    // `0` still records the completion event and its feedback; only the payout
    // is gone. Silently skipping the event would let a retry pay twice.
    award: Math.min(base, remaining)
  };
}

module.exports = {
  STEP_REWARD_BUDGET,
  STEP_REWARD_BASE,
  stepRewardPlan
};
