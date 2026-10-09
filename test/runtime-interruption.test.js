'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUnitOfWork } = require('../src/application');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');
const { registerProcessLifecycle } = require('../src/bootstrap/process-lifecycle');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { createAppHost, createPowerHost } = require('../src/platform/electron');
const {
  createIdleSession,
  startFocus
} = execution.focusSession;

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push('commit');
      state = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function runningState() {
  const state = normalizePersistedState({}, { now: 1_000 });
  state.focusSession = startFocus(createIdleSession(1_000), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'interrupt-focus',
    taskId: 'task-1'
  }).session;
  return state;
}

function createInterruptionCommand(repository, at, overrides = {}) {
  return execution.pauseForInterruption.createPauseForInterruptionCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => at },
    sessionClock: { now: () => at },
    ...overrides
  });
}

function runInterruption(at, { publish = true } = {}) {
  const events = [];
  const repository = createRepository(runningState(), events);
  const result = createInterruptionCommand(repository, at, {
    synchronize: () => events.push('synchronize'),
    clearNudge: () => events.push('clear-nudge'),
    clearTray: () => events.push('clear-tray'),
    present: () => events.push('present-idle'),
    publish: () => events.push('publish')
  }).execute({ publish });
  return { result, persisted: repository.inspect(), events };
}

test('an interruption before the deadline commits a paused session before effects', () => {
  const { result, persisted, events } = runInterruption(31_000);

  assert.equal(result.ok, true);
  assert.equal(result.due, undefined);
  assert.equal(result.session.status, 'paused');
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'paused');
  assert.equal(persisted.state.focusSession.elapsedBeforeStartMs, 30_000);
  assert.equal(persisted.state.focusSession.awaitingOfflineConfirmation, false);
  assert.deepEqual(events, [
    'commit', 'synchronize', 'clear-nudge', 'clear-tray', 'present-idle', 'publish'
  ]);
  assert.deepEqual(execution.pauseForInterruption.PAUSE_FOR_INTERRUPTION_WRITES, ['focusSession']);
});

test('an interruption at the deadline holds completion for explicit confirmation', () => {
  const { result, persisted, events } = runInterruption(61_000);

  assert.equal(result.ok, true);
  assert.equal(result.due, true);
  assert.equal(result.completion.completed, true);
  assert.equal(result.session.status, 'paused');
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusSession.status, 'paused');
  assert.equal(persisted.state.focusSession.elapsedBeforeStartMs, 60_000);
  assert.equal(persisted.state.focusSession.awaitingOfflineConfirmation, true);
  assert.equal(persisted.state.focusSession.recoveryReason, 'offline-session-due');
  assert.deepEqual(events, [
    'commit', 'synchronize', 'clear-nudge', 'clear-tray', 'present-idle', 'publish'
  ]);
});

test('interruption rejection is zero-write and quit mode only suppresses publication', () => {
  const idleEvents = [];
  const idleState = normalizePersistedState({}, { now: 31_000 });
  const idleRepository = createRepository(idleState, idleEvents);
  const idle = createInterruptionCommand(idleRepository, 31_000, {
    synchronize: () => idleEvents.push('synchronize'),
    clearNudge: () => idleEvents.push('clear-nudge'),
    clearTray: () => idleEvents.push('clear-tray'),
    present: () => idleEvents.push('present-idle'),
    publish: () => idleEvents.push('publish')
  }).execute();

  assert.equal(idle.ok, false);
  assert.equal(idle.reason, 'not-running');
  assert.equal(idle.session.status, 'idle');
  assert.equal(idleRepository.inspect().commits, 0);
  assert.deepEqual(idleRepository.inspect().state, idleState);
  assert.deepEqual(idleEvents, []);

  const quiet = runInterruption(31_000, { publish: false });
  assert.equal(quiet.result.ok, true);
  assert.deepEqual(quiet.events, [
    'commit', 'synchronize', 'clear-nudge', 'clear-tray', 'present-idle'
  ]);
});

test('effect failures cannot turn a committed interruption into a retryable failure', () => {
  const repository = createRepository(runningState());
  const reported = [];
  const fail = label => () => { throw new Error(`${label} unavailable`); };
  const result = createInterruptionCommand(repository, 31_000, {
    synchronize: fail('clock'),
    clearNudge: fail('nudge'),
    clearTray: fail('tray'),
    present: fail('pet'),
    publish: fail('renderer'),
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  }).execute();

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [
    ['clock unavailable', 'session-paused-for-interruption'],
    ['nudge unavailable', 'session-paused-for-interruption'],
    ['tray unavailable', 'session-paused-for-interruption'],
    ['pet unavailable', 'session-paused-for-interruption'],
    ['renderer unavailable', 'session-paused-for-interruption']
  ]);
});

test('suspend and before-quit both use the conservative interruption path', () => {
  const app = new EventEmitter();
  app.getPath = name => `/${name}`;
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => true;
  app.quit = () => {};
  app.isReady = () => true;
  app.whenReady = () => Promise.resolve();
  app.getLoginItemSettings = () => ({ openAtLogin: false });
  app.setLoginItemSettings = () => {};
  const powerMonitor = new EventEmitter();
  const calls = [];
  const lifecycle = createLifecycleRegistry();
  const processLifecycle = registerProcessLifecycle({
    lifecycle,
    appHost: createAppHost({ app }),
    powerHost: createPowerHost({ powerMonitor }),
    isSessionRunning: () => true,
    pauseActiveSessionForInterruption: options => calls.push(['pause', options]),
    setScreenLocked: locked => calls.push(['screen-lock', locked]),
    resumeAfterInterruption: () => calls.push(['resume']),
    activatePrimaryWindow: () => calls.push(['activate'])
  });

  powerMonitor.emit('suspend');
  assert.deepEqual(calls, []);
  processLifecycle.startPowerMonitoring();
  powerMonitor.emit('suspend');
  app.emit('before-quit');
  assert.deepEqual(calls, [
    ['pause', undefined],
    ['pause', { publish: false }]
  ]);

  powerMonitor.emit('lock-screen');
  powerMonitor.emit('unlock-screen');
  powerMonitor.emit('resume');
  app.emit('second-instance');
  const closeEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  app.emit('window-all-closed', closeEvent);
  assert.deepEqual(calls.slice(2), [
    ['screen-lock', true],
    ['screen-lock', false],
    ['resume'],
    ['activate']
  ]);
  assert.equal(closeEvent.prevented, true);

  app.emit('will-quit');
  assert.equal(lifecycle.disposed, true);
  powerMonitor.emit('suspend');
  assert.equal(calls.filter(call => call[0] === 'pause').length, 2);
});
