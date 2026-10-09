'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SKIP_WORK_OCCURRENCE_WRITES,
  createSkipWorkOccurrenceWorkflow,
  createUnitOfWork
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const SKIPPED_AT = Date.parse('2026-09-08T09:00:00Z');
const OCCURRENCE_DAY = '2026-09-08';

function baseState() {
  const canonical = normalizePersistedState({}, { now: SKIPPED_AT });
  return normalizePersistedState({
    ...canonical,
    tasks: [{
      id: 'occ-1',
      title: '每日整理一行',
      createdAt: 1,
      plannedFor: OCCURRENCE_DAY,
      seriesId: 'series-1',
      occurrenceDate: OCCURRENCE_DAY,
      steps: [{ id: 'step-1', title: '打开文件', done: false }]
    }],
    recurrenceSeries: [{
      id: 'series-1',
      createdAt: 1,
      state: 'active',
      rule: {
        frequency: 'daily',
        interval: 1,
        weekdays: null,
        strategy: 'fixed',
        anchorDate: OCCURRENCE_DAY
      },
      template: {
        title: '每日整理一行',
        stepTitles: ['打开文件'],
        energy: 'medium',
        energyAuto: true
      },
      openTaskId: 'occ-1',
      lastOccurrenceDate: OCCURRENCE_DAY
    }],
    nowTaskId: 'occ-1',
    focusLandingPrompt: {
      sessionId: 'focus-old',
      taskId: 'occ-1',
      completedAt: SKIPPED_AT - 1_000,
      status: 'pending'
    }
  }, { now: SKIPPED_AT });
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
  return createSkipWorkOccurrenceWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => SKIPPED_AT },
    idFactory: prefix => `${prefix}-next-${++sequence}`,
    ...overrides
  });
}

test('skipping an occurrence seals work and clears Now and preserves the landing in one commit', () => {
  const initial = baseState();
  const progressBefore = {
    xp: initial.xp,
    level: initial.level,
    streak: initial.streak,
    lastCompletedDate: initial.lastCompletedDate,
    stats: structuredClone(initial.stats),
    rewardLedger: structuredClone(initial.rewardLedger)
  };
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ taskId: 'occ-1' });
  const persisted = repository.inspect();

  assert.deepEqual(result, { ok: true, nextOccurrenceDate: '2026-09-09' });
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks.find(task => task.id === 'occ-1').skippedAt, SKIPPED_AT);
  assert.equal(persisted.state.recurrenceSeries[0].openTaskId, 'task-next-1');
  assert.equal(persisted.state.nowTaskId, null);
  assert.deepEqual(persisted.state.focusLandingPrompt, initial.focusLandingPrompt);
  assert.deepEqual({
    xp: persisted.state.xp,
    level: persisted.state.level,
    streak: persisted.state.streak,
    lastCompletedDate: persisted.state.lastCompletedDate,
    stats: persisted.state.stats,
    rewardLedger: persisted.state.rewardLedger
  }, progressBefore, 'skipping must not alter progress');
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(SKIP_WORK_OCCURRENCE_WRITES, [
    'tasks', 'recurrenceSeries', 'nowTaskId'
  ]);
});

test('live session and quick-start handoffs block skipping without writes or IDs', () => {
  const active = baseState();
  active.focusSession = execution.focusSession.startFocus(active.focusSession, {
    now: SKIPPED_AT - 1_000,
    durationMs: 60_000,
    taskId: 'occ-1',
    sessionId: 'focus-1'
  }).session;
  const paused = structuredClone(active);
  paused.focusSession = execution.focusSession.pauseSession(paused.focusSession, SKIPPED_AT).session;
  const deciding = baseState();
  deciding.quickStartDecision = {
    sessionId: 'quick-1',
    taskId: 'occ-1',
    completedAt: SKIPPED_AT - 1,
    elapsedMs: 120_000,
    status: 'pending',
    resolvedAt: null
  };

  for (const initial of [active, paused, deciding]) {
    const events = [];
    const repository = createRepository(initial, events);
    let idCalls = 0;
    const workflow = createWorkflow(repository, {
      idFactory: () => { idCalls += 1; return `unexpected-${idCalls}`; },
      publish: fact => events.push(['publish', fact])
    });

    assert.deepEqual(workflow.execute({ taskId: 'occ-1' }), {
      ok: false,
      reason: 'task-in-active-session'
    });
    assert.equal(repository.inspect().commits, 0);
    assert.deepEqual(repository.inspect().state, initial);
    assert.equal(idCalls, 0);
    assert.deepEqual(events, []);
  }
});

test('retries and stale revisions cannot advance a series twice', () => {
  const repository = createRepository(baseState());
  const workflow = createWorkflow(repository);

  assert.equal(workflow.execute({ taskId: 'occ-1' }).ok, true);
  assert.deepEqual(workflow.execute({ taskId: 'occ-1' }), {
    ok: false,
    reason: 'occurrence-skipped'
  });
  assert.deepEqual(workflow.execute({ taskId: 'task-next-1', expectedRevision: 0 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.tasks.filter(task => !task.skippedAt).length, 1);
});

test('post-commit delivery failure cannot make a skipped occurrence retryable', () => {
  const repository = createRepository(baseState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({ taskId: 'occ-1' }), {
    ok: true,
    nextOccurrenceDate: '2026-09-09'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'work-occurrence-skipped']]);
});
