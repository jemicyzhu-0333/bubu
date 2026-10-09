'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESUME_FOCUS_SESSION_WRITES,
  createResumeFocusSessionWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const WALL_NOW = Date.parse('2026-09-09T10:00:00Z');
const SESSION_NOW = WALL_NOW + 250;

function sourceState() {
  return normalizePersistedState({ tasks: [{ id: 'task-1', title: 'Synthetic task', createdAt: 1, steps: [] }] }, { now: WALL_NOW });
}

function pausedSession(kind = 'focus', options = {}) {
  const started = kind === 'break'
    ? execution.focusSession.startBreak(execution.focusSession.createIdleSession(WALL_NOW), {
        minutes: options.minutes || 5,
        now: options.startedAt === undefined ? SESSION_NOW - 10_000 : options.startedAt,
        sessionId: 'session-1',
        taskId: 'task-1'
      })
    : execution.focusSession.startFocus(execution.focusSession.createIdleSession(WALL_NOW), {
        minutes: options.minutes || 25,
        now: options.startedAt === undefined ? SESSION_NOW - 10_000 : options.startedAt,
        sessionId: 'session-1',
        taskId: 'task-1'
      });
  return execution.focusSession.pauseSession(
    started.session,
    options.pausedAt === undefined ? SESSION_NOW - 5_000 : options.pausedAt
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
  return createResumeFocusSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => WALL_NOW },
    sessionClock: { now: () => SESSION_NOW },
    ...overrides
  });
}

test('resuming focus commits execution and return progress before effects', () => {
  const events = [];
  const initial = sourceState();
  initial.focusSession = pausedSession('focus');
  const repository = createRepository(initial, events);
  const result = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact])
  }).execute({ sessionId: 'session-1', intent: 'resume' });

  assert.equal(result.ok, true);
  assert.equal(result.session.running, true);
  assert.equal(result.session.kind, 'focus');
  assert.equal(result.session.startedAt, SESSION_NOW);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.stats.dailyReturns['2026-09-09'], 1);
  assert.equal(persisted.state.rewardLedger.events.at(-1).source, 'execution-return');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'present', 'publish']);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(events[2][1], events[3][1]);
  assert.equal(events[1][1].returnRecorded, true);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(RESUME_FOCUS_SESSION_WRITES, ['focusSession', 'stats', 'rewardLedger']);
});

test('resuming a break does not manufacture a focus return', () => {
  const initial = sourceState();
  initial.focusSession = pausedSession('break');
  const beforeStats = structuredClone(initial.stats);
  const beforeLedger = structuredClone(initial.rewardLedger);
  const repository = createRepository(initial);

  const result = createWorkflow(repository).execute({ sessionId: 'session-1', intent: 'resume' });

  assert.equal(result.ok, true);
  assert.equal(result.session.kind, 'break');
  assert.deepEqual(repository.inspect().state.stats, beforeStats);
  assert.deepEqual(repository.inspect().state.rewardLedger, beforeLedger);
});

test('idle and stale resume requests write nothing and publish nothing', () => {
  const cases = [
    ['idle', sourceState(), {}, 'not-paused'],
    ['stale', (() => {
      const state = sourceState();
      state.focusSession = pausedSession('focus');
      return state;
    })(), { expectedRevision: 1 }, 'state-revision-conflict']
  ];

  for (const [name, initial, input, reason] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      synchronize: () => events.push(['synchronize']),
      present: () => events.push(['present']),
      publish: () => events.push(['publish'])
    }).execute(input);

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    assert.equal(Object.hasOwn(result, 'settledAt'), false, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }
});

test('a full paused session is handed to settlement without a partial commit', () => {
  const initial = sourceState();
  const started = execution.focusSession.startFocus(
    execution.focusSession.createIdleSession(WALL_NOW),
    {
      minutes: 5,
      now: SESSION_NOW - 5 * 60_000,
      sessionId: 'session-1',
      taskId: 'task-1'
    }
  ).session;
  initial.focusSession = execution.focusSession.pauseForOfflineConfirmation(
    started,
    SESSION_NOW
  ).session;
  const events = [];
  const repository = createRepository(initial, events);
  const result = createWorkflow(repository, {
    synchronize: () => events.push(['synchronize']),
    present: () => events.push(['present']),
    publish: () => events.push(['publish'])
  }).execute({ sessionId: 'session-1', intent: 'confirm-completion' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-completed');
  assert.equal(result.completion.sessionId, 'session-1');
  assert.equal(result.completion.completed, true);
  assert.equal(result.nextSession.status, 'idle');
  assert.equal(result.settledAt, SESSION_NOW);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('effect failures cannot make a resumed session safely retryable', () => {
  const initial = sourceState();
  initial.focusSession = pausedSession('focus');
  const repository = createRepository(initial);
  const reported = [];
  const result = createWorkflow(repository, {
    synchronize: () => { throw new Error('clock unavailable'); },
    present: () => { throw new Error('pet unavailable'); },
    publish: () => { throw new Error('renderer unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute({ sessionId: 'session-1', intent: 'resume' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'session-resumed'],
    ['pet unavailable', 'session-resumed'],
    ['renderer unavailable', 'session-resumed']
  ]);
});
