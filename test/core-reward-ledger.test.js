'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRewardLedger,
  createRewardEvent,
  normalizeRewardLedger,
  recordReward,
  hasRewardEvent,
  rewardTotal,
  makeRewardEventId,
  taskCompletionRewardId,
  stepCompletionRewardId,
  taskRewardCycle,
  stepBudgetKey,
  stepBudgetSpent,
  stepBudgetRemaining,
  REWARD_LEDGER_VERSION,
  MAX_REWARD_EVENT_ID_LENGTH,
  MAX_STEP_BUDGET_KEYS,
  STEP_REWARD_BUDGET
} = require('../src/core/reward-ledger');

test('records a domain reward event exactly once', () => {
  const event = createRewardEvent({
    eventId: makeRewardEventId('task-complete', 'task-1', '2026-08-29'),
    source: 'task-complete',
    dateKey: '2026-08-29'
  }, { now: 1000 });
  const first = recordReward(createRewardLedger(), event);
  assert.equal(first.recorded, true);
  assert.equal(first.awardedReward, 15);

  const retry = recordReward(first.ledger, event);
  assert.equal(retry.recorded, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.awardedReward, 0);
  assert.equal(rewardTotal(retry.ledger), 15);
});

test('applies a daily cap within a reward bucket', () => {
  let ledger = createRewardLedger();
  for (const [eventId, baseReward] of [['feed-1', 20], ['feed-2', 20]]) {
    const result = recordReward(ledger, createRewardEvent({
      eventId,
      source: 'pet-feed',
      bucket: 'pet-feed',
      dateKey: '2026-08-29',
      baseReward
    }), { dailyCap: 30 });
    ledger = result.ledger;
  }
  assert.equal(ledger.events[0].awardedReward, 20);
  assert.equal(ledger.events[1].awardedReward, 10);
  assert.equal(rewardTotal(ledger, { dateKey: '2026-08-29', bucket: 'pet-feed' }), 30);
});

test('normalizes malformed and duplicate persisted ledger entries', () => {
  const valid = {
    eventId: 'one', source: 'task-complete', dateKey: '2026-08-29',
    baseReward: 15, awardedReward: 15, createdAt: 1
  };
  const ledger = normalizeRewardLedger({ events: [null, valid, { ...valid, awardedReward: 999 }, { nope: true }] });
  assert.equal(ledger.version, REWARD_LEDGER_VERSION);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].awardedReward, 15);
  assert.deepEqual(ledger.seenEventIds, ['one']);
  assert.equal(ledger.dailyBucketTotals['2026-08-29']['task-complete'], 15);
});

test('recording an older stable-time reward keeps the written ledger canonical', () => {
  const later = createRewardEvent({
    eventId: 'task-at-1500', source: 'task-complete', dateKey: '2026-08-29', createdAt: 1_500
  });
  const earlier = createRewardEvent({
    eventId: 'feed-at-noon', source: 'pet-feed', bucket: 'pet-feed',
    dateKey: '2026-08-29', baseReward: 5, createdAt: 1_000
  });
  const first = recordReward(createRewardLedger(), later).ledger;
  const written = recordReward(first, earlier).ledger;

  assert.deepEqual(written.events.map(event => event.eventId), ['feed-at-noon', 'task-at-1500']);
  assert.deepEqual(normalizeRewardLedger(written, { maxEvents: 5000 }), written);
});

test('v1 migration keeps permanent identities and cap totals when display history is trimmed', () => {
  const legacyEvents = [
    { eventId: 'old-task', source: 'task-complete', bucket: 'task-complete', dateKey: '2026-08-29', baseReward: 15, awardedReward: 15, createdAt: 1 },
    { eventId: 'feed-1', source: 'pet-feed', bucket: 'pet-feed', dateKey: '2026-08-29', baseReward: 20, awardedReward: 20, createdAt: 2 },
    { eventId: 'feed-2', source: 'pet-feed', bucket: 'pet-feed', dateKey: '2026-08-29', baseReward: 20, awardedReward: 10, createdAt: 3 }
  ];
  const migrated = normalizeRewardLedger({ version: 1, events: legacyEvents }, { maxEvents: 2 });

  assert.equal(migrated.version, REWARD_LEDGER_VERSION);
  assert.deepEqual(migrated.stepBudgets, {}, 'a v1 ledger has no step budget history to carry');
  assert.equal(migrated.events.length, 2);
  assert.equal(migrated.events.some(event => event.eventId === 'old-task'), false);
  assert.equal(hasRewardEvent(migrated, 'old-task'), true);
  assert.equal(rewardTotal(migrated, { dateKey: '2026-08-29', bucket: 'pet-feed' }), 30);

  const retry = recordReward(migrated, legacyEvents[0], { maxEvents: 2 });
  assert.equal(retry.recorded, false);
  assert.equal(retry.awardedReward, 0);
});

test('event retention never reopens an old identity or a daily reward bucket', () => {
  let ledger = createRewardLedger();
  const taskEvent = createRewardEvent({
    eventId: 'task-complete:old:lifetime', source: 'task-complete', dateKey: '2026-08-29'
  });
  ledger = recordReward(ledger, taskEvent, { maxEvents: 1 }).ledger;
  ledger = recordReward(ledger, createRewardEvent({
    eventId: 'feed-1', source: 'pet-feed', bucket: 'pet-feed', dateKey: '2026-08-29', baseReward: 20
  }), { maxEvents: 1, dailyCap: 30 }).ledger;
  ledger = recordReward(ledger, createRewardEvent({
    eventId: 'noise', source: 'execution-return', dateKey: '2026-08-29', baseReward: 0
  }), { maxEvents: 1 }).ledger;

  assert.equal(ledger.events.length, 1);
  assert.equal(hasRewardEvent(ledger, taskEvent.eventId), true);
  assert.equal(recordReward(ledger, taskEvent, { maxEvents: 1 }).recorded, false);

  const capped = recordReward(ledger, createRewardEvent({
    eventId: 'feed-2', source: 'pet-feed', bucket: 'pet-feed', dateKey: '2026-08-29', baseReward: 20
  }), { maxEvents: 1, dailyCap: 30 });
  assert.equal(capped.awardedReward, 10);
  assert.equal(rewardTotal(capped.ledger, { dateKey: '2026-08-29', bucket: 'pet-feed' }), 30);
});

test('a reward cycle comes from the occurrence date, with the legacy category only as a fallback', () => {
  // schema 8: the occurrence date is the cycle. A recurrence instance is its own
  // task with its own identity, so it earns once and keeps that record.
  const occurrence = { id: 'water', occurrenceDate: '2026-08-28' };
  const nextOccurrence = { id: 'water-next', occurrenceDate: '2026-08-29' };
  assert.equal(taskRewardCycle(occurrence, '2026-08-29'), '2026-08-28');
  assert.equal(taskCompletionRewardId(occurrence, '2026-08-29'), 'task-complete:water:2026-08-28');
  assert.equal(taskCompletionRewardId(nextOccurrence, '2026-08-29'), 'task-complete:water-next:2026-08-29');

  const oneOff = { id: 'report' };
  assert.equal(taskRewardCycle(oneOff, '2026-08-29'), 'lifetime');
  assert.equal(taskCompletionRewardId(oneOff, '2026-08-28'), 'task-complete:report:lifetime');
  assert.equal(taskCompletionRewardId(oneOff, '2026-08-29'), 'task-complete:report:lifetime');
  assert.equal(stepCompletionRewardId(oneOff, '2', '2026-08-29'), 'step-complete:report-2:lifetime');
  assert.equal(
    stepCompletionRewardId(oneOff, 'step-a', '2026-08-29'),
    'step-complete:report%7Cstep-a:lifetime'
  );

  // The legacy branch has to survive: a schema-7 daily task that was already
  // paid must keep the exact identity it was paid under, or the migration day
  // would hand out its reward a second time.
  const legacyDaily = { id: 'water', category: 'daily' };
  assert.equal(taskCompletionRewardId(legacyDaily, '2026-08-28'), 'task-complete:water:2026-08-28');
  assert.equal(taskCompletionRewardId(legacyDaily, '2026-08-29'), 'task-complete:water:2026-08-29');
  assert.equal(stepCompletionRewardId(legacyDaily, '2', '2026-08-28'), 'step-complete:water-2:2026-08-28');
});

test('a step budget is per occurrence, only ever grows, and is bounded', () => {
  const task = { id: 'water', occurrenceDate: '2026-08-29' };
  const key = stepBudgetKey(task, '2026-08-30');
  assert.equal(key, 'water|2026-08-29');

  let ledger = createRewardLedger();
  assert.equal(stepBudgetSpent(ledger, key), 0);
  assert.equal(stepBudgetRemaining(ledger, key, STEP_REWARD_BUDGET), STEP_REWARD_BUDGET);

  // The budget is deliberately not the daily bucket: the second call names a
  // later local day and still gets nothing, because the allowance belongs to the
  // occurrence rather than to a calendar day.
  for (let index = 0; index < 8; index += 1) {
    const result = recordReward(ledger, createRewardEvent({
      eventId: `step-complete:water-${index}:2026-08-29`,
      source: 'step-complete',
      dateKey: index < 5 ? '2026-08-29' : '2026-08-30',
      baseReward: 3
    }), { bucketCap: { key, cap: STEP_REWARD_BUDGET } });
    ledger = result.ledger;
    assert.equal(result.recorded, true, 'the completion event is recorded even with no payout left');
    assert.equal(result.awardedReward, index < 5 ? 3 : 0);
  }
  assert.equal(stepBudgetSpent(ledger, key), STEP_REWARD_BUDGET);
  assert.equal(stepBudgetRemaining(ledger, key, STEP_REWARD_BUDGET), 0);

  // Trimming the display log must never hand the allowance back.
  const trimmed = normalizeRewardLedger(ledger, { maxEvents: 1 });
  assert.equal(trimmed.events.length, 1);
  assert.equal(stepBudgetSpent(trimmed, key), STEP_REWARD_BUDGET);

  const overflowing = { version: REWARD_LEDGER_VERSION, events: [], stepBudgets: {} };
  for (let index = 0; index <= MAX_STEP_BUDGET_KEYS; index += 1) {
    overflowing.stepBudgets[`task-${index}|lifetime`] = 3;
  }
  assert.throws(() => normalizeRewardLedger(overflowing), RangeError);
});

test('overlong business IDs use stable bounded reward keys without changing short legacy keys', () => {
  const task = { id: '🧠'.repeat(100) };
  const stepId = '步'.repeat(200);
  const taskId = taskCompletionRewardId(task, '2026-08-29');
  const stepRewardId = stepCompletionRewardId(task, stepId, '2026-08-29');

  assert.ok(taskId.length <= MAX_REWARD_EVENT_ID_LENGTH);
  assert.ok(stepRewardId.length <= MAX_REWARD_EVENT_ID_LENGTH);
  assert.equal(taskId, taskCompletionRewardId(task, '2026-08-29'));
  assert.equal(stepRewardId, stepCompletionRewardId(task, stepId, '2026-08-29'));
  assert.notEqual(taskId, stepRewardId);
  assert.doesNotThrow(() => createRewardEvent({
    eventId: stepRewardId, source: 'step-complete', dateKey: '2026-08-29'
  }));
  assert.equal(taskCompletionRewardId({ id: 'report' }, '2026-08-29'), 'task-complete:report:lifetime');
});
