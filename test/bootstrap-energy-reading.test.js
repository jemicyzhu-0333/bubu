'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCurrentEnergyReader, energyCurveLevelNow } = require('../src/bootstrap/energy-reading');
const { currentEnergyEstimate } = require('../src/application/queries/energy-compatibility');
const { planningFixture, NOW } = require('../test-support/planning-guidance-fixture');
test('shared current-energy reader uses one canonical snapshot/time and preserves explicit settings', () => {
  const state = planningFixture(), pomodoro = null;
  let reads = 0, clocks = 0;
  const read = createCurrentEnergyReader({ readSnapshot: () => { reads++; return state; }, getSettings: () => state.settings,
    getPomodoro: () => pomodoro, now: () => { clocks++; return NOW; } });
  for (const settings of [state.settings, { ...state.settings, workStartHour: 10 }]) {
    assert.deepEqual(read(settings), currentEnergyEstimate({ stats: state.stats, pomodoroState: pomodoro, settings,
      energyCheckIn: state.energyCheckIn, now: NOW, curveLevel: energyCurveLevelNow({ snapshot: state, settings, pomodoro, now: NOW }) }));
  }
  assert.equal(reads, 2); assert.equal(clocks, 2); assert.deepEqual(read(), read(state.settings));
});
