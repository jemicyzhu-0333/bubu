'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOLVE_QUICK_START_WRITES,
  createResolveQuickStartWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const RESOLVED_AT = Date.parse('2026-09-09T10:00:00Z');
const SESSION_STARTED_AT = RESOLVED_AT + 250;
const RENEWED_EXPIRY = '2026-09-09T23:59:59.999Z';

function sourceState({ task = {}, decision = {}, state = {} } = {}) {
  const canonical = normalizePersistedState({}, { now: RESOLVED_AT });
  return normalizePersistedState({
    ...canonical,
    tasks: [{
      id: 'task-1',
      title: '从第一步继续',
      nextAction: '打开方案文档',
      createdAt: RESOLVED_AT - 10_000,
      ...task
    }],
    quickStartDecision: {
      sessionId: 'quick-1',
      taskId: 'task-1',
      completedAt: RESOLVED_AT - 1_000,
      elapsedMs: 120_000,
      status: 'pending',
      resolvedAt: null,
      ...decision
    },
    settings: {
      ...canonical.settings,
      pomodoroMinutes: 25,
      lastChosenFocusMinutes: 45
    },
    ...state
  }, { now: RESOLVED_AT });
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
  return createResolveQuickStartWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => RESOLVED_AT },
    sessionClock: { now: () => SESSION_STARTED_AT },
    idFactory: prefix => `${prefix}-${++sequence}`,
    renewExpiry: () => RENEWED_EXPIRY,
    ...overrides
  });
}

test('stopping after two minutes saves the landing and return in one commit', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const workflow = createWorkflow(repository, {
    synchronize: () => { throw new Error('done must not synchronize a new session'); },
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ sessionId: 'quick-1', progressMade: false, action: 'stop', landingNote: '写下方案第一段' });

  assert.deepEqual(result, { ok: true, action: 'done' });
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.quickStartDecision.status, 'done');
  assert.equal(persisted.state.quickStartDecision.resolvedAt, RESOLVED_AT);
  assert.equal(persisted.state.focusSession.status, 'idle');
  assert.equal(persisted.state.tasks[0].nextAction, '写下方案第一段');
  assert.equal(persisted.state.tasks[0].lastCheckpoint, '写下方案第一段');
  assert.equal(persisted.state.tasks[0].steps.length, 1);
  assert.equal(persisted.state.stats.dailyReturns['2026-09-09'], 1);
  assert.equal(persisted.state.stats.dailyLaunches['2026-09-09'], undefined);
  assert.equal(persisted.state.rewardLedger.seenEventIds.length, 3);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(events[1][1].landingSaved, true);
  assert.equal(events[1][1].session, null);
});

test('extending an expired task renews work and starts focus atomically before effects', () => {
  const events = [];
  const initial = sourceState({
    task: {
      expired: true,
      expiresAt: '2026-09-08T23:59:59.999Z'
    }
  });
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    renewExpiry: (now, settings) => {
      assert.equal(now, RESOLVED_AT);
      assert.equal(settings.adhocTtlMode, 'midnight');
      return RENEWED_EXPIRY;
    },
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ sessionId: 'quick-1', progressMade: false, action: 'extend-8', landingNote: '继续写第一段' });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'extend-8');
  assert.equal(result.session.running, true);
  assert.equal(result.session.kind, 'focus');
  assert.equal(result.session.plannedDurationMs, 8 * 60_000);
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.quickStartDecision.status, 'extend-8');
  assert.equal(persisted.state.focusSession.sessionId, 'session-1');
  assert.equal(persisted.state.focusSession.taskId, 'task-1');
  assert.equal(persisted.state.nowTaskId, 'task-1');
  assert.equal(persisted.state.tasks[0].expired, false);
  assert.equal(persisted.state.tasks[0].expiresAt, RENEWED_EXPIRY);
  assert.equal(persisted.state.tasks[0].nextAction, '继续写第一段');
  assert.equal(persisted.state.stats.dailyReturns['2026-09-09'], 1);
  assert.equal(persisted.state.stats.dailyLaunches['2026-09-09'], 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
  assert.equal(events[1][1], events[2][1]);
  assert.equal(events[1][1].renewed, true);
  assert.deepEqual(RESOLVE_QUICK_START_WRITES, [
    'focusSession', 'quickStartDecision', 'nowTaskId', 'tasks', 'stats', 'rewardLedger', 'xp', 'level', 'pet', 'companion', 'unlockedSkins'
  ]);
});

test('full-session continuation uses the current Today duration and supports legacy taskless decisions', () => {
  const repository = createRepository(sourceState());
  const full = createWorkflow(repository).execute({ sessionId: 'quick-1', progressMade: false, action: 'full-round', landingNote: null });

  assert.equal(full.ok, true);
  assert.equal(full.action, 'full-session');
  assert.equal(full.session.plannedDurationMs, 45 * 60_000);

  const tasklessRepository = createRepository(sourceState({
    decision: { taskId: null },
    state: { tasks: [], nowTaskId: null }
  }));
  const taskless = createWorkflow(tasklessRepository).execute({ sessionId: 'quick-1', progressMade: false, action: 'full-session' });
  assert.equal(taskless.ok, true);
  assert.equal(taskless.session.taskId, null);
  assert.equal(tasklessRepository.inspect().state.nowTaskId, null);
});

test('invalid, stale and unwritable resolutions preserve the pending decision with zero writes', () => {
  const fullTask = {
    steps: Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      title: `已经完成 ${index}`,
      done: true,
      completedAt: RESOLVED_AT - index - 1
    }))
  };
  const active = sourceState();
  active.focusSession = execution.focusSession.startFocus(active.focusSession, {
    taskId: 'task-1',
    minutes: 25,
    now: RESOLVED_AT - 500,
    sessionId: 'other-focus'
  }).session;
  const cases = [
    ['missing decision', sourceState({ state: { quickStartDecision: null } }), 'done', 'no-pending-quick-start'],
    ['invalid action', sourceState(), 'later', 'invalid-action'],
    ['focus landing pending', sourceState({ state: {
      focusLandingPrompt: {
        sessionId: 'focus-old', taskId: 'task-1', completedAt: RESOLVED_AT - 2_000, status: 'pending'
      }
    } }), 'extend-8', 'focus-landing-pending'],
    ['active session', active, 'extend-8', 'session-active'],
    ['completed task', sourceState({ task: {
      done: true, completedAt: RESOLVED_AT - 500
    } }), 'extend-8', 'task-completed'],
    ['scheduled task', sourceState({ task: {
      scheduledFor: '2026-09-09T11:00:00.000Z'
    } }), 'extend-8', 'task-scheduled'],
    ['landing step limit', sourceState({ task: fullTask }), {
      action: 'done', landingNote: '无法加入的第 101 步'
    }, 'step-limit-reached']
  ];

  for (const [name, initial, input, reason] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      synchronize: fact => events.push(['synchronize', fact]),
      publish: fact => events.push(['publish', fact])
    }).execute({ sessionId: 'quick-1', progressMade: false, ...(typeof input === 'string' ? { action: input } : input) });

    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }

  const stale = createRepository(sourceState());
  assert.deepEqual(createWorkflow(stale).execute({ sessionId: 'quick-1', progressMade: false,
    action: 'done', expectedRevision: 1
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(stale.inspect().commits, 0);
});

test('failed continuation discards a provisional expiry renewal and landing note', () => {
  const initial = sourceState({
    task: {
      expired: true,
      expiresAt: '2026-09-08T23:59:59.999Z'
    }
  });
  initial.focusSession = execution.focusSession.startFocus(initial.focusSession, {
    taskId: 'other-task',
    minutes: 25,
    now: RESOLVED_AT - 500,
    sessionId: 'other-focus'
  }).session;
  const repository = createRepository(initial);

  const result = createWorkflow(repository).execute({ sessionId: 'quick-1', progressMade: false,
    action: 'extend-8', landingNote: '不能提前保存'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-active');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
});

test('post-commit effect failures cannot make a durable resolution retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    synchronize: () => { throw new Error('runtime clock unavailable'); },
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = workflow.execute({ sessionId: 'quick-1', progressMade: false, action: 'extend' });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'extend-8');
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['runtime clock unavailable', 'quick-start-resolved'],
    ['renderer closed', 'quick-start-resolved']
  ]);
  assert.deepEqual(workflow.execute({ sessionId: 'quick-1', progressMade: false, action: 'extend-8' }), {
    ok: false,
    reason: 'no-pending-quick-start'
  });
});

test('explicit progress applies to the displayed completed session before continuation replaces it', () => {
  const repository = createRepository(sourceState());
  const facts = [];
  const result = createWorkflow(repository, { publish: fact => facts.push(fact) }).execute({
    sessionId: 'quick-1', progressMade: true, action: 'extend-8'
  });
  assert.equal(result.ok, true);
  const after = repository.inspect().state;
  assert.equal(after.focusSession.sessionId, 'session-1');
  assert.equal(after.level, 2);
  assert.equal(after.xp, 0);
  assert.equal(after.pet.foodTickets, 9);
  assert.equal(after.companion.relationships.dango.bondPoints, 2);
  const fact = after.rewardLedger.events.find(event => event.source === 'quick-start-confirmed');
  assert.equal(fact.metadata.sessionId, 'quick-1');
  assert.equal(fact.metadata.taskId, 'task-1');
  assert.equal(facts[0].sessionId, 'quick-1');
  assert.equal(facts[0].reward.closeGranted, false);
});

for (const task of [null, { done: true, completedAt: RESOLVED_AT - 1 }, { skippedAt: RESOLVED_AT - 1 }]) {
  test(`quick done can confirm original ${task === null ? 'missing' : task.done ? 'completed' : 'skipped'} task without saving a note`, () => {
    const initial = task === null ? sourceState({ state: { tasks: [] } }) : sourceState({ task });
    const repository = createRepository(initial);
    const result = createWorkflow(repository).execute({ sessionId: 'quick-1', progressMade: true, action: 'done' });
    assert.equal(result.ok, true);
    const after = repository.inspect().state;
    assert.equal(after.quickStartDecision.taskId, 'task-1');
    assert.equal(after.xp, 10);
    assert.equal(after.level, 2);
    assert.equal(after.pet.foodTickets, 9);
  });
}

test('quick progress requires explicit boolean and exact displayed identity even with same task', () => {
  const repository = createRepository(sourceState());
  const workflow = createWorkflow(repository);
  const initial = repository.inspect().state;
  for (const progressMade of [undefined, null, 'true', 1]) {
    assert.equal(workflow.execute({ sessionId: 'quick-1', action: 'done', progressMade }).reason, 'invalid-progress-choice');
  }
  assert.equal(workflow.execute({ sessionId: 'old-quick', action: 'done', progressMade: true }).reason, 'quick-start-decision-changed');
  assert.equal(workflow.execute({ action: 'done', progressMade: true }).reason, 'quick-start-decision-changed');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
});
