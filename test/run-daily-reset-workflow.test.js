'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RUN_DAILY_RESET_WRITES,
  createRunDailyResetWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { calendarDayDiff } = require('../src/core/calendar');

const RESET_AT = Date.parse('2026-08-29T12:00:00Z');
const TODAY = '2026-08-29';
const LONG_AGO = '2026-08-20T00:00:00.000Z';

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: RESET_AT });
}

/**
 * Attach a fixed daily recurrence after normalization: the schema-8 repair path
 * rebuilds the task model from legacy input and keeps only the series it created
 * itself. Committing still runs the strict current-schema validation, so these
 * fixtures are checked against the real task-model invariants.
 */
function linkSeries(state, { id, openTaskId = null, memberTaskIds = [], lastOccurrenceDate }) {
  state.recurrenceSeries.push({
    id,
    createdAt: 1,
    state: 'active',
    rule: {
      frequency: 'daily', interval: 1, weekdays: null,
      strategy: 'fixed', anchorDate: lastOccurrenceDate
    },
    template: { title: `${id} 每天一次`, stepTitles: [], energy: 'medium', energyAuto: true },
    openTaskId,
    lastOccurrenceDate
  });
  for (const taskId of memberTaskIds) {
    const task = state.tasks.find(item => item.id === taskId);
    task.seriesId = id;
    task.occurrenceDate = lastOccurrenceDate;
  }
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
  let issued = 0;
  return createRunDailyResetWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => RESET_AT, dayKey: () => TODAY },
    idFactory: prefix => `${prefix}-fixed-${(issued += 1)}`,
    ...overrides
  });
}

test('the local-day pass leaves an open occurrence alone and only moves a closed series on', () => {
  const events = [];
  const initial = baseState({
    tasks: [
      {
        id: 'occ-open', title: '昨天没做完的一轮', createdAt: 1, done: false,
        steps: [{ id: 'step-a', title: '打开文档', done: true, completionCycle: 3 }]
      },
      { id: 'occ-closed', title: '已完成的一轮', createdAt: 2, done: true, completedAt: 3 }
    ],
    nowTaskId: 'occ-open'
  });
  initial.lastResetDate = '2026-08-28';
  linkSeries(initial, {
    id: 'series-open', openTaskId: 'occ-open',
    memberTaskIds: ['occ-open'], lastOccurrenceDate: '2026-08-28'
  });
  linkSeries(initial, {
    id: 'series-closed', memberTaskIds: ['occ-closed'], lastOccurrenceDate: '2026-08-28'
  });
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute(), {
    ok: true, mode: 'advance', dayKey: TODAY, archivedCount: 0, calibration: null
  });

  const persisted = repository.inspect();
  // One commit for the whole day: recount, tidy, series catch-up, expiry and the
  // day marker cannot land separately.
  assert.equal(persisted.commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);

  // Yesterday's unfinished round keeps its place, its checked steps and its
  // reward cycle. Coming back late is progress, not a miss to clean up.
  const carried = persisted.state.tasks.find(task => task.id === 'occ-open');
  assert.equal(carried.done, false);
  assert.equal(carried.occurrenceDate, '2026-08-28');
  assert.deepEqual(carried.steps.map(step => step.done), [true]);
  assert.equal(carried.steps[0].completionCycle, 3);
  assert.equal(persisted.state.nowTaskId, 'occ-open');
  assert.equal(persisted.state.lastResetDate, TODAY);

  // Only the closed series gets a fresh round, dated today rather than any day
  // in between.
  const openSeries = persisted.state.recurrenceSeries.find(series => series.id === 'series-open');
  const closedSeries = persisted.state.recurrenceSeries.find(series => series.id === 'series-closed');
  assert.equal(openSeries.openTaskId, 'occ-open');
  assert.equal(openSeries.lastOccurrenceDate, '2026-08-28');
  assert.equal(closedSeries.lastOccurrenceDate, TODAY);
  assert.deepEqual(events[1][1].generatedTaskIds, [closedSeries.openTaskId]);
  assert.equal(
    persisted.state.tasks.find(task => task.id === closedSeries.openTaskId).occurrenceDate,
    TODAY
  );
});

test('a second pass on the same local day changes nothing and publishes nothing', () => {
  const initial = baseState({
    tasks: [{ id: 'stale', title: '很久没碰的闪念', createdAt: 1, expiresAt: LONG_AGO }]
  });
  initial.lastResetDate = TODAY;
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute(), { ok: false, reason: 'day-already-reset' });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('startup catches up an old open occurrence even when the daily marker is already current', () => {
  const initial = baseState({ tasks: [{ id: 'old', title: '继续这一次', createdAt: 1 }] });
  initial.lastResetDate = TODAY;
  linkSeries(initial, { id: 'series', openTaskId: 'old', memberTaskIds: ['old'], lastOccurrenceDate: '2026-08-20' });
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository);
  assert.equal(workflow.execute().mode, 'catch-up');
  assert.equal(repository.inspect().state.tasks[0].occurrenceDate, TODAY);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(workflow.execute().reason, 'day-already-reset');
  assert.equal(repository.inspect().commits, 1);
});

test('a 29 to 28 to 29 clock rollback cannot run the same local-day pass twice', () => {
  const initial = baseState({
    tasks: [{ id: 'occ-clock', title: '保留完成态', createdAt: 1, done: true, completedAt: 100 }]
  });
  initial.lastResetDate = '2026-08-29';
  linkSeries(initial, {
    id: 'series-1', memberTaskIds: ['occ-clock'], lastOccurrenceDate: '2026-08-29'
  });
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    clock: { now: () => Date.parse('2026-08-28T12:00:00Z'), dayKey: () => '2026-08-28' },
    publish: fact => events.push(['publish', fact])
  });

  // The marker is monotonic: rolling the clock back must not make 08-29 look new
  // again, which would run the same day's pass a second time.
  assert.deepEqual(workflow.execute(), { ok: false, reason: 'reset-marker-ahead' });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('the local-day tidy-up preserves work with unresolved execution-loop handoffs', () => {
  const openTask = (id, title) => ({
    id, title, createdAt: Date.parse('2026-08-20T12:00:00Z'), expiresAt: LONG_AGO
  });
  const events = [];
  const initial = baseState({
    tasks: [
      openTask('landing-1', '待写落点'),
      openTask('decision-1', '待选继续方式'),
      openTask('session-1', '暂停中的会话'),
      openTask('stale-1', '无闭环引用的过期闪念'),
      openTask('occ-1', '重复任务的这一轮')
    ],
    nowTaskId: 'stale-1',
    focusSession: {
      status: 'paused', pausedFrom: 'focus', sessionId: 'focus-1', taskId: 'session-1',
      plannedDurationMs: 1_500_000, elapsedBeforeStartMs: 60_000, pausedAt: 800,
      activeSegments: [{ startedAt: 700, endedAt: 800 }], createdAt: 700, updatedAt: 800
    },
    focusLandingPrompt: {
      sessionId: 'focus-0', taskId: 'landing-1', completedAt: 1, status: 'pending'
    },
    quickStartDecision: {
      sessionId: 'quick-1', taskId: 'decision-1', completedAt: 1,
      elapsedMs: 120_000, status: 'pending', resolvedAt: null
    }
  });
  initial.lastResetDate = '2026-08-28';
  linkSeries(initial, {
    id: 'series-1', openTaskId: 'occ-1',
    memberTaskIds: ['occ-1'], lastOccurrenceDate: '2026-08-21'
  });
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.equal(workflow.execute().archivedCount, 1);

  const persisted = repository.inspect();
  // Work behind an unanswered prompt or a paused session still owes the user an
  // answer, and a recurrence occurrence belongs to its series' schedule.
  assert.deepEqual(
    persisted.state.tasks.map(task => task.id),
    ['landing-1', 'decision-1', 'session-1', 'occ-1']
  );
  assert.equal(persisted.state.archivedTasks.length, 1);
  assert.equal(persisted.state.archivedTasks[0].id, 'stale-1');
  assert.equal(persisted.state.archivedTasks[0].archiveReason, 'expired-unreviewed');
  assert.equal(persisted.state.nowTaskId, null);
  assert.equal(persisted.state.focusSession.taskId, 'session-1');
  assert.equal(persisted.state.focusLandingPrompt.taskId, 'landing-1');
  assert.equal(persisted.state.quickStartDecision.taskId, 'decision-1');
  assert.deepEqual(events[1][1].archivedTaskIds, ['stale-1']);
});

test('a first-ever pass records the day without tidying anything away', () => {
  const events = [];
  const initial = baseState({
    tasks: [
      { id: 'stale', title: '很久没碰的闪念', createdAt: 1, expiresAt: LONG_AGO },
      { id: 'slipped', title: '过了截止日', createdAt: 1, deadline: '2026-08-20', overdueCount: 0 }
    ]
  });
  initial.lastResetDate = null;
  linkSeries(initial, { id: 'series-1', lastOccurrenceDate: '2026-08-28' });
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute(), {
    ok: true, mode: 'initialize', dayKey: TODAY, archivedCount: 0, calibration: null
  });

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.lastResetDate, TODAY);
  // No prior marker means no measured absence: archiving, recounting or catching
  // a series up on first launch would be a surprise rather than a service.
  assert.deepEqual(persisted.state.tasks.map(task => task.id), ['stale', 'slipped']);
  assert.deepEqual(persisted.state.archivedTasks, []);
  assert.equal(persisted.state.recurrenceSeries[0].lastOccurrenceDate, '2026-08-28');
  assert.equal(persisted.state.tasks[1].overdueCount, 0);
  // Expiry still rides along, so due work is flagged on the very first pass.
  assert.equal(persisted.state.tasks[0].expired, true);
  assert.deepEqual(events[1][1].expiredTaskIds, ['stale']);
});

test('the pass recounts open deadline slippage and flags expiry in the same commit', () => {
  const facts = [];
  const initial = baseState({
    tasks: [
      { id: 'open', title: '还在做', createdAt: 1, deadline: '2026-08-27', overdueCount: 0 },
      {
        id: 'done', title: '已完成', createdAt: 1, deadline: '2026-08-20',
        overdueCount: 2, done: true, completedAt: 2
      },
      { id: 'due', title: '刚到期', createdAt: 1, expiresAt: new Date(RESET_AT - 1).toISOString() }
    ],
    nowTaskId: 'due'
  });
  initial.lastResetDate = '2026-08-28';
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, { publish: fact => facts.push(fact) });

  assert.equal(workflow.execute().ok, true);

  const persisted = repository.inspect();
  const slipped = calendarDayDiff(new Date('2026-08-27'), new Date(RESET_AT));
  assert.equal(persisted.commits, 1);
  assert.ok(slipped > 0);
  assert.equal(persisted.state.tasks.find(task => task.id === 'open').overdueCount, slipped);
  // Closed work keeps the count it was closed with, even though its deadline
  // slipped further: history records what happened, not a total that keeps
  // running afterwards.
  assert.equal(persisted.state.tasks.find(task => task.id === 'done').overdueCount, 2);
  assert.ok(calendarDayDiff(new Date('2026-08-20'), new Date(RESET_AT)) > 2);
  assert.equal(persisted.state.tasks.find(task => task.id === 'due').expired, true);
  assert.deepEqual(facts[0].expiredTaskIds, ['due']);
  assert.equal(facts[0].clearedNowTaskId, 'due');
  assert.equal(persisted.state.nowTaskId, null);
});

test('the published local-day fact is frozen and covers exactly the declared write set', () => {
  const facts = [];
  const initial = baseState();
  initial.lastResetDate = '2026-08-28';
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, { publish: fact => facts.push(fact) });

  assert.equal(workflow.execute().ok, true);
  assert.deepEqual(facts[0], {
    type: 'local-day-reset',
    dayKey: TODAY,
    mode: 'advance',
    archivedTaskIds: [],
    generatedTaskIds: [],
    expiredTaskIds: [],
    clearedNowTaskId: null,
    energyProfileChanged: false,
    energyCalibration: null,
    droppedRoutineDayKeys: [],
    resetAt: RESET_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(facts[0]), true);
  assert.equal(Object.isFrozen(facts[0].archivedTaskIds), true);
  assert.equal(Object.isFrozen(facts[0].generatedTaskIds), true);
  assert.equal(Object.isFrozen(facts[0].expiredTaskIds), true);
  assert.equal(Object.isFrozen(facts[0].droppedRoutineDayKeys), true);
  assert.deepEqual(RUN_DAILY_RESET_WRITES, [
    'tasks',
    'archivedTasks',
    'recurrenceSeries',
    'nowTaskId',
    'lastResetDate',
    'routineLog',
    'energyProfile'
  ]);
});

test('a curve that moved carries its two numbers on the fact, not just a boolean', () => {
  // ARCHITECTURE「日常与能量」: the timeline event is written from the published fact, because a
  // history row may only be appended after the commit landed — and `execute()`
  // returns its response on the uncommitted path too.
  const facts = [];
  const initial = baseState();
  initial.lastResetDate = '2026-08-28';
  initial.energyCheckIn = { level: 70, timestamp: RESET_AT - 6 * 60 * 60 * 1000, source: 'manual' };
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository, {
    publish: fact => facts.push(fact),
    energyModel: {
      predict: () => ({ modelLevel: 45, effects: [], baselineSeed: null, minuteOfDay: 600 })
    }
  });

  assert.equal(workflow.execute().ok, true);
  assert.equal(facts[0].energyProfileChanged, true);
  // The very first report is warm-up: the count is real, the error is not yet
  // measurable, and `null` is how that gets said without inventing a 0.
  assert.deepEqual(facts[0].energyCalibration, { observations: 1, mae: null });
  assert.equal(Object.isFrozen(facts[0].energyCalibration), true);
});

test('a day the curve could not learn from leaves the calibration field empty', () => {
  const facts = [];
  const initial = baseState();
  initial.lastResetDate = '2026-08-28';
  const repository = createRepository(initial);
  // No check-in yesterday → `calibrateEnergyProfile` reports `changed: false`, and
  // a day with nothing learned must not leave a "the curve retuned" row behind.
  createWorkflow(repository, {
    publish: fact => facts.push(fact),
    energyModel: { predict: () => ({ modelLevel: 45 }) }
  }).execute();
  assert.equal(facts[0].energyProfileChanged, false);
  assert.equal(facts[0].energyCalibration, null);
});

test('a stale revision refuses before the transition and feedback failure never retries', () => {
  const initial = baseState();
  initial.lastResetDate = '2026-08-28';
  const events = [];
  const stale = createRepository(initial, events);
  assert.deepEqual(
    createWorkflow(stale, { publish: fact => events.push(['publish', fact]) })
      .execute({ expectedRevision: 1 }),
    { ok: false, reason: 'state-revision-conflict' }
  );
  assert.equal(stale.inspect().commits, 0);
  assert.deepEqual(events, []);

  const repository = createRepository(initial);
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('notification host closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute(), {
    ok: true, mode: 'advance', dayKey: TODAY, archivedCount: 0, calibration: null
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.lastResetDate, TODAY);
  assert.deepEqual(reported, [['notification host closed', 'local-day-reset']]);
});

test('the workflow refuses to be built without the ports its purity depends on', () => {
  const unitOfWork = createUnitOfWork({ repository: createRepository(baseState()) });
  assert.throws(() => createRunDailyResetWorkflow({}), /requires a unit of work/);
  assert.throws(
    () => createRunDailyResetWorkflow({ unitOfWork, clock: { now: () => RESET_AT } }),
    /requires a clock with now and dayKey/
  );
  assert.throws(
    () => createRunDailyResetWorkflow({
      unitOfWork,
      clock: { now: () => RESET_AT, dayKey: () => TODAY }
    }),
    /requires an id factory/
  );
});
