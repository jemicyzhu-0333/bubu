'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../src/capabilities/progress');

test('progress exposes cohesive state and settlement rules through one frozen facade', () => {
  assert.deepEqual(Object.keys(progress).sort(), [
    'aiChangeEvents',
    'basicMeals',
    'dailyGrowth',
    'executionActivity',
    'healthyShutdown',
    'interactionReward',
    'ipcRoutes',
    'progressState',
    'recordTimeline',
    'sessionSettlement',
    'stepCompletion',
    'taskCompletion',
    'timelineDay',
    'timelineFacts'
  ]);
  assert.equal(Object.isFrozen(progress), true);
  assert.equal(Object.isFrozen(progress.dailyGrowth), true);
  assert.equal(Object.isFrozen(progress.basicMeals), true);
  assert.equal(Object.isFrozen(progress.executionActivity), true);
  assert.equal(Object.isFrozen(progress.healthyShutdown), true);
  assert.equal(Object.isFrozen(progress.interactionReward), true);
  assert.equal(Object.isFrozen(progress.progressState), true);
  assert.equal(Object.isFrozen(progress.sessionSettlement), true);
  assert.equal(Object.isFrozen(progress.stepCompletion), true);
  assert.equal(Object.isFrozen(progress.taskCompletion), true);
  assert.equal(Object.isFrozen(progress.ipcRoutes), true);
  assert.equal(Object.isFrozen(progress.recordTimeline), true);
  assert.equal(Object.isFrozen(progress.timelineDay), true);
  assert.equal(Object.isFrozen(progress.timelineFacts), true);
});
