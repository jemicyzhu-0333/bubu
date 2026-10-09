'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPLETE_DUE_SESSION_WRITES,
  createCompleteDueSessionWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = Date.parse('2026-09-09T09:55:00Z');
const DUE_AT = Date.parse('2026-09-09T10:00:00Z');
const MINUTE = 60_000;

function sourceState({ durationMs = 5 * MINUTE } = {}) {
  const state = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '完成这一轮', done: false, createdAt: STARTED_AT - 1 }]
  }, { now: STARTED_AT });
  state.nowTaskId = 'task-1';
  state.focusSession = execution.focusSession.startFocus(state.focusSession, {
    taskId: 'task-1',
    durationMs,
    now: STARTED_AT,
    sessionId: 'focus-1'
  }).session;
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
  return createCompleteDueSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => DUE_AT },
    sessionClock: { now: () => DUE_AT },
    random: () => 0.99,
    ...overrides
  });
}

test('a due session settles all capability slices once before completion effects', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const result = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publishSettlement: fact => events.push(['settlement', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.completion.completed, true);
  assert.equal(result.completion.reason, 'completed');
  assert.equal(result.session.status, 'idle');
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'idle');
  assert.equal(persisted.state.tasks[0].focusedMs, 5 * MINUTE);
  assert.equal(persisted.state.tasks[0].focusSessions, 1);
  assert.equal(persisted.state.xp, 0);
  assert.equal(persisted.state.stats.totalPomodoros, 1);
  assert.equal(persisted.state.focusLandingPrompt.sessionId, 'focus-1');
  assert.deepEqual(events.map(event => event[0]), [
    'commit', 'synchronize', 'settlement', 'present', 'publish'
  ]);
  assert.equal(events.slice(1).every(event => event[1] === events[1][1]), true);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(COMPLETE_DUE_SESSION_WRITES, [
    'focusSession', 'quickStartDecision', 'focusLandingPrompt', 'tasks',
    'xp', 'level', 'lastCompletedDate', 'stats', 'rewardLedger',
    'companion', 'unlockedSkins'
  ]);
});

test('an early or idle session performs no write and publishes no effects', () => {
  const cases = [
    ['early', sourceState({ durationMs: 25 * MINUTE }), 'focus'],
    ['idle', normalizePersistedState({}, { now: DUE_AT }), 'idle']
  ];

  for (const [name, initial, status] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      synchronize: () => events.push(['synchronize']),
      publishSettlement: () => events.push(['settlement']),
      present: () => events.push(['present']),
      publish: () => events.push(['publish'])
    }).execute();

    assert.equal(result.ok, true, name);
    assert.equal(result.completed, false, name);
    assert.equal(result.session.status, status, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }
});

test('a stale due check does not run the session clock or any effect', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const result = createWorkflow(repository, {
    sessionClock: { now: () => { throw new Error('must not sample'); } },
    synchronize: () => events.push(['synchronize']),
    publishSettlement: () => events.push(['settlement']),
    present: () => events.push(['present']),
    publish: () => events.push(['publish'])
  }).execute({ expectedRevision: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('post-commit failures cannot make a completed session retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const effects = {
    synchronize: () => { throw new Error('clock unavailable'); },
    publishSettlement: () => { throw new Error('reward feedback unavailable'); },
    present: () => { throw new Error('completion presentation unavailable'); },
    publish: () => { throw new Error('renderer unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  };

  const result = createWorkflow(repository, effects).execute();

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'due-session-completed'],
    ['reward feedback unavailable', 'due-session-completed'],
    ['completion presentation unavailable', 'due-session-completed'],
    ['renderer unavailable', 'due-session-completed']
  ]);
});
