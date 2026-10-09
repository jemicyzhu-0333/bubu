'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCEPT_HEALTHY_SHUTDOWN_WRITES,
  createAcceptHealthyShutdownWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const progress = require('../src/capabilities/progress');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = Date.parse('2026-09-09T09:55:00Z');
const ACCEPTED_AT = Date.parse('2026-09-09T10:00:00Z');
const DAY_KEY = '2026-09-09';
const MINUTE = 60_000;

function baseState(overrides = {}) {
  const state = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '完成这一轮', done: false, createdAt: STARTED_AT - 1 }],
    ...overrides
  }, { now: STARTED_AT });
  state.nowTaskId = 'task-1';
  return state;
}

function startSession(state, kind, durationMs, taskId = 'task-1') {
  state.focusSession = execution.focusSession.startSession(state.focusSession, {
    kind,
    durationMs,
    taskId,
    now: STARTED_AT,
    sessionId: `${kind}-1`
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
  return createAcceptHealthyShutdownWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => ACCEPTED_AT },
    sessionClock: { now: () => ACCEPTED_AT },
    ...overrides
  });
}

test('a due focus settles every capability and unlocks shutdown skins in one commit', () => {
  const initial = startSession(baseState({
    xp: 209,
    level: 7,
    stats: {
      healthyShutdownCount: 6,
      healthyShutdownStreak: 6,
      lastHealthyShutdownDate: '2026-09-08'
    }
  }), 'focus', 5 * MINUTE);
  const initialFish = initial.pet.foodInventory.fish;
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publishSettlement: fact => events.push(['settlement', fact]),
    clearNudge: fact => events.push(['clear-nudge', fact]),
    clearTray: fact => events.push(['clear-tray', fact]),
    present: fact => events.push(['present', fact]),
    publish: fact => events.push(['publish', fact]),
    revealHandoff: fact => events.push(['reveal', fact])
  });

  const result = workflow.execute({ dayKey: DAY_KEY });
  const persisted = repository.inspect();

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.action, 'settled-completion');
  assert.equal(result.completion.completed, true);
  assert.equal(result.session.status, 'idle');
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'idle');
  assert.equal(persisted.state.tasks[0].focusedMs, 5 * MINUTE);
  assert.equal(persisted.state.tasks[0].focusSessions, 1);
  assert.equal(persisted.state.xp, 9);
  assert.equal(persisted.state.level, 8);
  assert.equal(persisted.state.stats.totalPomodoros, 1);
  assert.equal(persisted.state.stats.healthyShutdownCount, 7);
  assert.equal(persisted.state.stats.healthyShutdownStreak, 7);
  assert.equal(persisted.state.stats.lastHealthyShutdownDate, DAY_KEY);
  assert.equal(persisted.state.pet.foodInventory.fish, initialFish);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 1);
  assert.ok(persisted.state.unlockedSkins.includes('forest'));
  assert.ok(persisted.state.unlockedSkins.includes('bat'));
  assert.equal(persisted.state.focusLandingPrompt.sessionId, 'focus-1');
  assert.deepEqual(events.map(event => event[0]), [
    'commit', 'synchronize', 'settlement', 'clear-nudge', 'clear-tray',
    'present', 'publish', 'reveal'
  ]);
  assert.equal(events.slice(1).every(event => event[1] === events[1][1]), true);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(ACCEPT_HEALTHY_SHUTDOWN_WRITES, [
    'focusSession', 'quickStartDecision', 'focusLandingPrompt', 'tasks',
    'xp', 'level', 'lastCompletedDate', 'stats', 'rewardLedger',
    'companion', 'unlockedSkins', 'pet'
  ]);
});

test('an early focus pauses and keeps its own task as the shutdown landing target', () => {
  const initial = baseState({
    tasks: [
      { id: 'task-a', title: '原会话任务', done: false, createdAt: 1 },
      { id: 'task-b', title: '后来选择的任务', done: false, createdAt: 2 }
    ]
  });
  initial.nowTaskId = 'task-b';
  startSession(initial, 'focus', 10 * MINUTE, 'task-a');
  const repository = createRepository(initial);
  let randomCalls = 0;

  const result = createWorkflow(repository, {
    random: () => { randomCalls += 1; return 0; }
  }).execute({ dayKey: DAY_KEY });
  const state = repository.inspect().state;

  assert.equal(result.action, 'paused-focus');
  assert.equal(result.session.status, 'paused');
  assert.equal(state.focusSession.taskId, 'task-a');
  assert.deepEqual(state.focusLandingPrompt, {
    sessionId: 'focus-1',
    taskId: 'task-a',
    completedAt: ACCEPTED_AT,
    status: 'pending'
  });
  assert.equal(state.tasks[0].focusedMs, 0);
  assert.equal(randomCalls, 0);
  assert.equal(repository.inspect().commits, 1);
});

test('an older pending landing wins over a new healthy-shutdown handoff', () => {
  const prompt = {
    sessionId: 'focus-previous',
    taskId: 'task-1',
    completedAt: STARTED_AT - MINUTE,
    status: 'pending'
  };
  const initial = startSession(baseState({ focusLandingPrompt: prompt }), 'focus', 5 * MINUTE);
  const repository = createRepository(initial);

  const result = createWorkflow(repository).execute({ dayKey: DAY_KEY });

  assert.equal(result.action, 'settled-completion');
  assert.deepEqual(repository.inspect().state.focusLandingPrompt, prompt);
  assert.equal(repository.inspect().state.stats.healthyShutdownCount, 1);
  assert.equal(repository.inspect().commits, 1);
});

test('a due quick start enters its required three-way decision', () => {
  const initial = startSession(baseState(), 'quick-start', 2 * MINUTE);
  const repository = createRepository(initial);

  const result = createWorkflow(repository, {
    clock: { now: () => STARTED_AT + 2 * MINUTE },
    sessionClock: { now: () => STARTED_AT + 2 * MINUTE }
  }).execute({ dayKey: DAY_KEY });
  const state = repository.inspect().state;

  assert.equal(result.action, 'settled-completion');
  assert.equal(state.focusSession.status, 'idle');
  assert.equal(state.focusLandingPrompt, null);
  assert.deepEqual(state.quickStartDecision, {
    sessionId: 'quick-start-1',
    taskId: 'task-1',
    completedAt: STARTED_AT + 2 * MINUTE,
    elapsedMs: 2 * MINUTE,
    status: 'pending',
    resolvedAt: null
  });
  assert.equal(state.xp, 10);
  assert.equal(state.companion.relationships.dango.bondPoints, 1);
  assert.equal(repository.inspect().commits, 1);
});

test('active and paused breaks both end without creating a handoff', () => {
  const active = startSession(baseState(), 'break', 5 * MINUTE, null);
  const paused = structuredClone(active);
  paused.focusSession = execution.focusSession.pauseSession(
    paused.focusSession,
    STARTED_AT + MINUTE
  ).session;

  for (const [name, initial] of [['active', active], ['paused', paused]]) {
    const repository = createRepository(initial);
    const result = createWorkflow(repository).execute({ dayKey: DAY_KEY });
    const state = repository.inspect().state;

    assert.equal(result.action, 'stopped-break', name);
    assert.equal(state.focusSession.status, 'idle', name);
    assert.equal(state.focusLandingPrompt, null, name);
    assert.equal(state.quickStartDecision, null, name);
    assert.equal(repository.inspect().commits, 1, name);
  }
});

test('shutdown streak markers remain monotonic across a clock rollback', () => {
  const state = baseState({
    stats: {
      healthyShutdownCount: 12,
      healthyShutdownStreak: 7,
      lastHealthyShutdownDate: '2026-09-09'
    }
  });

  assert.deepEqual(progress.healthyShutdown.recordHealthyShutdown(state, '2026-09-08'), {
    ok: true,
    recorded: false,
    dayKey: '2026-09-08',
    count: 12,
    streak: 7
  });
  assert.equal(progress.healthyShutdown.recordHealthyShutdown(state, '2026-09-09').recorded, false);
  assert.equal(progress.healthyShutdown.recordHealthyShutdown(state, '2026-09-10').recorded, true);
  assert.equal(state.stats.healthyShutdownCount, 13);
  assert.equal(state.stats.healthyShutdownStreak, 8);
  assert.equal(state.stats.lastHealthyShutdownDate, '2026-09-10');
});

test('invalid, stale and repeated requests write nothing or publish effects', () => {
  const initial = baseState();
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    sessionClock: { now: () => { throw new Error('must not sample'); } },
    synchronize: () => events.push(['synchronize']),
    publish: () => events.push(['publish'])
  });

  assert.deepEqual(workflow.execute({ dayKey: 'not-a-day' }), {
    ok: false,
    reason: 'invalid-day-key'
  });
  assert.equal(workflow.execute({ dayKey: DAY_KEY, expectedRevision: 1 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);

  const valid = createWorkflow(repository).execute({ dayKey: DAY_KEY });
  assert.equal(valid.committed, true);
  const repeated = createWorkflow(repository, {
    synchronize: () => events.push(['synchronize']),
    publish: () => events.push(['publish'])
  }).execute({ dayKey: DAY_KEY });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.committed, false);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit']);
});

test('post-commit effect failures cannot make healthy shutdown retryable', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const fail = label => () => { throw new Error(`${label} unavailable`); };
  const result = createWorkflow(repository, {
    synchronize: fail('clock'),
    publishSettlement: fail('reward feedback'),
    clearNudge: fail('nudge'),
    clearTray: fail('tray'),
    present: fail('pet'),
    publish: fail('renderer'),
    revealHandoff: fail('popover'),
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute({ dayKey: DAY_KEY });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'healthy-shutdown-accepted'],
    ['reward feedback unavailable', 'healthy-shutdown-accepted'],
    ['nudge unavailable', 'healthy-shutdown-accepted'],
    ['tray unavailable', 'healthy-shutdown-accepted'],
    ['pet unavailable', 'healthy-shutdown-accepted'],
    ['renderer unavailable', 'healthy-shutdown-accepted'],
    ['popover unavailable', 'healthy-shutdown-accepted']
  ]);
});
