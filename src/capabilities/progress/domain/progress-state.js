'use strict';

const { recordDailyGrowth } = require('./daily-growth');
const { levelCost } = require('../../../content/growth-policy.mjs');
const {
  localDayKey,
  compareDayKeys
} = require('../../../core/calendar');

function requireTimestamp(value, label = 'timestamp') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError(`${label} must be a finite non-negative timestamp`);
  }
  return value;
}

function ensureStats(state) {
  if (!state.stats || typeof state.stats !== 'object' || Array.isArray(state.stats)) state.stats = {};
  for (const field of ['dailyFocus', 'dailyCompletions', 'dailyLaunches', 'dailyReturns']) {
    if (!state.stats[field] || typeof state.stats[field] !== 'object' || Array.isArray(state.stats[field])) {
      state.stats[field] = {};
    }
  }
  return state.stats;
}

function incrementDaily(stats, field, dayKey, amount = 1) {
  if (!stats[field] || typeof stats[field] !== 'object' || Array.isArray(stats[field])) stats[field] = {};
  stats[field][dayKey] = (Number(stats[field][dayKey]) || 0) + amount;
}

function recordTaskBreakdown(state) {
  const stats = ensureStats(state);
  stats.totalBreakdowns = (Number(stats.totalBreakdowns) || 0) + 1;
  return { count: stats.totalBreakdowns };
}

function applyXp(state, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('invalid-growth-award');
  let xp = (state.xp ?? 0) + amount;
  let level = state.level ?? 1;
  if (!Number.isSafeInteger(xp) || xp < 0 || !Number.isSafeInteger(level) || level < 1 || level > 1_000_000) {
    throw new RangeError('invalid-growth-state');
  }
  const previousLevel = level;
  while (level < 15 && xp >= levelCost(level)) {
    xp -= levelCost(level);
    level += 1;
  }
  if (level >= 15) {
    const gained = Math.min(Math.floor(xp / levelCost(level)), 1_000_000 - level);
    xp -= gained * levelCost(level);
    level += gained;
  }
  state.xp = xp;
  state.level = level;
  return { leveledUp: level > previousLevel, level, xp };
}

function applyProgressDay(state, at) {
  const timestamp = requireTimestamp(at, 'progress timestamp');
  const day = localDayKey(timestamp);
  if (state.lastCompletedDate && compareDayKeys(day, state.lastCompletedDate) <= 0) return false;
  // 只记“最后一次有进展的那一天”，供奖励日单调（monotonicRewardDay）和“今天第一件”判断使用。
  // 不再计连续天数：断一天就清零的数字对容易中断的人是压力（见 core/active-days.js）。
  state.lastCompletedDate = day;
  return true;
}

function monotonicRewardDay(state, at) {
  let day = localDayKey(requireTimestamp(at, 'reward timestamp'));
  // Daily growth entitlements are monotonic even if a close is the first
  // action and the wall clock later moves back. Source facts keep their own day.
  const growthDays = Object.entries(state.rewardLedger?.dailyBucketTotals || {})
    .filter(([, totals]) => ['growth-unit', 'growth-first', 'growth-close'].some(key => totals[key] > 0))
    .map(([dayKey]) => dayKey);
  for (const marker of [state.lastResetDate, state.lastCompletedDate, ...growthDays]) {
    if (marker && compareDayKeys(marker, day) > 0) day = marker;
  }
  return day;
}

function applyDomainReward(state, input = {}) {
  const at = requireTimestamp(input.at, 'reward timestamp');
  const source = input.source;
  const advance = ['task-complete', 'step-complete', 'focus-confirmed', 'quick-start-confirmed'].includes(source)
    && input.amount > 0;
  const close = ['healthy-shutdown', 'focus-landing', 'rest-choice'].includes(source);
  const sourceDay = input.dateKey === undefined ? localDayKey(at) : input.dateKey;
  const minimumDay = advance || close ? monotonicRewardDay(state, at) : sourceDay;
  const dateKey = compareDayKeys(sourceDay, minimumDay) > 0 ? sourceDay : minimumDay;
  const result = recordDailyGrowth(state.rewardLedger, {
    eventId: input.eventId, source, dateKey, at, taskId: input.metadata?.taskId || null,
    advance, close, metadata: input.metadata || {}
  });
  if (!result.recorded) return { ...result, leveledUp: false, level: state.level };
  state.rewardLedger = result.ledger;
  const xpResult = result.awardedReward > 0
    ? applyXp(state, result.awardedReward)
    : { leveledUp: false, level: state.level, xp: state.xp };
  return { ...result, ...xpResult };
}

module.exports = {
  ensureStats,
  incrementDaily,
  recordTaskBreakdown,
  applyXp,
  applyProgressDay,
  monotonicRewardDay,
  applyDomainReward
};
