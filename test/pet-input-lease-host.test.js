'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createPetViewport } = require('../src/platform/electron/windows/pet-viewport');
const { createPetWindowHost } = require('../src/platform/electron/windows/pet-window');
const PAGE = '/app/src/surfaces/pet/realtime/index.html', URL = pathToFileURL(PAGE).href;
function harness({ loaded = true, legacy = false } = {}) {
  let now = 0, id = 0, tick, timers = 0, cleared = 0, cursor = { x: 110, y: 110 };
  let pointerSpace = { schemaVersion: 1, revision: 1, kind: 'event-screen-dip', scaleFactor: 1 };
  const calls = [], messages = [], errors = [];
  const viewport = createPetViewport({ bounds: { x: 100, y: 100, width: 220, height: 220 },
    selectedPage: PAGE, readPointerSpace: legacy ? null : () => pointerSpace,
    screen: { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    now: () => now, newEpoch: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    interval: (fn, ms) => { assert.equal(ms, 24); tick = fn; timers++; return timers; },
    cancelInterval: () => cleared++, onDeliveryError: (error, context) => errors.push([error.message, context]) });
  const native = new EventEmitter(), contents = new EventEmitter();
  let bounds = { ...viewport.initialBounds };
  Object.assign(contents, { mainFrame: { url: URL }, loading: false, destroyed: false, url: URL,
    getURL() { return this.url; }, isLoadingMainFrame() { return this.loading; }, isDestroyed() { return this.destroyed; },
    send: (channel, value) => messages.push({ channel, value }) });
  Object.assign(native, { webContents: contents, destroyed: false, visible: true,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, isFocused: () => false,
    getBounds: () => ({ ...bounds }), getContentBounds: () => ({ ...bounds }),
    setIgnoreMouseEvents: value => calls.push(value), setPosition: (x, y) => { bounds = { ...bounds, x, y }; },
    setBounds: value => { bounds = { ...value }; } });
  viewport.attach(native); native.emit('show');
  if (loaded) contents.emit('did-finish-load');
  const capability = () => viewport.setMenuOpen(false).inputLease;
  const event = () => ({ sender: native.webContents, senderFrame: native.webContents.mainFrame });
  const request = (patch = {}, cap = capability()) => ({ schemaVersion: 1, epoch: cap.epoch, viewRevision: cap.viewRevision,
    contactGeneration: 1, sequence: 1, phase: 'begin', ...patch });
  return { viewport, native, contents, calls, messages, errors, capability, request, event,
    apply: value => viewport.applyInputLease(event(), value), tick: () => tick(), time: value => { now = value; },
    cursor: value => { cursor = value; }, source: value => { pointerSpace = { ...pointerSpace, ...value }; },
    geometry: value => { bounds = { ...bounds, ...value }; }, timers: () => [timers, cleared] };
}
test('V2 is pass-through until the exact document finishes loading, without requiring focus', () => {
  const h = harness({ loaded: false });
  assert.equal(h.calls.at(-1), true); assert.equal(h.capability().available, false);
  assert.equal(h.apply(h.request()).ok, false);
  h.contents.emit('did-finish-load');
  assert.equal(h.capability().available, true); assert.equal(h.native.isFocused(), false);
  assert.equal(h.apply(h.request()).ok, true); assert.equal(h.calls.at(-1), false);
  assert.equal(h.timers()[0], 1, 'lease shares the existing 24ms hit-test timer');
});
test('active lease suppresses whitespace pass-through, renews at 100ms, and restores it on end', () => {
  const h = harness(), begin = h.request();
  assert.equal(h.apply(begin).ok, true);
  h.cursor({ x: 1900, y: 1000 }); h.tick(); assert.equal(h.calls.at(-1), false);
  h.time(100); assert.equal(h.apply({ ...begin, phase: 'renew', sequence: 2 }).ok, true);
  h.time(350); h.tick(); assert.equal(h.calls.at(-1), false);
  assert.equal(h.apply({ ...begin, phase: 'end', sequence: 3 }).ok, true);
  assert.equal(h.calls.at(-1), true); assert.equal(h.capability().epoch, begin.epoch, 'normal end permits immediate queued regrab');
});
test('expiry is checked before IPC admission, even when the hit-test timer has not run', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  h.cursor({ x: 1900, y: 1000 }); h.time(300);
  const late = h.apply({ ...begin, phase: 'renew', sequence: 2 });
  assert.equal(late.ok, false); assert.notEqual(late.capability.epoch, begin.epoch); assert.equal(h.calls.at(-1), true);
  assert.equal(h.apply(begin).ok, false);
  assert.equal(h.apply(h.request()).reason, 'stale-contact');
  assert.equal(h.apply(h.request({ contactGeneration: 2 })).ok, true);
});
test('timer expiry fences the old epoch without changing the presentation revision', () => {
  const h = harness(), begin = h.request(), before = h.viewport.readPresentationView(); assert(h.apply(begin).ok);
  h.cursor({ x: 1900, y: 1000 }); h.time(300); h.tick();
  assert.equal(h.calls.at(-1), true); assert.notEqual(h.capability().epoch, begin.epoch);
  assert.equal(h.viewport.readPresentationView().revision, before.revision);
  assert.equal(h.messages.at(-1).value.inputLease.epoch, h.capability().epoch);
});
test('one active contact and increasing per-contact sequence fence end/regrab and delayed messages', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  assert.equal(h.apply(h.request({ contactGeneration: 2 })).reason, 'contact-active');
  assert.equal(h.apply({ ...begin, phase: 'renew' }).reason, 'stale-sequence');
  assert.equal(h.apply({ ...begin, phase: 'renew', sequence: 5 }).ok, true);
  assert.equal(h.apply({ ...begin, phase: 'end', sequence: 4 }).ok, false);
  assert.equal(h.apply({ ...begin, phase: 'end', sequence: 6 }).ok, true);
  assert.equal(h.apply(begin).reason, 'stale-contact');
  const next = h.request({ contactGeneration: 2, sequence: 7 }); assert(h.apply(next).ok);
  assert.equal(h.apply({ ...begin, phase: 'end', sequence: 100 }).reason, 'contact-mismatch');
  h.cursor({ x: 1900, y: 1000 }); h.tick(); assert.equal(h.calls.at(-1), false);
});
test('invalid and foreign requests cannot grant or terminate an existing lease', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  const end = { ...begin, phase: 'end', sequence: 2 };
  for (const event of [{ sender: {}, senderFrame: h.contents.mainFrame },
    { sender: h.contents, senderFrame: { url: URL } }, { sender: h.contents, senderFrame: { url: URL, parent: h.contents.mainFrame } }]) {
    assert.equal(h.viewport.applyInputLease(event, end).reason, 'foreign-document');
  }
  assert.equal(h.apply({ ...end, extra: 1 }).reason, 'invalid-request');
  h.cursor({ x: 1900, y: 1000 }); h.tick(); assert.equal(h.calls.at(-1), false);
});
test('same-URL replacement mainFrame stays unavailable until its own did-finish-load', () => {
  const h = harness(), begin = h.request(), old = h.contents.mainFrame; assert(h.apply(begin).ok);
  h.contents.mainFrame = { url: URL };
  const refused = h.apply({ ...begin, phase: 'renew', sequence: 2 });
  assert.equal(refused.ok, false); assert.equal(refused.capability.available, false); assert.equal(h.calls.at(-1), true);
  h.contents.emit('did-finish-load');
  const fresh = h.request(); assert.notEqual(fresh.epoch, begin.epoch);
  assert.equal(h.viewport.applyInputLease({ sender: h.contents, senderFrame: old }, fresh).ok, false);
  assert.equal(h.apply(fresh).ok, true, 'a new document may restart its own contact generation');
});
test('same-URL replacement webContents and foreign exact URLs are never admitted', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  h.native.webContents = Object.assign(new EventEmitter(), { ...h.contents, mainFrame: { url: URL } });
  assert.equal(h.apply(begin).ok, false); assert.equal(h.capability().available, false);
  for (const url of [URL + '?spoof=1', URL + '#spoof', 'https://example.test/index.html', URL.replace('index', 'sibling')]) {
    const other = harness(); other.contents.url = url; other.contents.mainFrame.url = url;
    assert.equal(other.apply(other.request()).ok, false); assert.equal(other.capability().available, false);
  }
});
for (const lifecycle of ['navigation', 'reload', 'crash', 'destroyed', 'hide', 'blur', 'closed']) {
  test(`${lifecycle} revokes the lease and fences queued requests`, () => {
    const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
    const revision = h.viewport.readPresentationView().revision;
    if (lifecycle === 'navigation') h.contents.emit('did-start-navigation', {}, URL, false, true);
    if (lifecycle === 'reload') { h.contents.loading = true; h.tick(); }
    if (lifecycle === 'crash') h.contents.emit('render-process-gone', {}, { reason: 'crashed' });
    if (lifecycle === 'destroyed') { h.contents.destroyed = true; h.contents.emit('destroyed'); }
    if (lifecycle === 'hide') { h.native.visible = false; h.native.emit('hide'); }
    if (lifecycle === 'blur') h.native.emit('blur');
    if (lifecycle === 'closed') { h.native.destroyed = true; h.native.emit('closed'); }
    const result = h.apply({ ...begin, phase: 'renew', sequence: 2 });
    assert.equal(result.ok, false); assert.notEqual(result.capability.epoch, begin.epoch);
    if (!['closed', 'destroyed'].includes(lifecycle)) assert.equal(h.viewport.readPresentationView().revision, revision);
    if (['navigation', 'reload', 'crash', 'destroyed', 'hide'].includes(lifecycle)) assert.equal(h.calls.at(-1), true);
    if (lifecycle === 'hide' || lifecycle === 'closed') assert.equal(h.timers()[1], 1);
  });
}
test('subframe navigation does not revoke a verified main-frame contact', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  h.contents.emit('did-start-navigation', {}, URL, false, false);
  h.contents.emit('did-fail-load', {}, -3, 'aborted', URL, false);
  h.contents.emit('did-navigate-in-page', {}, URL, false);
  assert.equal(h.apply({ ...begin, phase: 'renew', sequence: 2 }).ok, true);
});
test('actual geometry is re-read before stale commands, without a prior viewport publication', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  const before = h.messages.at(-1).value.presentationView.revision;
  h.geometry({ x: 400 });
  const result = h.apply({ ...begin, phase: 'renew', sequence: 2 });
  assert.equal(result.ok, false); assert.notEqual(result.capability.epoch, begin.epoch);
  assert(result.capability.viewRevision > before);
});
test('source revision and scale changes independently fence leases without geometry revision churn', () => {
  for (const patch of [{ revision: 2 }, { scaleFactor: 1.5 }]) {
    const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
    h.source(patch);
    const result = h.apply({ ...begin, phase: 'renew', sequence: 2 });
    assert.equal(result.ok, false); assert.notEqual(result.capability.epoch, begin.epoch);
    assert.equal(result.capability.viewRevision, begin.viewRevision);
  }
});
test('missing or unstable native readback refuses input override and keeps pass-through', () => {
  for (const change of [h => { delete h.native.getContentBounds; }, h => {
    const original = h.native.getBounds; let n = 0; h.native.getBounds = () => ({ ...original(), x: ++n });
  }]) {
    const h = harness(), request = h.request(); change(h);
    const result = h.apply(request);
    assert.equal(result.ok, false); assert.equal(result.capability.available, false); assert.equal(h.calls.at(-1), true);
  }
});
test('native flag exceptions never cache success, grant a lease, or escape the polling callback', () => {
  const h = harness(); h.cursor({ x: 1900, y: 1000 }); h.tick();
  const begin = h.request(), original = h.native.setIgnoreMouseEvents;
  h.native.setIgnoreMouseEvents = value => { original(value); throw Error('outcome unknown'); };
  const result = h.apply(begin);
  assert.equal(result.ok, false); assert.equal(result.reason, 'native-state-unknown'); assert.equal(result.capability.available, false);
  assert.doesNotThrow(() => h.tick()); assert.equal(h.errors.length, 1, 'repeated timer errors are bounded');
  h.native.setIgnoreMouseEvents = original; h.tick();
  assert.equal(h.calls.at(-1), true, 'recovery first restores pass-through');
  assert.equal(h.apply(begin).ok, false); assert.equal(h.apply(h.request({ contactGeneration: 2 })).ok, true);
});
test('native geometry exceptions revoke grants and keep polling failures contained', () => {
  const h = harness(), begin = h.request(); assert(h.apply(begin).ok);
  h.native.getBounds = () => { throw Error('bounds unavailable'); };
  assert.doesNotThrow(() => h.tick()); assert.equal(h.calls.at(-1), true);
  const result = h.apply({ ...begin, phase: 'renew', sequence: 2 });
  assert.equal(result.ok, false); assert.equal(result.capability.available, false); assert.equal(h.errors.length, 1);
});
test('default 2D keeps its geometry and hit testing without lease metadata or facade', () => {
  const h = harness({ legacy: true });
  assert.equal('applyInputLease' in h.viewport, false);
  assert.equal('inputLease' in h.viewport.setMenuOpen(false), false);
  assert.equal('presentationView' in h.viewport.setMenuOpen(false), false);
  h.cursor({ x: 1900, y: 1000 }); h.tick(); assert.equal(h.calls.at(-1), true);
  h.cursor({ x: 110, y: 110 }); h.tick(); assert.equal(h.calls.at(-1), false);
});
test('only the selected V2 window facade exposes the host lease command', () => {
  class Window extends EventEmitter {
    constructor(options) { super(); this.bounds = options; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, send() {}, getURL: () => '', mainFrame: null }); }
    loadFile() {} isDestroyed() { return false; } isVisible() { return false; }
    getBounds() { return this.bounds; } getContentBounds() { return this.bounds; }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} setIgnoreMouseEvents() {}
  }
  const base = { BrowserWindow: Window, pagePath: '/app/src/renderer/pet.html', preloadPath: '/app/src/preload-pet.js',
    platform: 'win32', bounds: { x: 100, y: 100, width: 220, height: 220 },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    rendererSelection: { defaultApp: true, requested: '1' } };
  assert.equal('applyInputLease' in createPetWindowHost(base), false);
  assert.equal(typeof createPetWindowHost({ ...base, enableReload: true }).applyInputLease, 'function');
});

test('finish-load while loading waits for stop on the same completed document', () => {
  const h = harness({ loaded: false }); h.contents.loading = true;
  h.contents.emit('did-finish-load'); assert.equal(h.capability().available, false);
  h.contents.loading = false; h.contents.emit('did-stop-loading');
  assert.equal(h.capability().available, true);
});
for (const change of ['no-finish', 'replacement', 'navigation', 'crash']) test(`stop-loading cannot admit ${change}`, () => {
  const h = harness({ loaded: false }); h.contents.loading = true;
  if (change !== 'no-finish') h.contents.emit('did-finish-load');
  if (change === 'replacement') h.contents.mainFrame = { url: URL };
  if (change === 'navigation') h.contents.emit('did-start-navigation', {}, URL, false, true);
  if (change === 'crash') h.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  h.contents.loading = false; h.contents.emit('did-stop-loading');
  assert.equal(h.capability().available, false);
});
for (const change of ['main-load-failure', 'same-page-navigation']) test(`pending completed document is revoked by ${change}`, () => {
  const h = harness({ loaded: false }); h.contents.loading = true;
  h.contents.emit('did-finish-load');
  if (change === 'main-load-failure') h.contents.emit('did-fail-load', {}, -2, 'failed', URL, true);
  else h.contents.emit('did-navigate-in-page', {}, URL, true);
  h.contents.loading = false; h.contents.emit('did-stop-loading');
  assert.equal(h.capability().available, false);
});
test('duplicate stop-loading preserves completed document token and active lease epoch', () => {
  const h = harness({ loaded: false }); h.contents.loading = true;
  h.contents.emit('did-finish-load'); h.contents.loading = false; h.contents.emit('did-stop-loading');
  const begin = h.request(); assert.equal(h.apply(begin).ok, true);
  const before = h.capability();
  h.contents.emit('did-stop-loading'); h.contents.emit('did-stop-loading');
  assert.deepEqual(h.capability(), before);
  assert.equal(h.apply({ ...begin, phase: 'renew', sequence: 2 }).ok, true);
});
