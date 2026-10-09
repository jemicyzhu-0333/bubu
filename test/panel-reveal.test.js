const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPanelReveal } = require('../src/platform/electron/windows/panel-reveal');
const { placeFloatingPanel } = require('../src/core/window-placement');
test('a panel waits for readiness and paint; closing cancels stale reveals', async () => {
  const win = new EventEmitter(); let paint; const calls = [];
  win.webContents = { executeJavaScript: () => new Promise(resolve => { paint = resolve; }) };
  win.isDestroyed = () => false; win.show = () => calls.push('show'); win.focus = () => calls.push('focus');
  const reveal = createPanelReveal(win);
  await reveal.show(); assert.deepEqual(calls, []);
  win.emit('ready-to-show'); await Promise.resolve(); reveal.cancel(); paint(); await Promise.resolve();
  assert.deepEqual(calls, []);
  const next = reveal.show(); await Promise.resolve(); paint(); await next;
  assert.deepEqual(calls, ['show', 'focus']);
});
test('Windows floating placement centres first open, remembers moves, clamps after monitor removal', () => {
  const bounds = { x: 0, y: 0, width: 720, height: 600 };
  const workArea = { x: -1920, y: 24, width: 1920, height: 1000 };
  assert.deepEqual(placeFloatingPanel({ bounds, workArea }), { x: -1320, y: 224 });
  assert.deepEqual(placeFloatingPanel({ bounds, workArea, remembered: { x: -1500, y: 100 } }), { x: -1500, y: 100 });
  assert.deepEqual(placeFloatingPanel({ bounds, workArea, remembered: { x: 3000, y: -900 } }), { x: -728, y: 32 });
});
