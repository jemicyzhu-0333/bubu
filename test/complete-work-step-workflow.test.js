'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPLETE_WORK_STEP_WRITES,
  createCompleteWorkStepWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const COMPLETED_AT = Date.parse('2026-09-08T09:00:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState({
    tasks: [{
      id: 'task-1',
      title: '完成两个检查点',
      done: false,
      createdAt: 1,
      nextAction: '打开文件',
      steps: [
        { id: 'step-1', title: '打开文件', done: false },
        { id: 'step-2', title: '写第一句', done: false }
      ]
    }],
    ...overrides
  }, { now: COMPLETED_AT });
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
  return createCompleteWorkStepWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => COMPLETED_AT },
    ...overrides
  });
}

test('step completion seals work and records bounded progress in one commit', () => {
  const initial = baseState({ xp: 31, level: 2 });
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ taskId: 'task-1', stepId: 'step-1' });
  const persisted = repository.inspect();

  assert.deepEqual(result, { ok: true, done: true, awarded: 30, advanceGranted: true });
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].steps[0].done, true);
  assert.equal(persisted.state.tasks[0].steps[0].completedAt, COMPLETED_AT);
  assert.equal(persisted.state.tasks[0].nextAction, '写第一句');
  assert.equal(persisted.state.xp, 1);
  assert.equal(persisted.state.level, 3);
  assert.equal(persisted.state.lastCompletedDate, '2026-09-08');
  assert.ok(persisted.state.unlockedSkins.includes('forest'));
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(COMPLETE_WORK_STEP_WRITES, [
    'tasks', 'xp', 'level', 'lastCompletedDate', 'stats',
    'rewardLedger', 'pet', 'companion', 'unlockedSkins'
  ]);
});

test('leveling up from a step never mints food, including after an effect failure', () => {
  const initial = baseState({ xp: 98, level: 1 });
  const initialInventory = structuredClone(initial.pet.foodInventory);
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, { publish: () => { throw new Error('closed'); } });
  assert.equal(workflow.execute({ taskId: 'task-1', stepId: 'step-1' }).ok, true);
  assert.deepEqual(repository.inspect().state.pet.foodInventory, initialInventory);
  assert.equal(repository.inspect().commits, 1);
  workflow.execute({ taskId: 'task-1', stepId: 'step-1' });
  assert.deepEqual(repository.inspect().state.pet.foodInventory, initialInventory);
  assert.equal(repository.inspect().commits, 1);
});

test('rejected and stale step commands write nothing and publish nothing', () => {
  const initial = baseState();
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ taskId: 'missing', stepId: 'step-1' }), {
    ok: false,
    reason: 'task-not-found',
    done: false
  });
  assert.deepEqual(workflow.execute({
    taskId: 'task-1',
    stepId: 'step-1',
    expectedRevision: 2
  }), {
    ok: false,
    reason: 'state-revision-conflict',
    done: false
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('a retry cannot complete or reward the same checkpoint twice', () => {
  const repository = createRepository(baseState());
  const workflow = createWorkflow(repository);

  assert.equal(workflow.execute({ taskId: 'task-1', stepId: 'step-1' }).ok, true);
  assert.deepEqual(workflow.execute({ taskId: 'task-1', stepId: 'step-1' }), {
    ok: false,
    reason: 'step-completed',
    done: false
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.xp, 0);
});

test('post-commit delivery failures cannot turn a completed step into a retryable result', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1', stepId: 'step-1' }), {
    ok: true,
    done: true,
    awarded: 30,
    advanceGranted: true
  });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-step-completed']]);
});
