'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UPDATE_WORK_ITEM_WRITES,
  createUnitOfWork,
  createUpdateWorkItemWorkflow
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const UPDATED_AT = Date.parse('2026-09-08T10:00:00Z');
const OCCURRENCE_DAY = '2026-09-08';

function stateWith(overrides = {}) {
  const canonical = normalizePersistedState({}, { now: UPDATED_AT });
  return normalizePersistedState({ ...canonical, ...overrides }, { now: UPDATED_AT });
}

function oneOffState(overrides = {}) {
  return stateWith({
    tasks: [{
      id: 'task-1',
      title: '写方案',
      createdAt: 1,
      steps: [{ id: 'step-1', title: '打开文档', done: false }]
    }],
    nowTaskId: 'task-1',
    ...overrides
  });
}

function recurringState() {
  return stateWith({
    tasks: [{
      id: 'occ-1',
      title: '每天写一行',
      createdAt: 1,
      plannedFor: OCCURRENCE_DAY,
      seriesId: 'series-1',
      occurrenceDate: OCCURRENCE_DAY,
      steps: [{ id: 'step-1', title: '打开文件', done: false }]
    }],
    recurrenceSeries: [{
      id: 'series-1',
      createdAt: 1,
      state: 'active',
      rule: {
        frequency: 'daily',
        interval: 1,
        weekdays: null,
        strategy: 'fixed',
        anchorDate: OCCURRENCE_DAY
      },
      template: {
        title: '每天写一行',
        stepTitles: ['打开文件'],
        tags: [],
        energy: 'medium',
        energyAuto: true
      },
      openTaskId: 'occ-1',
      lastOccurrenceDate: OCCURRENCE_DAY
    }]
  });
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
  return createUpdateWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => UPDATED_AT },
    idFactory: prefix => `${prefix}-new-${++sequence}`,
    inferEnergy: title => (title.includes('高能') ? 'high' : 'medium'),
    suggestDuration: (_title, energy) => (energy === 'high' ? 45 : 25),
    ...overrides
  });
}

test('task fields and stable step operations commit once before publishing', () => {
  const events = [];
  const repository = createRepository(oneOffState(), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({
    taskId: 'task-1',
    patch: {
      title: '高能方案',
      energy: 'auto',
      estimateMinutes: 30,
      steps: [
        { op: 'rename', stepId: 'step-1', title: '打开设计稿' },
        { op: 'add', title: '写出摘要' }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.scope, 'current');
  assert.equal(result.task.title, '高能方案');
  assert.equal(result.task.energy, 'high');
  assert.equal(result.task.energyAuto, true);
  assert.equal(result.task.estimateMinutes, 30);
  assert.equal(result.task.estimateSource, 'user');
  assert.equal(result.task.suggestedMin, 45);
  assert.deepEqual(result.task.steps.map(step => step.id), ['step-1', 'step-new-1']);
  assert.deepEqual(result.task.steps.map(step => step.title), ['打开设计稿', '写出摘要']);
  assert.equal(result.task.nextAction, '打开设计稿');
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(UPDATE_WORK_ITEM_WRITES, ['tasks', 'recurrenceSeries', 'nowTaskId']);
});

test('recurring edits require a scope and only the future scope changes the template', () => {
  const missingScopeRepository = createRepository(recurringState());
  const missingScope = createWorkflow(missingScopeRepository).execute({
    taskId: 'occ-1',
    patch: { title: '没说范围' }
  });
  assert.deepEqual(missingScope, {
    ok: false,
    reason: 'recurrence-scope-required',
    task: null
  });
  assert.equal(missingScopeRepository.inspect().commits, 0);

  const currentRepository = createRepository(recurringState());
  const current = createWorkflow(currentRepository).execute({
    taskId: 'occ-1',
    patch: { title: '今天只写标题' },
    scope: 'current'
  });
  assert.equal(current.ok, true);
  assert.equal(current.task.title, '今天只写标题');
  assert.equal(currentRepository.inspect().state.recurrenceSeries[0].template.title, '每天写一行');

  const futureRepository = createRepository(recurringState());
  const future = createWorkflow(futureRepository).execute({
    taskId: 'occ-1',
    patch: {
      title: '以后写两行',
      tags: ['写作'],
      steps: [{ op: 'rename', stepId: 'step-1', title: '打开日报' }]
    },
    scope: 'current-and-future'
  });
  const persisted = futureRepository.inspect();
  assert.equal(future.ok, true);
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].title, '以后写两行');
  assert.deepEqual(persisted.state.tasks[0].tags, ['写作']);
  assert.equal(persisted.state.recurrenceSeries[0].template.title, '以后写两行');
  assert.deepEqual(persisted.state.recurrenceSeries[0].template.tags, ['写作']);
  assert.deepEqual(persisted.state.recurrenceSeries[0].template.stepTitles, ['打开日报']);
});

test('a rejected compound step edit leaves every field and execution pointer unchanged', () => {
  const initial = oneOffState();
  const events = [];
  const repository = createRepository(initial, events);
  let idCalls = 0;
  const workflow = createWorkflow(repository, {
    idFactory: () => `allocated-${++idCalls}`,
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({
    taskId: 'task-1',
    patch: {
      title: '不应落库',
      steps: [
        { op: 'add', title: '临时步骤' },
        { op: 'reorder', stepIds: ['step-1'] }
      ]
    }
  }), { ok: false, reason: 'step-order-mismatch', task: null });
  assert.equal(idCalls, 1);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('an edit that makes the selected task unavailable clears only the Now pointer', () => {
  const repository = createRepository(oneOffState({
    focusLandingPrompt: {
      sessionId: 'focus-1',
      taskId: 'task-1',
      completedAt: UPDATED_AT - 1,
      status: 'pending'
    }
  }));
  const workflow = createWorkflow(repository);
  const scheduledFor = new Date(UPDATED_AT + 60_000).toISOString();

  const result = workflow.execute({
    taskId: 'task-1',
    patch: { scheduledFor }
  });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().state.nowTaskId, null);
  assert.equal(repository.inspect().state.focusLandingPrompt.taskId, 'task-1',
    'editing availability does not own an existing landing prompt');
});

test('optimistic revision conflicts reject stale retries before allocating IDs or writing', () => {
  const repository = createRepository(oneOffState());
  let idCalls = 0;
  const workflow = createWorkflow(repository, {
    idFactory: prefix => `${prefix}-${++idCalls}`
  });

  assert.equal(workflow.execute({
    taskId: 'task-1',
    patch: { steps: [{ op: 'add', title: '第一版' }] },
    expectedRevision: 0
  }).ok, true);
  const afterFirst = repository.inspect().state;
  const idCallsAfterFirstCommit = idCalls;

  assert.deepEqual(workflow.execute({
    taskId: 'task-1',
    patch: { steps: [{ op: 'add', title: '过期重试' }] },
    expectedRevision: 0
  }), { ok: false, reason: 'state-revision-conflict', task: null });
  assert.equal(idCalls, idCallsAfterFirstCommit);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(repository.inspect().state, afterFirst);
});

test('post-commit projection failure cannot make an applied edit retryable', () => {
  const repository = createRepository(oneOffState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ taskId: 'task-1', patch: { title: '已经提交' } });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.tasks[0].title, '已经提交');
  assert.deepEqual(reported, [['renderer closed', 'work-item-updated']]);
});
for (const status of ['focus', 'quick-start', 'paused']) {
  test(`${status}: only append steps to this occurrence; session and template remain intact`, () => {
    const initial = recurringState();
    initial.focusSession = { status, sessionId: 'focus-1', taskId: 'occ-1', startedAt: UPDATED_AT,
      pausedFrom: status === 'paused' ? 'focus' : null, pausedAt: UPDATED_AT,
      plannedDurationMs: 1500000, elapsedBeforeStartMs: 0 };
    const repository = createRepository(stateWith(initial));
    const before = repository.snapshot();
    const workflow = createWorkflow(repository);
    for (const input of [
      { patch: { title: 'renamed' }, scope: 'current' },
      { patch: { steps: [{ op: 'remove', stepId: 'step-1' }] }, scope: 'current' },
      { patch: { steps: [{ op: 'add', title: 'extra' }] }, scope: 'current-and-future' }
    ]) {
      assert.equal(workflow.execute({ taskId: 'occ-1', ...input }).reason, 'task-in-focus');
      assert.deepEqual(repository.snapshot(), before);
    }
    const result = workflow.execute({ taskId: 'occ-1', patch: { steps: [{ op: 'add', title: '确认附件' }] }, scope: 'current' });
    assert.equal(result.ok, true);
    assert.equal(result.task.title, before.tasks[0].title);
    assert.deepEqual(result.task.steps[0], before.tasks[0].steps[0]);
    assert.equal(result.task.steps[1].title, '确认附件');
    const renamed = workflow.execute({ taskId: 'occ-1', patch: { steps: [{ op: 'rename', stepId: result.task.steps[1].id, title: '核对最后一个附件' }] }, scope: 'current' });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.task.steps[1].title, '核对最后一个附件');
    assert.deepEqual(repository.snapshot().focusSession, before.focusSession);
    assert.deepEqual(repository.snapshot().recurrenceSeries, before.recurrenceSeries);
  });
}
