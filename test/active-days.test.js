'use strict';

// “最近一个月里用过几天”：取代连续打卡。数的是每日统计里有记录的日子，窗口往回数 30 天，
// 中断不会让它归零，只会让窗口慢慢滑走旧的日子。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_DAYS_WINDOW, FLAME_ACTIVE_DAYS_TARGET, activeDayKeys, latestActiveDay, activeDaysInWindow
} = require('../src/core/active-days');

test('the constants say what the product says: 30 days, more than 15 of them', () => {
  assert.equal(ACTIVE_DAYS_WINDOW, 30);
  assert.equal(FLAME_ACTIVE_DAYS_TARGET, 16);
});

test('any of focus, completion, launch or return makes a day a used day, and a day counts once', () => {
  const stats = {
    dailyFocus: { '2026-09-01': 1500000, '2026-09-02': 0 },
    dailyCompletions: { '2026-09-01': 2, '2026-09-03': 1 },
    dailyLaunches: { '2026-09-04': 1 },
    dailyReturns: { '2026-09-05': 3 },
    somethingElse: { '2026-09-06': 9 }
  };
  assert.deepEqual([...activeDayKeys(stats)].sort(), ['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05']);
  assert.equal(latestActiveDay(stats), '2026-09-05');
});

test('the window is 30 days ending on the reference day, inclusive at both ends', () => {
  const stats = { dailyCompletions: { '2026-08-06': 1, '2026-08-05': 1, '2026-09-04': 1, '2026-09-05': 1 } };
  // 09-04 往回数 30 天：08-06 … 09-04。08-05 在窗口外。
  assert.equal(activeDaysInWindow(stats, '2026-09-04'), 2);
  assert.equal(activeDaysInWindow(stats, '2026-09-05'), 2, 'the window slides: Aug 6 has just fallen out, Sep 5 came in');
  assert.equal(activeDaysInWindow(stats, '2026-08-05'), 1);
});

test('a break does not reset anything, it only lets old days slide away', () => {
  const days = {};
  for (let day = 1; day <= 18; day += 1) days[`2026-09-${String(day).padStart(2, '0')}`] = 1;
  const stats = { dailyLaunches: days };
  assert.equal(activeDaysInWindow(stats, '2026-09-18'), 18);
  assert.equal(activeDaysInWindow(stats, '2026-09-28'), 18, 'ten days away and nothing was lost');
  // 10-10 往回数 30 天从 09-11 开始，只剩 11–18 号这 8 天。
  assert.equal(activeDaysInWindow(stats, '2026-10-10'), 8, 'a month later, only the days still in the window count');
});

test('missing, malformed or non-date data counts as zero instead of throwing', () => {
  assert.equal(activeDaysInWindow(undefined), 0);
  assert.equal(activeDaysInWindow({}), 0);
  assert.equal(activeDaysInWindow({ dailyFocus: 'x', dailyCompletions: { 'yesterday': 3, '2026-9-1': 3, '2026-09-01': -1 } }), 0);
  assert.equal(activeDaysInWindow({ dailyFocus: { '2026-09-01': 60000 } }), 1, 'no reference day: end at the latest used day');
});
