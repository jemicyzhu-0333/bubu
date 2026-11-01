'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopPointerWindow } = require('../src/surfaces/pet/realtime/pointer-window-port.mjs');
test('desktop pointer port preserves release/cancel propagation but leaves deactivation to the surface owner', () => {
  const window = new EventTarget(), port = createDesktopPointerWindow(window), calls = [];
  const listener = event => calls.push(event.type);
  for (const type of ['blur', 'focus', 'pointerup', 'pointercancel']) port.addEventListener(type, listener);
  for (const type of ['blur', 'focus', 'pointerup', 'pointercancel']) window.dispatchEvent(new Event(type));
  assert.deepEqual(calls, ['pointerup', 'pointercancel']);
  for (const type of ['blur', 'focus', 'pointerup', 'pointercancel']) port.removeEventListener(type, listener);
  window.dispatchEvent(new Event('pointerup')); assert.equal(calls.length, 2);
});
test('desktop pointer port rejects an unavailable native event boundary', () => {
  assert.throws(() => createDesktopPointerWindow(null), /event ports/);
  assert.throws(() => createDesktopPointerWindow({ addEventListener() {} }), /event ports/);
});
