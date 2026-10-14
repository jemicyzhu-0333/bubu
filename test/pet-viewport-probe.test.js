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

// Real production createPetViewport behind synthetic native/screen ports (no
// Electron, no fake move events): `nudge(phase, n, bounds)` may shift the native
// frame the way macOS does, without going through our setters.
function productionFixture(nudge = () => {}) {
  const { EventEmitter } = require('node:events');
  const { createPetViewport } = require('../src/platform/electron/windows/pet-viewport');
  const anchor = { x: 1600, y: 800, width: 220, height: 220 };
  const calls = [];
  let cursor = { x: 1610, y: 810 }, reads = 0, yields = 0;
  const host = createPetViewport({ bounds: anchor, interval: () => 1, cancelInterval: () => {}, screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => cursor } });
  let bounds = { ...host.initialBounds };
  const native = new EventEmitter();
  native.webContents = new EventEmitter(); native.webContents.send = () => {}; native.isDestroyed = () => false;
  native.getBounds = () => { nudge('read', ++reads, bounds); return { ...bounds }; };
  for (const name of ['setIgnoreMouseEvents', 'setBounds', 'setPosition']) native[name] = (...args) => calls.push({ name, args });
  host.attach(native);
  return { host, native, calls, setCursor: next => { cursor = next; }, yieldTurn: async () => { nudge('yield', ++yields, bounds); } };
}

test('probe accepts one small OS nudge during the yield and reports the sample as invalidated', async () => {
  const result = await verifyRounds(productionFixture((phase, n, b) => { if (phase === 'yield' && n === 1) b.y += 3; }));
  assert.equal(result.nativeGeometryWrites, 0); assert.equal(result.geometryFreshAtCapture, true);
  assert.equal(result.invalidatedSamples, 1); assert.equal(result.freshSamples, 59);
  assert.deepEqual(result.osNudges, [{ round: 0, open: true, phase: 'yield', dx: 0, dy: 3 }]);
  assert.deepEqual(result.maxOsDisplacement, { x: 0, y: 3 });
});

test('probe accepts a small OS nudge before geometry capture as a fresh sample', async () => {
  const result = await verifyRounds(productionFixture((phase, n, b) => { if (phase === 'read' && n === 2) b.y += 3; }));
  assert.equal(result.invalidatedSamples, 0); assert.equal(result.osNudges.length, 1);
});

test('probe rejects a nudge that moves the logical anchor outside the native window', async () => {
  await assert.rejects(verifyRounds(productionFixture((phase, n, b) => { if (phase === 'read' && n === 2) b.y += 4000; })),
    /logical-anchor-outside-native-window/);
  await assert.rejects(verifyRounds(productionFixture((phase, n, b) => { if (phase === 'yield' && n === 3) b.y += 4000; })),
    /logical-anchor-outside-native-window/);
});

test('probe rejects a contained OS displacement beyond the bounded nudge limit', async () => {
  await assert.rejects(verifyRounds(productionFixture((phase, n, b) => { if (phase === 'yield' && n === 1) b.x -= 60; })),
    /os-nudge-exceeds-bound/);
});

test('probe rejects repeated OS drift even when each step is small', async () => {
  await assert.rejects(verifyRounds(productionFixture((phase, n, b) => { if (phase === 'yield') b.y += 1; })),
    /os-nudge-repeated/);
});

test('probe rejects geometry that is stale relative to the same-turn native frame', async () => {
  const ports = fixture();
  const real = ports.host.setMenuOpen;
  let first = true;
  ports.host.setMenuOpen = open => {
    const geometry = real(open);
    if (first) { first = false; const b = ports.native.getBounds(); ports.native._setBounds({ ...b, y: b.y + 3 }); }
    return geometry;
  };
  await assert.rejects(verifyRounds(ports), /geometry-stale-at-capture/);
});

test('probe still rejects backing-store resize during the yield', async () => {
  await assert.rejects(verifyRounds(productionFixture((phase, n, b) => { if (phase === 'yield' && n === 2) b.height += 1; })),
    /native-backing-store-resized/);
});
