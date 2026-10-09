'use strict';

// 桌宠脚下的进度环：主进程只给一个锚点（总时长、已过多久、是否在走），桌宠页自己往前推。
// 这里测两头：锚点怎么从会话投影出来，桌宠页拿到锚点后怎么摆弄那圈线。
const test = require('node:test');
const assert = require('node:assert/strict');
const execution = require('../src/capabilities/execution');

const T0 = Date.parse('2026-09-08T09:00:00Z');
const MIN = 60_000;
const { focusSession, sessionProjection } = execution;
const ring = (session, at) => sessionProjection.projectFocusRing(sessionProjection.projectSession(session, at));

function started(minutes = 25) {
  return focusSession.startFocus(focusSession.createIdleSession(T0), {
    now: T0, durationMs: minutes * MIN, taskId: 'task-1', sessionId: 'focus-1'
  }).session;
}

test('no session, no ring', () => {
  assert.equal(ring(focusSession.createIdleSession(T0), T0), null);
  assert.equal(sessionProjection.projectFocusRing(null), null);
  assert.equal(sessionProjection.projectFocusRing({ running: false, paused: false, plannedDurationMs: 60000 }), null);
});

test('a running focus session becomes an anchor the pet page can advance on its own', () => {
  assert.deepEqual(ring(started(25), T0 + 3 * MIN), {
    mode: 'focus', sessionId: 'focus-1', plannedMs: 25 * MIN, elapsedMs: 3 * MIN, running: true
  });
});

test('a paused session keeps its elapsed time and stops advancing', () => {
  const paused = focusSession.pauseSession(started(25), T0 + 4 * MIN).session;
  const anchor = ring(paused, T0 + 10 * MIN);
  assert.equal(anchor.running, false);
  assert.equal(anchor.elapsedMs, 4 * MIN, 'time spent paused does not fill the ring');
  assert.equal(anchor.plannedMs, 25 * MIN);
});

test('a break is a break, and a two-minute start is still a focus ring', () => {
  const rest = focusSession.startBreak(focusSession.createIdleSession(T0), { now: T0, durationMs: 5 * MIN, sessionId: 'break-1' }).session;
  assert.equal(ring(rest, T0 + MIN).mode, 'break');
  const quick = focusSession.startQuickStart(focusSession.createIdleSession(T0), { now: T0, taskId: 'task-1', sessionId: 'quick-1' }).session;
  const anchor = ring(quick, T0 + 30_000);
  assert.equal(anchor.mode, 'focus');
  assert.equal(anchor.plannedMs, 2 * MIN);
});

test('an unconfirmed offline recovery never pretends the ring is still moving', () => {
  const anchor = sessionProjection.projectFocusRing({
    running: false, paused: true, mode: 'focus', sessionId: 's', plannedDurationMs: 25 * MIN, elapsedMs: 5 * MIN,
    awaitingOfflineConfirmation: true
  });
  assert.equal(anchor.running, false);
  const stillRunningFlag = sessionProjection.projectFocusRing({
    running: true, paused: false, mode: 'focus', sessionId: 's', plannedDurationMs: 25 * MIN, elapsedMs: 5 * MIN,
    awaitingOfflineConfirmation: true
  });
  assert.equal(stillRunningFlag.running, false, 'waiting for the person to confirm counts as not moving');
});

test('garbage never produces a ring: zero or negative length, elapsed past the end, non-numbers', () => {
  const base = { running: true, paused: false, mode: 'focus', sessionId: 's' };
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: 0, elapsedMs: 0 }), null);
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: -5, elapsedMs: 0 }), null);
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: 'x', elapsedMs: 0 }), null);
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: 10 * MIN, elapsedMs: 99 * MIN }).elapsedMs, 10 * MIN, 'clamped to a full ring');
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: 10 * MIN, elapsedMs: -3 }).elapsedMs, 0);
  assert.equal(sessionProjection.projectFocusRing({ ...base, plannedDurationMs: 10 * MIN, elapsedMs: NaN }).elapsedMs, 0);
});
