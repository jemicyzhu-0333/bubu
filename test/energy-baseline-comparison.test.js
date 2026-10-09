'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertEnergyBaseline } = require('./helpers/assert-energy-baseline');

const expected = {
  dayKey: '2026-02-17', sampleMinutes: 15, nowMinute: 720,
  samples: [{ minute: 0, level: 50, slope: 0.01,
    attribution: [{ source: 'check-in', id: null, label: null, delta: 2 }] }],
  confidence: 'medium', trend: 'flat',
  suggestedWindows: [{ startMinute: 735, endMinute: 795, peak: 60 }]
};

test('energy baseline comparison admits only bounded derived-number roundoff and reports its path', () => {
  const actual = structuredClone(expected);
  actual.samples[0].level += 8 * Number.EPSILON * expected.samples[0].level;
  const report = assertEnergyBaseline(actual, expected);
  assert.ok(report.maxAbsoluteDeviation > 0);
  assert.equal(report.path, 'curve.samples[0].level');
  assert.ok(report.maxAbsoluteDeviation <= report.budgetAtPath);
});

for (const [name, mutate] of [
  ['0.001 energy regression', value => { value.samples[0].level += 0.001; }],
  ['above-roundoff energy regression', value => { value.samples[0].level += 1e-10; }],
  ['non-finite energy', value => { value.samples[0].level = NaN; }],
  ['numeric type change', value => { value.samples[0].level = '50'; }],
  ['timestamp/minute drift', value => { value.samples[0].minute += 1e-14; }],
  ['now minute drift', value => { value.nowMinute += 1e-10; }],
  ['sample count change', value => { value.samples.pop(); }],
  ['sample cadence change', value => { value.sampleMinutes = 30; }],
  ['date change', value => { value.dayKey = '2026-02-18'; }],
  ['confidence change', value => { value.confidence = 'high'; }],
  ['trend change', value => { value.trend = 'rising'; }],
  ['attribution identity change', value => { value.samples[0].attribution[0].source = 'effect'; }],
  ['window boundary change', value => { value.suggestedWindows[0].startMinute += 1; }],
  ['extra field', value => { value.extra = 1; }]
]) {
  test(`energy baseline comparison rejects ${name}`, () => {
    const actual = structuredClone(expected);
    mutate(actual);
    assert.throws(() => assertEnergyBaseline(actual, expected), { code: 'ERR_ASSERTION' });
  });
}
