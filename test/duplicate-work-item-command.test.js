'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const DUPLICATED_AT = Date.parse('2026-09-08T14:00:00Z');

function sourceState() {
  const canonical = normalizePersistedState({}, { now: DUPLICATED_AT });
  return normalizePersistedState({
    ...canonical,
    archivedTasks: [{
      id: 'source-task',
      title: '复用这份计划',
      description: '只复制计划字段',
      createdAt: 1,
      done: true,
      completedAt: DUPLICATED_AT - 1,
      archivedAt: DUPLICATED_AT - 1,
      archiveReason: 'completed',
      tags: ['方案'],
      energy: 'high',
      energyAuto: false,
      estimateMinutes: 45,
      estimateSource: 'user',
      steps: [{
        id: 'source-step', title: '打开旧文档', done: true, completedAt: DUPLICATED_AT - 2
      }]
    }]
  }, { now: DUPLICATED_AT });
}

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createCommand(repository, overrides = {}) {
  let sequence = 0;
  return work.duplicateWorkItem.createDuplicateWorkItemCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => DUPLICATED_AT },
    idFactory: prefix => `${prefix}-copy-${++sequence}`,
    ...overrides
  });
}

test('duplicating archived work creates fresh task and step identities in one commit', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = command.execute({ taskId: 'source-task' });

  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'task-copy-1');
  assert.deepEqual(result.task.steps.map(step => step.id), ['step-copy-2']);
  assert.equal(result.task.steps[0].done, false);
  assert.equal(result.task.done, false);
  assert.equal(result.task.completedAt, null);
  assert.equal(result.task.archivedAt, null);
  assert.equal(result.task.seriesId, null);
  assert.deepEqual(result.task.tags, ['方案']);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].id, result.task.id);
  assert.equal(persisted.state.archivedTasks[0].id, 'source-task');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'work-item-duplicated',
    taskId: 'task-copy-1',
    sourceTaskId: 'source-task',
    duplicatedAt: DUPLICATED_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(work.duplicateWorkItem.DUPLICATE_WORK_ITEM_WRITES, ['tasks']);
});

test('missing and stale duplicate requests perform zero writes and effects', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  let idCalls = 0;
  const command = createCommand(repository, {
    idFactory: prefix => `${prefix}-${++idCalls}`,
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ taskId: 'missing' }), {
    ok: false,
    reason: 'task-not-found'
  });
  assert.deepEqual(command.execute({ taskId: 'source-task', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(idCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, sourceState());
  assert.deepEqual(events, []);
});

test('post-commit projection failure cannot make a duplicate request retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const command = createCommand(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = command.execute({ taskId: 'source-task' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-item-duplicated']]);
});
