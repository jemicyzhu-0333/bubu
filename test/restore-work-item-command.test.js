'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const RESTORED_AT = Date.parse('2026-09-08T14:00:00Z');
const RENEWED_EXPIRY = '2026-09-08T23:59:59.999Z';

function sourceState(taskOverrides = {}) {
  const canonical = normalizePersistedState({}, { now: RESTORED_AT });
  return normalizePersistedState({
    ...canonical,
    archivedTasks: [{
      id: 'task-1',
      title: '重新拿回来',
      description: '保留原计划',
      createdAt: RESTORED_AT - 10_000,
      updatedAt: RESTORED_AT - 9_000,
      archivedAt: RESTORED_AT - 1_000,
      archiveReason: 'manual',
      expiresAt: '2026-09-07T23:59:59.999Z',
      expired: true,
      steps: [{ id: 'step-1', title: '打开文件', done: false }],
      ...taskOverrides
    }]
  }, { now: RESTORED_AT });
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
  return work.restoreWorkItem.createRestoreWorkItemCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => RESTORED_AT },
    renewExpiry: () => RENEWED_EXPIRY,
    ...overrides
  });
}

test('restoring active work renews an elapsed expiry and commits once before publishing', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  let renewalCalls = 0;
  const command = createCommand(repository, {
    renewExpiry: now => {
      renewalCalls += 1;
      assert.equal(now, RESTORED_AT);
      return RENEWED_EXPIRY;
    },
    publish: fact => events.push(['publish', fact])
  });

  const result = command.execute({ taskId: 'task-1' });

  assert.equal(result.ok, true);
  assert.equal(result.task.archivedAt, null);
  assert.equal(result.task.archiveReason, null);
  assert.equal(result.task.expired, false);
  assert.equal(result.task.expiresAt, RENEWED_EXPIRY);
  assert.equal(renewalCalls, 1);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].id, 'task-1');
  assert.equal(persisted.state.archivedTasks.length, 0);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'work-item-restored',
    taskId: 'task-1',
    restoredAt: RESTORED_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(work.restoreWorkItem.RESTORE_WORK_ITEM_WRITES, ['tasks', 'archivedTasks']);
});

test('restoring sealed history preserves its completion and original expiry snapshot', () => {
  const initial = sourceState({
    done: true,
    completedAt: RESTORED_AT - 5_000,
    expired: false
  });
  const repository = createRepository(initial);
  let renewalCalls = 0;
  const command = createCommand(repository, {
    renewExpiry: () => {
      renewalCalls += 1;
      return RENEWED_EXPIRY;
    }
  });

  const result = command.execute({ taskId: 'task-1' });

  assert.equal(result.ok, true);
  assert.equal(result.task.done, true);
  assert.equal(result.task.completedAt, RESTORED_AT - 5_000);
  assert.equal(result.task.expiresAt, '2026-09-07T23:59:59.999Z');
  assert.equal(renewalCalls, 0);
  assert.equal(repository.inspect().commits, 1);
});

test('missing and stale restore requests leave both work collections untouched', () => {
  const initial = sourceState();
  const events = [];
  const repository = createRepository(initial, events);
  let renewalCalls = 0;
  const command = createCommand(repository, {
    renewExpiry: () => {
      renewalCalls += 1;
      return RENEWED_EXPIRY;
    },
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ taskId: 'missing' }), {
    ok: false,
    reason: 'task-not-found'
  });
  assert.deepEqual(command.execute({ taskId: 'task-1', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(renewalCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('an invalid renewal policy fails before mutation or commit', () => {
  const initial = sourceState();
  const repository = createRepository(initial);
  const command = createCommand(repository, { renewExpiry: () => 'already-expired' });

  assert.throws(
    () => command.execute({ taskId: 'task-1' }),
    /expiry renewal must return a future instant/
  );
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
});

test('post-commit projection failure cannot make a restore request retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const command = createCommand(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = command.execute({ taskId: 'task-1' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-item-restored']]);
});
