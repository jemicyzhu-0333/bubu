import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTopologyOracle } from './oracle.mjs';
const require = createRequire(import.meta.url);
const { createPetPointerSpace } = require('../../src/platform/electron/windows/pet-pointer-space');
// Observed Windows logical layout; both 1.25 scales here are synthetic, not a second-panel measurement.
const fixture = () => [{ id: 1, rotation: 0, scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 2048, height: 1152 } },
 { id: 2, rotation: 0, scaleFactor: 1.25, bounds: { x: 2048, y: -252, width: 2048, height: 1152 } }];
test('production remains fail-closed for actual-layout-shaped two-display fixture', () => {
 const read = createPetPointerSpace({ screen: { getAllDisplays: fixture }, platform: 'win32', versions: { electron: '44.10.1', chrome: '152.0.7977.169' } });
 assert.equal(read().reason, 'display-topology-unverified'); assert.equal(read().kind, 'client');
});
test('DIP delta is not multiplied by display scale or DPR', () => {
 const o = createTopologyOracle(), s = o.observe(fixture());
 assert.deepEqual(o.segment({ x: 2100, y: -100 }, { x: 2110, y: -90 }, s.revision).delta, { x: 10, y: 10 });
 assert.equal(s.productionCapability, false);
});
test('shared edge ownership is half-open but crossing is not admitted', () => {
 const o = createTopologyOracle(), s = o.observe(fixture());
 assert.equal(o.segment({ x: 2047, y: 10 }, { x: 2048, y: 10 }, s.revision).reason, 'cross-display-unverified');
 assert.equal(o.segment({ x: 2048, y: 10 }, { x: 2049, y: 10 }, s.revision).accepted, true);
 assert.equal(o.segment({ x: 4096, y: 0 }, { x: 4095, y: 0 }, s.revision).accepted, false);
 assert.equal(o.segment({ x: 2047, y: -1 }, { x: 2048, y: -1 }, s.revision).accepted, false);
});
for (const change of ['scale', 'rotation', 'bounds', 'id', 'remove', 'invalid']) test(`topology ${change} invalidates prior revision`, () => {
 const o = createTopologyOracle(), d = fixture(), before = o.observe(d);
 if (change === 'scale') d[1].scaleFactor = 1.5;
 if (change === 'rotation') d[1].rotation = 90;
 if (change === 'bounds') d[1].bounds.y--;
 if (change === 'id') d[1].id++;
 if (change === 'remove') d.pop();
 if (change === 'invalid') d[1].bounds.width = NaN;
 assert.ok(o.observe(d).revision > before.revision);
 assert.equal(o.segment({ x: 10, y: 10 }, { x: 20, y: 20 }, before.revision).reason, 'stale-topology');
});
test('enumeration order does not change revision; output mutation cannot alter ownership', () => {
 const o = createTopologyOracle(), s = o.observe(fixture()); s.displays[0].bounds.width = 99999;
 assert.equal(o.observe(fixture().reverse()).revision, s.revision);
 assert.equal(o.segment({ x: 10, y: 10 }, { x: 5000, y: 10 }, s.revision).accepted, false);
});
for (const kind of ['mixed-DPI', 'rotation', 'overlap', 'duplicate-id', 'invalid-number']) test(`reject ${kind}`, () => {
 const o = createTopologyOracle(), d = fixture();
 if (kind === 'mixed-DPI') d[1].scaleFactor = 2;
 if (kind === 'rotation') d[1].rotation = 90;
 if (kind === 'overlap') d[1].bounds.x = 100;
 if (kind === 'duplicate-id') d[1].id = 1;
 if (kind === 'invalid-number') d[1].bounds.x = Infinity;
 const s = o.observe(d); assert.ok(s.reason); assert.equal(o.segment({ x: 10, y: 10 }, { x: 20, y: 20 }, s.revision).accepted, false);
});
