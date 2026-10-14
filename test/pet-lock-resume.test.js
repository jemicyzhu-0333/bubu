'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerProcessLifecycle } = require('../src/bootstrap/process-lifecycle');

test('display changes go through the same resume path', () => {
  let h, sub; const log = [];
  const pl = registerProcessLifecycle({ lifecycle: { register: () => {} }, appHost: { subscribeLifecycle: () => () => {} },
    powerHost: { subscribe: x => { h = x; return () => {}; } }, isSessionRunning: () => false, pauseActiveSessionForInterruption() {},
    setScreenLocked() {}, resumeAfterInterruption() {}, resumePetSurface: r => log.push(r), activatePrimaryWindow() {},
    screenHost: { subscribeDisplayChanges: l => { sub = l; return () => {}; } } });
  pl.startPowerMonitoring(); sub(); assert.deepEqual(log, ['display-change']);
});
test('lock -> unlock -> suspend -> resume drives the unified pet surface resume path', () => {
  let handlers = null; const log = [];
  const pl = registerProcessLifecycle({
    lifecycle: { register: () => {} },
    appHost: { subscribeLifecycle: () => () => {} },
    powerHost: { subscribe: h => { handlers = h; return () => {}; } },
    mealRuntime: { interrupt() {}, suspend() {}, resume() {} },
    isSessionRunning: () => false, pauseActiveSessionForInterruption() {},
    setScreenLocked: v => log.push(['locked', v]),
    resumeAfterInterruption: () => log.push(['resume-session']),
    resumePetSurface: r => log.push(['surface', r]),
    activatePrimaryWindow() {}
  });
  pl.startPowerMonitoring();
  handlers.onLock(); handlers.onUnlock(); handlers.onSuspend(); handlers.onResume();
  assert.deepEqual(log, [['locked', true], ['locked', false], ['surface', 'unlock-screen'], ['resume-session'], ['surface', 'resume']]);
});

test('screen host forwards display changes and disposes its listeners', () => {
  const { createScreenHost } = require('../src/platform/electron/screen-host');
  const { EventEmitter } = require('node:events');
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay() {}, getDisplayNearestPoint() {}, getCursorScreenPoint: () => ({ x: 0, y: 0 }) });
  let host; try { host = createScreenHost({ screen }); } catch { host = createScreenHost({ loadScreen: () => screen }); }
  let n = 0; const off = host.subscribeDisplayChanges(() => n++);
  for (const e of ['display-added', 'display-removed', 'display-metrics-changed']) screen.emit(e);
  off(); screen.emit('display-metrics-changed');
  assert.equal(n, 3);
});
