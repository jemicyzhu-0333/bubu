'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STOP_FOCUS_SESSION_WRITES,
  createStopFocusSessionWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = Date.parse('2026-09-09T09:55:00Z');
const STOPPED_AT = Date.parse('2026-09-09T10:00:00Z');
const MINUTE = 60_000;

function sourceState({ durationMs = 25 * MINUTE, startedAt = STARTED_AT } = {}) {
  const state = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '完成这一轮', done: false, createdAt: startedAt - 1 }]
  }, { now: startedAt });
  state.nowTaskId = 'task-1';
  state.focusSession = execution.focusSession.startFocus(state.focusSession, {
    taskId: 'task-1',
    durationMs,
    now: startedAt,
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
  return createStopFocusSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => STOPPED_AT },
    sessionClock: { now: () => STOPPED_AT },
    random: () => 0.99,
    ...overrides
  });
}

test('an early stop commits session investment once before isolated effects', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const result = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publishSettlement: fact => events.push(['settlement', fact]),
    clearNudge: fact => events.push(['clear-nudge', fact]),
    clearTray: fact => events.push(['clear-tray', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(result.completion.completed, false);
  assert.equal(result.completion.reason, 'stopped');
  assert.equal(result.session.status, 'idle');
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].focusedMs, 5 * MINUTE);
  assert.equal(persisted.state.tasks[0].focusSessions, 1);
  assert.equal(persisted.state.xp, 0);
  assert.equal(persisted.state.focusSession.status, 'idle');
  assert.deepEqual(events.map(event => event[0]), [
    'commit', 'synchronize', 'settlement', 'clear-nudge', 'clear-tray', 'present', 'publish'
  ]);
  assert.equal(events.slice(1).every(event => event[1] === events[1][1]), true);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(STOP_FOCUS_SESSION_WRITES, [
    'focusSession', 'quickStartDecision', 'focusLandingPrompt', 'tasks',
    'xp', 'level', 'lastCompletedDate', 'stats', 'rewardLedger',
    'companion', 'unlockedSkins'
  ]);
});

test('stopping at the deadline records normal completion and its handoff atomically', () => {
  const initial = sourceState({ durationMs: 5 * MINUTE });
  const repository = createRepository(initial);

  const result = createWorkflow(repository).execute();

  assert.equal(result.ok, true);
  assert.equal(result.completion.completed, true);
  assert.equal(result.completion.reason, 'completed');
  const state = repository.inspect().state;
  assert.equal(state.xp, 0);
  assert.equal(state.stats.totalPomodoros, 1);
  assert.equal(state.focusLandingPrompt.sessionId, 'focus-1');
  assert.equal(state.focusSession.status, 'idle');
});

test('an internal stop reason never turns an interruption into a completion', () => {
  const repository = createRepository(sourceState());

  const result = createWorkflow(repository).execute({ reason: 'accepted-rest' });

  assert.equal(result.ok, true);
  assert.equal(result.completion.completed, false);
  assert.equal(result.completion.reason, 'accepted-rest');
  assert.equal(repository.inspect().state.xp, 0);
  assert.equal(repository.inspect().state.focusLandingPrompt, null);
});

test('idle and stale stops perform no write and no effect', () => {
  const idle = normalizePersistedState({}, { now: STOPPED_AT });
  const cases = [
    ['idle', idle, {}, 'not-running'],
    ['stale', sourceState(), { expectedRevision: 1 }, 'state-revision-conflict']
  ];

  for (const [name, initial, input, reason] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      synchronize: () => events.push(['synchronize']),
      publishSettlement: () => events.push(['settlement']),
      clearNudge: () => events.push(['clear-nudge']),
      clearTray: () => events.push(['clear-tray']),
      present: () => events.push(['present']),
      publish: () => events.push(['publish'])
    }).execute(input);

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }
});

test('post-commit failures cannot make a stopped session retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const effects = {
    synchronize: () => { throw new Error('clock unavailable'); },
    publishSettlement: () => { throw new Error('reward feedback unavailable'); },
    clearNudge: () => { throw new Error('nudge unavailable'); },
    clearTray: () => { throw new Error('tray unavailable'); },
    present: () => { throw new Error('pet unavailable'); },
    publish: () => { throw new Error('renderer unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  };

  const result = createWorkflow(repository, effects).execute();

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'session-stopped'],
    ['reward feedback unavailable', 'session-stopped'],
    ['nudge unavailable', 'session-stopped'],
    ['tray unavailable', 'session-stopped'],
    ['pet unavailable', 'session-stopped'],
    ['renderer unavailable', 'session-stopped']
  ]);
});
