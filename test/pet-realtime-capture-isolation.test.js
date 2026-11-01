'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { installFixtureIsolation, readFixtureIsolation, readFixtureIsolationDiagnostics,
  recordFixtureSuppression } = require('../src/platform/electron/dev/fixture-isolation');
const { createAppHost } = require('../src/platform/electron/app-host');
const { createShortcutHost } = require('../src/platform/electron/shortcuts');
const { createNotificationHost } = require('../src/platform/electron/notifications');
const { createTrayHost } = require('../src/platform/electron/tray');
const { createIpcHost } = require('../src/platform/electron/ipc-host');
const { createPetDevelopment } = require('../src/platform/electron/dev/pet-development');

function appFixture() {
  const app = new EventEmitter(), calls = [];
  const directory = path.join(os.tmpdir(), 'bubu-capture-test-owned', 'profile-dev');
  const paths = { userData: directory, sessionData: directory };
  app.getPath = name => paths[name]; app.setPath = (name, value) => { paths[name] = value; };
  app.commandLine = { hasSwitch: name => name === 'user-data-dir' };
  app.isPackaged = false; app.isReady = () => true; app.whenReady = () => Promise.resolve();
  app.requestSingleInstanceLock = () => true; app.quit = () => {};
  app.getLoginItemSettings = () => { calls.push('read-login'); return { openAtLogin: true }; };
  app.setLoginItemSettings = () => { calls.push('write-login'); };
  return { app, calls, paths, directory };
}
function shortcutFixture() {
  const calls = [];
  const host = createShortcutHost({ globalShortcut: {
    register: () => { calls.push('register'); return true; }, unregisterAll: () => { calls.push('unregisterAll'); },
    unregister: () => { calls.push('unregister'); }, isRegistered: () => false
  } });
  return { calls, host };
}

test('capture isolation absent: existing default OS ports and IPC semantics remain unchanged', () => {
  assert.equal(readFixtureIsolation(), false);
  const f = appFixture(), host = createAppHost({ app: f.app });
  assert.equal(host.openAtLogin(), true); assert.equal(host.setOpenAtLogin(false), true);
  assert.deepEqual(f.calls, ['read-login', 'write-login']);
  const shortcuts = shortcutFixture(); assert.equal(shortcuts.host.registerAll([{ accelerator: 'Alt+Space', handler() {} }]).ok, true);
  const release = shortcuts.host.claim('Control+Q', () => {}); release(); shortcuts.host.dispose();
  assert.deepEqual(shortcuts.calls, ['register', 'register', 'unregister', 'unregisterAll']);
  const handlers = new Map(), ipc = createIpcHost({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) } });
  ipc.handle('tasks:add', (_event, value) => value); assert.equal(handlers.get('tasks:add')({}, 'value'), 'value'); ipc.dispose();
});

test('capture isolation rejects non-owned, packaged, non-development and external-profile installation', () => {
  const f = appFixture(), base = { app: f.app, profilePath: f.directory, assertOwnedProfile: () => true, defaultApp: true, argv: ['electron', '--dev'] };
  for (const patch of [{ defaultApp: false }, { argv: [] }, { profilePath: 'relative' },
    { profilePath: path.join(os.tmpdir(), 'foreign-profile') }, { assertOwnedProfile: () => false },
    { assertOwnedProfile: () => Promise.resolve(true) }, { extra: true }]) {
    assert.throws(() => installFixtureIsolation({ ...base, ...patch }), /fixture-isolation/);
    assert.equal(readFixtureIsolation(), false);
  }
  f.app.isPackaged = true; assert.throws(() => installFixtureIsolation(base), /fixture-isolation/); f.app.isPackaged = false;
  f.paths.sessionData = path.join(os.tmpdir(), 'foreign-session'); assert.throws(() => installFixtureIsolation(base), /fixture-isolation/);
  assert.deepEqual(f.calls, []);
});

test('owned capture suppresses all fixed OS effects and closes non-diagnostic IPC without replacing the real app', async t => {
  const f = appFixture(); let attestations = 0;
  const scope = installFixtureIsolation({ app: f.app, profilePath: f.directory,
    assertOwnedProfile: () => { attestations++; return true; }, defaultApp: true, argv: ['electron', '--dev'] });
  const shortcuts = shortcutFixture(); const appHost = createAppHost({ app: f.app });
  await t.test('login, shortcut and global unregister never reach native OS ports', () => {
    assert.equal(appHost.openAtLogin(), false);
    assert.throws(() => appHost.setOpenAtLogin(true), /fixture-login-write-disabled/);
    const result = shortcuts.host.registerAll([{ accelerator: 'Alt+Space', handler() {} }]);
    assert.deepEqual(result, { ok: true, failed: [], suppressed: true });
    assert.equal(shortcuts.host.claim('Control+Q', () => {}), null);
    assert.equal(shortcuts.host.dispose(), true); assert.equal(shortcuts.host.dispose(), false);
    assert.deepEqual(f.calls, []); assert.deepEqual(shortcuts.calls, []);
  });
  await t.test('notifications settle suppressed receipts without support checks or native construction', () => {
    let calls = 0, receipt;
    class Notification { constructor() { calls++; } static isSupported() { calls++; return true; } }
    const notifications = createNotificationHost({ Notification, isSuppressed: () => false, isSoundEnabled: () => true });
    assert.equal(notifications.show({ title: 'fixture' }, result => { receipt = result; }), null);
    assert.deepEqual(receipt, { shown: false, reason: 'fixture-suppressed' }); notifications.closeAll(); assert.equal(calls, 0);
  });
  await t.test('native tray and hot-reload watcher are not created and cleanup remains idempotent', () => {
    let constructors = 0;
    const tray = createTrayHost({ Tray: class { constructor() { constructors++; } }, Menu: {}, nativeImage: {},
      initialIcon: {}, tooltip: 'fixture', onClick() {}, onRightClick() {} });
    assert.deepEqual(tray.getBounds(), { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(tray.setTitle('fixture'), false); assert.equal(tray.setIcon({}), false); assert.equal(tray.showMenu([]), false);
    assert.equal(tray.dispose(), true); assert.equal(tray.dispose(), false); assert.equal(constructors, 0);
    const development = createPetDevelopment({ profile: 'development', sourceRoot: '/never-watched', getWindow: () => null, showPet() {} });
    const stop = development.start(); stop(); stop();
  });
  await t.test('only seven exact existing diagnostics channels reach their original handlers', () => {
    const handlers = new Map(), dispatched = [];
    const ipc = createIpcHost({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) } });
    const allowed = ['settings:get-interface', 'pet:getState', 'pet:getContent', 'pet:getBounds', 'pet:getFeedState', 'pet:updateRuntime', 'pet:cueAck'];
    const denied = ['ai:credential-import', 'ai:preview-breakdown', 'updates:check', 'activity:copy-plugin-command',
      'settings:update', 'appearance:equip', 'tasks:add', 'pet:feed', 'pet:openPanel', 'pet:setPosition'];
    for (const channel of [...allowed, ...denied]) ipc.handle(channel, (_event, payload) => { dispatched.push(channel); return payload; });
    for (const channel of allowed) assert.equal(handlers.get(channel)({}, 7), 7);
    for (const channel of denied) assert.throws(() => handlers.get(channel)({}, { secret: 'not-exported' }), /fixture-ipc-disabled/);
    assert.deepEqual(dispatched, allowed); ipc.dispose(); assert.equal(handlers.size, 0);
    assert.equal(readFixtureIsolationDiagnostics().suppressed.blockedIPC, denied.length);
  });
  await t.test('fixed audit is bounded and contains no payloads, profile paths or arbitrary event fields', () => {
    const diagnostics = readFixtureIsolationDiagnostics();
    assert.deepEqual(Object.keys(diagnostics), ['schemaVersion', 'installed', 'closed', 'invalidated', 'suppressed']);
    assert.equal(diagnostics.installed, true); assert.equal(diagnostics.suppressed.loginWrite, 1);
    assert.equal(diagnostics.suppressed.notificationShow, 1); assert.equal(diagnostics.suppressed.developmentStart, 1);
    assert(Object.values(diagnostics.suppressed).every(Number.isSafeInteger));
    assert.equal(JSON.stringify(diagnostics).includes(f.directory), false); assert.equal(JSON.stringify(diagnostics).includes('secret'), false);
    assert.throws(() => recordFixtureSuppression('arbitrary payload'), /fixture-effect-unknown/);
    assert.throws(() => installFixtureIsolation({}), /already-installed/); assert(attestations > 10);
  });
  await t.test('closing capture never re-enables OS effects for queued callbacks', () => {
    assert.equal(scope.close(), true); assert.equal(scope.close(), false); assert.equal(readFixtureIsolationDiagnostics().closed, true);
    assert.throws(() => appHost.setOpenAtLogin(false), /fixture-login-write-disabled/); assert.deepEqual(f.calls, []);
  });
  await t.test('profile drift permanently fails closed even if a caller later restores the original path', () => {
    f.paths.userData = path.join(os.tmpdir(), 'foreign-profile');
    assert.throws(() => appHost.setOpenAtLogin(false), /fixture-isolation-scope-mismatch/);
    f.paths.userData = f.directory;
    assert.throws(() => appHost.setOpenAtLogin(false), /fixture-isolation-invalidated/);
    assert.equal(readFixtureIsolationDiagnostics().invalidated, true); assert.deepEqual(f.calls, []);
  });
});
