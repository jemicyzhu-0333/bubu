'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const WALL_NOW = Date.parse('2026-09-09T10:00:00Z');
const SESSION_NOW = WALL_NOW + 250;

function sourceState() {
  return normalizePersistedState({}, { now: WALL_NOW });
}

function runningSession({ minutes = 25, elapsedMs = 10_000 } = {}) {
  return execution.focusSession.startFocus(execution.focusSession.createIdleSession(WALL_NOW), {
    taskId: 'task-1',
    minutes,
    now: SESSION_NOW - elapsedMs,
    sessionId: 'focus-1'
  }).session;
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

function createCommand(repository, overrides = {}) {
  return execution.pauseSession.createPauseSessionCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => WALL_NOW },
    sessionClock: { now: () => SESSION_NOW },
    ...overrides
  });
}

test('pausing commits execution state before isolated feedback effects', () => {
  const events = [];
  const initial = sourceState();
  initial.focusSession = runningSession();
  const repository = createRepository(initial, events);
  const result = createCommand(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    clearNudge: fact => events.push(['clear-nudge', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(result.session.status, 'paused');
  assert.equal(result.session.kind, 'focus');
  assert.equal(result.session.elapsedMs, 10_000);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'paused');
  assert.equal(persisted.state.focusSession.pausedAt, SESSION_NOW);
  assert.deepEqual(events.map(event => event[0]), [
    'commit', 'synchronize', 'clear-nudge', 'present', 'publish'
  ]);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(events[2][1], events[3][1]);
  assert.equal(events[3][1], events[4][1]);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(execution.pauseSession.PAUSE_SESSION_WRITES, ['focusSession']);
});

test('idle and already-paused sessions reject without writes or effects', () => {
  const pausedState = sourceState();
  pausedState.focusSession = execution.focusSession.pauseSession(
    runningSession(),
    SESSION_NOW - 1_000
  ).session;
  const cases = [
    ['idle', sourceState()],
    ['paused', pausedState]
  ];

  for (const [name, initial] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createCommand(repository, {
      synchronize: () => events.push(['synchronize']),
      clearNudge: () => events.push(['clear-nudge']),
      present: () => events.push(['present']),
      publish: () => events.push(['publish'])
    }).execute();

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, 'not-running', name);
    assert.equal(Object.hasOwn(result, 'settledAt'), false, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }
});

test('pausing at the deadline hands completion to the settlement workflow', () => {
  const initial = sourceState();
  initial.focusSession = runningSession({ minutes: 5, elapsedMs: 5 * 60_000 });
  const events = [];
  const repository = createRepository(initial, events);
  const result = createCommand(repository, {
    synchronize: () => events.push(['synchronize']),
    clearNudge: () => events.push(['clear-nudge']),
    present: () => events.push(['present']),
    publish: () => events.push(['publish'])
  }).execute();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-completed');
  assert.equal(result.completion.sessionId, 'focus-1');
  assert.equal(result.completion.completed, true);
  assert.equal(result.nextSession.status, 'idle');
  assert.equal(result.settledAt, SESSION_NOW);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('stale requests and effect failures keep pause retry semantics unambiguous', () => {
  const staleState = sourceState();
  staleState.focusSession = runningSession();
  const staleRepository = createRepository(staleState);
  assert.deepEqual(createCommand(staleRepository).execute({ expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(staleRepository.inspect().commits, 0);

  const state = sourceState();
  state.focusSession = runningSession();
  const repository = createRepository(state);
  const reported = [];
  const result = createCommand(repository, {
    synchronize: () => { throw new Error('clock unavailable'); },
    clearNudge: () => { throw new Error('nudge unavailable'); },
    present: () => { throw new Error('pet unavailable'); },
    publish: () => { throw new Error('renderer unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'session-paused'],
    ['nudge unavailable', 'session-paused'],
    ['pet unavailable', 'session-paused'],
    ['renderer unavailable', 'session-paused']
  ]);
});
