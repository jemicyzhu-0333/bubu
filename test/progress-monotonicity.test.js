'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../src/capabilities/progress');
const { STATUS } = require('../src/capabilities/execution').focusSession;
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { applyProgressDay, monotonicRewardDay } = progress.progressState;

// 进度标记以“天”为身份：连胜日、奖励结算日和回归计数都靠它去重。时钟一旦回拨到已经结算
// 过的那天，同一天就会被结算第二次，于是连胜凭空续上、奖励重复发放。这三条规则先前只由
// src/core/state-transitions.js 的测试覆盖，而那个模块是放错层的工作流、已在 0.4.0 删除——
// 规则本身仍然活着，所以覆盖跟到规则的所有者。
//
// 时间统一用本地时刻构造：判据本身按本地日切分，写 UTC 字面量会让断言在某些时区偏移下失真。

function baseState() {
  return normalizePersistedState({}, { now: 0 });
}

test('the last-progress day stays monotonic across a clock rollback', () => {
  const state = baseState();
  state.lastCompletedDate = '2026-08-29';

  assert.equal(applyProgressDay(state, new Date(2026, 7, 28, 12).getTime()), false);
  assert.equal(state.lastCompletedDate, '2026-08-29');
  assert.equal(applyProgressDay(state, new Date(2026, 7, 29, 12).getTime()), false);
  assert.equal(applyProgressDay(state, new Date(2026, 7, 30, 12).getTime()), true);
  assert.equal(state.lastCompletedDate, '2026-08-30');
  // 没有连续天数：跳过几天再回来，只是 lastCompletedDate 往前走，没有什么被“打断”。
  assert.equal(applyProgressDay(state, new Date(2026, 8, 20, 12).getTime()), true);
  assert.equal('streak' in state, false);
});

// The reward business day is the shared identity input for task and step
// rewards, so it must never follow a backwards clock into a day that has
// already been settled. The transactions that consume it live in
// `test/work-transactions.test.js`.
test('the reward business day cannot move backward with the clock', () => {
  const day29 = new Date(2026, 7, 29, 12).getTime();
  const day28 = new Date(2026, 7, 28, 12).getTime();

  const state = baseState();
  state.lastResetDate = '2026-08-29';
  assert.equal(monotonicRewardDay(state, day28), '2026-08-29');
  assert.equal(monotonicRewardDay(state, day29), '2026-08-29');

  const completedLater = baseState();
  completedLater.lastCompletedDate = '2026-08-30';
  assert.equal(monotonicRewardDay(completedLater, day29), '2026-08-30');
});

// 回归计数与幂等身份必须同时落账。resume-focus-session 和 resolve-quick-start 两个工作流的
// 测试只断言了首次记账的计数，重放路径没有覆盖：计数若不跟着奖励台账的去重结果走，同一个
// checkpoint 每重连一次就多记一次回归。kind 取执行能力的 STATUS 而不是字面量，因为这里校验
// 的正是两套词表必须对得上——execution 改名而 progress 的 RETURN_KINDS 没跟着改的话，每一次
// 真实回归都会静默地记不上。
test('an execution return records its daily counter exactly once per checkpoint', () => {
  const state = baseState();
  const at = new Date(2026, 7, 29, 12).getTime();
  const identity = { sessionId: 'session-1', checkpoint: 'resume-1', kind: STATUS.FOCUS, at };

  assert.equal(progress.executionActivity.recordExecutionReturn(state, identity).recorded, true);
  assert.equal(state.stats.dailyReturns['2026-08-29'], 1);

  assert.equal(progress.executionActivity.recordExecutionReturn(state, identity).recorded, false);
  assert.equal(state.stats.dailyReturns['2026-08-29'], 1);
});
