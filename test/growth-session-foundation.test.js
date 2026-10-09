'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRewardLedger, stepBudgetKey } = require('../src/core/reward-ledger');
const { recordStepCompletion } = require('../src/capabilities/progress/domain/step-completion');
const { recordTaskCompletion } = require('../src/capabilities/progress/domain/task-completion');
const { applyDomainReward } = require('../src/capabilities/progress/domain/progress-state');
const { reconcileCompletedTask } = require('../src/capabilities/execution/domain/task-completion');
const { recordCompletionHandoff } = require('../src/capabilities/execution/domain/session-settlement');

const now = new Date(2026, 9, 7, 12).getTime();
function state() { return { xp: 0, level: 1, rewardLedger: createRewardLedger(), stats: {} }; }
function step(taskId, stepId) { return [{ id: taskId }, { id: stepId, done: true }]; }

test('GROW001 first genuine step reaches level two with 30 XP and parent fact adds no unit', () => {
  const draft = state();
  const result = recordStepCompletion(draft, ...step('task', 'step'), { now });
  assert.equal(result.reward.awardedReward, 30);
  assert.equal(result.reward.firstAdvance, true);
  assert.equal(draft.level, 2);
  assert.equal(draft.xp, 0);
  const parent = recordTaskCompletion(draft, { id: 'task', done: true }, { now });
  assert.equal(parent.reward.awardedReward, 0);
  assert.equal(draft.stats.totalTasksDone, 1);
});

test('GROW001 new day step ignores old lifetime 15 XP allowance', () => {
  const draft = state();
  draft.rewardLedger.stepBudgets[stepBudgetKey({ id: 'task' }, '2026-10-07')] = 15;
  assert.equal(recordStepCompletion(draft, ...step('task', 'later-step'), { now }).reward.awardedReward, 30);
});

test('GROW001 shared task/day sources, three units and a chosen close total at most 60', () => {
  const draft = state();
  let total = 0;
  const awards = [];
  for (const [index, taskId] of ['one', 'one', 'two', 'three', 'four'].entries()) {
    const award = applyDomainReward(draft, { eventId: `fact-${index}`, source: 'focus-confirmed',
      amount: 10, at: now, metadata: { taskId } }).awardedReward;
    awards.push(award);
    total += award;
  }
  total += applyDomainReward(draft, { eventId: 'close', source: 'focus-landing', amount: 10, at: now }).awardedReward;
  assert.deepEqual(awards, [30, 0, 10, 10, 0]);
  assert.equal(total, 60);
  assert.equal(draft.rewardLedger.events.filter(event => event.source === 'focus-confirmed').length, 5);
});

test('EXEC001 completed task clears Now while preserving unanswered landing identity', () => {
  const prompt = { sessionId: 'original', taskId: 'task', completedAt: now, status: 'pending' };
  const draft = { nowTaskId: 'task', focusLandingPrompt: prompt, focusSession: null };
  reconcileCompletedTask(draft, { taskId: 'task', now });
  assert.equal(draft.nowTaskId, null);
  assert.deepEqual(draft.focusLandingPrompt, prompt);
});

for (const taskId of ['missing-linked-task', null]) test(`EXEC001 handoff exists for ${taskId || 'genuine free focus'}`, () => {
  const draft = { focusLandingPrompt: null };
  recordCompletionHandoff(draft, { sessionId: 'original', taskId, completed: true, kind: 'focus', endedAt: now },
    { landingTaskAvailable: false });
  assert.deepEqual(draft.focusLandingPrompt, { sessionId: 'original', taskId, completedAt: now, status: 'pending' });
});

test('all genuine free sessions share one daily unit while linked missing tasks keep separate units', () => {
  const draft = state();
  const awards = [null, null, 'missing-a', 'missing-b', 'missing-c'].map((taskId, i) =>
    applyDomainReward(draft, { eventId: `free-${i}`, source: 'focus-confirmed', amount: 10, at: now,
      metadata: { taskId } }).awardedReward);
  assert.deepEqual(awards, [30, 0, 10, 10, 0]);
});

test('close-only cannot take first advance; rollback cannot replenish closing or advance units', () => {
  const draft = state();
  const close = applyDomainReward(draft, { eventId: 'close-today', source: 'rest-choice', amount: 10, at: now });
  assert.equal(close.awardedReward, 10);
  assert.equal(close.firstAdvance, false);
  const rollback = now - 86400000;
  assert.equal(applyDomainReward(draft, { eventId: 'close-backward', source: 'healthy-shutdown', amount: 10,
    at: rollback }).awardedReward, 0);
  const stepResult = recordStepCompletion(draft, ...step('task', 'step'), { now: rollback });
  assert.equal(stepResult.reward.awardedReward, 30);
  assert.equal(stepResult.reward.firstAdvance, true);
  assert.equal(stepResult.reward.event.dateKey, close.event.dateKey);
});

test('every recorded completed task counts even when the three daily units are exhausted', () => {
  const draft = state();
  for (let i = 0; i < 4; i += 1) recordTaskCompletion(draft, { id: `task-${i}`, done: true }, { now });
  assert.equal(draft.stats.totalTasksDone, 4);
  assert.equal(Object.values(draft.stats.dailyCompletions)[0], 4);
  assert.equal(draft.rewardLedger.events.filter(event => event.source === 'task-complete').length, 4);
  assert.equal(draft.rewardLedger.events.filter(event => event.source === 'task-complete').every(event => event.awardedReward === 0), true);
});

test('a different real step on the next day earns a new daily unit with lifetime source identities retained', () => {
  const draft = state();
  assert.equal(recordStepCompletion(draft, ...step('task', 'one'), { now }).reward.awardedReward, 30);
  assert.equal(recordStepCompletion(draft, ...step('task', 'two'), { now: now + 86400000 }).reward.awardedReward, 30);
  assert.equal(recordStepCompletion(draft, ...step('task', 'one'), { now: now + 86400000 }).reward.recorded, false);
});

test('timer, click, routine and AI source facts never become progress claims', () => {
  const draft = state();
  for (const source of ['focus-complete', 'quick-start-complete', 'break-complete', 'pet-interaction', 'pet-feed', 'routine-complete', 'ai-complete']) {
    const reward = applyDomainReward(draft, { eventId: source, source, amount: 100, at: now });
    assert.equal(reward.recorded, true, source);
    assert.equal(reward.awardedReward, 0, source);
    assert.equal(reward.firstAdvance, false, source);
  }
  assert.equal(draft.xp, 0);
});

test('source date stays original for zero-XP accounting even after future growth', () => {
  const draft = state();
  recordStepCompletion(draft, ...step('task', 'one'), { now });
  const earlier = new Date(2026, 9, 6, 12).getTime();
  const result = applyDomainReward(draft, { eventId: 'past-session', source: 'focus-complete', amount: 0, at: earlier,
    dateKey: '2026-10-06' });
  assert.equal(result.event.dateKey, '2026-10-06');
});

test('level costs cross boundaries at 30 times level with 450 plateau and safe overflow rejection', () => {
  const { applyXp } = require('../src/capabilities/progress/domain/progress-state');
  for (const level of [1, 3, 5, 7, 14, 15, 999999]) {
    const draft = { level, xp: Math.min(30 * level, 450) - 1 };
    assert.deepEqual(applyXp(draft, 1), { leveledUp: true, level: level + 1, xp: 0 });
  }
  const draft = { level: 1, xp: Number.MAX_SAFE_INTEGER };
  assert.throws(() => applyXp(draft, 1), /invalid-growth-state/);
  assert.deepEqual(draft, { level: 1, xp: Number.MAX_SAFE_INTEGER });
});

test('reward duplicate and daily totals survive display history trimming and restart normalization', () => {
  const { normalizeRewardLedger } = require('../src/core/reward-ledger');
  const draft = state();
  recordStepCompletion(draft, ...step('task', 'one'), { now });
  // Simulate bounded presentation trimming while preserving durable ledger indexes.
  draft.rewardLedger.events = [];
  draft.rewardLedger = normalizeRewardLedger(draft.rewardLedger);
  assert.equal(recordStepCompletion(draft, ...step('task', 'one'), { now }).reward.recorded, false);
  assert.equal(recordStepCompletion(draft, ...step('task', 'two'), { now }).reward.awardedReward, 0);
  assert.equal(recordStepCompletion(draft, ...step('second-task', 'three'), { now }).reward.awardedReward, 10);
});

test('all session-growth callers declare every path owned by the draft helper', () => {
  const { RECORD_SESSION_GROWTH_WRITES } = require('../src/application/workflows/record-session-growth');
  const callers = [
    require('../src/application/workflows/resolve-focus-landing').RESOLVE_FOCUS_LANDING_WRITES,
    require('../src/application/workflows/resolve-quick-start').RESOLVE_QUICK_START_WRITES,
    require('../src/application/workflows/accept-healthy-shutdown').ACCEPT_HEALTHY_SHUTDOWN_WRITES,
    require('../src/application/workflows/start-break-session').START_BREAK_SESSION_WRITES
  ];
  for (const writes of callers) for (const path of RECORD_SESSION_GROWTH_WRITES) assert.ok(writes.includes(path), path);
});

test('zero-XP facts leave permanent XP and level unchanged even with a high retained XP balance', () => {
  const draft = { ...state(), level: 2, xp: 190 };
  const result = applyDomainReward(draft, { eventId: 'timer-no-growth', source: 'focus-complete', amount: 25, at: now });
  assert.equal(result.awardedReward, 0);
  assert.equal(result.leveledUp, false);
  assert.equal(draft.level, 2);
  assert.equal(draft.xp, 190);
});
