'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  START_FOCUS_SESSION_WRITES,
  createStartFocusSessionWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const WALL_NOW = Date.parse('2026-09-09T10:00:00Z');
const SESSION_NOW = WALL_NOW + 250;

function sourceState({ task = {}, state = {} } = {}) {
  const canonical = normalizePersistedState({}, { now: WALL_NOW });
  return normalizePersistedState({
    ...canonical,
    tasks: [{
      id: 'task-1',
      title: '开始当前工作',
      nextAction: '打开方案文档',
      createdAt: WALL_NOW - 10_000,
      ...task
    }],
    settings: {
      ...canonical.settings,
      pomodoroMinutes: 25,
      lastChosenFocusMinutes: 45
    },
    ...state
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

function createWorkflow(repository, overrides = {}) {
  let sequence = 0;
  return createStartFocusSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => WALL_NOW },
    sessionClock: { now: () => SESSION_NOW },
    idFactory: prefix => `${prefix}-${++sequence}`,
    ...overrides
  });
}

test('a focus start commits execution selection and launch progress before effects', () => {
  const events = [];
  const initial = sourceState({
    state: {
      quickStartDecision: {
        sessionId: 'quick-old', taskId: 'task-1', completedAt: WALL_NOW - 1_000,
        elapsedMs: 120_000, status: 'done', resolvedAt: WALL_NOW - 500
      }
    }
  });
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ taskId: 'task-1', minutes: 30 });

  assert.equal(result.ok, true);
  assert.equal(result.session.kind, 'focus');
  assert.equal(result.session.plannedDurationMs, 30 * 60_000);
  assert.equal(result.session.startedAt, SESSION_NOW);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.sessionId, 'session-1');
  assert.equal(persisted.state.nowTaskId, 'task-1');
  assert.equal(persisted.state.quickStartDecision, null);
  assert.equal(persisted.state.stats.dailyLaunches['2026-09-09'], 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(START_FOCUS_SESSION_WRITES, [
    'focusSession', 'quickStartDecision', 'nowTaskId', 'stats', 'tasks'
  ]);
});

test('a two-minute rescue stays task-bound and uses the fixed quick-start duration', () => {
  const repository = createRepository(sourceState());
  const originalTasks = repository.snapshot().tasks;
  const result = createWorkflow(repository).execute({
    taskId: 'task-1', minutes: 120, quick: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.kind, 'quick-start');
  assert.equal(result.session.plannedDurationMs, 2 * 60_000);
  assert.equal(repository.inspect().state.focusSession.taskId, 'task-1');
  assert.deepEqual(repository.snapshot().tasks, originalTasks);
});

test('a taskless normal focus uses the persisted duration fallback without changing Now', () => {
  const initial = sourceState({ state: { nowTaskId: 'task-1' } });
  const repository = createRepository(initial);

  const result = createWorkflow(repository).execute({ taskId: null });

  assert.equal(result.ok, true);
  assert.equal(result.session.taskId, null);
  assert.equal(result.session.plannedDurationMs, 25 * 60_000);
  assert.equal(repository.inspect().state.nowTaskId, 'task-1');
});

test('task rejections project an active session with the injected session clock', () => {
  const initial = sourceState({
    task: { scheduledFor: '2026-09-09T11:00:00.000Z' }
  });
  initial.focusSession = execution.focusSession.startFocus(initial.focusSession, {
    taskId: 'task-1', minutes: 25, now: WALL_NOW - 1_000, sessionId: 'active-1'
  }).session;
  const repository = createRepository(initial);
  const result = createWorkflow(repository, {
    sessionClock: {
      now: (session, wallNow) => {
        assert.equal(session.sessionId, 'active-1');
        assert.equal(wallNow, WALL_NOW);
        return SESSION_NOW;
      }
    }
  }).execute({ taskId: 'task-1', minutes: 25 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task-scheduled');
  assert.equal(result.session.elapsedMs, 1_250);
  assert.equal(Object.hasOwn(result, 'settledAt'), false);
  assert.equal(repository.inspect().commits, 0);
});

test('handoffs, invalid work and live sessions reject without writes, IDs or effects', () => {
  const activeState = sourceState();
  activeState.focusSession = execution.focusSession.startFocus(activeState.focusSession, {
    taskId: 'task-1', minutes: 25, now: WALL_NOW - 500, sessionId: 'active-1'
  }).session;
  const offlineState = sourceState();
  offlineState.focusSession = {
    ...execution.focusSession.createIdleSession(WALL_NOW - 1_000),
    status: 'paused',
    sessionId: 'offline-1',
    taskId: 'task-1',
    plannedDurationMs: 25 * 60_000,
    elapsedBeforeStartMs: 25 * 60_000,
    activeSegments: [{ startedAt: WALL_NOW - 25 * 60_000, endedAt: WALL_NOW }],
    startedAt: null,
    endsAt: null,
    pausedAt: WALL_NOW,
    pausedFrom: 'focus',
    awaitingOfflineConfirmation: true,
    recoveryReason: 'offline-session-due',
    createdAt: WALL_NOW - 25 * 60_000,
    updatedAt: WALL_NOW
  };
  const cases = [
    ['pending quick-start decision', sourceState({ state: {
      quickStartDecision: {
        sessionId: 'quick-1', taskId: 'task-1', completedAt: WALL_NOW - 1_000,
        elapsedMs: 120_000, status: 'pending', resolvedAt: null
      }
    } }), { taskId: 'task-1', minutes: 25 }, 'quick-start-decision-pending'],
    ['pending landing', sourceState({ state: {
      focusLandingPrompt: {
        sessionId: 'focus-old', taskId: 'task-1', completedAt: WALL_NOW - 1_000, status: 'pending'
      }
    } }), { taskId: 'task-1', minutes: 25 }, 'focus-landing-pending'],
    ['offline confirmation', offlineState, { taskId: 'task-1', minutes: 25 }, 'awaiting-confirmation'],
    ['missing rescue task', sourceState(), { taskId: 'missing', quick: true }, 'task-not-found'],
    ['unclarified rescue task', sourceState({ task: { nextAction: null } }), {
      taskId: 'task-1', quick: true
    }, 'next-action-required'],
    ['completed task', sourceState({ task: { done: true, completedAt: WALL_NOW - 1 } }), {
      taskId: 'task-1', minutes: 25
    }, 'task-completed'],
    ['future task', sourceState({ task: { scheduledFor: '2026-09-09T11:00:00.000Z' } }), {
      taskId: 'task-1', minutes: 25
    }, 'task-scheduled'],
    ['active session', activeState, { taskId: 'task-1', minutes: 25 }, 'already-running']
  ];

  for (const [name, initial, input, reason] of cases) {
    const events = [];
    let ids = 0;
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      idFactory: () => { ids += 1; return `session-${ids}`; },
      synchronize: fact => events.push(['synchronize', fact]),
      publish: fact => events.push(['publish', fact])
    }).execute(input);

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    assert.equal(Object.hasOwn(result, 'settledAt'), false, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.equal(ids, 0, name);
    assert.deepEqual(events, [], name);
  }
});

test('a due session is returned for the existing settlement workflow without starting another', () => {
  const initial = sourceState();
  initial.focusSession = execution.focusSession.startFocus(initial.focusSession, {
    taskId: 'task-1', minutes: 5, now: SESSION_NOW - 5 * 60_000, sessionId: 'due-1'
  }).session;
  const events = [];
  let ids = 0;
  const repository = createRepository(initial, events);
  const result = createWorkflow(repository, {
    idFactory: () => { ids += 1; return `session-${ids}`; },
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  }).execute({ taskId: 'task-1', minutes: 25 });

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

test('stale requests and post-commit effect failures keep retry semantics unambiguous', () => {
  const staleRepository = createRepository(sourceState());
  assert.deepEqual(createWorkflow(staleRepository).execute({
    taskId: 'task-1', minutes: 25, expectedRevision: 1
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(staleRepository.inspect().commits, 0);

  const repository = createRepository(sourceState());
  const reported = [];
  const result = createWorkflow(repository, {
    synchronize: () => { throw new Error('clock unavailable'); },
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute({ taskId: 'task-1', minutes: 25 });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'focus-session-started'],
    ['renderer closed', 'focus-session-started']
  ]);
});

test('explicit title-only clarification and two-minute start commit together before effects', () => {
  const initial = sourceState({ task: { nextAction: null, blocker: 'Keep this blocker' } });
  const repository = createRepository(initial), events = [];
  const result = createWorkflow(repository, { publish: fact => {
    events.push(fact); assert.equal(repository.inspect().state.tasks[0].nextAction, 'Open notes');
  } }).execute({ taskId: 'task-1', quick: true, nextAction: ' Open notes ', taskVersion: entityFingerprint(initial.tasks[0]) });
  assert.equal(result.ok, true);
  assert.equal(result.session.kind, 'quick-start'); assert.equal(result.session.plannedDurationMs, 120000);
  assert.equal(result.session.startedAt, SESSION_NOW);
  const after = repository.inspect(); assert.equal(after.commits, 1);
  assert.equal(after.state.tasks[0].nextAction, 'Open notes'); assert.equal(after.state.tasks[0].steps[0].title, 'Open notes');
  assert.equal(after.state.tasks[0].blocker, 'Keep this blocker');
  assert.equal(after.state.tasks[0].updatedAt, WALL_NOW); assert.equal(after.state.nowTaskId, 'task-1');
  assert.equal(events.length, 1); assert.equal(events[0].clarified, true);
});

test('same-millisecond canonical edits reject the original clarification fingerprint without writes', () => {
  const initial = sourceState({ task: { nextAction: null } });
  const taskVersion = entityFingerprint(initial.tasks[0]);
  for (const change of [{ title: 'Changed' }, { description: 'Changed' }, { tags: ['new'] },
    { steps: [{ id: 'step-existing', title: 'Changed', done: false }] }, { nextAction: 'Already chosen' }]) {
    const changed = sourceState({ task: { ...initial.tasks[0], ...change } });
    assert.equal(changed.tasks[0].updatedAt, initial.tasks[0].updatedAt);
    const repository = createRepository(changed);
    const result = createWorkflow(repository).execute({ taskId: 'task-1', quick: true, nextAction: 'Old input', taskVersion });
    assert.equal(result.reason, 'task-changed'); assert.deepEqual(repository.inspect().state, changed);
    assert.equal(repository.inspect().commits, 0);
  }
});

test('clarification cannot overwrite an existing action or enter through normal focus', () => {
  for (const quick of [true, false]) {
    const initial = sourceState(), repository = createRepository(initial);
    const result = createWorkflow(repository).execute({ taskId: 'task-1', quick, nextAction: 'Overwrite', taskVersion: entityFingerprint(initial.tasks[0]) });
    assert.equal(result.ok, false); assert.equal(repository.inspect().commits, 0);
    assert.deepEqual(repository.inspect().state, initial);
  }
});

test('invalid paired clarification never writes and full step capacity cannot half-start', () => {
  for (const extra of [{ nextAction: 'Action' }, { taskVersion: 'a'.repeat(64) }, { nextAction: ' ', taskVersion: 'a'.repeat(64) },
    { nextAction: 'x'.repeat(201), taskVersion: 'a'.repeat(64) }, { nextAction: 'Action', taskVersion: 'bad' }]) {
    const repository = createRepository(sourceState({ task: { nextAction: null } }));
    assert.equal(createWorkflow(repository).execute({ taskId: 'task-1', quick: true, ...extra }).ok, false);
    assert.equal(repository.inspect().commits, 0);
  }
  const initial = sourceState({ task: { nextAction: null, steps: Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}`, title: `Existing ${i}`, done: false })) } });
  const repository = createRepository(initial);
  const result = createWorkflow(repository).execute({ taskId: 'task-1', quick: true, nextAction: 'New action', taskVersion: entityFingerprint(initial.tasks[0]) });
  assert.equal(result.reason, 'step-limit-reached'); assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
});
