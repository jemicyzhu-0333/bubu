'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SETTLE_FOCUS_SESSION_WRITES,
  createSettleFocusSessionWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { localDayKey } = require('../src/core/calendar');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const STARTED_AT = Date.parse('2026-09-08T09:00:00Z');
const MINUTE = 60_000;

function baseState(overrides = {}) {
  const state = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '完成这一轮', done: false, createdAt: 1 }],
    ...overrides
  }, { now: STARTED_AT });
  state.nowTaskId = 'task-1';
  return state;
}

function start(kind, durationMs, taskId = 'task-1') {
  return execution.focusSession.startSession(
    execution.focusSession.createIdleSession(STARTED_AT),
    { kind, durationMs, taskId, now: STARTED_AT, sessionId: `${kind}-1` }
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
  return createSettleFocusSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => STARTED_AT + 5 * MINUTE },
    ...overrides
  });
}

function finish(session, at, reason = 'completed') {
  return execution.focusSession.stopSession(session, at).completion;
}

test('full focus settlement commits all four capability slices once before effects', () => {
  const initial = baseState({ xp: 190, level: 2 });
  const running = start('focus', 5 * MINUTE);
  initial.focusSession = running;
  const completion = finish(running, STARTED_AT + 5 * MINUTE);
  const initialFish = initial.pet.foodInventory.fish;
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt
  });
  const persisted = repository.inspect();

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.reward.recorded, true);
  assert.equal(result.foodDrop, null);
  assert.deepEqual(result.newlyUnlockedSkins, []);
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'idle');
  assert.deepEqual(persisted.state.focusLandingPrompt, {
    sessionId: 'focus-1', taskId: 'task-1', completedAt: completion.endedAt, status: 'pending'
  });
  assert.equal(persisted.state.quickStartDecision, null);
  assert.equal(persisted.state.xp, 190);
  assert.equal(persisted.state.level, 2);
  // 写集声明了 lastCompletedDate，那这一次提交就必须把它推进：它只在本次结算里推进一次，
  // 重放不再动它（下方 retry 段的 commits 仍为 1 即是这条的保证）。连续天数已不存在。
  assert.equal('streak' in persisted.state, false);
  assert.equal(persisted.state.lastCompletedDate, localDayKey(completion.endedAt));
  assert.equal(persisted.state.stats.totalFocusMs, 5 * MINUTE);
  assert.equal(persisted.state.stats.totalPomodoros, 1);
  assert.equal(persisted.state.tasks[0].focusedMs, 5 * MINUTE);
  assert.equal(persisted.state.tasks[0].focusSessions, 1);
  assert.equal(persisted.state.pet.foodInventory.fish, initialFish);
  assert.equal(result.reward.levelUpFood, undefined);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 0);
  assert.equal(persisted.state.unlockedSkins.includes('forest'), false);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(events[1][1], events[2][1]);
  assert.deepEqual(SETTLE_FOCUS_SESSION_WRITES, [
    'focusSession', 'quickStartDecision', 'focusLandingPrompt', 'tasks',
    'xp', 'level', 'lastCompletedDate', 'stats', 'rewardLedger',
    'companion', 'unlockedSkins'
  ]);

  const retry = workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.committed, false);
  assert.equal(retry.reward.recorded, false);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'publish']);
});

test('quick-start completion creates only its decision and zero-XP progress facts', () => {
  const initial = baseState();
  const running = start('quick-start', 2 * MINUTE);
  initial.focusSession = running;
  const completion = finish(running, STARTED_AT + 2 * MINUTE);
  const repository = createRepository(initial);
  let randomCalls = 0;
  const workflow = createWorkflow(repository, {
    random: () => { randomCalls += 1; return 0; }
  });

  const result = workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt
  });
  const state = repository.inspect().state;

  assert.equal(result.reward.awardedReward, 0);
  assert.deepEqual(state.quickStartDecision, {
    sessionId: 'quick-start-1', taskId: 'task-1', completedAt: completion.endedAt,
    elapsedMs: 2 * MINUTE, status: 'pending', resolvedAt: null
  });
  assert.equal(state.focusLandingPrompt, null);
  assert.equal(state.stats.totalFocusMs, 2 * MINUTE);
  assert.equal(state.stats.totalPomodoros, 0);
  assert.equal(state.tasks[0].focusedMs, 2 * MINUTE);
  assert.equal(state.companion.relationships.dango.bondPoints, 0);
  assert.equal(randomCalls, 0);
});

test('an explicit early stop records real investment without completion rewards or handoffs', () => {
  const initial = baseState();
  const running = start('focus', 5 * MINUTE);
  initial.focusSession = running;
  const stoppedAt = STARTED_AT + MINUTE;
  const completion = finish(running, stoppedAt, 'stopped');
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository);

  const result = workflow.execute({
    nextSession: execution.focusSession.createIdleSession(stoppedAt),
    completion,
    settledAt: stoppedAt
  });
  const state = repository.inspect().state;

  assert.equal(completion.completed, false);
  assert.equal(result.reward.recorded, true);
  assert.equal(result.reward.awardedReward, 0);
  assert.equal(state.xp, 0);
  assert.equal('streak' in state, false);
  assert.equal(state.stats.totalFocusMs, MINUTE);
  assert.equal(state.stats.totalPomodoros, 0);
  assert.deepEqual(state.stats.dailyCompletions, {});
  assert.equal(state.tasks[0].focusedMs, MINUTE);
  assert.equal(state.tasks[0].focusSessions, 1);
  assert.equal(state.focusLandingPrompt, null);
  assert.equal(state.quickStartDecision, null);
  assert.equal(state.companion.relationships.dango.bondPoints, 0);
});

test('offline-due focus settles only after explicit confirmation', () => {
  const initial = baseState();
  const running = start('focus', MINUTE);
  const held = execution.focusSession.pauseForOfflineConfirmation(
    running,
    STARTED_AT + MINUTE
  );
  initial.focusSession = held.session;
  assert.equal(held.session.awaitingOfflineConfirmation, true);
  assert.equal(initial.xp, 0);

  const confirmedAt = STARTED_AT + MINUTE + 5_000;
  const confirmed = execution.focusSession.resumeSession(held.session, confirmedAt);
  const repository = createRepository(initial);
  const result = createWorkflow(repository).execute({
    nextSession: confirmed.session,
    completion: confirmed.completion,
    settledAt: confirmedAt
  });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.xp, 0);
  assert.equal(repository.inspect().state.focusSession.status, 'idle');
  assert.equal(repository.inspect().state.focusLandingPrompt.sessionId, 'focus-1');
});

test('invalid input and revision conflicts write nothing and emit no effects', () => {
  const initial = baseState();
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({
    nextSession: initial.focusSession,
    completion: { sessionId: 'broken' }
  }), { ok: false, reason: 'invalid-session-completion' });

  const running = start('focus', MINUTE);
  const completion = finish(running, STARTED_AT + MINUTE);
  assert.deepEqual(workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt
  }), { ok: false, reason: 'session-settlement-mismatch' });
  assert.deepEqual(workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt,
    expectedRevision: 2
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('post-commit effect failures are reported and cannot hide a durable settlement', () => {
  const initial = baseState();
  const running = start('break', MINUTE, null);
  initial.focusSession = running;
  const completion = finish(running, STARTED_AT + MINUTE);
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    synchronize: fact => {
      events.push(['synchronize', fact]);
      throw new Error('clock unavailable');
    },
    publish: fact => {
      events.push(['publish', fact]);
      throw new Error('renderer unavailable');
    },
    reportEffectError: (error, fact) => events.push(['report', error.message, fact.type])
  });

  const result = workflow.execute({
    nextSession: execution.focusSession.createIdleSession(completion.endedAt),
    completion,
    settledAt: completion.endedAt
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), [
    'commit', 'synchronize', 'report', 'publish', 'report'
  ]);
  assert.equal(repository.inspect().state.stats.totalFocusMs, 0);
  assert.equal(repository.inspect().state.quickStartDecision, null);
  assert.equal(repository.inspect().state.focusLandingPrompt, null);
});
