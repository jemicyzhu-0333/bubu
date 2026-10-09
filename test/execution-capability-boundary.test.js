'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const execution = require('../src/capabilities/execution');

test('execution exposes its owned transitions through one frozen public facade', () => {
  assert.deepEqual(Object.keys(execution).sort(), [
    'focusLanding',
    'focusSession',
    'healthyShutdown',
    'ipcRoutes',
    'nowSelection',
    'pauseForInterruption',
    'pauseSession',
    'quickStartDecision',
    'quickStartInput',
    'recoverSession',
    'runtimeClock',
    'sessionDuration',
    'sessionProjection',
    'sessionSettlement',
    'sessionStart',
    'taskCompletion',
    'taskLinkage'
  ]);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(Object.isFrozen(execution.focusLanding), true);
  assert.equal(Object.isFrozen(execution.focusSession), true);
  assert.equal(Object.isFrozen(execution.healthyShutdown), true);
  assert.equal(Object.isFrozen(execution.nowSelection), true);
  assert.equal(Object.isFrozen(execution.pauseForInterruption), true);
  assert.equal(Object.isFrozen(execution.pauseSession), true);
  assert.equal(Object.isFrozen(execution.quickStartDecision), true);
  assert.equal(Object.isFrozen(execution.quickStartInput), true);
  assert.deepEqual(Object.keys(execution.quickStartInput), ['readClarification']);
  assert.equal(Object.isFrozen(execution.recoverSession), true);
  assert.equal(Object.isFrozen(execution.runtimeClock), true);
  assert.equal(Object.isFrozen(execution.sessionStart), true);
  assert.equal(Object.isFrozen(execution.sessionProjection), true);
  assert.equal(Object.isFrozen(execution.sessionSettlement), true);
  assert.equal(Object.isFrozen(execution.sessionDuration), true);
  assert.equal(Object.isFrozen(execution.taskCompletion), true);
  assert.equal(Object.isFrozen(execution.taskLinkage), true);
  // Cross-capability tidy-ups ask execution which work it is still mid-loop on,
  // rather than reaching into the session shapes themselves.
  assert.deepEqual(Object.keys(execution.taskLinkage).sort(), [
    'clearNowTask',
    'pendingHandoffTaskIds',
    'taskExecutionBlockReason'
  ]);
  assert.equal(
    execution.focusSession.settleForHealthyShutdown,
    execution.healthyShutdown.settleForHealthyShutdown
  );
  assert.deepEqual(Object.keys(execution.focusSession).sort(), [
    'STATUS',
    'adjustSessionDuration',
    'completeIfDue',
    'createIdleSession',
    'elapsedMs',
    'isActiveFocusSession',
    'isActiveSession',
    'isPausedSession',
    'isTimingSession',
    'normalizeFocusSession',
    'pauseForOfflineConfirmation',
    'pauseSession',
    'recoverSession',
    'remainingMs',
    'resumeSession',
    'sessionKind',
    'settleForHealthyShutdown',
    'startBreak',
    'startFocus',
    'startQuickStart',
    'startSession',
    'stopSession'
  ]);
});

test('execution domain requires time and identity to cross its boundary explicitly', () => {
  const { createIdleSession, normalizeFocusSession, startFocus } = execution.focusSession;
  assert.throws(() => createIdleSession(), /now must be a finite non-negative timestamp/);
  assert.throws(
    () => normalizeFocusSession(null),
    /options\.now must be a finite non-negative timestamp/
  );

  const idle = createIdleSession(0);
  assert.throws(
    () => startFocus(idle, { now: 1, durationMs: 60_000 }),
    /input\.sessionId or options\.idFactory/
  );
  const started = startFocus(
    idle,
    { now: 1, durationMs: 60_000 },
    { idFactory: () => 'injected-session-id' }
  );
  assert.equal(started.session.sessionId, 'injected-session-id');
});

test('pruned legacy paths stay pruned so execution rules keep one home', () => {
  for (const pruned of [
    '../src/core/focus-session',
    '../src/core/runtime-session-clock',
    '../src/core/session-duration',
    '../src/renderer/session-duration'
  ]) {
    assert.throws(() => require(pruned), /Cannot find module/);
  }
});
