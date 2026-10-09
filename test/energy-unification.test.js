'use strict';

// 能量只有一个数：曲线。专注负荷是曲线的一个分量，头部读数直接读曲线，
// 主进程和面板读同一条。
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnergyCurve, FOCUS_ACUTE_MAX, FOCUS_RESIDUAL_CAP } = require('../src/core/energy-curve');
const { currentEnergyEstimate } = require('../src/application/queries/energy-compatibility');
const { collectFocusSessions } = require('../src/application/queries/energy-curve-view');
const { localDayStart } = require('../src/core/calendar');

const DAY = '2026-09-29';
const START = localDayStart(DAY);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (hour, minute = 0) => START + hour * HOUR + minute * MIN;

function focusLoad(sessions, now) {
  const curve = buildEnergyCurve({ dayKey: DAY, now, focusSessions: sessions });
  const row = curve.nowAttribution.find(entry => entry.source === 'focus-load');
  return { curve, delta: row ? row.delta : 0 };
}

test('focus load deepens during a session and shows up in the curve itself', () => {
  const quarter = focusLoad([{ startMs: at(14), endMs: at(14, 25) }], at(14, 25)).delta;
  const hour = focusLoad([{ startMs: at(14), endMs: at(15) }], at(15)).delta;
  assert.ok(quarter < 0 && hour < quarter, `${hour} should be deeper than ${quarter}`);
  assert.ok(hour >= -(FOCUS_ACUTE_MAX + FOCUS_RESIDUAL_CAP));
});

test('rest after focus recovers the acute part but keeps the day residue', () => {
  const session = [{ startMs: at(14), endMs: at(15) }];
  const justEnded = focusLoad(session, at(15)).delta;
  const afterRest = focusLoad(session, at(16, 30)).delta;
  assert.ok(afterRest > justEnded, 'recovers');
  assert.ok(afterRest < 0, 'the day residue stays');
});

test('the day residue is capped, and yesterday’s sessions add none of it', () => {
  const long = [9, 11, 13, 15].map(hour => ({ startMs: at(hour), endMs: at(hour + 1) }));
  const { delta } = focusLoad(long, at(23, 30));
  assert.ok(delta >= -FOCUS_RESIDUAL_CAP - 0.01, `${delta} respects the residual cap once acute has recovered`);
  const yesterday = focusLoad([{ startMs: at(-3), endMs: at(-2) }], at(10)).delta;
  assert.ok(Math.abs(yesterday) < 0.1, 'only a faded acute tail can reach into today');
});

test('the estimate reads the curve as-is: no second blend, no second focus table, no rounding to 5', () => {
  const estimate = currentEnergyEstimate({
    stats: { dailyFocus: { [DAY]: 200 * MIN } },
    pomodoroState: { running: true, mode: 'focus', elapsedMs: 70 * MIN },
    settings: {},
    energyCheckIn: { level: 80, state: 'high', timestamp: at(9) },
    now: at(10),
    curveLevel: 47.4
  });
  assert.equal(estimate.level, 47);
  assert.equal(estimate.activityAdjustment, 0);
  assert.equal(estimate.source, 'check-in');
  assert.equal(estimate.band, 'medium');
});

test('focus sessions come from settled rewards plus the running session', () => {
  const sessions = collectFocusSessions({
    dayKey: DAY,
    now: at(16),
    pomodoro: { mode: 'focus', running: true, elapsedMs: 20 * MIN },
    rewardLedger: { events: [
      { source: 'focus-complete', createdAt: at(10), metadata: { elapsedMs: 25 * MIN } },
      { source: 'quick-start-complete', createdAt: at(11), metadata: { elapsedMs: 2 * MIN } },
      { source: 'break-complete', createdAt: at(12), metadata: { elapsedMs: 5 * MIN } },
      { source: 'focus-complete', createdAt: at(-30), metadata: { elapsedMs: 25 * MIN } }
    ] }
  });
  assert.deepEqual(sessions, [
    { startMs: at(9, 35), endMs: at(10) },
    { startMs: at(10, 58), endMs: at(11) },
    { startMs: at(15, 40), endMs: at(16) }
  ]);
});
