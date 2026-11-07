'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPetViewport } = require('../src/platform/electron/windows/pet-viewport');

function harness() {
  let cursor = { x: 5, y: 5 }, tick, cleared = 0;
  const calls = [];
  const screen = { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: p => ({
    workArea: p.x > 2000 ? { x: 2200, y: 0, width: 400, height: 300 } : p.x < 0 ? { x: -1280, y: -100, width: 1280, height: 720 } : { x: 0, y: 0, width: 1920, height: 1080 }
  }) };
  const viewport = createPetViewport({ bounds: { x: 1600, y: 800, width: 220, height: 220 }, screen,
    interval: callback => { tick = callback; return 1; }, cancelInterval: () => { cleared++; } });
  let bounds = { ...viewport.initialBounds };
  const native = new EventEmitter();
  native.webContents = new EventEmitter(); native.webContents.send = (...args) => calls.push(['send', ...args]);
  native.isDestroyed = () => false; native.getBounds = () => bounds;
  native.setBounds = next => { bounds = { ...next }; calls.push(['resize', next]); };
  native.setPosition = (x, y) => { bounds = { ...bounds, x, y }; calls.push(['move', x, y]); };
  native.setIgnoreMouseEvents = ignored => calls.push(['ignore', ignored]);
  viewport.attach(native); native.emit('show');
  return { viewport, native, calls, cursor: point => { cursor = point; tick(); }, cleared: () => cleared };
}
test('menu/food round trips never resize or move the native window or logical anchor', () => {
  const h = harness(), anchor = h.viewport.getBounds(), bounds = { ...h.native.getBounds() };
  for (let i = 0; i < 30; i++) {
    const opened = h.viewport.setMenuOpen(true), closed = h.viewport.setMenuOpen(false);
    assert.deepEqual(opened, closed);
    assert.equal(bounds.x + opened.width / 2 + opened.stageOffset.x, anchor.x + 110);
  }
  assert.deepEqual(h.viewport.getBounds(), anchor);
  assert.deepEqual(h.native.getBounds(), bounds);
  assert.equal(h.calls.some(c => c[0] === 'move'), false);
});
test('desktop whitespace passes through while pet and open panels remain interactive', () => {
  const h = harness(); h.cursor({ x: 1610, y: 810 });
  assert.deepEqual(h.calls.at(-1), ['ignore', false]);
  const bounds = h.native.getBounds(); h.cursor({ x: bounds.x + 2, y: bounds.y + 2 });
  assert.deepEqual(h.calls.at(-1), ['ignore', true]);
  h.viewport.setMenuOpen(true); assert.deepEqual(h.calls.at(-1), ['ignore', false]);
  h.viewport.setMenuOpen(false); assert.deepEqual(h.calls.at(-1), ['ignore', true]);
  h.native.emit('hide'); assert.equal(h.cleared(), 1);
  h.native.emit('show'); h.native.emit('closed'); assert.equal(h.cleared(), 2);
});
test('negative-origin secondary display keeps the logical pet position and backing size', () => {
  const h = harness(); h.viewport.setPosition(-1250, -70);
  const geo = h.viewport.setMenuOpen(true), bounds = h.native.getBounds();
  assert.equal(bounds.width, 520); assert.equal(bounds.height, 360);
  assert.equal(bounds.x + geo.width / 2 + geo.stageOffset.x, -1140);
  assert.equal(bounds.y + geo.height / 2 + geo.stageOffset.y, 40);
  assert.deepEqual(h.viewport.getBounds(), { x: -1250, y: -70, width: 220, height: 220 });
});

test('moving to a smaller work area adjusts once; menu toggles remain size-stable', () => {
  const h = harness(); h.viewport.setPosition(2250, 40);
  const before = h.native.getBounds();
  assert.equal(before.width, 400); assert.equal(before.height, 300);
  const opened = h.viewport.setMenuOpen(true);
  assert.equal(before.x + opened.width / 2 + opened.stageOffset.x, 2360);
  h.viewport.setMenuOpen(false);
  assert.deepEqual(h.native.getBounds(), before);
  assert.equal(h.calls.filter(c => c[0] === 'resize').length, 1);
});

// macOS lock -> unlock: the OS may reset the native pass-through flag and
// emit 'hide' without a matching 'show'. The cached value must not keep the
// window ignoring clicks forever.
function lockHarness() {
  const h = harness(); let visible = true; const extra = [];
  h.native.isVisible = () => visible;
  h.native.setAlwaysOnTop = (...a) => extra.push(['top', ...a]);
  h.native.setVisibleOnAllWorkspaces = (...a) => extra.push(['spaces', ...a]);
  return { ...h, extra, setVisible: v => { visible = v; } };
}
test('lock -> unlock: resync re-asserts pass-through even when the cache already matches', () => {
  const h = lockHarness(); h.cursor({ x: 1610, y: 810 });
  assert.deepEqual(h.calls.at(-1), ['ignore', false]);
  const n = h.calls.filter(c => c[0] === 'ignore').length;
  h.cursor({ x: 1611, y: 811 });                     // cache matches: no native call
  assert.equal(h.calls.filter(c => c[0] === 'ignore').length, n);
  h.viewport.resync('unlock-screen');                 // OS may have flipped it natively
  assert.deepEqual(h.calls.at(-1), ['ignore', false]);
  assert.ok(h.extra.some(c => c[0] === 'top' && c[1] === true && c[2] === 'floating'));
  assert.ok(h.extra.some(c => c[0] === 'spaces'));
  assert.ok(h.calls.some(c => c[0] === 'send' && c[1] === 'pet:viewport'));
});
test('lock emits hide without show: unlock resync restarts hit-test polling', () => {
  const h = lockHarness(); h.cursor({ x: 5, y: 5 });
  h.native.emit('hide'); assert.equal(h.cleared(), 1);
  h.viewport.resync('unlock-screen');
  h.cursor({ x: 1610, y: 810 });                      // polling alive again
  assert.deepEqual(h.calls.at(-1), ['ignore', false]);
});
test('resync while hidden does not start polling; display change re-lays out onto the new work area', () => {
  const h = lockHarness(); h.native.emit('hide'); h.setVisible(false);
  const ticksBefore = h.cleared(); h.viewport.resync('resume'); assert.equal(h.cleared(), ticksBefore);
  h.setVisible(true); h.viewport.setPosition(2250, 40);
  h.viewport.resync('display-change');
  assert.equal(h.native.getBounds().width, 400);
});
test('late native show after an OS position nudge writes no frame; explicit resume re-positions', () => {
  const h = harness(), b = h.native.getBounds();
  h.native.getBounds = () => ({ ...b, x: b.x + 1, y: b.y - 1 });   // macOS nudge after showInactive
  const before = h.calls.length; h.native.emit('show');
  assert.equal(h.calls.slice(before).some(c => c[0] === 'resize' || c[0] === 'move'), false);
  h.viewport.resync('unlock-screen');
  assert.ok(h.calls.slice(before).some(c => c[0] === 'resize'));
});

test('optional V2 pointer-space metadata rides the existing viewport publication without changing legacy geometry', () => {
  const screen = { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) };
  let revision = 1;
  const viewport = createPetViewport({ bounds: { x: 100, y: 100, width: 220, height: 220 }, screen,
    readPointerSpace: () => ({ schemaVersion: 1, kind: 'client', revision }) });
  const window = new EventEmitter(), messages = []; window.webContents = new EventEmitter();
  Object.assign(window, { isDestroyed: () => false, getBounds: () => viewport.initialBounds, setIgnoreMouseEvents() {} });
  window.webContents.send = (channel, payload) => messages.push({ channel, payload }); viewport.attach(window);
  window.webContents.emit('did-finish-load'); assert.equal(messages.at(-1).channel, 'pet:viewport');
  assert.equal(messages.at(-1).payload.pointerSpace.revision, 1);
  revision = 2; window.webContents.emit('did-finish-load'); assert.equal(messages.at(-1).payload.pointerSpace.revision, 2);
  window.emit('closed');
});

function receiptHarness() {
  const h = harness(), screen = { getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: -1000, width: 3840, height: 2080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) };
  const viewport = createPetViewport({ bounds: { x: -400, y: -100, width: 220, height: 220 }, screen, readPointerSpace: () => ({ kind: 'client', revision: 1 }) });
  let bounds = { ...viewport.initialBounds }; const native = h.native;
  native.getBounds = () => ({ ...bounds });
  native.getContentBounds = () => ({ ...bounds, x: bounds.x + 2, y: bounds.y + 22, width: bounds.width - 4, height: bounds.height - 24 });
  native.setPosition = (x, y) => { bounds = { ...bounds, x, y }; };
  native.setBounds = next => { bounds = { ...next }; };
  viewport.attach(native);
  return { viewport, native, calls: h.calls };
}
test('V2 move receipt reads actual clamped bounds and keeps logical intent separate', () => {
  const h = receiptHarness(), before = h.viewport.readPresentationView();
  assert.equal(before.available, true); assert.notDeepEqual(before.contentBounds, before.backingBounds);
  assert.equal(h.viewport.readPresentationView().revision, before.revision);
  const original = h.native.setPosition; h.native.setPosition = (x, y) => original(Math.round(x) + 7, Math.round(y) - 3);
  const receipt = h.viewport.setPosition(-300.25, -120.75), view = receipt.view;
  assert.deepEqual(view.logicalAnchor, h.viewport.getBounds());
  assert.deepEqual(view.backingBounds, h.native.getBounds()); assert.deepEqual(view.contentBounds, h.native.getContentBounds());
  assert.equal(view.backingBounds.x + view.geometry.width / 2 + view.geometry.stageOffset.x, -190.25);
  assert.equal(view.backingBounds.y + view.geometry.height / 2 + view.geometry.stageOffset.y, -10.75);
  assert.equal(view.revision, before.revision + 1); assert(Object.isFrozen(receipt.requestedLogicalAnchor));
  assert.equal(h.calls.filter(c => c[0] === 'send').at(-1)[2].presentationView.revision, view.revision);
  assert.equal(h.viewport.readPresentationView().revision, view.revision);
});
test('V2 noop native command is reported as actual unmoved bounds, not fabricated success', () => {
  const h = receiptHarness(), before = h.viewport.readPresentationView(); h.native.setPosition = () => {};
  const receipt = h.viewport.setPosition(-200, -50);
  assert.deepEqual(receipt.view.backingBounds, before.backingBounds);
  assert.equal(receipt.view.logicalAnchor.x, -200); assert.equal(receipt.view.available, true, 'available observation is not movement success');
});
test('V2 partial native throw preserves old logical anchor but independently reports actual changed bounds', () => {
  const h = receiptHarness(), before = h.viewport.readPresentationView(); const original = h.native.setPosition; let calls = 0;
  h.native.setPosition = (x, y) => { calls++; original(x, y); throw new Error('after OS call'); };
  assert.throws(() => h.viewport.setPosition(-200, -50), /after OS call/);
  const after = h.viewport.readPresentationView(); assert.deepEqual(after.logicalAnchor, before.logicalAnchor);
  assert.notDeepEqual(after.backingBounds, before.backingBounds); assert.equal(calls, 1, 'no implicit rollback or retry');
});
test('V2 missing content bounds and unstable sandwich read are unavailable, without guessed content', () => {
  const h = receiptHarness(); delete h.native.getContentBounds;
  let view = h.viewport.readPresentationView(); assert.equal(view.available, false); assert.equal(view.contentBounds, null);
  const original = h.native.getBounds; let n = 0; h.native.getBounds = () => ({ ...original(), x: ++n });
  h.native.getContentBounds = () => original(); view = h.viewport.readPresentationView();
  assert.equal(view.stableNativeRead, false); assert.equal(view.available, false);
  assert.equal(view.backingBounds.x, 2);
});
test('legacy viewport retains its payload and makes no content bounds read', () => {
  const h = harness(); h.native.getContentBounds = () => { throw new Error('must not be called'); };
  const value = h.viewport.setMenuOpen(false); assert.equal(Object.hasOwn(value, 'presentationView'), false);
  assert.equal(h.viewport.readPresentationView(), null); assert.equal(h.viewport.setPosition(1400, 700), undefined);
});
