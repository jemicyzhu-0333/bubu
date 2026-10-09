'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../src/capabilities/guidance');

test('guidance exposes energy state and its command through one frozen facade', () => {
  assert.deepEqual(Object.keys(guidance).sort(), [
    'adjustEnergy',
    'aiChangeLedger',
    'dailyReview',
    'energyCalibration',
    'energyCheckIn',
    'energyCurveTrials',
    'energyEstimate',
    'energySelfReports',
    'energySignals',
    'impulseEnergyClassifier',
    'ipcRoutes',
    'localProposal',
    'materializeDueReviews',
    'memoryAggregation',
    'memoryConfirmation',
    'moodNotes',
    'planningPreferences',
    'planningState',
    'proposalPreview',
    'recommendations',
    'recordEnergyCheckIn',
    'recordStrategyFeedback',
    'recordStrategyShown',
    'resetEnergyCalibration',
    'strategyFeedback',
    'taskDemand',
    'taskRanking',
    'wakeTime'
  ]);
  assert.equal(Object.isFrozen(guidance), true);
  assert.equal(Object.isFrozen(guidance.taskDemand), true);
  assert.equal(Object.isFrozen(guidance.energyEstimate), true);
  assert.equal(Object.isFrozen(guidance.taskRanking), true);
  assert.deepEqual(Object.keys(guidance.taskDemand), [
    'ENERGY_BANDS', 'inferEnergy', 'suggestDuration', 'estimatedMinutes'
  ]);
  assert.deepEqual(Object.keys(guidance.energyEstimate), [
    'currentEnergyLevel', 'currentEnergyEstimate', 'normalizeEnergyCheckIn',
    'energyToBand', 'energyLabel', 'resolveWorkHours', 'baseEnergyAt'
  ]);
  assert.deepEqual(Object.keys(guidance.taskRanking), [
    'smartPickTask', 'rankTasks', 'recommendTasks', 'scoreTask', 'getNextStep'
  ]);
  assert.equal(Object.isFrozen(guidance.adjustEnergy), true);
  assert.equal(Object.isFrozen(guidance.energyCheckIn), true);
  assert.equal(Object.isFrozen(guidance.energyCalibration), true);
  assert.equal(Object.isFrozen(guidance.energySignals), true);
  assert.equal(Object.isFrozen(guidance.wakeTime), true);
  assert.equal(Object.isFrozen(guidance.moodNotes), true);
  assert.equal(Object.isFrozen(guidance.impulseEnergyClassifier), true);
  assert.equal(Object.isFrozen(guidance.dailyReview), true);
  assert.equal(Object.isFrozen(guidance.materializeDueReviews), true);
  assert.equal(Object.isFrozen(guidance.memoryConfirmation), true);
  assert.equal(Object.isFrozen(guidance.recordEnergyCheckIn), true);
  assert.equal(Object.isFrozen(guidance.resetEnergyCalibration), true);
  assert.equal(Object.isFrozen(guidance.strategyFeedback), true);
  assert.equal(Object.isFrozen(guidance.recordStrategyShown), true);
  assert.equal(Object.isFrozen(guidance.recordStrategyFeedback), true);
});

test('guidance energy transitions require a closed canonical fact', () => {
  const state = { energyCheckIn: null };
  assert.deepEqual(guidance.energyCheckIn.recordEnergyCheckIn(state, {
    level: 42,
    state: 'medium',
    timestamp: 1_000
  }), {
    ok: true,
    changed: true,
    checkIn: { level: 42, state: 'medium', timestamp: 1_000 }
  });
  assert.equal(
    guidance.energyCheckIn.recordEnergyCheckIn(state, {
      level: 42,
      state: 'energized',
      timestamp: 1_000
    }).reason,
    'energy-check-in-invalid'
  );
});

test('strategy feedback transitions return a new canonical map without mutating the input map', () => {
  const before = { existing: { helpful: true, updatedAt: 1, shownCount: 1, dismissedCount: 0 } };
  const shown = guidance.strategyFeedback.recordStrategyShown(before, 'focus-start', 2_000);
  assert.equal(before['focus-start'], undefined);
  assert.equal(shown['focus-start'].shownCount, 1);
  const feedback = guidance.strategyFeedback.recordStrategyFeedback(
    shown,
    'focus-start',
    false,
    3_000
  );
  assert.equal(feedback['focus-start'].helpful, false);
  assert.equal(feedback['focus-start'].dismissedCount, 1);
});

test('the pruned daily-review path stays pruned so review rules keep one home', () => {
  // The old alias resolved the card and wrote task plans in one call. Guidance keeps the card
  // decision; the resolve-review workflow hands the plan write to work.taskPlanning.
  assert.throws(() => require('../src/core/daily-review'), /Cannot find module/);
});
