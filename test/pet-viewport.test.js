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
