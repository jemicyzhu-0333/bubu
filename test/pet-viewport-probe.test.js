'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trackedWindowClass, verifyRounds } = require('../scripts/verify-pet-viewport.cjs');
function fixture(mutated = false) {
  const anchor = { x: 1600, y: 800, width: 220, height: 220 };
  let bounds = { x: 1400, y: 720, width: 520, height: 360 };
  let cursor = { x: 1601, y: 801 };
  const calls = [];
  const native = { getBounds: () => ({ ...bounds }), _setBounds(next) { bounds = { ...next }; } };
  const host = { getBounds: () => ({ ...anchor }), setMenuOpen(open) {
    const area = open ? native.getBounds() : anchor;
    calls.push({ name: 'setIgnoreMouseEvents', args: [cursor.x < area.x || cursor.y < area.y || cursor.x >= area.x + area.width || cursor.y >= area.y + area.height] });
    if (mutated) calls.push({ name: 'setResizable', args: [true] });
    const b = native.getBounds();
    return { width: b.width, height: b.height, stageOffset: {
      x: anchor.x + anchor.width / 2 - b.x - b.width / 2,
      y: anchor.y + anchor.height / 2 - b.y - b.height / 2 } };
  } };
  return { host, calls, native, setCursor: value => { cursor = value; }, yieldTurn: async () => {} };
}
test('native viewport probe checks 30 rounds, stable anchor and controlled hit API states', async () => {
  const result = await verifyRounds(fixture());
  assert.equal(result.rounds, 30); assert.equal(result.nativeGeometryWrites, 0); assert.equal(result.nativeIgnoreMouseEventsContract, true);
});
test('native viewport probe fails a frame-policy mutation even if bounds end unchanged', async () => {
  await assert.rejects(verifyRounds(fixture(true)), /native-frame-mutated/);
});
test('native tracking delegates exact methods and never substitutes their behavior', () => {
  const record = { calls: [] }, actual = [];
  class Native { setBounds(...args) { actual.push(args); return 'native-result'; } setResizable() {} setPosition() {} setIgnoreMouseEvents() {} }
  const Window = trackedWindowClass(Native, record), window = new Window();
  assert.ok(window instanceof Native);
  assert.equal(Object.getPrototypeOf(window), Native.prototype);
  assert.doesNotMatch(Window.toString(), /extends/);
  assert.equal(window.setBounds({ x: 1 }, false), 'native-result');
  assert.deepEqual(record.calls, [{ name: 'setBounds', args: [{ x: 1 }, false] }]);
  assert.deepEqual(actual, [[{ x: 1 }, false]]); assert.equal(record.window, window);
});

test('native viewport probe tolerates OS x/y nudge without frame writes', async () => {
  const ports = fixture();
  let reads = 0;
  const base = ports.native.getBounds();
  ports.native.getBounds = () => ({ ...base, y: reads++ === 0 ? base.y : base.y + 3 });
  const result = await verifyRounds(ports);
  assert.equal(result.rounds, 30); assert.equal(result.nativeGeometryWrites, 0);
});

test('native viewport probe rejects backing-store resize even without setter calls', async () => {
  const ports = fixture();
  let reads = 0;
  const base = ports.native.getBounds();
  ports.native.getBounds = () => ({ ...base, height: reads++ === 0 ? base.height : base.height + 1 });
  await assert.rejects(verifyRounds(ports), /native-backing-store-resized/);
});

for (const fail of [false, true]) test(`dynamic import of the actual Electron entry invokes the probe and handles failure=${fail}`, () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const entry = path.resolve(__dirname, '../scripts/run-pet-viewport-probe.cjs');
  const script = `
    import Module from 'node:module';
    import { pathToFileURL } from 'node:url';
    const original = Module._load;
    Module._load = function(request, parent, ...rest) {
      if (request === './verify-pet-viewport.cjs' && parent?.filename === ${JSON.stringify(entry)}) {
        return { main: async () => { console.log('CONTROL_MAIN_INVOKED'); ${fail ? "throw new Error('controlled');" : ''} },
          reportFailure: () => { console.log('CONTROL_FAILURE_HANDLED'); process.exitCode = 7; } };
      }
      return original.call(this, request, parent, ...rest);
    };
    await import(pathToFileURL(${JSON.stringify(entry)}).href);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, fail ? 7 : 0);
  assert.match(result.stdout, /CONTROL_MAIN_INVOKED/);
  assert.equal(result.stdout.includes('CONTROL_FAILURE_HANDLED'), fail);
});
