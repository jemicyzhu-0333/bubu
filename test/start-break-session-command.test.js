'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createStartBreakSessionWorkflow, START_BREAK_SESSION_WRITES } = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const WALL_NOW = Date.parse('2026-09-09T10:00:00Z');
const SESSION_NOW = WALL_NOW + 250;

function sourceState(overrides = {}) {
  return normalizePersistedState({
    ...normalizePersistedState({}, { now: WALL_NOW }),
    ...overrides
  }, { now: WALL_NOW });
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
  let sequence = 0;
  return createStartBreakSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => WALL_NOW },
    sessionClock: { now: () => SESSION_NOW },
    idFactory: prefix => `${prefix}-${++sequence}`,
    ...overrides
  });
}

test('starting a break commits its execution state before isolated effects', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const command = createCommand(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact])
  });

  const result = command.execute({ taskId: 'task-1', minutes: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.session.kind, 'break');
  assert.equal(result.session.taskId, 'task-1');
  assert.equal(result.session.plannedDurationMs, 7 * 60_000);
  assert.equal(result.session.startedAt, SESSION_NOW);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.sessionId, 'session-1');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'present', 'publish']);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(events[2][1], events[3][1]);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(START_BREAK_SESSION_WRITES, [
    'focusSession', 'xp', 'level', 'rewardLedger', 'pet', 'companion', 'unlockedSkins'
  ]);
});

test('a pending focus landing permits a silent automatic break', () => {
  const events = [];
  const initial = sourceState({
    tasks: [{ id: 'task-1', title: '继续工作', createdAt: WALL_NOW - 1_000 }],
    focusLandingPrompt: {
      sessionId: 'focus-1', taskId: 'task-1', completedAt: WALL_NOW - 500, status: 'pending'
    }
  });
  const repository = createRepository(initial, events);
  const result = createCommand(repository, {
    synchronize: () => events.push(['synchronize']),
    present: () => events.push(['present']),
    publish: () => events.push(['publish'])
  }).execute({ taskId: 'task-1', minutes: 5, present: false });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().state.focusLandingPrompt.status, 'pending');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
});

test('protected and active sessions reject without writes, identities or effects', () => {
  const active = sourceState();
  active.focusSession = execution.focusSession.startFocus(active.focusSession, {
    taskId: 'task-1', minutes: 25, now: WALL_NOW, sessionId: 'focus-1'
  }).session;
  const offline = sourceState();
  offline.focusSession = execution.focusSession.pauseForOfflineConfirmation(
    execution.focusSession.startFocus(offline.focusSession, {
      taskId: 'task-1', minutes: 5, now: WALL_NOW - 5 * 60_000, sessionId: 'offline-1'
    }).session,
    WALL_NOW
  ).session;
  const cases = [
    ['quick-start decision', sourceState({
      quickStartDecision: {
        sessionId: 'quick-1', taskId: 'task-1', completedAt: WALL_NOW - 1_000,
        elapsedMs: 120_000, status: 'pending', resolvedAt: null
      }
    }), 'quick-start-decision-pending'],
    ['offline confirmation', offline, 'awaiting-confirmation'],
    ['active focus', active, 'session-active']
  ];

  for (const [name, initial, reason] of cases) {
    const events = [];
    let ids = 0;
    const repository = createRepository(initial, events);
    const result = createCommand(repository, {
      idFactory: () => { ids += 1; return `session-${ids}`; },
      synchronize: () => events.push(['synchronize']),
      present: () => events.push(['present']),
      publish: () => events.push(['publish'])
    }).execute({ taskId: 'task-1', minutes: 5 });

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    assert.equal(Object.hasOwn(result, 'settledAt'), false, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.equal(ids, 0, name);
    assert.deepEqual(events, [], name);
  }
});

test('a due session is handed to settlement without starting or committing a break', () => {
  const initial = sourceState();
  initial.focusSession = execution.focusSession.startFocus(initial.focusSession, {
    taskId: 'task-1', minutes: 5, now: SESSION_NOW - 5 * 60_000, sessionId: 'due-1'
  }).session;
  const events = [];
  let ids = 0;
  const repository = createRepository(initial, events);
  const result = createCommand(repository, {
    idFactory: () => { ids += 1; return `session-${ids}`; },
    synchronize: () => events.push(['synchronize']),
    present: () => events.push(['present']),
    publish: () => events.push(['publish'])
  }).execute({ taskId: 'task-1', minutes: 5 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'previous-session-completed');
  assert.equal(result.completion.sessionId, 'due-1');
  assert.equal(result.completion.completed, true);
  assert.equal(result.nextSession.status, 'idle');
  assert.equal(result.settledAt, SESSION_NOW);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.equal(ids, 0);
  assert.deepEqual(events, []);
});

test('stale requests and effect failures preserve unambiguous retry behavior', () => {
  const staleRepository = createRepository(sourceState());
  assert.deepEqual(createCommand(staleRepository).execute({
    minutes: 5, expectedRevision: 1
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(staleRepository.inspect().commits, 0);

  const repository = createRepository(sourceState());
  const reported = [];
  const result = createCommand(repository, {
    synchronize: () => { throw new Error('clock unavailable'); },
    present: () => { throw new Error('pet unavailable'); },
    publish: () => { throw new Error('renderer unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute({ minutes: 5 });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'break-session-started'],
    ['pet unavailable', 'break-session-started'],
    ['renderer unavailable', 'break-session-started']
  ]);
});

for (const shouldPresent of [false, true]) test(`only explicit rest choice earns close regardless presentation=${shouldPresent}`, () => {
  for (const userInitiated of [false, true]) {
    const repository = createRepository(sourceState());
    const result = createCommand(repository).execute({ minutes: 5, present: shouldPresent, userInitiated });
    assert.equal(result.ok, true);
    const after = repository.inspect().state;
    assert.equal(after.xp, userInitiated ? 10 : 0);
    assert.equal(after.pet.foodTickets, 6);
    assert.equal(after.companion.relationships.dango.bondPoints, userInitiated ? 1 : 0);
  }
});

test('invalid rest-choice flags cannot start a break or infer consent from presentation', () => {
  const initial = sourceState();
  const repository = createRepository(initial);
  for (const userInitiated of [null, 1, 'true']) {
    assert.equal(createCommand(repository).execute({ minutes: 5, userInitiated }).reason, 'invalid-rest-choice');
  }
  assert.deepEqual(repository.inspect().state, initial);
  assert.equal(repository.inspect().commits, 0);
});
