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
