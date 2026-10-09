'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const work = require('../src/capabilities/work');

test('work exposes its migrated domain rules through one frozen public facade', () => {
  assert.deepEqual(Object.keys(work).sort(), [
    'activateScheduledWork',
    'availability',
    'captureImpulse',
    'dailyTidy',
    'discardImpulse',
    'duplicateWorkItem',
    'impulseInbox',
    'inboxRecords',
    'ipcRoutes',
    'occurrenceSkipping',
    'recurrence',
    'restoreWorkItem',
    'scheduleActivation',
    'selection',
    'seriesRefresh',
    'seriesUpdating',
    'sessionEntry',
    'sessionInvestment',
    'stepCompletion',
    'taskArchiving',
    'taskAvoidance',
    'taskClarification',
    'taskCompletion',
    'taskCreation',
    'taskDuplication',
    'taskEditing',
    'taskExpiration',
    'taskModel',
    'taskPlanning',
    'taskRestoration',
    'taskState',
    'updateRecurrenceSeries'
  ]);
  assert.equal(Object.isFrozen(work), true);
  assert.equal(Object.isFrozen(work.activateScheduledWork), true);
  assert.equal(Object.isFrozen(work.availability), true);
  assert.equal(Object.isFrozen(work.captureImpulse), true);
  assert.equal(Object.isFrozen(work.dailyTidy), true);
  assert.equal(Object.isFrozen(work.discardImpulse), true);
  assert.equal(Object.isFrozen(work.duplicateWorkItem), true);
  assert.equal(Object.isFrozen(work.impulseInbox), true);
  assert.equal(Object.isFrozen(work.occurrenceSkipping), true);
  assert.equal(Object.isFrozen(work.recurrence), true);
  assert.equal(Object.isFrozen(work.restoreWorkItem), true);
  assert.equal(Object.isFrozen(work.scheduleActivation), true);
  assert.equal(Object.isFrozen(work.seriesRefresh), true);
  assert.equal(Object.isFrozen(work.seriesUpdating), true);
  assert.equal(Object.isFrozen(work.selection), true);
  assert.equal(Object.isFrozen(work.sessionEntry), true);
  assert.equal(Object.isFrozen(work.sessionInvestment), true);
  assert.equal(Object.isFrozen(work.stepCompletion), true);
  assert.equal(Object.isFrozen(work.taskArchiving), true);
  assert.equal(Object.isFrozen(work.taskAvoidance), true);
  assert.equal(Object.isFrozen(work.taskClarification), true);
  assert.equal(Object.isFrozen(work.taskCompletion), true);
  assert.equal(Object.isFrozen(work.taskCreation), true);
  assert.equal(Object.isFrozen(work.taskDuplication), true);
  assert.equal(Object.isFrozen(work.taskEditing), true);
  assert.equal(Object.isFrozen(work.taskExpiration), true);
  assert.equal(Object.isFrozen(work.taskState), true);
  assert.equal(Object.isFrozen(work.taskModel), true);
  assert.equal(Object.isFrozen(work.taskPlanning), true);
  assert.equal(Object.isFrozen(work.taskRestoration), true);
  assert.equal(Object.isFrozen(work.updateRecurrenceSeries), true);
});

test('pruned legacy core paths stay pruned so work rules keep one home', () => {
  for (const pruned of [
    '../src/core/task-availability',
    '../src/core/recurrence',
    '../src/core/task-model'
  ]) {
    assert.throws(() => require(pruned), /Cannot find module/);
  }
});

test('work normalization only invents timestamps from explicit inputs', () => {
  assert.throws(
    () => work.taskModel.normalizeTask({ title: '缺少创建时间' }),
    /options\.now/
  );
  assert.equal(
    work.taskModel.normalizeTask({ id: 'task-1', title: '已有时间', createdAt: 100 }).createdAt,
    100
  );

  assert.throws(
    () => work.taskModel.normalizeRecurrenceSeries({}),
    /options\.now/
  );
  assert.throws(
    () => work.taskModel.normalizeRecurrenceRule({}),
    /options\.fallbackTimestamp/
  );
  assert.equal(
    work.taskModel.normalizeRecurrenceRule({ anchorDate: '2026-09-08' }).anchorDate,
    '2026-09-08'
  );
});
