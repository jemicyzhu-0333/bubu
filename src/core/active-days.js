'use strict';

// “最近一个月里用过几天”：取代了连续打卡的计数。
//
// 连续 N 天的数字断一天就清零，对容易中断的人是持续的压力；“最近 30 天里有几天用过”不会因为
// 中断而归零，只会随着时间慢慢滑动。“用过”的意思是那一天有过专注、完成、开始或回来中的任意一项，
// 全部来自已有的每日统计，不需要新的持久化字段。
const ACTIVE_DAYS_WINDOW = 30;
// 一个月里用过“超过 15 天”，也就是至少 16 天。
const FLAME_ACTIVE_DAYS_TARGET = 16;
const DAILY_SOURCES = Object.freeze(['dailyFocus', 'dailyCompletions', 'dailyLaunches', 'dailyReturns']);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shiftDayKey(dayKey, offset) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// 有过任意一项记录的日子（去重）。
function activeDayKeys(stats) {
  const days = new Set();
  if (!isPlainObject(stats)) return days;
  for (const source of DAILY_SOURCES) {
    const record = stats[source];
    if (!isPlainObject(record)) continue;
    for (const [dayKey, value] of Object.entries(record)) {
      if (DAY_KEY.test(dayKey) && Number(value) > 0) days.add(dayKey);
    }
  }
  return days;
}

// 最近一个有记录的日子：解锁是在“刚做完一件事”的那一刻判断的，那天就是窗口的终点。
function latestActiveDay(stats) {
  let latest = null;
  for (const dayKey of activeDayKeys(stats)) if (latest === null || dayKey > latest) latest = dayKey;
  return latest;
}

// [endDayKey 往前 windowDays 天, endDayKey] 里有几天用过。endDayKey 缺省取最近一个有记录的日子。
function activeDaysInWindow(stats, endDayKey = null, windowDays = ACTIVE_DAYS_WINDOW) {
  const end = endDayKey && DAY_KEY.test(endDayKey) ? endDayKey : latestActiveDay(stats);
  if (!end) return 0;
  const start = shiftDayKey(end, -(windowDays - 1));
  let count = 0;
  for (const dayKey of activeDayKeys(stats)) if (dayKey >= start && dayKey <= end) count += 1;
  return count;
}

module.exports = {
  ACTIVE_DAYS_WINDOW,
  FLAME_ACTIVE_DAYS_TARGET,
  activeDayKeys,
  latestActiveDay,
  activeDaysInWindow
};
