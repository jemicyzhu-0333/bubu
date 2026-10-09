'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyWorkPeriod } = require('../src/content/work-period.mjs');
const legacy = require('../src/content/legacy-pet-content');

test('legacy public exports and classifier arities remain bounded', () => {
  assert.deepEqual(Object.keys(legacy), ['LINES', 'SCENE_DECORATIONS', 'STATE_SCENES', 'SKIN_SCENES',
    'EASTER_EGGS', 'INTERACTIONS', 'FOODS', 'getContextualLine', 'getTimePeriod', 'pick']);
  assert.equal(legacy.getTimePeriod.length, 1);
  assert.equal(classifyWorkPeriod.length, 3);
});

test('default work hours remain a legacy wrapper responsibility', () => {
  assert.equal(legacy.getTimePeriod(10), 'forenoon');
  assert.equal(legacy.getTimePeriod(10, undefined, undefined), 'forenoon');
  assert.equal(classifyWorkPeriod(10, undefined, undefined), 'night');
  assert.equal(classifyWorkPeriod(4, undefined, undefined), 'lateNight');
  assert.equal(legacy.getTimePeriod(undefined), 'night');
});

test('existing default thresholds and midnight end retain exact labels', () => {
  const cases = [[4, 'lateNight'], [5, 'morning'], [9, 'morning'], [10, 'forenoon'],
    [12.999, 'forenoon'], [13, 'noon'], [14, 'afternoon'], [18, 'evening'], [21.999, 'evening'], [22, 'night']];
  for (const [hour, expected] of cases) assert.equal(classifyWorkPeriod(hour, 10, 21), expected);
  assert.equal(classifyWorkPeriod(24, 10, 24), 'evening');
  assert.equal(classifyWorkPeriod(25, 10, 24), 'night');
});

test('coercible and nonfinite inputs retain existing arithmetic behavior', () => {
  assert.equal(classifyWorkPeriod('10', '10', '21'), 'forenoon');
  assert.equal(classifyWorkPeriod(10, NaN, 21), 'night');
  assert.equal(classifyWorkPeriod(NaN, 10, 21), 'night');
  assert.equal(classifyWorkPeriod(-Infinity, 10, 21), 'lateNight');
  assert.equal(classifyWorkPeriod(Infinity, 10, 21), 'night');
  assert.equal(classifyWorkPeriod(10, null, null), 'night');
  assert.throws(() => classifyWorkPeriod(10, 1n, 21), TypeError);
  assert.throws(() => classifyWorkPeriod(Symbol('hour'), 10, 21), TypeError);
});

test('injected math preserves method receivers and exact invocation order', () => {
  const calls = [];
  const math = {};
  for (const name of ['round', 'min', 'max']) math[name] = function (...args) {
    assert.equal(this, math);
    calls.push([name, ...args]);
    return Math[name](...args);
  };
  assert.equal(classifyWorkPeriod(15, 10, 21, math), 'afternoon');
  assert.deepEqual(calls, [
    ['round', 10], ['min', 22, 10], ['max', 0, 10],
    ['round', 21], ['min', 24, 21], ['max', 11, 21],
    ['round', 3.3], ['max', 1, 3], ['max', 15, 18]
  ]);
});

test('input coercion runs in work-start work-end then repeated-hour order', () => {
  const calls = [];
  const value = (name, number) => ({ valueOf() { calls.push(name); return number; } });
  assert.equal(classifyWorkPeriod(value('hour', 15), value('start', 10), value('end', 21)), 'afternoon');
  assert.deepEqual(calls, ['start', 'end', 'hour', 'hour', 'hour', 'hour', 'hour']);
});

test('incomplete injected Math retains original native method error messages', () => {
  for (const [math, method] of [[{}, 'round'], [{ round: Math.round }, 'min'],
    [{ round: Math.round, min: Math.min }, 'max'],
    [{ round: 0, min: Math.min, max: Math.max }, 'round']]) {
    assert.throws(() => classifyWorkPeriod(15, 10, 21, math),
      { name: 'TypeError', message: `Math.${method} is not a function` });
  }
});
