'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppHost } = require('../src/platform/electron');

function createAppHarness() {
  const app = new EventEmitter();
  const calls = [];
  const paths = { userData: '/profiles/default', sessionData: '/sessions/default' };
  let openAtLogin = false;
  app.getPath = name => paths[name];
  app.setPath = (name, value) => { calls.push(['set-path', name, value]); paths[name] = value; };
  app.requestSingleInstanceLock = () => { calls.push(['lock']); return true; };
  app.quit = () => { calls.push(['quit']); return 'quitting'; };
  app.isReady = () => true;
  app.whenReady = () => Promise.resolve('ready');
  app.isPackaged = true;
  app.dock = { hide: () => calls.push(['hide-dock']) };
  app.getLoginItemSettings = () => ({ openAtLogin });
  app.setLoginItemSettings = options => {
    calls.push(['login-item', options]);
    openAtLogin = options.openAtLogin;
  };
  return { app, calls, paths };
}

test('new branding reuses userData and sessionData before locking without changing custom profiles', () => {
  const path = require('node:path');
  const harness = createAppHarness();
  harness.app.setPath('userData', path.resolve('/profiles/im-adhder'));
  const names = [];
  harness.app.setName = name => names.push(name);
  const host = createAppHost({ app: harness.app });
  assert.equal(host.userDataPath(), path.resolve('/profiles/focuspix'));
  assert.equal(harness.app.getPath('sessionData'), host.userDataPath());
  assert.deepEqual(names, ['focuspix']);
});

test('app host keeps profile selection and process controls behind a narrow API', async () => {
  const harness = createAppHarness();
  const host = createAppHost({ app: harness.app });

  assert.equal(host.userDataPath(), '/profiles/default');
  assert.equal(host.setDataDirectory('/profiles/dev'), '/profiles/dev');
  assert.deepEqual(harness.paths, { userData: '/profiles/dev', sessionData: '/profiles/dev' });
  assert.equal(host.acquireSingleInstanceLock(), true);
  assert.equal(host.isPackaged(), true);
  assert.equal(host.isReady(), true);
  assert.equal(await host.whenReady(), 'ready');
  assert.equal(host.hideDock(), true);
  assert.equal(host.openAtLogin(), false);
  assert.equal(host.setOpenAtLogin(true), true);
  assert.equal(host.openAtLogin(), true);
  assert.equal(host.quit(), 'quitting');
  assert.equal(Object.prototype.hasOwnProperty.call(host, 'app'), false);
});

test('app lifecycle subscription is closed, replaceable and removable', () => {
  const harness = createAppHarness();
  const host = createAppHost({ app: harness.app });
  const calls = [];
  const options = label => ({
    keepAliveWithoutWindows: true,
    onSecondInstance: () => calls.push(`${label}:second`),
    onBeforeQuit: () => calls.push(`${label}:before`),
    onWillQuit: () => calls.push(`${label}:will`)
  });
  const disposeFirst = host.subscribeLifecycle(options('old'));
  const disposeSecond = host.subscribeLifecycle(options('new'));

  harness.app.emit('second-instance');
  harness.app.emit('before-quit');
  harness.app.emit('will-quit');
  const closeEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  harness.app.emit('window-all-closed', closeEvent);
  assert.deepEqual(calls, ['new:second', 'new:before', 'new:will']);
  assert.equal(closeEvent.prevented, true);
  assert.equal(disposeFirst(), false);
  assert.equal(disposeSecond(), true);
  for (const eventName of ['second-instance', 'before-quit', 'will-quit', 'window-all-closed']) {
    assert.equal(harness.app.listenerCount(eventName), 0);
  }
});

test('app host validates lifecycle and login settings before side effects', () => {
  const harness = createAppHarness();
  const host = createAppHost({ app: harness.app });
  assert.throws(() => host.subscribeLifecycle({}), /complete and closed/);
  assert.throws(() => host.setOpenAtLogin('yes'), /boolean/);
  assert.throws(() => host.setDataDirectory(''), /non-empty path/);
  assert.equal(harness.calls.length, 0);
});

test('app host supports platforms without a dock and rejects incomplete apps', () => {
  const harness = createAppHarness();
  delete harness.app.dock;
  assert.equal(createAppHost({ app: harness.app }).hideDock(), false);
  assert.throws(() => createAppHost({ app: { on() {}, off() {} } }), /required process capability/);
});

test('menu-bar activation policy is applied only when macOS is ready', () => {
  const harness=createAppHarness();const policy=[];let ready=false;
  harness.app.isReady=()=>ready;
  harness.app.setActivationPolicy=value=>policy.push(value);
  const host=createAppHost({app:harness.app});
  host.hideDock();assert.deepEqual(policy,[]);
  ready=true;harness.app.emit('ready');assert.deepEqual(policy,['accessory']);
  assert.equal(harness.app.listenerCount('ready'),0);
});
