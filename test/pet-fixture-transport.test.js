'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createPetViewport } = require('../src/platform/electron/windows/pet-viewport');
const { createPetInputLease } = require('../src/platform/electron/windows/pet-input-lease');
const { createPresentationViewTracker } = require('../src/core/pet-presentation-view.mjs');
const { FIXTURE_TRANSPORT_SCOPE: scope, isPureFixtureTranslation, readFixtureTranslation } = require('../src/core/pet-fixture-transport.mjs');
const PAGE = '/app/src/surfaces/pet/realtime/index.html', URL = pathToFileURL(PAGE).href;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function harness({ isolated = true, legacy = false, negative = false, small = false } = {}) {
  let now = 0, id = 0, tick, timers = 0, active = isolated;
  let pointerSpace = { schemaVersion: 1, kind: 'client', revision: 1 };
  const area = { x: negative ? -1920 : 0, y: negative ? -100 : 0, width: small ? 550 : 1920, height: 1080 };
  const display = { id: 1, bounds: { ...area }, workArea: area, scaleFactor: 1, rotation: 0 };
  const calls = [], messages = [], errors = [];
  const viewport = createPetViewport({ bounds: { x: area.x + 10, y: area.y + 10, width: 220, height: 220 },
    screen: { getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 99999, y: 99999 }) },
    readPointerSpace: legacy ? null : () => pointerSpace, selectedPage: PAGE, readFixtureActive: () => active,
    now: () => now, newEpoch: () => uuid(++id), interval: fn => { tick = fn; return ++timers; }, cancelInterval() {},
    onDeliveryError: error => errors.push(error) });
  let bounds = { ...viewport.initialBounds };
  const native = new EventEmitter(), contents = new EventEmitter();
  Object.assign(contents, { mainFrame: { url: URL }, loading: false, destroyed: false, url: URL,
    getURL() { return this.url; }, isLoadingMainFrame() { return this.loading; }, isDestroyed() { return this.destroyed; },
    send: (channel, value) => messages.push({ channel, value }) });
  Object.assign(native, { webContents: contents, destroyed: false, visible: true,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
    getBounds: () => ({ ...bounds }), getContentBounds: () => ({ ...bounds, x: bounds.x + 2, y: bounds.y + 4, width: bounds.width - 4, height: bounds.height - 8 }),
    setPosition(x, y) { calls.push(['move', x, y]); bounds = { ...bounds, x, y }; },
    setBounds(value) { calls.push(['bounds', value]); bounds = { ...value }; },
    setIgnoreMouseEvents(value) { calls.push(['ignore', value]); } });
  const port = viewport.attach(native); native.emit('show'); contents.emit('did-finish-load');
  const cap = () => viewport.setMenuOpen(false).inputLease;
  const request = (patch = {}) => ({ schemaVersion: 1, epoch: cap().epoch, viewRevision: cap().viewRevision,
    contactGeneration: 1, sequence: 1, phase: 'begin', ...patch });
  const apply = q => viewport.applyInputLease({ sender: contents, senderFrame: contents.mainFrame }, q);
  function arm() {
    const setup = port.prepareFixture(); assert.equal(setup.ok, true, setup.reason);
    const begin = request(); assert(apply(begin).ok);
    const armed = port.arm({ setupId: setup.setupId, probeId: uuid(100), epoch: begin.epoch,
      contactGeneration: begin.contactGeneration, viewRevision: begin.viewRevision });
    assert.equal(armed.ok, true, armed.reason);
    return { setup, begin, armed };
  }
  return { port, viewport, native, contents, messages, calls, errors, arm, cap, request, apply, display,
    tick: () => tick(), time: v => { now = v; }, profile: v => { active = v; },
    source: v => { pointerSpace = { ...pointerSpace, ...v }; }, bounds: v => { bounds = { ...bounds, ...v }; },
    timers: () => timers, translate: step => port.translate({ probeId: uuid(100), step }) };
}
test('collector fixed out-and-back translates anchor/backing/content once and preserves held contact/TTL', () => {
  const h = harness(), { setup, begin } = h.arm();
  h.time(150);
  const first = h.translate(1); assert.equal(first.ok, true, first.reason);
  assert.equal(first.receipt.epoch, begin.epoch); assert(isPureFixtureTranslation(first.receipt.before, first.view, { x: 24, y: 16 }));
  assert.deepEqual(h.messages.at(-1).value.fixtureTranslation, first.receipt);
  assert.equal(h.cap().epoch, begin.epoch);
  const second = h.translate(2); assert.equal(second.ok, true, second.reason);
  assert.deepEqual(second.view.logicalAnchor, setup.prepared.logicalAnchor);
  assert.equal(h.port.finish({ probeId: uuid(100) }).ok, true);
  h.time(299); h.tick(); assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], false);
  h.time(300); h.tick(); assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], true, 'migration never renewed 300ms deadline');
  assert.notEqual(h.cap().epoch, begin.epoch); assert.equal(h.timers(), 1);
  const restore = h.port.restoreFixture({ setupId: setup.setupId });
  assert.equal(restore.confirmed, true, restore.reason); assert.deepEqual(restore.view.logicalAnchor, setup.before.logicalAnchor);
  assert.equal(h.port.restoreFixture({ setupId: setup.setupId }).attempted, false);
});
test('lease migration requires private authority and preserves sequence/deadline exactly', () => {
  let time = 0, epoch = 0;
  const authority = {}, lease = createPetInputLease({ now: () => time, newEpoch: () => uuid(++epoch), fixtureAuthority: authority });
  const pointer = { revision: 1 }, view = { revision: 1, available: true };
  const cap = lease.observe(view, pointer, true);
  assert(lease.apply({ schemaVersion: 1, epoch: cap.epoch, viewRevision: 1, contactGeneration: 3, sequence: 7, phase: 'begin' }).ok);
  const before = lease.fixtureSnapshot(authority); time = 299;
  assert.equal(lease.migrateFixture({}, before, { revision: 2, available: true }, pointer, true), false);
  assert.equal(lease.migrateFixture(authority, before, { revision: 2, available: true }, pointer, true), true);
  const after = lease.fixtureSnapshot(authority); assert.deepEqual(after.active, before.active); assert.equal(after.epoch, before.epoch);
  time = 300;
  assert.equal(lease.migrateFixture(authority, after, { revision: 3, available: true }, pointer, true), false);
  assert.equal(lease.fixtureSnapshot(authority).active, null);
});
test('late expiry before next tick rejects translation without issuing a move', () => {
  const h = harness(); h.arm(); const count = h.calls.length; h.time(300);
  assert.equal(h.translate(1).ok, false); assert.equal(h.calls.slice(count).some(c => c[0] === 'move'), false);
});
for (const mode of ['clamp', 'noop', 'content-mismatch', 'partial-throw', 'readback-throw', 'blur', 'expiry-during-call']) {
  test(`${mode} fails without retries and reports actual readback or unknown`, () => {
    const h = harness(), { setup, begin } = h.arm(), original = h.native.setPosition;
    let moves = 0;
    h.native.setPosition = (x, y) => {
      moves++;
      if (mode !== 'noop') original(x - (mode === 'clamp' ? 1 : 0), y);
      if (mode === 'partial-throw') throw Error('partial');
      if (mode === 'readback-throw') h.native.getBounds = () => { throw Error('unknown'); };
      if (mode === 'blur') h.native.emit('blur');
      if (mode === 'expiry-during-call') h.time(300);
    };
    if (mode === 'content-mismatch') {
      const origin = h.native.getContentBounds(); h.native.getContentBounds = () => ({ ...origin });
    }
    const result = h.translate(1); assert.equal(result.ok, false); assert.equal(result.attempted, true); assert.equal(moves, 1);
    assert.equal(h.translate(1).ok, false); assert.equal(moves, 1);
    if (mode === 'readback-throw') assert.equal(result.view, null);
    else assert(result.view?.available);
    if (mode === 'partial-throw') {
      assert.deepEqual(result.view.logicalAnchor, setup.prepared.logicalAnchor);
      assert.equal(result.view.backingBounds.x, setup.prepared.backingBounds.x + 24);
    }
    if (mode !== 'readback-throw') assert.notEqual(h.cap().epoch, begin.epoch);
  });
}
for (const loss of ['profile', 'navigation', 'same-url-load', 'frame', 'contents', 'window', 'new-contact']) {
  test(`${loss} loss forbids stale cleanup and further movement`, () => {
    const h = harness(), { setup } = h.arm(); assert(h.translate(1).ok);
    if (loss === 'profile') h.profile(false);
    if (loss === 'navigation') h.contents.emit('did-start-navigation', {}, URL, false, true);
    if (loss === 'same-url-load') { h.contents.emit('did-start-navigation', {}, URL, false, true); h.contents.emit('did-finish-load'); }
    if (loss === 'frame') { h.contents.mainFrame = { url: URL }; h.contents.emit('did-finish-load'); }
    if (loss === 'contents') h.native.webContents = new EventEmitter();
    if (loss === 'window') { h.native.destroyed = true; h.native.emit('closed'); }
    if (loss === 'new-contact') {
      assert(h.apply(h.request({ phase: 'end', sequence: 2 })).ok);
      assert(h.apply(h.request({ contactGeneration: 2, sequence: 3 })).ok);
    }
    const count = h.calls.filter(c => c[0] === 'move').length;
    assert.equal(h.port.restoreFixture({ setupId: setup.setupId }).ok, false);
    assert.equal(h.translate(2).ok, false);
    assert.equal(h.calls.filter(c => c[0] === 'move').length, count);
  });
}
test('negative workarea supports preparation, pure translation and restoration', () => {
  const h = harness({ negative: true }), { setup } = h.arm();
  assert(h.translate(1).ok); assert(h.translate(2).ok);
  assert(h.port.restoreFixture({ setupId: setup.setupId }).confirmed);
  assert(setup.prepared.backingBounds.x < 0);
});
test('unavailable and too-small workarea reject preparation before writing', () => {
  for (const h of [harness({ small: true }), harness()]) {
    if (h.display.workArea.width > 1000) h.display.workArea = null;
    const n = h.calls.length, result = h.port.prepareFixture();
    assert.equal(result.ok, false); assert.equal(result.attempted, false);
    assert.equal(h.calls.slice(n).some(c => c[0] === 'move'), false);
  }
});
test('default 2D and noncollector V2 attach no port or capability', () => {
  for (const h of [harness({ legacy: true }), harness({ isolated: false })]) {
    assert.equal(h.port, null); assert.equal('fixtureTransport' in h.viewport.setMenuOpen(false), false);
  }
});
test('wrong epoch/contact/view and malformed arm records fail closed; wrong step never moves', () => {
  const h = harness(), setup = h.port.prepareFixture(), begin = h.request(); assert(h.apply(begin).ok);
  const arm = { setupId: setup.setupId, probeId: uuid(100), epoch: begin.epoch, contactGeneration: 1, viewRevision: begin.viewRevision };
  for (const patch of [{ epoch: uuid(900) }, { contactGeneration: 2 }, { viewRevision: 999 }, { extra: 1 }]) {
    assert.equal(h.port.arm({ ...arm, ...patch }).ok, false);
  }
  assert(h.port.arm(arm).ok); const n = h.calls.length;
  assert.equal(h.translate(2).ok, false);
  assert.equal(h.port.translate({ probeId: uuid(101), step: 1 }).ok, false);
  assert.equal(h.calls.length, n); assert(h.translate(1).ok);
  assert.equal(h.translate(1).ok, false);
});
test('pointer-space/display drift and raw backing-only moves cannot be rebased', () => {
  for (const change of [h => h.source({ revision: 2 }), h => { h.display.scaleFactor = 2; },
    h => h.bounds({ x: h.native.getBounds().x + 1 })]) {
    const h = harness(); h.arm(); change(h); const n = h.calls.length;
    assert.equal(h.translate(1).ok, false); assert.equal(h.calls.slice(n).some(c => c[0] === 'move'), false);
  }
});
test('pure receipt validates exact finite translations and frozen closed copies', () => {
  const h = harness(); h.arm(); const receipt = h.translate(1).receipt;
  const copied = readFixtureTranslation(receipt); assert(copied); assert.notEqual(copied, receipt); assert(Object.isFrozen(copied.after.geometry.stageOffset));
  for (const patch of [{ delta: { x: 33, y: 16 } }, { extra: true }, { epoch: 'bad' }, { fromRevision: 0 },
    { step: 2 }, { after: { ...receipt.after, logicalAnchor: receipt.before.logicalAnchor } },
    { after: { ...receipt.after, geometry: { ...receipt.after.geometry, stageOffset: { x: 1, y: 0 } } } },
    { after: { ...receipt.after, contentBounds: receipt.before.contentBounds } },
    { after: { ...receipt.after, revision: receipt.after.revision + 1 } }]) assert.equal(readFixtureTranslation({ ...receipt, ...patch }), null);
  let touched = 0; const hostile = { ...receipt }; Object.defineProperty(hostile, 'before', { get() { touched++; return receipt.before; } });
  assert.equal(readFixtureTranslation(hostile), null); assert.equal(touched, 0);
  const tracker = createPresentationViewTracker(), before = tracker.record(receipt.before), after = tracker.record(receipt.after);
  assert(isPureFixtureTranslation(before, after, { x: 24, y: 16 }));
  assert.equal(isPureFixtureTranslation(before, after, { x: NaN, y: 0 }), false);
  assert.equal(copied.scope, scope);
});
test('synchronous new contact during native call cannot be migrated or revoked by the old attempt', () => {
  const h = harness(); h.arm(); const original = h.native.setPosition; let fresh;
  h.native.setPosition = (x, y) => {
    original(x, y);
    // A real reentrant observation revokes the old mapping; the replacement
    // contact is separately admitted with a fresh epoch and generation.
    h.tick(); fresh = h.request({ contactGeneration: 2, sequence: 2 }); assert(h.apply(fresh).ok);
  };
  assert.equal(h.translate(1).ok, false);
  assert.equal(h.cap().epoch, fresh.epoch);
  assert.equal(h.apply({ ...fresh, phase: 'renew', sequence: 3 }).ok, true);
});
test('preparation and restoration native exceptions retain truthful actual bounds and are never repeated', () => {
  const h = harness(), original = h.native.setPosition;
  let calls = 0;
  h.native.setPosition = (x, y) => { calls++; original(x, y); throw Error('partial'); };
  const setup = h.port.prepareFixture(); assert.equal(setup.ok, false); assert.equal(setup.attempted, true); assert.equal(calls, 1);
  assert.equal(h.port.prepareFixture().attempted, false); assert.equal(calls, 1);
  const restored = h.port.restoreFixture({ setupId: setup.setupId });
  assert.equal(restored.ok, false); assert.equal(restored.attempted, true); assert.equal(restored.confirmed, false); assert(restored.view);
  assert.equal(h.port.restoreFixture({ setupId: setup.setupId }).attempted, false); assert.equal(calls, 2);
});
test('window handoff is one-shot, collector-only, V2-only, and retired after fixture close', () => {
  const { createPetWindowHost } = require('../src/platform/electron/windows/pet-window');
  const { installFixtureIsolation, readFixtureIsolation, readActiveFixtureIsolation } = require('../src/platform/electron/dev/fixture-isolation');
  let ports = [], windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); windows.push(this); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, send() {}, getURL: () => '', mainFrame: null });
      this.on('bubu:fixture-transport-port', port => ports.push(port));
    }
    loadFile() {} isDestroyed() { return false; } isVisible() { return false; }
    getBounds() { return { ...this.bounds }; } getContentBounds() { return { ...this.bounds }; }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} setIgnoreMouseEvents() {}
  }
  const base = { BrowserWindow: Window, pagePath: '/app/src/renderer/pet.html', preloadPath: '/app/src/preload-pet.js',
    platform: 'win32', bounds: { x: 100, y: 100, width: 220, height: 220 }, enableReload: true,
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    rendererSelection: { defaultApp: true, requested: '1' } };
  createPetWindowHost(base); assert.equal(ports.length, 0);
  const isolation = installFixtureIsolation({ app: { isPackaged: false, getPath: () => '/owned/profile' },
    profilePath: '/owned/profile', assertOwnedProfile: () => true, defaultApp: true, argv: ['--dev'] });
  createPetWindowHost({ ...base, enableReload: false }); assert.equal(ports.length, 0);
  const host = createPetWindowHost(base); assert.equal(ports.length, 1); assert(Object.isFrozen(ports[0]));
  assert.equal('fixtureTransport' in host, false); assert.equal(ports[0].prepareFixture().ok, false, 'document must finish loading');
  isolation.close(); assert.equal(readFixtureIsolation(), true); assert.equal(readActiveFixtureIsolation(), false);
  assert.equal(ports[0].read().ok, false); createPetWindowHost(base); assert.equal(ports.length, 1);
  for (const window of windows) window.emit('closed');
});
