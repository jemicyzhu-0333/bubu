'use strict';

// Mock Electron integration: validates the actual host/preload/registrar contract,
// not native input, transparent composition, GPU performance or production acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createPetWindowHost } = require('../src/platform/electron/windows/pet-window');
const { createRendererIpcRegistrar } = require('../src/bootstrap/renderer-ipc');
const { assertIpcPayload, allowedSurfacesFor } = require('../src/application/ipc');
const { createPetSurfaceClient } = require('../src/surfaces/pet/adapter/surface-client.mjs');

const ROOT = path.resolve(__dirname, '..');
const RENDERERS = path.join(ROOT, 'src/renderer');
const PRODUCTION_PAGE = path.join(RENDERERS, 'pet.html');
const REALTIME_PAGE = path.join(ROOT, 'src/surfaces/pet/realtime/index.html');
const PRELOAD = path.join(ROOT, 'src/preload-pet.js');
const DEVELOPMENT = Object.freeze({ development: true, defaultApp: true, requested: '1' });

function fixture({ development = true, selection = DEVELOPMENT } = {}) {
  const handlers = new Map(), calls = [], instances = [];
  const renderer = new EventEmitter();
  let senderURL;
  class FakeContents extends EventEmitter {
    constructor() { super(); this.messages = []; }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
    isDestroyed() { return false; }
    isLoading() { return false; }
    getURL() { return senderURL; }
    send(channel, payload) { this.messages.push({ channel, payload }); renderer.emit(channel, {}, payload); }
    reload() { this.reloaded = true; }
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new FakeContents(); this.visible = false;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      instances.push(this);
    }
    loadFile(pagePath) { this.pagePath = pagePath; senderURL = pathToFileURL(pagePath).href; }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    getBounds() { return { ...this.bounds }; }
    setVisibleOnAllWorkspaces(value, options) { this.workspace = [value, options]; }
    setAlwaysOnTop(value, level) { this.topmost = [value, level]; }
    showInactive() { this.visible = true; }
    close() { this.emit('closed'); }
  }
  const register = createRendererIpcRegistrar({ rendererDirectory: RENDERERS,
    ipcHost: { handle: (channel, handler) => handlers.set(channel, handler) },
    petRendererSelection: { ...selection, development }, allowedSurfacesFor, assertIpcPayload,
    readTasks: () => [], getSettings: () => ({ locale: 'zh-CN', theme: 'system' }),
    interfaceHost: { languages: () => ['zh-CN'], apply() {} } });
  for (const channel of ['pet:getState', 'pet:updateRuntime', 'pet:cueAck']) {
    register(channel, (_event, payload) => {
      calls.push({ channel, payload });
      return channel === 'pet:getState' ? { contextRevision: 7, motionMode: 'full' } : { ok: true };
    });
  }
  const host = createPetWindowHost({ BrowserWindow: FakeBrowserWindow, preloadPath: PRELOAD,
    pagePath: PRODUCTION_PAGE, bounds: { x: 30, y: 40, width: 220, height: 220 },
    enableReload: development, rendererSelection: selection, screen: {}, platform: 'linux' });
  renderer.invoke = (channel, payload) => Promise.resolve().then(() => {
    const handler = handlers.get(channel);
    assert.equal(typeof handler, 'function', `unregistered fixture channel ${channel}`);
    return handler({ senderFrame: { url: senderURL }, sender: instances[0].webContents }, payload);
  });
  let bridge;
  vm.runInNewContext(fs.readFileSync(PRELOAD, 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { ipcRenderer: renderer, contextBridge: {
        exposeInMainWorld(name, value) { assert.equal(name, 'bubu'); bridge = value; }
      } };
    }
  }, { filename: PRELOAD });
  return { host, native: instances[0], renderer, bridge, client: createPetSurfaceClient(bridge), calls,
    from(url) { senderURL = url; } };
}

function assertHardened(native) {
  const preferences = native.options.webPreferences;
  assert.equal(preferences.preload, PRELOAD);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webviewTag, false);
  assert.equal(native.options.transparent, true);
  assert.deepEqual(native.webContents.openHandler(), { action: 'deny' });
  for (const type of ['will-navigate', 'will-attach-webview']) {
    let blocked = false;
    native.webContents.emit(type, { preventDefault() { blocked = true; } });
    assert.equal(blocked, true, type);
  }
}

test('realtime IPC: actual development pet host selects only the fixed page and retains hardening', async () => {
  const f = fixture();
  assert.equal(f.native.pagePath, REALTIME_PAGE);
  assertHardened(f.native);
  assert.equal('nativeWindow' in f.host, false);
  assert.equal('webContents' in f.host, false);
  assert.equal('invoke' in f.bridge, false);
  assert.equal('ipcRenderer' in f.bridge, false);
  assert.equal(Object.isFrozen(f.client), true);
  assert.deepEqual(await f.client.pet_getState(), { contextRevision: 7, motionMode: 'full' });
  assert.deepEqual(f.calls, [{ channel: 'pet:getState', payload: undefined }]);
  assert.deepEqual(await f.bridge.getInterfacePreferences(), {
    locale: 'zh-CN', theme: 'system', resolvedLocale: 'zh-CN', revision: 1
  });
});

test('realtime IPC: actual preload and registrar admit only canonical boolean runtime snapshots', async () => {
  const f = fixture();
  for (let bits = 0; bits < 16; bits++) {
    const runtime = { visible: Boolean(bits & 1), menuOpen: Boolean(bits & 2),
      dragging: Boolean(bits & 4), prefersReducedMotion: Boolean(bits & 8) };
    assert.deepEqual(await f.client.pet_updateRuntime(runtime), { ok: true });
    assert.deepEqual(f.calls.at(-1), { channel: 'pet:updateRuntime', payload: runtime });
  }
  const baseline = { visible: true, menuOpen: false, dragging: false, prefersReducedMotion: false };
  const before = f.calls.length;
  for (const field of Object.keys(baseline)) {
    for (const invalid of [0, 1, 'false', null, undefined]) {
      await assert.rejects(f.client.pet_updateRuntime({ ...baseline, [field]: invalid }), /Invalid IPC payload/);
    }
    const missing = { ...baseline }; delete missing[field];
    await assert.rejects(f.client.pet_updateRuntime(missing), /Invalid IPC payload/);
  }
  await assert.rejects(f.client.pet_updateRuntime({ ...baseline, extra: true }), /unknown field/);
  assert.equal(f.calls.length, before, 'invalid payloads must not reach application handlers');
});

test('realtime IPC: cue rejection traverses the real closed codec without undocumented reason', async () => {
  const f = fixture();
  const acknowledgement = { decisionId: 'cue-realtime-1', status: 'rejected' };
  assert.deepEqual(await f.client.pet_ackCue(acknowledgement), { ok: true });
  assert.deepEqual(f.calls.at(-1), { channel: 'pet:cueAck', payload: acknowledgement });
  const before = f.calls.length;
  await assert.rejects(f.client.pet_ackCue({ ...acknowledgement, reason: 'realtime-foundation-only' }), /unknown field: reason/);
  await assert.rejects(f.client.pet_ackCue({ ...acknowledgement, status: 'unsupported' }), /status is invalid/);
  await assert.rejects(f.client.pet_getState({ private: true }).then(() => {
    // The real preload deliberately takes no payload for this query.
    return f.renderer.invoke('pet:getState', { private: true });
  }), /payload must be empty/);
  assert.equal(f.calls.filter(call => call.channel === 'pet:cueAck').length, 1);
  assert.equal(f.calls.length, before + 1, 'only the preload no-payload state query was admitted');
});

test('realtime IPC: dev-selected state denies old pet, sibling, remote and popover sender roles', async () => {
  const f = fixture();
  const invalid = [pathToFileURL(PRODUCTION_PAGE).href,
    pathToFileURL(path.join(path.dirname(REALTIME_PAGE), 'sibling.html')).href,
    pathToFileURL(path.join(RENDERERS, 'popover.html')).href,
    pathToFileURL(path.join(RENDERERS, 'pet.html.backup')).href,
    'https://example.test/src/surfaces/pet/realtime/index.html', 'not a URL'];
  for (const url of invalid) {
    f.from(url);
    await assert.rejects(f.client.pet_getState(), /sender is not allowed/);
    await assert.rejects(f.client.pet_updateRuntime({ visible: true, menuOpen: false,
      dragging: false, prefersReducedMotion: false }), /sender is not allowed/);
    await assert.rejects(f.client.pet_ackCue({ decisionId: 'cue-1', status: 'rejected' }), /sender is not allowed/);
  }
  assert.equal(f.calls.length, 0);
  f.from(pathToFileURL(REALTIME_PAGE).href);
  assert.equal((await f.client.pet_getState()).contextRevision, 7);
});

for (const [name, selection, development] of [
  ['production profile', DEVELOPMENT, false],
  ['packaged app', { ...DEVELOPMENT, defaultApp: false }, true],
  ['missing opt-in', { ...DEVELOPMENT, requested: undefined }, true],
  ['arbitrary requested path', { ...DEVELOPMENT, requested: '/tmp/custom.html' }, true]
]) {
  test(`realtime IPC: ${name} retains production page and denies the development surface`, async () => {
    const f = fixture({ development, selection });
    assert.equal(f.native.pagePath, PRODUCTION_PAGE);
    assertHardened(f.native);
    assert.equal((await f.client.pet_getState()).contextRevision, 7);
    f.from(pathToFileURL(REALTIME_PAGE).href);
    await assert.rejects(f.client.pet_getState(), /sender is not allowed/);
  });
}

test('realtime IPC: actual viewport preload owns one idempotently removable listener per subscription', () => {
  const f = fixture(), first = [], second = [];
  const release = f.client.onPetViewport(value => first.push(value));
  const releaseOther = f.client.onPetViewport(value => second.push(value));
  assert.equal(f.renderer.listenerCount('pet:viewport'), 2);
  const payload = { width: 520, height: 360, stageOffset: { x: -130, y: 70 } };
  f.host.send('pet:viewport', payload);
  assert.deepEqual(first, [payload]); assert.deepEqual(second, [payload]);
  const queuedListener = f.renderer.listeners('pet:viewport')[0];
  release(); release();
  assert.equal(f.renderer.listenerCount('pet:viewport'), 1);
  queuedListener({}, { ...payload, width: 1 });
  f.host.send('pet:viewport', { ...payload, width: 500 });
  assert.equal(first.length, 1, 'a removed or already queued callback stays terminal');
  assert.equal(second.length, 2, 'disposing one subscription must not remove another');
  releaseOther();
  assert.equal(f.renderer.listenerCount('pet:viewport'), 0);
});
