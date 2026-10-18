import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as T from 'three';
import { createEffectRuntime, EFFECT_IDS } from './bounded-effects.mjs';
const scene = new T.Scene(), anchor = new T.Object3D(); scene.add(anchor); scene.updateMatrixWorld(true);
const r = createEffectRuntime({ THREE: T, scene, seed: 77 }); let revision = 0;
const step = (dt = 1 / 60, flags = {}) => r.tick({ dt, poseRevision: ++revision, ...flags });
const h = r.enter({ effectId: 'leaf-stream', anchor, rateHz: 0 });
assert.equal(h.state, 'entering'); const beforeReset = h.generation; h.reset();
assert.equal(h.isCurrent(beforeReset), false); assert.equal(h.isCurrent(h.generation), true); step(); h.burst(8); assert.equal(h.liveCount, 8);
assert.throws(() => h.burst(9)); assert.throws(() => h.burst(NaN));
assert.throws(() => r.tick({ dt: Infinity, poseRevision: ++revision }));
assert.throws(() => r.tick({ dt: 0, poseRevision: revision - 1 }));
anchor.position.x = 2; anchor.updateMatrixWorld(true); step(0);
const cloud = scene.getObjectByName('BoundedAccessoryEffects').children[0];
const m = new T.Matrix4(); cloud.getMatrixAt(0, m); assert.ok(Math.abs(m.elements[12]) < .1, 'world tail stays at spawn');
step(600, { hidden: true }); assert.equal(h.liveCount, 8);
step(600, { paused: true }); assert.equal(h.liveCount, 8);
step(600); assert.equal(h.liveCount, 8, 'large resume advances at most .05 seconds');
step(.01, { reducedMotion: true }); assert.equal(h.liveCount, 0);
h.dispose(); h.dispose(); assert.equal(h.state, 'disposed'); assert.equal(h.reset(), false);
assert.equal(h.burst(1), 0); assert.equal(h.isCurrent(h.generation), false);
const local = r.enter({ effectId: 'petal-stream', anchor, space: 'local', rateHz: 0 });
step(); local.burst(1); step(0); cloud.getMatrixAt(0, m); assert.ok(m.elements[12] > 1.9);
local.stop({ immediate: false }); anchor.position.x = 10; anchor.updateMatrixWorld(true); step(0);
cloud.getMatrixAt(0, m); assert.ok(m.elements[12] < 2.1, 'unequip detaches local trail');
for (let i = 0; i < 200; i++) step(); assert.equal(local.state, 'disposed');
let borrowedDispose = 0; const borrowedGeometry = new T.TorusGeometry(.1, .01, 6, 16);
borrowedGeometry.addEventListener('dispose', () => borrowedDispose++);
const source = new T.Mesh(borrowedGeometry, new T.MeshBasicMaterial()); scene.add(source);
const g = r.enter({ effectId: 'halo-sparks', anchor, glowMesh: source }); step(); g.dispose();
assert.equal(borrowedDispose, 0); assert.equal(source.parent, scene);
const handles = EFFECT_IDS.map(effectId => r.enter({ effectId, anchor })); handles.push(r.enter({ effectId: EFFECT_IDS[0], anchor }));
assert.equal(r.enter({ effectId: EFFECT_IDS[0], anchor }), null);
for (let i = 0; i < 600; i++) step(); assert.ok(r.diagnostics().liveParticles <= 96);
r.reset();
const samples = [], bytes = r.diagnostics().poolBytes; let maxLive = 0, maxEmitters = 0;
let randomState = 5; const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
let churn = []; const frame = { dt: 1 / 60, poseRevision: revision, paused: false, hidden: false, reducedMotion: false };
const cpu = new Float64Array(120000);
for (let i = 0; i < cpu.length; i++) {
  if (i % 19 === 0) {
    churn = churn.filter(item => item.state !== 'disposed');
    const item = r.enter({ effectId: EFFECT_IDS[i % 3], anchor, lifetimeSec: .5 + random() * 2,
      durationSec: .5 + random() * 4, rateHz: 12 }); if (item) churn.push(item);
  }
  if (i % 43 === 0 && churn.length) churn[0].stop({ immediate: random() < .5 });
  frame.poseRevision = ++revision; frame.hidden = i % 1700 < 20; frame.reducedMotion = i % 3900 < 20;
  const start = performance.now(); r.tick(frame); cpu[i] = performance.now() - start;
  if (i % 1000 === 0) { const d = r.diagnostics(); assert.equal(d.poolBytes, bytes);
    assert.ok(d.liveParticles <= 96 && d.activeEmitters <= 4); maxLive = Math.max(maxLive, d.liveParticles); maxEmitters = Math.max(maxEmitters, d.activeEmitters); }
  if (i % 20000 === 19999) { global.gc?.(); samples.push({ frames: i + 1, heapUsed: process.memoryUsage().heapUsed,
    arrayBuffers: process.memoryUsage().arrayBuffers, poolBytes: r.diagnostics().poolBytes }); }
}
cpu.sort(); const report = { threeVersion: T.REVISION, scope: 'Node CPU only; no GPU/native/window performance claim',
  frames: cpu.length, simulatedSeconds: cpu.length / 60, deterministicChurn: true,
  invariantChecks: 'lifecycle, stale handles, aggregate caps, borrowed ownership, local/world detachment, hidden/pause/resume/reduced motion',
  maxObservedLive: maxLive, maxObservedEmitters: maxEmitters, poolBytes: bytes,
  cpuUpdateMs: { median: cpu[60000], p95: cpu[114000], p99: cpu[118800], max: cpu[cpu.length - 1] },
  postGcSamples: samples, memoryPlateauClaim: 'Fixed typed pool and stable ArrayBuffer count; heap samples are descriptive, not proof of native/GPU leak absence' };
r.dispose(); r.dispose(); assert.equal(borrowedDispose, 0); assert.throws(() => step()); assert.throws(() => r.enter({ effectId: EFFECT_IDS[0], anchor }));
assert.equal(scene.getObjectByName('BoundedAccessoryEffects'), undefined);
source.material.dispose(); borrowedGeometry.dispose();
fs.writeFileSync(new URL('./cpu-evidence.json', import.meta.url), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
// Two independent runtimes with the same injected inputs replay exactly; globals untouched.
function replay(seed) {
  const s = new T.Scene(), a = new T.Object3D(); s.add(a);
  const effect = createEffectRuntime({ THREE: T, scene: s, seed });
  effect.enter({ effectId: 'petal-stream', anchor: a });
  for (let n = 0; n < 180; n++) { a.position.x = n / 180; effect.tick({ dt: 1 / 60, poseRevision: n }); }
  const data = s.getObjectByName('BoundedAccessoryEffects').children[0].instanceMatrix.array.slice();
  effect.dispose(); return data;
}
assert.deepEqual(replay(123), replay(123)); assert.notDeepEqual(replay(123), replay(124));
// Finite doubles must never overflow Three's Float32 instance upload.
{
  const scene = new T.Scene(), anchor = new T.Object3D(); scene.add(anchor);
  const runtime = createEffectRuntime({ THREE: T, scene });
  runtime.enter({ effectId: 'leaf-stream', anchor }); anchor.position.x = 1e100;
  assert.throws(() => runtime.tick({ dt: .01, poseRevision: 0 }), /anchor/);
  anchor.position.x = 0; scene.scale.x = 0;
  assert.throws(() => runtime.tick({ dt: .01, poseRevision: 1 }), /scene/);
  runtime.dispose();
}
