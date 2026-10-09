'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLARIFY_WORK_ITEM_WRITES,
  createClarifyWorkItemWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const CLARIFIED_AT = Date.parse('2026-09-08T10:00:00Z');

function stateWith(task = {}, state = {}) {
  const canonical = normalizePersistedState({}, { now: CLARIFIED_AT });
  return normalizePersistedState({
    ...canonical,
    tasks: [{ id: 'task-1', title: '写方案', createdAt: 1, ...task }],
    ...state
  }, { now: CLARIFIED_AT });
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
  return createClarifyWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => CLARIFIED_AT },
    idFactory: prefix => `${prefix}-new-${++sequence}`,
    suggestNextAction: () => '打开方案文档',
    ...overrides
  });
}

test('clarification updates work and selects Now in one commit before publishing', () => {
  const events = [];
  const repository = createRepository(stateWith(), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({
    taskId: 'task-1',
    blocker: '入口太多',
    nextAction: '先写标题'
  });

  assert.equal(result.ok, true);
  assert.equal(result.task.blocker, '入口太多');
  assert.equal(result.task.nextAction, '先写标题');
  assert.equal(result.task.activationFriction, 50);
  assert.equal(result.task.updatedAt, CLARIFIED_AT);
  assert.deepEqual(result.task.steps.map(step => [step.id, step.title]), [
    ['step-new-1', '先写标题']
  ]);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.nowTaskId, 'task-1');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[0][1], { now: CLARIFIED_AT, expectedRevision: 0 });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(events[1][1], {
    type: 'work-item-clarified',
    taskId: 'task-1',
    clarifiedAt: CLARIFIED_AT,
    revision: 1
  });
  assert.deepEqual(CLARIFY_WORK_ITEM_WRITES, ['tasks', 'nowTaskId']);
});

test('clarification reuses an unfinished step or deterministically creates the default action', () => {
  const existingRepository = createRepository(stateWith({
    steps: [{ id: 'step-stable', title: '打开已有文档', done: false }]
  }));
  const existingWorkflow = createWorkflow(existingRepository, {
    idFactory: () => { throw new Error('existing action must not allocate an ID'); },
    suggestNextAction: () => { throw new Error('existing action must not request a suggestion'); }
  });

  const existing = existingWorkflow.execute({ taskId: 'task-1', blocker: '还没开始' });
  assert.equal(existing.ok, true);
  assert.equal(existing.task.nextAction, '打开已有文档');
  assert.deepEqual(existing.task.steps.map(step => step.id), ['step-stable']);

  let suggestionCalls = 0;
  const defaultRepository = createRepository(stateWith());
  const fallback = createWorkflow(defaultRepository, {
    suggestNextAction: title => {
      suggestionCalls += 1;
      assert.equal(title, '写方案');
      return '打开方案文档';
    }
  }).execute({ taskId: 'task-1', blocker: '不知道第一步' });

  assert.equal(fallback.ok, true);
  assert.equal(fallback.task.nextAction, '打开方案文档');
  assert.deepEqual(fallback.task.steps.map(step => step.id), ['step-new-1']);
  assert.equal(suggestionCalls, 1);
});

test('unavailable or full work is rejected without writes, IDs or effects', () => {
  const fullSteps = Array.from({ length: 100 }, (_, index) => ({
    id: `step-${index}`,
    title: `已完成步骤 ${index}`,
    done: true,
    completedAt: index + 2
  }));
  const skipped = stateWith({
    seriesId: 'series-1',
    occurrenceDate: '2026-09-08',
    skippedAt: CLARIFIED_AT - 1
  }, {
    recurrenceSeries: [{
      id: 'series-1',
      createdAt: 1,
      state: 'active',
      rule: {
        frequency: 'daily', interval: 1, weekdays: null,
        strategy: 'fixed', anchorDate: '2026-09-08'
      },
      template: { title: '写方案', stepTitles: [], energy: 'medium', energyAuto: true },
      openTaskId: null,
      lastOccurrenceDate: '2026-09-08'
    }]
  });
  const cases = [
    ['scheduled', stateWith({
      scheduledFor: new Date(CLARIFIED_AT + 60_000).toISOString()
    }), 'task-scheduled'],
    ['expired', stateWith({
      expiresAt: new Date(CLARIFIED_AT).toISOString()
    }), 'task-expired'],
    ['completed', stateWith({
      done: true, completedAt: CLARIFIED_AT - 1
    }), 'task-completed'],
    ['skipped', skipped, 'occurrence-skipped'],
    ['full', stateWith({ steps: fullSteps }), 'step-limit-reached']
  ];

  for (const [name, initial, reason] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    let idCalls = 0;
    const result = createWorkflow(repository, {
      idFactory: () => `unexpected-${++idCalls}`,
      publish: fact => events.push(['publish', fact])
    }).execute({
      taskId: 'task-1', blocker: '不应写入', nextAction: '新的动作'
    });

    assert.deepEqual(result, { ok: false, reason }, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.equal(idCalls, 0, name);
    assert.deepEqual(events, [], name);
  }
});

test('a stale retry is rejected before allocating another stable step identity', () => {
  const repository = createRepository(stateWith());
  let idCalls = 0;
  const workflow = createWorkflow(repository, {
    idFactory: prefix => `${prefix}-${++idCalls}`
  });

  assert.equal(workflow.execute({
    taskId: 'task-1', nextAction: '第一版', expectedRevision: 0
  }).ok, true);
  const committed = repository.inspect().state;
  const idsAfterCommit = idCalls;

  assert.deepEqual(workflow.execute({
    taskId: 'task-1', nextAction: '过期重试', expectedRevision: 0
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(idCalls, idsAfterCommit);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(repository.inspect().state, committed);
});

test('post-commit projection failure cannot make clarification retryable', () => {
  const repository = createRepository(stateWith());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ taskId: 'task-1', nextAction: '已经提交' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.tasks[0].nextAction, '已经提交');
  assert.deepEqual(reported, [['renderer closed', 'work-item-clarified']]);
});
