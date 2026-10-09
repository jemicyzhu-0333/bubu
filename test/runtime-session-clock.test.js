'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RuntimeSessionClock,
  latestSessionEvidenceAt,
  safeSessionWallTime
} = require('../src/capabilities/execution').runtimeClock;
const {
  createIdleSession,
  startFocus,
  pauseSession,
  resumeSession,
  completeIfDue,
  remainingMs
} = require('../src/capabilities/execution').focusSession;

function controlledClock(initialWall = 1_000, initialMonotonic = 0) {
  let wall = initialWall;
  let monotonic = initialMonotonic;
  const clock = new RuntimeSessionClock({
    wallNow: () => wall,
    monotonicNow: () => monotonic
  });
  return {
    clock,
    setWall(value) { wall = value; },
    setMonotonic(value) { monotonic = value; }
  };
}

test('runtime clock rollback cannot erase already observed active progress', () => {
  const controlled = controlledClock();
  const active = startFocus(createIdleSession(0), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'runtime-rollback'
  }).session;
  controlled.clock.anchor(active, 1_000);

  controlled.setWall(31_000);
  controlled.setMonotonic(30_000);
  assert.equal(controlled.clock.now(active), 31_000);

  controlled.setWall(21_000);
  controlled.setMonotonic(40_000);
  const transitionAt = controlled.clock.now(active);
  assert.equal(transitionAt, 41_000);

  const paused = pauseSession(active, transitionAt);
  assert.equal(paused.session.elapsedBeforeStartMs, 40_000);
  assert.deepEqual(paused.session.activeSegments, [{ startedAt: 1_000, endedAt: 41_000 }]);
});

test('wall-clock jumps cannot complete an anchored runtime session early', () => {
  const controlled = controlledClock();
  const active = startFocus(createIdleSession(0), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'runtime-forward-jump'
  }).session;
  controlled.clock.anchor(active, 1_000);

  controlled.setWall(10_000_000);
  controlled.setMonotonic(1_000);
  const afterJump = controlled.clock.now(active);
  assert.equal(afterJump, 2_000);
  assert.equal(remainingMs(active, afterJump), 59_000);
  assert.equal(completeIfDue(active, afterJump).completed, false);

  controlled.setMonotonic(60_000);
  assert.equal(completeIfDue(active, controlled.clock.now(active)).completed, true);
});

test('resume re-anchors at or after every persisted session timestamp', () => {
  const active = startFocus(createIdleSession(0), {
    now: 50_000,
    durationMs: 60_000,
    sessionId: 'safe-resume'
  }).session;
  const paused = pauseSession(active, 70_000).session;
  assert.equal(latestSessionEvidenceAt(paused), 70_000);
  assert.equal(safeSessionWallTime(paused, 10_000), 70_000);

  const controlled = controlledClock(10_000, 5_000);
  const resumeAt = controlled.clock.now(paused);
  const resumed = resumeSession(paused, resumeAt).session;
  assert.equal(resumed.startedAt, 70_000);
  assert.equal(controlled.clock.anchor(resumed, 10_000), 70_000);

  controlled.setMonotonic(6_000);
  assert.equal(controlled.clock.now(resumed), 71_000);
});

test('runtime clock output is integral, nondecreasing, and re-anchors changed sessions', () => {
  let monotonic = 0.25;
  const clock = new RuntimeSessionClock({
    wallNow: () => 1_000.25,
    monotonicNow: () => monotonic
  });
  const first = startFocus(createIdleSession(0), {
    now: 1_001,
    durationMs: 60_000,
    sessionId: 'first'
  }).session;
  assert.equal(clock.anchor(first), 1_001);
  monotonic = 1.1;
  assert.equal(clock.now(first), 1_001);
  monotonic = 0.5;
  assert.equal(clock.now(first), 1_001);

  const second = startFocus(createIdleSession(0), {
    now: 2_000,
    durationMs: 60_000,
    sessionId: 'second'
  }).session;
  assert.equal(clock.now(second, 2_000), 2_000);
});
