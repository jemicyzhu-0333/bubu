'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  createIdleSession,
  normalizeFocusSession,
  sessionKind,
  isActiveFocusSession,
  isTimingSession,
  elapsedMs,
  remainingMs,
  startFocus,
  startQuickStart,
  startBreak,
  pauseSession,
  resumeSession,
  stopSession,
  completeIfDue,
  recoverSession,
  settleForHealthyShutdown,
  pauseForOfflineConfirmation
} = require('../src/capabilities/execution').focusSession;

test('quick-start is a distinct two-minute session and duplicate starts are rejected', () => {
  const initial = createIdleSession(0);
  const started = startQuickStart(initial, { now: 1000, taskId: 'task-1', sessionId: 'quick-1' });
  assert.equal(started.ok, true);
  assert.equal(started.session.status, STATUS.QUICK_START);
  assert.equal(started.session.plannedDurationMs, 2 * 60 * 1000);

  const duplicate = startQuickStart(started.session, { now: 2000, taskId: 'task-1' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, 'already-running');

  const cannotOverrideDuration = startQuickStart(createIdleSession(0), {
    now: 3000, durationMs: 99 * 60 * 1000, sessionId: 'quick-fixed'
  });
  assert.equal(cannotOverrideDuration.session.plannedDurationMs, 2 * 60 * 1000);
});

test('normalizing a persisted idle session is stable across wall-clock time', () => {
  const persisted = createIdleSession(1_234);
  assert.deepEqual(normalizeFocusSession(persisted, { now: 9_999 }), persisted);
});

test('clock rollback never truncates immutable paused-session history', () => {
  const active = startFocus(createIdleSession(0), {
    now: 10_000, durationMs: 60_000, sessionId: 'rollback-history'
  }).session;
  const persisted = pauseSession(active, 11_000).session;
  const restoredDuringRollback = normalizeFocusSession(persisted, { now: 10_500 });

  assert.deepEqual(restoredDuringRollback, persisted);
  assert.deepEqual(restoredDuringRollback.activeSegments, [
    { startedAt: 10_000, endedAt: 11_000 }
  ]);

  const stoppedDuringRollback = stopSession(restoredDuringRollback, 10_500);
  assert.equal(stoppedDuringRollback.completion.elapsedMs, 1_000);
  assert.deepEqual(stoppedDuringRollback.completion.activeSegments, [
    { startedAt: 10_000, endedAt: 11_000 }
  ]);
});

test('elapsed time is capped at the planned duration after sleep or a late stop', () => {
  const started = startFocus(createIdleSession(0), {
    now: 10_000,
    durationMs: 25 * 60 * 1000,
    sessionId: 'focus-1'
  }).session;
  const eightHoursLater = 10_000 + 8 * 60 * 60 * 1000;
  assert.equal(elapsedMs(started, eightHoursLater), 25 * 60 * 1000);
  const stopped = stopSession(started, eightHoursLater);
  assert.equal(stopped.completion.elapsedMs, 25 * 60 * 1000);
});

test('pause and resume preserve elapsed time and remaining duration', () => {
  const started = startFocus(createIdleSession(0), {
    now: 1000,
    durationMs: 10 * 60 * 1000,
    sessionId: 'focus-2'
  }).session;
  const paused = pauseSession(started, 121_000);
  assert.equal(paused.session.status, STATUS.PAUSED);
  assert.equal(paused.session.elapsedBeforeStartMs, 120_000);
  assert.deepEqual(paused.session.activeSegments, [{ startedAt: 1000, endedAt: 121_000 }]);

  const resumed = resumeSession(paused.session, 500_000);
  assert.equal(resumed.session.status, STATUS.FOCUS);
  assert.equal(remainingMs(resumed.session, 500_000), 8 * 60 * 1000);
  assert.equal(resumed.session.endsAt, 500_000 + 8 * 60 * 1000);
});

test('completion records only active segments across a long pause', () => {
  const started = startFocus(createIdleSession(0), {
    now: 1_000,
    durationMs: 10 * 60 * 1000,
    sessionId: 'segmented-focus'
  }).session;
  const paused = pauseSession(started, 121_000).session;
  const resumed = resumeSession(paused, 24 * 60 * 60 * 1000 + 1_000).session;
  const stopped = stopSession(resumed, 24 * 60 * 60 * 1000 + 181_000);

  assert.equal(stopped.completion.elapsedMs, 5 * 60 * 1000);
  assert.deepEqual(stopped.completion.activeSegments, [
    { startedAt: 1_000, endedAt: 121_000 },
    { startedAt: 24 * 60 * 60 * 1000 + 1_000, endedAt: 24 * 60 * 60 * 1000 + 181_000 }
  ]);
});

test('pause at the deadline surfaces completion instead of persisting a zero-time pause', () => {
  const started = startQuickStart(createIdleSession(0), {
    now: 1_000,
    taskId: 'task-quick',
    sessionId: 'quick-at-deadline'
  }).session;
  const paused = pauseSession(started, 121_000);

  assert.equal(paused.ok, true);
  assert.equal(paused.session.status, STATUS.IDLE);
  assert.equal(paused.completion.kind, STATUS.QUICK_START);
  assert.equal(paused.completion.completed, true);
  assert.equal(paused.completion.elapsedMs, 120_000);
});

test('resume and stop reject idle state while stopping a pause preserves active time', () => {
  assert.equal(resumeSession(createIdleSession(0), 1_000).reason, 'not-paused');
  assert.equal(stopSession(createIdleSession(0), 1_000).reason, 'not-running');

  const started = startFocus(createIdleSession(0), {
    now: 1_000, durationMs: 10 * 60 * 1000, sessionId: 'paused-stop'
  }).session;
  const paused = pauseSession(started, 61_000).session;
  const stopped = stopSession(paused, 500_000);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.completion.elapsedMs, 60_000);
  assert.equal(stopped.completion.completed, false);

  const due = startFocus(createIdleSession(0), {
    now: 1_000, durationMs: 60_000, sessionId: 'stop-at-deadline'
  }).session;
  const settled = stopSession(due, 61_000);
  assert.equal(settled.completion.completed, true);
  assert.equal(settled.completion.reason, 'completed');
});

test('recovery resumes a live persisted session and completes an expired one', () => {
  const session = startFocus(createIdleSession(0), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'persisted-focus'
  }).session;
  const serialized = JSON.parse(JSON.stringify(session));

  const liveRecovery = recoverSession(serialized, { now: 30_000 });
  assert.equal(liveRecovery.action, 'resume');
  assert.equal(remainingMs(liveRecovery.session, 30_000), 31_000);

  const expiredRecovery = recoverSession(serialized, { now: 500_000 });
  assert.equal(expiredRecovery.action, 'completed');
  assert.equal(expiredRecovery.session.status, STATUS.IDLE);
  assert.equal(expiredRecovery.completion.elapsedMs, 60_000);
  assert.equal(expiredRecovery.completion.completed, true);
  assert.deepEqual(expiredRecovery.completion.activeSegments, [{ startedAt: 1_000, endedAt: 61_000 }]);
});

test('completeIfDue does not complete early', () => {
  const session = startFocus(createIdleSession(0), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'not-due'
  }).session;
  assert.equal(completeIfDue(session, 60_000).completed, false);
  assert.equal(completeIfDue(session, 61_000).completed, true);
});

test('starting after an expired persisted session surfaces its completion', () => {
  const expired = startFocus(createIdleSession(0), {
    now: 1_000, durationMs: 60_000, sessionId: 'expired-before-restart'
  }).session;
  const next = startFocus(expired, {
    now: 100_000, durationMs: 60_000, sessionId: 'new-session'
  });
  assert.equal(next.ok, true);
  assert.equal(next.recoveredCompletion.sessionId, 'expired-before-restart');
  assert.equal(next.recoveredCompletion.completed, true);
  assert.equal(next.session.sessionId, 'new-session');
});

test('healthy shutdown never leaves an active break and preserves resumable focus', () => {
  const focus = startFocus(createIdleSession(0), {
    now: 1_000, durationMs: 60_000, sessionId: 'shutdown-focus'
  }).session;
  const paused = settleForHealthyShutdown(focus, 31_000);
  assert.equal(paused.action, 'paused-focus');
  assert.equal(paused.session.status, STATUS.PAUSED);
  assert.equal(paused.session.pausedFrom, STATUS.FOCUS);
  assert.equal(paused.completion, undefined);

  const due = settleForHealthyShutdown(focus, 61_000);
  assert.equal(due.action, 'settled-completion');
  assert.equal(due.session.status, STATUS.IDLE);
  assert.equal(due.completion.completed, true);

  const activeBreak = startBreak(createIdleSession(0), {
    now: 1_000, durationMs: 60_000, sessionId: 'shutdown-break'
  }).session;
  const stoppedBreak = settleForHealthyShutdown(activeBreak, 20_000);
  assert.equal(stoppedBreak.action, 'stopped-break');
  assert.equal(stoppedBreak.session.status, STATUS.IDLE);

  const pausedBreak = pauseSession(activeBreak, 20_000).session;
  assert.equal(settleForHealthyShutdown(pausedBreak, 30_000).session.status, STATUS.IDLE);
  assert.equal(settleForHealthyShutdown(paused.session, 40_000).action, 'kept-paused');
  assert.equal(settleForHealthyShutdown(createIdleSession(0), 40_000).action, 'idle');
});

test('quitting at the deadline preserves a full paused session for explicit confirmation', () => {
  const active = startFocus(createIdleSession(0), {
    now: 1_000, durationMs: 60_000, sessionId: 'quit-at-deadline'
  }).session;
  const held = pauseForOfflineConfirmation(active, 61_000);
  assert.equal(held.ok, true);
  assert.equal(held.due, true);
  assert.equal(held.session.status, STATUS.PAUSED);
  assert.equal(held.session.pausedFrom, STATUS.FOCUS);
  assert.equal(held.session.elapsedBeforeStartMs, 60_000);
  assert.equal(held.session.awaitingOfflineConfirmation, true);
  assert.equal(held.session.recoveryReason, 'offline-session-due');
  const blockedStart = startFocus(held.session, {
    now: 65_000, durationMs: 60_000, sessionId: 'must-not-start'
  });
  assert.equal(blockedStart.ok, false);
  assert.equal(blockedStart.reason, 'awaiting-confirmation');
  assert.equal(blockedStart.session.sessionId, 'quit-at-deadline');
  assert.equal(resumeSession(held.session, 70_000).completion.completed, true);

  const early = pauseForOfflineConfirmation(active, 31_000);
  assert.equal(early.due, undefined);
  assert.equal(early.session.status, STATUS.PAUSED);
  assert.equal(early.session.elapsedBeforeStartMs, 30_000);
  assert.equal(early.session.awaitingOfflineConfirmation, false);
  assert.equal(early.session.recoveryReason, null);
});

test('normalization upgrades legacy full pauses into explicit offline confirmation', () => {
  const restored = normalizeFocusSession({
    status: STATUS.PAUSED,
    pausedFrom: STATUS.FOCUS,
    sessionId: 'legacy-held',
    taskId: 'task-1',
    plannedDurationMs: 60_000,
    elapsedBeforeStartMs: 60_000,
    activeSegments: [{ startedAt: 1_000, endedAt: 61_000 }],
    pausedAt: 70_000,
    createdAt: 1_000,
    updatedAt: 70_000
  }, { now: 80_000 });

  assert.equal(restored.awaitingOfflineConfirmation, true);
  assert.equal(restored.recoveryReason, 'offline-session-due');
  assert.equal(startBreak(restored, { now: 80_000, durationMs: 60_000 }).reason, 'awaiting-confirmation');
  const abandoned = stopSession(restored, 80_000);
  assert.equal(abandoned.completion.completed, false);
  assert.equal(abandoned.completion.reason, 'stopped');
});

test('the three session questions differ exactly where pausing is involved', () => {
  const idle = createIdleSession(0);
  const started = kind => kind(idle, { now: 1_000, durationMs: 60_000, taskId: 'task-1', sessionId: 's' }).session;
  const paused = session => pauseSession(session, 2_000).session;
  const focus = started(startFocus);
  const brk = started(startBreak);

  // A caller asking any of these three questions gets a different answer, and the
  // gaps are the whole reason they are separate: `sessionKind` sees through PAUSED
  // to the round it interrupted, `isActiveFocusSession` is "focus time is on the
  // clock right now", `isTimingSession` is "there is a round to stop at all".
  const answers = session => [sessionKind(session), isActiveFocusSession(session), isTimingSession(session)];
  assert.deepEqual(answers(idle), [STATUS.IDLE, false, false]);
  assert.deepEqual(answers(focus), [STATUS.FOCUS, true, true]);
  assert.deepEqual(answers(started(startQuickStart)), [STATUS.QUICK_START, true, true]);
  assert.deepEqual(answers(brk), [STATUS.BREAK, false, true]);
  // Paused rounds are where a merged predicate would quietly give the wrong answer:
  // a held focus round is still focus-kind but is no longer spending focus time,
  // and a held break must not read as a startable slot either.
  assert.deepEqual(answers(paused(focus)), [STATUS.FOCUS, false, true]);
  assert.deepEqual(answers(paused(brk)), [STATUS.BREAK, false, true]);
  assert.deepEqual(answers(null), [null, false, false]);
});
