'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { localDayKey } = require('../src/core/calendar');
const {
  createRewardLedger,
  taskCompletionRewardId,
  stepCompletionRewardId
} = require('../src/core/reward-ledger');
const {
  createCompleteWorkItemWorkflow,
  createCompleteWorkStepWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');

/**
 * Drive the real completion workflows over a migrated file. Payout identities
 * seeded by the migration only matter if the live commit path honours them, so
 * these cases go through the same unit of work the app uses.
 */
function createMigratedRuntime(initial, startedAt) {
  let state = structuredClone(initial);
  let revision = 0;
  let ticks = 0;
  const facts = [];
  const repository = {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      state = normalizePersistedState(candidate, context);
      revision += 1;
      return structuredClone(state);
    },
    revision: () => revision
  };
  const ports = {
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => startedAt + (ticks += 1) },
    publish: fact => facts.push(fact)
  };
  return {
    facts,
    snapshot: () => structuredClone(state),
    revision: () => revision,
    completeTask: createCompleteWorkItemWorkflow({
      ...ports,
      idFactory: (prefix = 'gen') => `${prefix}-fixed`,
      random: () => 0.99
    }).execute,
    completeStep: createCompleteWorkStepWorkflow(ports).execute
  };
}

test('a ledger-less legacy migration seeds completed active and archived reward identities only', () => {
  const lastResetDate = '2026-08-28';
  const migrated = normalizePersistedState({
    schemaVersion: 5,
    lastResetDate,
    xp: 99,
    tasks: [
      {
        id: 'active-once', title: '一次任务', category: 'adhoc', done: true,
        steps: [{ title: '已做的旧步骤', done: true }, { id: 'later', title: '未做步骤', done: false }]
      },
      {
        id: 'active-daily', title: '每日任务', category: 'daily', done: true,
        steps: [{ id: 'daily-step', title: '每日步骤', done: true }]
      }
    ],
    archivedTasks: [
      {
        id: 'archived-once', title: '归档的一次任务', category: 'midterm', done: true,
        steps: [{ id: 'archived-step', title: '归档步骤', done: true }]
      },
      {
        id: 'archived-daily', title: '归档的每日任务', category: 'daily', done: false,
        steps: [{ id: 'done-only-step', title: '仅步骤完成', done: true }]
      }
    ]
  }, { now: Date.parse('2026-08-30T12:00:00Z') });

  const [activeOnce, activeDaily] = migrated.tasks;
  const [archivedOnce, archivedDaily] = migrated.archivedTasks;
  assert.deepEqual(migrated.rewardLedger.seenEventIds, [
    taskCompletionRewardId(activeDaily, lastResetDate),
    taskCompletionRewardId(activeOnce, lastResetDate),
    taskCompletionRewardId(archivedOnce, lastResetDate),
    stepCompletionRewardId(activeDaily, 'daily-step', lastResetDate),
    stepCompletionRewardId(activeOnce, '0', lastResetDate),
    stepCompletionRewardId(archivedDaily, 'done-only-step', lastResetDate),
    stepCompletionRewardId(archivedOnce, 'archived-step', lastResetDate)
  ].sort());
  assert.deepEqual(migrated.rewardLedger.events, []);
  assert.deepEqual(migrated.rewardLedger.dailyBucketTotals, {});
  assert.equal(migrated.xp, 99);
  assert.deepEqual(
    normalizePersistedState(migrated, { now: Date.parse('2026-09-02T12:00:00Z') }),
    migrated,
    'migration-only identities must become a canonical ledger for the current schema'
  );
});

test('daily legacy identities fall back to the migration local day without a reset marker', () => {
  const now = new Date(2026, 7, 30, 1, 30).getTime();
  const migrated = normalizePersistedState({
    schemaVersion: 4,
    tasks: [{
      id: 'daily', title: '喝水', category: 'daily', done: true,
      steps: [{ id: 'cup', title: '接水', done: true }]
    }]
  }, { now });
  const dayKey = localDayKey(now);

  assert.deepEqual(migrated.rewardLedger.seenEventIds, [
    taskCompletionRewardId(migrated.tasks[0], dayKey),
    stepCompletionRewardId(migrated.tasks[0], 'cup', dayKey)
  ].sort());
});

test('an existing legacy ledger keeps its history while schema 8 backfills spent step budgets', () => {
  const existingLedger = {
    ...createRewardLedger(),
    seenEventIds: ['existing-history']
  };
  const legacyWithLedger = normalizePersistedState({
    schemaVersion: 5,
    tasks: [{
      id: 'legacy-done', title: '旧完成', category: 'adhoc', done: true,
      steps: Array.from({ length: 6 }, (_, index) => ({
        id: `paid-${index}`, title: `已完成 ${index + 1}`, done: true
      }))
    }],
    rewardLedger: existingLedger
  }, { now: 1000 });

  assert.deepEqual(legacyWithLedger.rewardLedger.seenEventIds, ['existing-history'],
    'an existing ledger remains authoritative for payout identities');
  assert.deepEqual(legacyWithLedger.rewardLedger.events, existingLedger.events);
  assert.deepEqual(legacyWithLedger.rewardLedger.dailyBucketTotals, existingLedger.dailyBucketTotals);
  assert.equal(legacyWithLedger.rewardLedger.stepBudgets['legacy-done|lifetime'], 15,
    'already completed legacy steps consume the new lifetime allowance');

  for (const rewardLedger of [createRewardLedger()]) {
    const raw = normalizePersistedState({
      schemaVersion: 15,
      tasks: [{ id: 'current-done', title: '当前完成', category: 'adhoc', done: true }]
    }, { now: 1000 });
    raw.rewardLedger = rewardLedger;
    const current = normalizePersistedState(raw, { now: 1000 });
    assert.deepEqual(current.rewardLedger.seenEventIds, []);
    assert.deepEqual(current.rewardLedger.stepBudgets, {},
      'current-schema files remain byte-for-byte authoritative');
  }
});

test('a legacy paid task stays sealed while its migrated successor can earn on its own', () => {
  const completedAt = Date.parse('2026-08-29T12:00:00Z');
  const migrated = normalizePersistedState({
    schemaVersion: 5,
    xp: 18,
    lastResetDate: '2026-08-29',
    stats: { totalTasksDone: 1, dailyCompletions: { '2026-08-29': 1 } },
    tasks: [{
      id: 'paid-task', title: '已经领过奖励', category: 'daily', done: true,
      steps: [{ id: 'paid-step', title: '已经领过步骤奖励', done: true }]
    }]
  }, { now: completedAt });

  const runtime = createMigratedRuntime(migrated, completedAt);

  // The historical round is a terminal state: no reopen, no second payout, and
  // no way to reach its already-settled step.
  const sealed = migrated.tasks.find(task => task.id === 'paid-task');
  assert.equal(sealed.done, true);
  assert.equal(runtime.completeTask({ taskId: 'paid-task' }).reason, 'task-completed');
  assert.equal(
    runtime.completeStep({ taskId: 'paid-task', stepId: 'paid-step' }).reason,
    'task-completed'
  );
  const refused = runtime.snapshot();
  assert.equal(runtime.revision(), 0, 'a sealed round must be a zero-write refusal');
  assert.equal(refused.xp, 18);
  assert.equal(refused.stats.totalTasksDone, 1);
  assert.deepEqual(refused.rewardLedger.events, []);
  assert.deepEqual(refused.rewardLedger.dailyBucketTotals, {});

  // Tomorrow's round is a different task with a different identity, so the
  // seeded history must not silently swallow its first real reward.
  const successor = migrated.tasks.find(task => task.seriesId && !task.done);
  assert.ok(successor, 'a completed daily task migrates into a series with an open successor');
  assert.notEqual(successor.id, 'paid-task');

  const step = runtime.completeStep({ taskId: successor.id, stepId: successor.steps[0].id });
  assert.equal(step.awarded, 30);
  assert.equal(runtime.facts.at(-1).reward.recorded, true);

  assert.equal(runtime.completeTask({ taskId: successor.id }).done, true);
  assert.equal(runtime.facts.at(-1).reward.recorded, true);
  assert.equal(runtime.snapshot().xp, 18);
  assert.equal(runtime.snapshot().level, 2);
  assert.equal(runtime.snapshot().stats.totalTasksDone, 2);
});

test('a legacy step that was already paid blocks only itself, not the whole task', () => {
  const now = Date.parse('2026-08-29T12:00:00Z');
  const migrated = normalizePersistedState({
    schemaVersion: 5,
    xp: 3,
    lastResetDate: '2026-08-29',
    tasks: [{
      id: 'half-done', title: '只做完一步', category: 'adhoc', done: false,
      steps: [
        { id: 'paid-step', title: '已领过', done: true },
        { id: 'open-step', title: '还没做', done: false }
      ]
    }]
  }, { now });

  const runtime = createMigratedRuntime(migrated, now);
  assert.equal(
    runtime.completeStep({ taskId: 'half-done', stepId: 'paid-step' }).reason,
    'step-completed'
  );
  assert.equal(runtime.revision(), 0, 'a settled step must be a zero-write refusal');

  // This isolated historical normalizer test retains paid source identities.
  // A distinct real step now uses the daily growth unit, never a legacy budget.
  assert.equal(runtime.completeStep({ taskId: 'half-done', stepId: 'open-step' }).awarded, 30);
  assert.equal(runtime.facts.at(-1).reward.recorded, true);
  assert.equal(runtime.snapshot().xp, 3);

  assert.equal(runtime.completeTask({ taskId: 'half-done' }).done, true);
  assert.equal(
    runtime.facts.at(-1).reward.recorded, true,
    'an unfinished task was never paid, so it still can be'
  );
  assert.equal(runtime.snapshot().xp, 3);
});
