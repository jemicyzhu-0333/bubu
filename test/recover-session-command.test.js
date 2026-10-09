'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = 1_000;

function stateWithRunningSession() {
  const state = normalizePersistedState({}, { now: STARTED_AT });
  state.focusSession = execution.focusSession.startFocus(state.focusSession, {
    taskId: 'task-1',
    durationMs: 60_000,
    now: STARTED_AT,
    sessionId: 'persisted-focus'
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
      events.push(['commit']);
      state = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createCommand(repository, recoveredAt, overrides = {}) {
  return execution.recoverSession.createRecoverSessionCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => recoveredAt },
    ...overrides
  });
}

test('a still-live persisted session resumes without rewriting canonical state', () => {
  const initial = stateWithRunningSession();
  const repository = createRepository(initial);
  const facts = [];
  let clockReads = 0;
  const command = execution.recoverSession.createRecoverSessionCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => { clockReads += 1; return 31_000; } },
    synchronize: fact => facts.push(fact),
    notifyDue: () => { throw new Error('live recovery must not notify'); }
  });

  const result = command.execute();

  assert.equal(result.ok, true);
  assert.equal(result.action, 'resume');
  assert.equal(result.session.running, true);
  assert.equal(result.session.elapsedMs, 30_000);
  assert.equal(clockReads, 1);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].committed, false);
  assert.equal(Object.isFrozen(facts[0]), true);
  assert.deepEqual(execution.recoverSession.RECOVER_SESSION_WRITES, ['focusSession']);
});

test('a session due while absent is held before its notification is published', () => {
  const events = [];
  const repository = createRepository(stateWithRunningSession(), events);
  const result = createCommand(repository, 61_000, {
    synchronize: fact => events.push(['synchronize', fact.action]),
    notifyDue: fact => events.push(['notify-due', fact.action])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(result.action, 'awaiting-confirmation');
  assert.equal(result.completion.completed, true);
  assert.equal(result.session.status, 'paused');
  assert.equal(result.session.awaitingOfflineConfirmation, true);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.elapsedBeforeStartMs, 60_000);
  assert.equal(persisted.state.focusSession.recoveryReason, 'offline-session-due');
  assert.deepEqual(events, [
    ['commit'],
    ['synchronize', 'awaiting-confirmation'],
    ['notify-due', 'awaiting-confirmation']
  ]);
});

test('idle and already-paused recovery are validated no-ops without a due notice', () => {
  const active = stateWithRunningSession();
  const paused = structuredClone(active);
  paused.focusSession = execution.focusSession.pauseSession(active.focusSession, 31_000).session;
  const cases = [
    ['idle', normalizePersistedState({}, { now: 31_000 }), 'idle'],
    ['paused', paused, 'paused']
  ];

  for (const [name, initial, action] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createCommand(repository, 41_000, {
      synchronize: fact => events.push(['synchronize', fact.action]),
      notifyDue: () => events.push(['notify-due'])
    }).execute();

    assert.equal(result.ok, true, name);
    assert.equal(result.action, action, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [['synchronize', action]], name);
  }
});

test('stale recovery and post-commit effect failures keep retry semantics unambiguous', () => {
  const staleRepository = createRepository(stateWithRunningSession());
  const staleEffects = [];
  const stale = createCommand(staleRepository, 61_000, {
    synchronize: () => staleEffects.push('synchronize'),
    notifyDue: () => staleEffects.push('notify')
  }).execute({ expectedRevision: 1 });

  assert.deepEqual(stale, { ok: false, reason: 'state-revision-conflict' });
  assert.equal(staleRepository.inspect().commits, 0);
  assert.deepEqual(staleEffects, []);

  const repository = createRepository(stateWithRunningSession());
  const reported = [];
  const result = createCommand(repository, 61_000, {
    synchronize: () => { throw new Error('clock unavailable'); },
    notifyDue: () => { throw new Error('notification unavailable'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'session-recovered'],
    ['notification unavailable', 'session-recovered']
  ]);
});
