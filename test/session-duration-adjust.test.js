'use strict';

// 时长是计划，不是承诺：一轮开始之后仍然可以改。这条路径的危险不在“改不了”，
// 而在“改的时候悄悄结算了这一轮”——把时长缩到已投入时长以下，会让一段正在
// 跑的会话立刻变成已到点，从而在用户没有决定的情况下发出完成奖励。
// 所以这里的断言重点是：已投入的时间既不会被退回，也不会被当成完成。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  createIdleSession,
  startFocus,
  startQuickStart,
  startBreak,
  pauseSession,
  adjustSessionDuration,
  elapsedMs,
  remainingMs,
  normalizeFocusSession,
  pauseForOfflineConfirmation
} = require('../src/capabilities/execution').focusSession;
const {
  MIN_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  FOCUS_MINUTE_STEP,
  FOCUS_MINUTE_PRESETS,
  QUICK_START_MINUTES,
  clampFocusMinutes,
  normalizeFocusMinutes,
  isFocusMinutes,
  stepFocusMinutes,
  minimumAdjustableMinutes
} = require('../src/capabilities/execution').sessionDuration;

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-08-31T09:00:00Z');

function runningFocus(minutes = 25, now = T0) {
  const result = startFocus(createIdleSession(now), {
    taskId: 'task-1', minutes, now, sessionId: `focus-${minutes}-${now}`
  });
  assert.equal(result.ok, true);
  return result.session;
}

test('the shared range is one definition that both processes read', () => {
  assert.equal(MIN_FOCUS_MINUTES, 5);
  assert.equal(MAX_FOCUS_MINUTES, 120);
  assert.equal(DEFAULT_FOCUS_MINUTES, 60);
  assert.equal(FOCUS_MINUTE_STEP, 5);
  assert.deepEqual([...FOCUS_MINUTE_PRESETS], [15, 25, 45, 60, 90, 120]);
  // 两分钟救援故意不在这个区间里：它有自己的奖励语义，不能被时长选择器碰到。
  assert.equal(QUICK_START_MINUTES, 2);
  assert.equal(isFocusMinutes(QUICK_START_MINUTES), false);

  // 越界的信号是“夹住”的理由，不是“换一个来源”的理由。
  assert.equal(clampFocusMinutes(1), MIN_FOCUS_MINUTES);
  assert.equal(clampFocusMinutes(999), MAX_FOCUS_MINUTES);
  assert.equal(normalizeFocusMinutes(2, 45), MIN_FOCUS_MINUTES);
  assert.equal(normalizeFocusMinutes(null, undefined, 45), 45);
  assert.equal(normalizeFocusMinutes(), DEFAULT_FOCUS_MINUTES);
  assert.equal(stepFocusMinutes(MAX_FOCUS_MINUTES, 1), MAX_FOCUS_MINUTES);
  assert.equal(stepFocusMinutes(MIN_FOCUS_MINUTES, -1), MIN_FOCUS_MINUTES);
  assert.equal(stepFocusMinutes(60, -1), 55);
});

test('extending a running round keeps every invested minute and only moves the deadline', () => {
  const session = runningFocus(25);
  const now = T0 + 10 * MINUTE;
  const result = adjustSessionDuration(session, { plannedDurationMs: 60 * MINUTE }, { now });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.investedMs, 10 * MINUTE);
  assert.equal(result.session.status, STATUS.FOCUS);
  assert.equal(result.session.sessionId, session.sessionId, 'extending is not a new session');
  assert.equal(result.session.taskId, 'task-1');
  assert.equal(result.session.createdAt, session.createdAt, 'the round still started when it started');
  assert.equal(result.session.plannedDurationMs, 60 * MINUTE);
  assert.equal(elapsedMs(result.session, now), 10 * MINUTE);
  assert.equal(remainingMs(result.session, now), 50 * MINUTE);
  assert.equal(result.session.endsAt, now + 50 * MINUTE);
});

test('shortening is allowed down to — but never onto or below — the invested time', () => {
  const session = runningFocus(60);
  const now = T0 + 20 * MINUTE;

  const shortened = adjustSessionDuration(session, { plannedDurationMs: 25 * MINUTE }, { now });
  assert.equal(shortened.ok, true);
  assert.equal(shortened.session.plannedDurationMs, 25 * MINUTE);
  assert.equal(remainingMs(shortened.session, now), 5 * MINUTE);

  // 缩到已投入时长以下会让这一轮立刻“到点”，系统就会替用户结算一段他没有
  // 决定结束的会话。落在已投入时长上同样被拒绝：想现在停下走显式“结束这段”。
  for (const minutes of [5, 10, 19, 20]) {
    const rejected = adjustSessionDuration(session, { plannedDurationMs: minutes * MINUTE }, { now });
    assert.equal(rejected.ok, false, `${minutes} 分钟应当被拒绝`);
    assert.equal(rejected.reason, 'duration-below-invested');
    assert.equal(rejected.investedMs, 20 * MINUTE);
    assert.equal(rejected.session.plannedDurationMs, 60 * MINUTE, '被拒绝时原会话不能被改动');
  }
  assert.equal(minimumAdjustableMinutes(20 * MINUTE), 20);
  assert.equal(minimumAdjustableMinutes(20 * MINUTE + 1), 21, '不足一分钟也算已经投入');
  assert.equal(minimumAdjustableMinutes(0), MIN_FOCUS_MINUTES);
});

test('a paused round can be re-planned without resuming it', () => {
  const paused = pauseSession(runningFocus(25), T0 + 8 * MINUTE);
  assert.equal(paused.ok, true);
  assert.equal(paused.session.status, STATUS.PAUSED);

  const later = T0 + 30 * MINUTE;
  const result = adjustSessionDuration(paused.session, { plannedDurationMs: 45 * MINUTE }, { now: later });
  assert.equal(result.ok, true);
  assert.equal(result.session.status, STATUS.PAUSED, '改时长不能顺手把会话恢复成进行中');
  assert.equal(result.session.startedAt, null);
  assert.equal(result.session.endsAt, null);
  assert.equal(result.session.pausedAt, paused.session.pausedAt, '暂停时刻不因改时长而前移');
  assert.equal(result.session.elapsedBeforeStartMs, 8 * MINUTE);
  assert.equal(elapsedMs(result.session, later), 8 * MINUTE, '暂停期间不计时');
  assert.equal(remainingMs(result.session, later), 37 * MINUTE);
});

test('only a user-planned focus round is adjustable', () => {
  const now = T0 + MINUTE;
  const cases = [
    ['idle', createIdleSession(T0), 'not-running'],
    ['quick-start', startQuickStart(createIdleSession(T0), {
      taskId: 'task-1', now: T0, sessionId: 'quick-duration-test'
    }).session, 'session-kind-not-adjustable'],
    ['break', startBreak(createIdleSession(T0), {
      taskId: 'task-1', minutes: 5, now: T0, sessionId: 'break-duration-test'
    }).session, 'session-kind-not-adjustable']
  ];
  for (const [label, session, reason] of cases) {
    const result = adjustSessionDuration(session, { plannedDurationMs: 45 * MINUTE }, { now });
    assert.equal(result.ok, false, `${label} 不应可调`);
    assert.equal(result.reason, reason);
  }

  // 离线到点的会话正在等一个明确的“计入完成 / 放弃本轮”。允许改时长会让
  // 这个待确认状态凭空消失，用户永远看不到那个决定。
  const due = pauseForOfflineConfirmation(runningFocus(25), T0 + 25 * MINUTE);
  assert.equal(due.session.awaitingOfflineConfirmation, true);
  const blocked = adjustSessionDuration(due.session, { plannedDurationMs: 45 * MINUTE }, { now: T0 + 30 * MINUTE });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'awaiting-confirmation');
});

test('a no-op adjustment reports success without rewriting the session', () => {
  const session = runningFocus(25);
  const now = T0 + 5 * MINUTE;
  const result = adjustSessionDuration(session, { plannedDurationMs: 25 * MINUTE }, { now });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.session.startedAt, session.startedAt, 'startedAt 不能因为一次无变化的调整而重置');
  assert.equal(result.session.endsAt, session.endsAt);

  for (const bad of [0, -1, null, 'forty', Number.NaN, Number.POSITIVE_INFINITY]) {
    const rejected = adjustSessionDuration(session, { plannedDurationMs: bad }, { now });
    assert.equal(rejected.ok, false, `${String(bad)} 不是合法时长`);
    assert.equal(rejected.reason, 'invalid-duration');
  }
});

test('repeated adjustments accumulate active history instead of losing it', () => {
  let session = runningFocus(25);
  let now = T0;

  for (const [minutesLater, plannedMinutes] of [[5, 45], [15, 60], [30, 90]]) {
    now = T0 + minutesLater * MINUTE;
    const result = adjustSessionDuration(session, { plannedDurationMs: plannedMinutes * MINUTE }, { now });
    assert.equal(result.ok, true);
    assert.equal(elapsedMs(result.session, now), minutesLater * MINUTE, '每次调整后已投入时长都必须守恒');
    session = result.session;
  }

  // 归一化是启动时的严格校验路径。改过时长的会话必须能原样通过它，否则
  // 下次启动会被判为脏数据而整段丢弃。
  const reloaded = normalizeFocusSession(JSON.parse(JSON.stringify(session)), { now });
  assert.deepEqual(reloaded, session);
  assert.equal(reloaded.plannedDurationMs, 90 * MINUTE);
  assert.equal(elapsedMs(reloaded, now), 30 * MINUTE);

  const closedMs = reloaded.activeSegments.reduce((total, s) => total + (s.endedAt - s.startedAt), 0);
  assert.equal(closedMs, 30 * MINUTE, '三段已关闭的活动时间加起来就是已投入的 30 分钟');
});
