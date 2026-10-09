'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUnitOfWork,
  createSelectNowWorkflow,
  SELECT_NOW_WRITES
} = require('../src/application');

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = structuredClone(candidate);
      commits += 1;
      revision += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

test('select-now coordinates work and execution in one commit, then publishes', () => {
  const selectedAt = Date.parse('2026-09-08T10:00:00Z');
  const events = [];
  let clockReads = 0;
  const repository = createRepository({
    tasks: [{
      id: 'scheduled-task', title: '提前开始', done: false, skippedAt: null, expired: false,
      scheduledFor: new Date(selectedAt + 60_000).toISOString(), scheduleNotifiedAt: selectedAt - 1,
      selectionCount: 0, lastSelectedAt: null
    }],
    nowTaskId: null,
    settings: { dnd: false }
  }, events);
  const workflow = createSelectNowWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => { clockReads += 1; return selectedAt; } },
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ taskId: 'scheduled-task' });

  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'scheduled-task');
  assert.equal(result.task.selectionCount, 1);
  assert.equal(result.task.lastSelectedAt, selectedAt);
  assert.equal(result.task.scheduledFor, null);
  assert.equal(clockReads, 1);
  assert.deepEqual(SELECT_NOW_WRITES, ['tasks', 'nowTaskId']);
  assert.equal(events[0][0], 'commit');
  assert.deepEqual(events[0][1], { now: selectedAt, expectedRevision: 0 });
  assert.equal(events[1][0], 'publish');
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(events[1][1], {
    type: 'now-selected',
    taskId: 'scheduled-task',
    selectedAt,
    revision: 1
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.nowTaskId, 'scheduled-task');
  assert.deepEqual(repository.inspect().state.settings, { dnd: false });
});

test('select-now refuses invalid work with zero writes and zero effects', () => {
  const events = [];
  const repository = createRepository({
    tasks: [{ id: 'done', title: '已经完成', done: true, selectionCount: 0 }],
    nowTaskId: null
  }, events);
  const workflow = createSelectNowWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 100 },
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ taskId: 'done' }), {
    ok: false,
    reason: 'task-completed'
  });
  assert.deepEqual(workflow.execute({ taskId: 'missing' }), {
    ok: false,
    reason: 'task-not-found'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('a projection failure after select-now never makes the committed command retryable', () => {
  const reported = [];
  const repository = createRepository({
    tasks: [{ id: 'task-1', title: '开始', done: false, selectionCount: 0 }],
    nowTaskId: null
  });
  const workflow = createSelectNowWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 100 },
    publish: () => { throw new Error('window closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ taskId: 'task-1' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['window closed', 'now-selected']]);
});

test('select-now honors optimistic revision checks without entering its transition', () => {
  let clockReads = 0;
  const repository = createRepository({ tasks: [], nowTaskId: null });
  const workflow = createSelectNowWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => { clockReads += 1; return 100; } }
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1', expectedRevision: 2 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(clockReads, 1);
  assert.equal(repository.inspect().commits, 0);
});
