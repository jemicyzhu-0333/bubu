'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARCHIVE_WORK_ITEM_WRITES,
  createArchiveWorkItemWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const ARCHIVED_AT = Date.parse('2026-09-08T12:00:00Z');

function baseState() {
  const state = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '稍后再做', done: false, createdAt: 1 }]
  }, { now: ARCHIVED_AT });
  state.nowTaskId = 'task-1';
  state.focusLandingPrompt = {
    sessionId: 'focus-old',
    taskId: 'task-1',
    completedAt: ARCHIVED_AT - 1_000,
    status: 'pending'
  };
  return state;
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

function createWorkflow(repository, overrides = {}) {
  return createArchiveWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => ARCHIVED_AT },
    ...overrides
  });
}

test('archiving moves work and clears Now and preserves the landing in one commit', () => {
  const events = [];
  const repository = createRepository(baseState(), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1', reason: 'manual-delete' }), { ok: true });
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks.length, 0);
  assert.equal(persisted.state.archivedTasks[0].id, 'task-1');
  assert.equal(persisted.state.archivedTasks[0].archivedAt, ARCHIVED_AT);
  assert.equal(persisted.state.archivedTasks[0].archiveReason, 'manual-delete');
  assert.equal(persisted.state.nowTaskId, null);
  assert.deepEqual(persisted.state.focusLandingPrompt, baseState().focusLandingPrompt);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(ARCHIVE_WORK_ITEM_WRITES, [
    'tasks', 'archivedTasks', 'nowTaskId', 'aiCollaboration'
  ]);
});

test('live execution and a pending quick-start decision both protect a task from archiving', () => {
  const active = baseState();
  active.focusSession = execution.focusSession.startFocus(active.focusSession, {
    now: ARCHIVED_AT - 1_000,
    durationMs: 60_000,
    taskId: 'task-1',
    sessionId: 'focus-1'
  }).session;
  const deciding = baseState();
  deciding.quickStartDecision = {
    sessionId: 'quick-1',
    taskId: 'task-1',
    completedAt: ARCHIVED_AT - 1,
    elapsedMs: 120_000,
    status: 'pending',
    resolvedAt: null
  };

  for (const initial of [active, deciding]) {
    const events = [];
    const repository = createRepository(initial, events);
    const workflow = createWorkflow(repository, {
      publish: fact => events.push(['publish', fact])
    });
    assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
      ok: false,
      reason: 'task-in-active-session'
    });
    assert.equal(repository.inspect().commits, 0);
    assert.deepEqual(repository.inspect().state, initial);
    assert.deepEqual(events, []);
  }
});

test('open recurrence and stale revision refusals leave the repository unchanged', () => {
  const recurring = baseState();
  recurring.tasks[0].seriesId = 'series-1';
  recurring.tasks[0].occurrenceDate = '2026-09-08';
  recurring.recurrenceSeries = [{
    id: 'series-1',
    createdAt: 1,
    state: 'active',
    rule: {
      frequency: 'daily', interval: 1, weekdays: null,
      strategy: 'fixed', anchorDate: '2026-09-08'
    },
    template: { title: '稍后再做', stepTitles: [], energy: 'medium', energyAuto: true },
    openTaskId: 'task-1',
    lastOccurrenceDate: '2026-09-08'
  }];
  const repository = createRepository(recurring);
  const workflow = createWorkflow(repository);

  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
    ok: false,
    reason: 'open-recurrence-occurrence'
  });
  assert.deepEqual(workflow.execute({ taskId: 'task-1', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, recurring);
});

test('post-commit delivery failure cannot turn an archived item into a retryable result', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), { ok: true });
  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
    ok: false,
    reason: 'task-not-found'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-item-archived']]);
});
