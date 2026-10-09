'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPLETE_WORK_ITEM_WRITES,
  createCompleteWorkItemWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = Date.parse('2026-09-08T09:00:00Z');

function baseState({ unfinished = false, totalTasksDone = 0 } = {}) {
  const state = normalizePersistedState({
    tasks: [{
      id: 'task-1',
      title: '完成这一小步',
      done: false,
      createdAt: 1,
      steps: unfinished ? [{ id: 'step-1', title: '还没做完', done: false }] : []
    }]
  }, { now: STARTED_AT });
  state.nowTaskId = 'task-1';
  state.stats.totalTasksDone = totalTasksDone;
  return state;
}

function runningFocus(now = STARTED_AT, durationMs = 60_000, taskId = 'task-1') {
  return execution.focusSession.startFocus(
    execution.focusSession.createIdleSession(now),
    { now, durationMs, taskId, sessionId: 'focus-1' }
  ).session;
}

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createWorkflow(repository, overrides = {}) {
  return createCompleteWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => STARTED_AT + 30_000 },
    idFactory: prefix => `${prefix}-next`,
    ...overrides
  });
}

test('task completion, reward, companion benefits and session pause commit once before effects', () => {
  const initial = baseState({ totalTasksDone: 49 });
  initial.focusSession = runningFocus();
  const initialBerry = initial.pet.foodInventory.berry;
  const initialFish = initial.pet.foodInventory.fish;
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ taskId: 'task-1' });
  const persisted = repository.inspect();

  assert.deepEqual(result, { ok: true, done: true, nextOccurrenceDate: null });
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].done, true);
  assert.equal(persisted.state.nowTaskId, null);
  assert.equal(persisted.state.focusSession.status, 'paused');
  assert.equal(persisted.state.focusSession.pausedFrom, 'focus');
  assert.equal(persisted.state.focusSession.elapsedBeforeStartMs, 30_000);
  assert.equal(persisted.state.xp, 0);
  assert.equal(persisted.state.stats.totalTasksDone, 50);
  assert.equal(persisted.state.pet.foodInventory.berry, initialBerry);
  assert.equal(persisted.state.pet.foodInventory.fish, initialFish);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 2);
  assert.equal(persisted.state.level, 2);
  assert.equal(persisted.state.pet.foodTickets, 9);
  assert.equal(persisted.state.unlockedSkins.includes('crown'), false);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(events[2][1].sessionPaused, true);
  assert.equal(events[2][1].foodDrop, null);
  assert.deepEqual(events[2][1].newlyUnlockedSkins, []);
  assert.deepEqual(COMPLETE_WORK_ITEM_WRITES, [
    'tasks', 'recurrenceSeries', 'nowTaskId', 'focusSession',
    'xp', 'level', 'lastCompletedDate', 'stats', 'rewardLedger',
    'pet', 'companion', 'unlockedSkins'
  ]);

  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
    ok: false,
    reason: 'task-completed',
    unfinishedCount: 0
  });
  assert.equal(repository.inspect().commits, 1, 'a retry must not create a second commit');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
});

test('only the first daily advance grants three tickets and neither task mints berries', () => {
  const initial = baseState();
  initial.tasks.push({
    id: 'task-2',
    title: '再完成一步',
    done: false,
    createdAt: 2,
    steps: []
  });
  const initialBerry = initial.pet.foodInventory.berry;
  const facts = [];
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, { publish: fact => facts.push(fact) });

  assert.equal(workflow.execute({ taskId: 'task-1' }).ok, true);
  assert.equal(workflow.execute({ taskId: 'task-2' }).ok, true);

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 2);
  assert.equal(persisted.state.pet.foodInventory.berry, initialBerry);
  assert.deepEqual(facts.map(fact => fact.foodDrop), [null, null]);
  assert.equal(persisted.state.pet.foodTickets, 9);
  assert.deepEqual(facts.map(fact => fact.ticketsGranted), [true, false]);
});

test('a rejected completion writes nothing, pauses nothing and publishes nothing', () => {
  const initial = baseState({ unfinished: true });
  initial.focusSession = runningFocus();
  const events = [];
  const repository = createRepository(initial, events);
  let randomCalls = 0;
  const workflow = createWorkflow(repository, {
    random: () => { randomCalls += 1; return 0; },
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
    ok: false,
    reason: 'unfinished-steps-need-confirmation',
    unfinishedCount: 1
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.equal(randomCalls, 0);
  assert.deepEqual(events, []);
});

test('a just-due linked session is held for explicit confirmation, not silently rewarded', () => {
  const initial = baseState();
  initial.focusSession = runningFocus(STARTED_AT, 10_000);
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, {
    clock: { now: () => STARTED_AT + 10_000 }
  });

  const result = workflow.execute({ taskId: 'task-1' });
  const persisted = repository.inspect().state;

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(persisted.focusSession.status, 'paused');
  assert.equal(persisted.focusSession.awaitingOfflineConfirmation, true);
  assert.equal(persisted.focusSession.recoveryReason, 'task-completed-session-due');
  assert.equal(persisted.xp, 0, 'the task earns the first 30 XP and the session stays unsettled');
  assert.equal(persisted.level, 2);
  assert.equal(
    persisted.rewardLedger.seenEventIds.some(id => id.startsWith('session-settle:')),
    false
  );
});

test('post-commit delivery failure cannot turn a completed task into a retryable failure', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), {
    ok: true,
    done: true,
    nextOccurrenceDate: null
  });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-item-completed']]);
});
