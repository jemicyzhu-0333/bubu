'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const processPorts = require('node:child_process');
let externalCalls = 0;
const originalLoad = Module._load;
test.mock.method(Module, '_load', function (name, ...args) {
  if (name === 'electron') {
    externalCalls += 1;
    throw new Error('The nudge contract fixture must inject every Electron port');
  }
  return originalLoad.call(this, name, ...args);
});
for (const name of ['exec', 'execFile', 'spawn']) {
  test.mock.method(processPorts, name, () => {
    externalCalls += 1;
    throw new Error(`Uninjected process port: ${name}`);
  });
}
test.after(() => assert.equal(externalCalls, 0, 'no Electron or process port was reached'));

const preferences = require('../src/capabilities/preferences');
const { nudgePolicy } = require('../src/capabilities/attention');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { normalizePersistedState, assertCanonicalPersistedState } = require('../src/platform/persistence/persisted-schema');
const { createNudgeHost, systemPrefersReducedMotion } = require('../src/platform/electron/nudge-host');

function unavailable() { throw new Error('synthetic unavailable OS preference'); }
const themeCases = [
  ['true', { shouldUseReducedMotion: true }, true],
  ['false', { shouldUseReducedMotion: false }, false],
  ['missing', {}, false],
  ['null', null, false],
  ['malformed', { shouldUseReducedMotion: 'true' }, false],
  ['throwing', { get shouldUseReducedMotion() { return unavailable(); } }, false]
];
const preferenceCases = [
  ['true', { getAnimationSettings: () => ({ prefersReducedMotion: true }) }, true],
  ['false', { getAnimationSettings: () => ({ prefersReducedMotion: false }) }, false],
  ['missing method', {}, false],
  ['null', null, false],
  ['malformed result', { getAnimationSettings: () => ({ prefersReducedMotion: 'true' }) }, false],
  ['empty result', { getAnimationSettings: () => undefined }, false],
  ['null result', { getAnimationSettings: () => null }, false],
  ['throwing method', { getAnimationSettings: unavailable }, false],
  ['throwing accessor', { get getAnimationSettings() { return unavailable(); } }, false],
  ['throwing result', { getAnimationSettings: () => ({ get prefersReducedMotion() { return unavailable(); } }) }, false]
];
for (const [themeLabel, theme, themeKnownTrue] of themeCases) {
  for (const [preferenceLabel, systemPreferences, preferencesKnownTrue] of preferenceCases) {
    test(`reduced motion: theme ${themeLabel}, preferences ${preferenceLabel}`, () => {
      const actual = systemPrefersReducedMotion({ theme, preferences: systemPreferences });
      assert.equal(actual, themeKnownTrue || preferencesKnownTrue);
      for (const mode of ['reduced', 'balanced', 'full', 'auto', undefined]) {
        const expected = mode === 'reduced' || (mode !== 'full' && actual);
        assert.equal(nudgePolicy.shouldReduceNudgeMotion(mode, actual), expected, String(mode));
      }
    });
  }
}

// Actual host and adapters, with no native windows, timers, foreground commands,
// notifications, profile or provider. Timer callbacks run only when asked.
function hostFixture({ platform = 'darwin', appName = 'Editor', theme = false, reduced = false } = {}) {
  const timers = new Map(), windows = [], notifications = [];
  let nextId = 1;
  const sensory = { theme, reduced };
  class FakeWindow {
    static getFocusedWindow() { return null; }
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.positions = [];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.send = () => {};
      windows.push(this);
    }
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() { queueMicrotask(() => this.webContents.emit('did-finish-load')); }
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    focus() {}
    close() { this.destroyed = true; this.visible = false; }
    getBounds() { return this.options; }
    setPosition(x, y, animate) { this.positions.push({ x, y, animate }); }
  }
  class FakeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.emit('show'); }
    close() { this.emit('close'); }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  const host = createNudgeHost({
    BrowserWindow: FakeWindow, Notification: FakeNotification, platform,
    nativeTheme: { get shouldUseReducedMotion() { return sensory.theme; } },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: sensory.reduced }) },
    screenHost: { primaryDisplay: () => display, focusedDisplay: () => display },
    shortcutHost: { claim: () => () => {} },
    preloadPath: '/synthetic/preload.js', cornerPagePath: '/synthetic/corner.html',
    fullscreenPagePath: '/synthetic/fullscreen.html', appPath: '/synthetic/app',
    resourcesPath: '/synthetic/resources', isPackaged: false, exists: () => true,
    exec: (_command, _options, callback) => callback(null, `"LSDisplayName"="${appName}"`),
    execFile: (_file, _args, _options, callback) => callback(null, `foreground-v1:${appName}`),
    setTimer: (callback, delay) => { const id = nextId++; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id), random: () => 0
  });
  return { host, timers, windows, notifications, sensory,
    fire(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) { timers.delete(id); timer.callback(); }
      }
    }
  };
}

for (const mode of ['balanced', 'reduced', 'full', 'auto']) {
  test(`actual L3 host honors disagreeing OS probes in ${mode} mode`, async () => {
    const h = hostFixture({ theme: false, reduced: true });
    try {
      const result = await h.host.showLevel({ type: 'rest', level: 3, motionMode: mode });
      assert.equal(result.shown, true);
      assert.equal(h.windows.length, 4);
      assert.equal([...h.timers.values()].some(timer => timer.delay === 3000), mode === 'full');
      h.fire(3000);
      assert.equal(h.windows.filter(window => window.positions.some(position => position.animate)).length,
        mode === 'full' ? 4 : 0);
    } finally { h.host.dispose(); }
    assert.equal(h.timers.size, 0);
  });
}

test('a newly true OS preference prevents queued L3 movement and halts live corners', async () => {
  const h = hostFixture();
  try {
    await h.host.showLevel({ type: 'rest', level: 3, motionMode: 'balanced' });
    assert.equal([...h.timers.values()].some(timer => timer.delay === 3000), true);
    h.sensory.reduced = true;
    assert.equal(h.host.updateSensoryProfile({ motionMode: 'balanced' }), true);
    assert.equal(h.windows.every(window => window.positions.at(-1)?.animate === false), true);
    h.fire(3000);
    assert.equal(h.windows.some(window => window.positions.some(position => position.animate)), false);
  } finally { h.host.dispose(); }
});

function selectedApps(count) {
  return Array.from({ length: count }, (_, index) => `Selected App ${String(index + 1).padStart(3, '0')}`);
}

for (const count of [30, 31, 100]) {
  test(`all ${count} settings whitelist entries survive normalization, IPC and matching`, () => {
    const whitelist = selectedApps(count);
    const original = JSON.stringify(whitelist);
    const settings = preferences.normalizeSettings({ nudgeWhitelist: whitelist });
    assert.deepEqual(settings.nudgeWhitelist, whitelist);
    const decoded = validateIpcPayload('settings:update', { nudgeWhitelist: whitelist });
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.value.nudgeWhitelist, whitelist);
    const request = nudgePolicy.normalizeReminderRequest({ whitelist: decoded.value.nudgeWhitelist });
    assert.deepEqual(request.whitelist, whitelist);
    assert.notEqual(request.whitelist, whitelist);
    const replay = nudgePolicy.cloneReminderRequest(request);
    assert.deepEqual(replay.whitelist, whitelist);
    assert.notEqual(replay.whitelist, request.whitelist);
    for (const platform of ['darwin', 'win32']) {
      assert.equal(nudgePolicy.matchesForegroundWhitelist(whitelist.at(-1), whitelist, platform), true);
      assert.equal(nudgePolicy.matchesForegroundWhitelist(whitelist.at(-1), request.whitelist, platform), true);
    }
    assert.equal(JSON.stringify(whitelist), original);
  });
  for (const platform of ['darwin', 'win32']) {
    test(`real host ${platform} uses whitelist entry ${count} before escalation and sensitivity lookup`, async () => {
      const whitelist = selectedApps(count);
      const h = hostFixture({ platform, appName: whitelist.at(-1) });
      try {
        assert.equal(await h.host.isSensitiveForeground(whitelist), true);
        const result = await h.host.startNudgeSequence({ type: 'rest', maxLevel: 4, whitelist });
        assert.equal(result.shown, true);
        assert.equal(result.limitedToLevel, 1);
        assert.equal(result.reason, 'foreground-whitelist');
        assert.equal(h.windows.length, 0);
        assert.equal(h.notifications.length, 1);
        assert.equal(h.timers.size, 0, 'no escalation survives a whitelist match');
      } finally { h.host.dispose(); }
    });
  }
}

test('whitelist caps stay closed at 100 entries and 100 characters without widening IPC grants', () => {
  const overflow = selectedApps(101);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: overflow }).ok, false);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: ['x'.repeat(101)] }).ok, false);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: ['x'.repeat(100)] }).ok, true);
  assert.deepEqual(preferences.normalizeSettings({ nudgeWhitelist: overflow }).nudgeWhitelist, overflow.slice(0, 100));
  assert.deepEqual(nudgePolicy.sanitizeWhitelist(overflow), overflow.slice(0, 100));
  assert.equal(nudgePolicy.matchesForegroundWhitelist(overflow.at(-1), overflow, 'darwin'), false);
  assert.deepEqual(allowedSurfacesFor('settings:update'), ['popover']);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: [], foreignField: true }).ok, false);
});

test('fresh canonical defaults share Teams vocabulary and Windows aliases stay selection-scoped', () => {
  const fresh = normalizePersistedState({}, { now: Date.parse('2026-10-07T12:00:00Z') });
  assert.deepEqual(preferences.DEFAULT_WHITELIST, nudgePolicy.DEFAULT_WHITELIST);
  assert.equal(Object.isFrozen(preferences.DEFAULT_WHITELIST), true);
  assert.deepEqual(fresh.settings.nudgeWhitelist, nudgePolicy.DEFAULT_WHITELIST);
  assert.equal(fresh.settings.nudgeWhitelist.includes('teams'), true);
  assert.equal(fresh.settings.nudgeWhitelist.includes('microsoft teams'), true);
  for (const selected of ['teams', 'microsoft teams', 'ms-teams']) {
    for (const identity of ['Teams.exe', 'Microsoft Teams', 'ms-teams.exe']) {
      assert.equal(nudgePolicy.matchesForegroundWhitelist(identity, [selected], 'win32'), true);
      assert.equal(nudgePolicy.matchesForegroundWhitelist(identity, ['zoom'], 'win32'), false);
    }
  }
  assert.equal(nudgePolicy.matchesForegroundWhitelist('ms-teams.exe', ['microsoft teams'], 'darwin'), false);
  assert.equal(nudgePolicy.matchesForegroundWhitelist('Microsoft Teams', fresh.settings.nudgeWhitelist, 'darwin'), true);
  assert.equal(nudgePolicy.matchesForegroundWhitelist('ms-teams.exe', fresh.settings.nudgeWhitelist, 'win32'), true);
});

test('canonical18 explicit whitelist bytes, order, casing, duplicates and opt-outs are preserved', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const oldDefaults = [
    'zoom', 'tencent meeting', '腾讯会议', '钉钉会议', 'dingtalk', 'wechat', '飞书', 'lark',
    'obs', 'quicktime', 'screenflow', 'camtasia', 'keynote', 'powerpoint', 'game', 'steam'
  ];
  for (const whitelist of [[], oldDefaults, ['Zoom', 'ZOOM', 'My App', 'Zoom'], selectedApps(100)]) {
    const existing = normalizePersistedState({}, { now });
    existing.settings.nudgeWhitelist = [...whitelist];
    const bytes = JSON.stringify(existing);
    assert.doesNotThrow(() => assertCanonicalPersistedState(existing));
    const normalized = normalizePersistedState(existing, { now });
    assert.equal(JSON.stringify(normalized), bytes);
    assert.deepEqual(preferences.normalizeSettings(existing.settings).nudgeWhitelist, whitelist);
    assert.equal(JSON.stringify(existing), bytes, 'read-side normalization never mutates its input');
  }
});

test('absent and malformed whitelist input retains the existing separate settings and request contracts', () => {
  for (const input of [undefined, null, 1, 'zoom', {}]) {
    assert.deepEqual(preferences.normalizeSettings({ nudgeWhitelist: input }).nudgeWhitelist,
      preferences.DEFAULT_WHITELIST);
    assert.deepEqual(nudgePolicy.sanitizeWhitelist(input), []);
    assert.deepEqual(nudgePolicy.normalizeReminderRequest({ whitelist: input }).whitelist, []);
    assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: input }).ok, false);
  }
  const mixed = [null, ' Zoom ', 1, 'Teams', ''];
  assert.deepEqual(nudgePolicy.sanitizeWhitelist(mixed), [' Zoom ', 'Teams', '']);
  assert.deepEqual(preferences.normalizeSettings({ nudgeWhitelist: mixed }).nudgeWhitelist, ['Zoom', 'Teams']);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: mixed }).ok, false);
  assert.deepEqual(preferences.normalizeSettings({ nudgeWhitelist: [] }).nudgeWhitelist, []);
  assert.equal(validateIpcPayload('settings:update', { nudgeWhitelist: [] }).ok, true);
  assert.equal(nudgePolicy.matchesForegroundWhitelist('Teams', [], 'win32'), false);
});
