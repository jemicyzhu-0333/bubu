'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOLVE_IMPULSE_WRITES,
  createResolveImpulseWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const RESOLVED_AT = Date.parse('2026-09-09T09:00:00Z');
const NEXT_WORK_START = Date.parse('2026-09-10T10:00:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState({
    impulses: [{ id: 'impulse-1', text: '整理发布说明', createdAt: RESOLVED_AT - 10_000 }],
    ...overrides
  }, { now: RESOLVED_AT });
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
  let sequence = 0;
  return createResolveImpulseWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => RESOLVED_AT },
    idFactory: prefix => `${prefix}-${++sequence}`,
    inferEnergy: () => 'medium',
    suggestDuration: () => 25,
    suggestNextStep: title => ({ title: `打开：${title}` }),
    nextWorkStart: now => {
      assert.equal(now, RESOLVED_AT);
      return NEXT_WORK_START;
    },
    ...overrides
  });
}

test('promoting an impulse creates and optionally selects one task in a single commit', () => {
  const events = [];
  const repository = createRepository(baseState(), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'promote' });

  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'task-1');
  assert.equal(result.task.title, '整理发布说明');
  assert.equal('action' in result, false, 'the promote IPC response shape stays unchanged');
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.impulses.filter(item => !item.resolution).length, 0);
  assert.equal(persisted.state.impulses[0].resolution.targetId, result.task.id);
  assert.equal(persisted.state.tasks.length, 1);
  assert.equal(persisted.state.nowTaskId, result.task.id);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'impulse-resolved',
    impulseId: 'impulse-1',
    action: 'promote',
    taskId: 'task-1',
    resolvedAt: RESOLVED_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(RESOLVE_IMPULSE_WRITES, [
    'impulses', 'tasks', 'archivedTasks', 'nowTaskId', 'stats', 'energySignals'
  ]);
});

test('next-step creates a deterministic first step, records breakdown and takes over Now', () => {
  const repository = createRepository(baseState({
    tasks: [{ id: 'existing', title: '原来的 Now', createdAt: RESOLVED_AT - 20_000 }],
    nowTaskId: 'existing',
    stats: { totalBreakdowns: 4 }
  }));
  const workflow = createWorkflow(repository);

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'next-step' });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'next-step');
  assert.equal(result.task.steps[0].title, '打开：整理发布说明');
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.nowTaskId, result.task.id);
  assert.equal(persisted.state.tasks.some(task => task.id === 'existing'), true);
  assert.equal(persisted.state.stats.totalBreakdowns, 5);
  assert.equal(persisted.state.impulses.filter(item => !item.resolution).length, 0);
  assert.equal(persisted.state.impulses[0].resolution.targetId, result.task.id);
});

test('schedule creates an unavailable task at the next work start without inventing a deadline or TTL', () => {
  const repository = createRepository(baseState());
  const workflow = createWorkflow(repository);

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'schedule' });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'schedule');
  assert.equal(result.task.scheduledFor, new Date(NEXT_WORK_START).toISOString());
  assert.equal(result.task.deadline, null);
  assert.equal(result.task.expiresAt, null);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.nowTaskId, null);
  assert.equal(persisted.state.impulses.filter(item => !item.resolution).length, 0);
  assert.equal(persisted.state.impulses[0].resolution.targetId, result.task.id);
});

test('someday creates a canonical task directly into recoverable history', () => {
  const repository = createRepository(baseState());
  const workflow = createWorkflow(repository);

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'someday' });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'someday');
  assert.equal(result.task.archiveReason, 'someday');
  assert.equal(result.task.archivedAt, RESOLVED_AT);
  assert.equal(result.task.expiresAt, null);
  assert.equal(result.task.expired, false);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks.length, 0);
  assert.equal(persisted.state.archivedTasks[0].id, result.task.id);
  assert.equal(persisted.state.impulses.filter(item => !item.resolution).length, 0);
  assert.equal(persisted.state.impulses[0].resolution.targetId, result.task.id);
  assert.equal(persisted.state.nowTaskId, null);
});

test('review deletion consumes only the confirmed impulse', () => {
  const events = [];
  const repository = createRepository(baseState({
    impulses: [
      { id: 'impulse-1', text: '删除', createdAt: 1 },
      { id: 'impulse-2', text: '保留', createdAt: 2 }
    ]
  }), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ impulseId: 'impulse-1', action: 'delete' }), {
    ok: true,
    action: 'delete'
  });
  const persisted = repository.inspect();
  assert.deepEqual(persisted.state.impulses.map(item => item.id), ['impulse-2']);
  assert.deepEqual(events[0][1].expectedRevision, 0);
  assert.equal(events[1][1].taskId, null);
});

test('missing, invalid and stale resolutions do not allocate IDs, consume impulses or publish', () => {
  const initial = baseState();
  const events = [];
  let idCalls = 0;
  let policyCalls = 0;
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    idFactory: prefix => {
      idCalls += 1;
      return `${prefix}-${idCalls}`;
    },
    suggestNextStep: () => {
      policyCalls += 1;
      return { title: '不应执行' };
    },
    nextWorkStart: () => {
      policyCalls += 1;
      return NEXT_WORK_START;
    },
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ impulseId: 'missing', action: 'promote' }), {
    ok: false,
    reason: 'impulse-not-found'
  });
  assert.deepEqual(workflow.execute({ impulseId: 'impulse-1', action: 'rename' }), {
    ok: false,
    reason: 'impulse-action-invalid'
  });
  assert.deepEqual(workflow.execute({
    impulseId: 'impulse-1', action: 'next-step', expectedRevision: 1
  }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(idCalls, 0);
  assert.equal(policyCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('a resolution remains successful when post-commit projection delivery fails', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'promote' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'impulse-resolved']]);
});
