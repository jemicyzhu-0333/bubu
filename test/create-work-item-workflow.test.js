'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CREATE_WORK_ITEM_WRITES,
  createWorkItemWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const CREATED_AT = Date.parse('2026-09-01T08:00:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: CREATED_AT });
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
  return createWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => CREATED_AT },
    idFactory: prefix => `${prefix}-${++sequence}`,
    inferEnergy: () => 'low',
    suggestDuration: (_title, energy) => energy === 'low' ? 10 : 25,
    ...overrides
  });
}

test('creating a broken-down task commits work, Now and progress once before publishing', () => {
  const events = [];
  const repository = createRepository(baseState({
    stats: { totalBreakdowns: 4 }
  }), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({
    task: {
      title: '写发布说明',
      description: '先完成最小版本',
      energy: 'auto',
      tags: ['发布'],
      estimateMinutes: null,
      plannedFor: null,
      scheduledFor: null,
      deadline: null,
      expiresAt: null,
      recurrence: null,
      steps: [{ title: '打开说明文档' }]
    },
    breakdown: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'task-1');
  assert.equal(result.task.steps[0].id, 'step-2');
  assert.equal(result.task.energy, 'low');
  assert.equal(result.task.energyAuto, true);
  assert.equal(result.task.suggestedMin, 10);
  assert.equal(result.series, null);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].id, result.task.id);
  assert.equal(persisted.state.nowTaskId, result.task.id);
  assert.equal(persisted.state.stats.totalBreakdowns, 5);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'work-item-created',
    taskId: 'task-1',
    seriesId: null,
    createdAt: CREATED_AT,
    breakdown: true,
    selectedAsNow: true,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(CREATE_WORK_ITEM_WRITES, [
    'tasks', 'recurrenceSeries', 'nowTaskId', 'stats'
  ]);
});

test('a recurring task creates its series and first occurrence in the same snapshot', () => {
  const repository = createRepository(baseState());
  const workflow = createWorkflow(repository);

  const result = workflow.execute({
    task: {
      title: '每周一三写一行',
      description: null,
      energy: 'auto',
      tags: [],
      estimateMinutes: null,
      plannedFor: '2026-09-01',
      scheduledFor: '2026-09-02T09:00:00.000Z',
      deadline: '2026-09-02T12:00:00.000Z',
      expiresAt: '2026-09-03T12:00:00.000Z',
      recurrence: {
        frequency: 'weekly', interval: 1, weekdays: [1, 3], strategy: 'fixed', anchorDate: null
      },
      steps: [{ title: '打开文档' }]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.series.state, 'active');
  assert.equal(result.task.occurrenceDate, '2026-09-02');
  assert.equal(result.task.plannedFor, '2026-09-02');
  assert.equal(result.task.scheduledFor, '2026-09-02T09:00:00.000Z');
  assert.equal(result.task.deadline, '2026-09-02T12:00:00.000Z');
  assert.equal(result.task.expiresAt, '2026-09-03T12:00:00.000Z');
  assert.equal(result.series.openTaskId, result.task.id);
  assert.equal(result.series.lastOccurrenceDate, result.task.occurrenceDate);
  assert.deepEqual(result.series.template.stepTitles, ['打开文档']);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.recurrenceSeries[0].id, result.series.id);
  assert.equal(persisted.state.tasks[0].seriesId, result.series.id);
  assert.equal(persisted.state.nowTaskId, null, 'a future-scheduled task is not selected as Now');
});

test('creation preserves an existing Now selection and supports an explicit no-selection caller', () => {
  const existing = baseState({
    tasks: [{ id: 'existing', title: '正在做', createdAt: CREATED_AT - 1 }],
    nowTaskId: 'existing'
  });
  const repository = createRepository(existing);
  const workflow = createWorkflow(repository);

  const first = workflow.execute({ task: { title: '稍后做', energy: 'auto', steps: [] } });
  assert.equal(first.ok, true);
  assert.equal(repository.inspect().state.nowTaskId, 'existing');

  const emptyRepository = createRepository(baseState());
  const second = createWorkflow(emptyRepository).execute({
    task: { title: '不要自动选择', energy: 'auto', steps: [] },
    selectAsNow: false
  });
  assert.equal(second.ok, true);
  assert.equal(emptyRepository.inspect().state.nowTaskId, null);
});

test('series limits and stale revisions reject before allocating identities or publishing', () => {
  const full = baseState();
  full.recurrenceSeries = Array.from({ length: 200 }, (_, index) => ({ id: `series-${index}` }));
  const events = [];
  let idCalls = 0;
  const repository = createRepository(full, events);
  const workflow = createWorkflow(repository, {
    idFactory: prefix => `${prefix}-${++idCalls}`,
    publish: fact => events.push(['publish', fact])
  });
  const recurringTask = {
    title: '超出系列上限',
    energy: 'auto',
    recurrence: { frequency: 'daily', interval: 1, weekdays: null, strategy: 'fixed', anchorDate: null },
    steps: []
  };

  assert.deepEqual(workflow.execute({ task: recurringTask }), {
    ok: false,
    reason: 'series-limit-reached'
  });
  assert.deepEqual(workflow.execute({
    task: { title: '过期请求', energy: 'auto', steps: [] },
    expectedRevision: 1
  }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(idCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('post-commit projection failure cannot make task creation retryable', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ task: { title: '仍然成功', energy: 'auto', steps: [] } });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-item-created']]);
});
