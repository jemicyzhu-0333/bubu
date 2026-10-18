import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { loadGLB, source, hybrid, sha256 } from "./asset-fixtures.mjs";
const report = {
  scope:
    "CPU actual D2 pointer host + unchanged hybrid + real revised accessory meshes. Not native input, WebGL, GPU, or complete contact acceptance.",
  tests: {},
  scenarios: {},
  inputHashes: { source: sha256(source), hybrid: sha256(hybrid) },
};
report.modules = Object.fromEntries(
  [
    "../secondary-motion/index.mjs",
    "../secondary-motion/rapier.mjs",
    "../body-runtime/surface-query.mjs",
    "../body-runtime/pointer-host.mjs",
    "../package-lock.json",
    "./foundation-host.mjs",
    "./asset-fixtures.mjs",
  ].map((p) => [p, sha256(new URL(p, import.meta.url))]),
);
const pool = new FoundationPool(),
  actor = await pool.create();
const arrays = () => {
  const all = [];
  actor.f.h.body.root.traverse((m) => {
    if (m.geometry)
      for (const [key, a] of Object.entries(m.geometry.attributes))
        all.push([a.array, a.array.slice(), m.name, key]);
  });
  return all;
};
const originals = arrays();
const verifyOriginals = () =>
  originals.forEach(([a, b, n, k]) => assert.deepEqual(a, b, n + " " + k));
function verifyFrame(a) {
  assert.deepEqual(a.trace, [
    "body",
    "anchors",
    "secondary",
    "accessory-transforms",
    "effects",
    "render",
  ]);
  for (const item of a.mounts.values()) {
    assert(item.root.matrixWorld.elements.every(Number.isFinite));
    item.root.traverse((m) => {
      if (m.geometry)
        assert(m.geometry.attributes.position.array.every(Number.isFinite));
    });
    if (item.secondary) assert(item.secondary.diagnostics().maxSubsteps <= 6);
  }
}
function hit(a) {
  const p = a.f.h.body.skin
    .localToWorld(new T.Vector3(-0.2, 1.4, 0))
    .project(a.f.camera);
  return { clientX: (p.x + 1) * 192, clientY: (1 - p.y) * 192 };
}
const timings = [];
report.slowFrames = [];
for (const config of FIXTURES) {
  await actor.equip(config);
  const start = actor.time;
  let p = hit(actor);
  const modes = new Set();
  let maxSteps = 0;
  for (let i = 1; i <= 180; i++) {
    const t = start + i / 60;
    if (i === 3) actor.f.emit("pointerdown", t, p);
    if (i > 20 && i < 90) {
      p = { clientX: p.clientX + Math.sin(i) * 3, clientY: p.clientY - 1 };
      actor.f.emit("pointermove", t, p);
    }
    if (i === 90) actor.f.emit("pointerup", t, p);
    const queriesBefore = actor.f.h.diagnostics.surface.queries;
    const refitsBefore = actor.f.h.diagnostics.surface.refits;
    const begin = performance.now();
    const s = actor.step(t);
    const elapsedMs = performance.now() - begin;
    timings.push(elapsedMs);
    if (elapsedMs > 16.667)
      report.slowFrames.push({ fixture: config.id, frame: i, mode: s.mode, elapsedMs,
        queries: actor.f.h.diagnostics.surface.queries - queriesBefore,
        refits: actor.f.h.diagnostics.surface.refits - refitsBefore });
    modes.add(s.mode);
    verifyFrame(actor);
    for (const x of actor.mounts.values())
      maxSteps = Math.max(
        maxSteps,
        x.secondary?.diagnostics().maxSubsteps ?? 0,
      );
  }
  assert(modes.has("drag"));
  report.scenarios[config.id] = {
    frames: 180,
    modes: [...modes],
    maxSubsteps: maxSteps,
    resources: [...actor.mounts.values()].map((x) => ({
      id: x.spec.id,
      ...x.resources,
    })),
    researchOnly:
      config.id === "held-book-release"
        ? "Grip/contact not authored; release tested separately"
        : true,
  };
  verifyOriginals();
}
console.log("Five fixture drag sweeps passed");
report.tests.fiveRealAssetFixtures = true;
report.tests.bodyGeometryImmutable = true;
// Long hold remains owned by actual pointer host, not a short playback approximation.
await actor.equip(FIXTURES[1]);
let p = hit(actor),
  base = actor.time;
actor.f.emit("pointerdown", base + 0.01, p);
actor.step(base + 0.01);
let pettingFrames = 0;
for (let i = 1; i <= 1860; i++) {
  const s = actor.step(base + 0.01 + i / 30);
  if (s.mode === "petting") pettingFrames++;
}
assert(pettingFrames > 1750);
assert.equal(actor.f.h.state.pointerId, 1);
p = { clientX: p.clientX + 110, clientY: p.clientY - 95 };
actor.f.emit("pointermove", actor.time + 0.01, p);
assert.equal(actor.step(actor.time + 0.01).mode, "drag");
actor.f.emit("pointerup", actor.time + 0.01, p);
actor.step(actor.time + 0.01);
report.tests.hold62SecondsThenFastDrag = { pettingFrames };
console.log("62-second long hold and fast drag passed");
// Cancellation, lost capture, hidden resume and immediate repress on live DOM host.
for (const type of ["pointercancel", "lostpointercapture"]) {
  p = hit(actor);
  actor.f.emit("pointerdown", actor.time + 0.01, p);
  actor.step(actor.time + 0.01);
  actor.f.emit(type, actor.time + 0.01, p);
  actor.step(actor.time + 0.01);
  assert.equal(actor.f.h.state.pointerId, null);
}
p = hit(actor);
actor.f.emit("pointerdown", actor.time + 0.01, p);
actor.step(actor.time + 0.01);
actor.f.at(actor.time + 0.01);
actor.f.doc.hidden = true;
actor.f.doc.emit("visibilitychange");
actor.step(actor.time + 0.02, { hidden: true });
assert.equal(actor.f.h.state.pointerId, null);
actor.f.at(actor.time + 2);
actor.f.doc.hidden = false;
actor.f.doc.emit("visibilitychange");
actor.step(actor.time + 2);
verifyFrame(actor);
report.tests.cancelLostCaptureHiddenResume = true;
p = hit(actor);
actor.f.emit("pointerdown", actor.time + 0.01, p);
actor.step(actor.time + 0.01);
assert.equal(actor.f.h.state.pointerId, 1);
actor.f.emit("pointercancel", actor.time + 0.01, p);
actor.step(actor.time + 0.01);
report.tests.regrab = true;
actor.step(actor.time + 100);
verifyFrame(actor);
actor.reset();
actor.reset();
verifyFrame(actor);
report.tests.frameGapReset = true;
// Async generation rejection and bounded pending requests.
let resolveFirst, resolveSecond;
const delayed = () =>
  new Promise((r) => {
    if (!resolveFirst) resolveFirst = r;
    else resolveSecond = r;
  });
const a1 = actor.equip(FIXTURES[4], { load: delayed });
actor.remove();
const a2 = actor.equip(FIXTURES[4], { load: delayed });
await assert.rejects(actor.equip(FIXTURES[4], { load: delayed }), /budget/);
actor.remove();
const path =
  (await import("./asset-fixtures.mjs")).revised +
  "/accessory-expansion/models/05-halo.glb";
resolveFirst(await loadGLB(path));
resolveSecond(await loadGLB(path));
assert((await a1).stale);
assert((await a2).stale);
assert.equal(actor.mounts.size, 0);
assert.equal(actor.pendingEquips, 0);
report.tests.staleAsyncAndPendingBudget = true;
await actor.equip(FIXTURES[4]);
const second = await pool.create();
await second.equip(FIXTURES[4]);
await assert.rejects(pool.create(), /budget/);
const secondMatrix = second.mounts.get("halo").root.matrixWorld.clone();
actor.f.h.body.root.position.x += 1;
actor.step(actor.time + 0.1);
assert.deepEqual(second.mounts.get("halo").root.matrixWorld, secondMatrix);
actor.remove();
second.step(0.1);
assert(second.mounts.get("halo").root.parent);
second.dispose();
report.tests.twoActorIsolation = true;
// Measure churn rather than claim a flat JS heap; exact live counts are the hard invariant.
global.gc?.();
const before = process.memoryUsage().heapUsed;
const churnStart = performance.now();
for (let i = 0; i < 60; i++) {
  await actor.equip(FIXTURES[i % 5]);
  actor.step(actor.time + 1 / 60);
  actor.remove();
  assert.equal(actor.mountRoot.children.length, 1);
  assert.equal(actor.mounts.size, 0);
}
global.gc?.();
report.churn = {
  cycles: 60,
  elapsedMs: performance.now() - churnStart,
  heapBefore: before,
  heapAfter: process.memoryUsage().heapUsed,
  gcAvailable: typeof global.gc === "function",
};
verifyOriginals();
report.surfaceQuery = { ...actor.f.h.diagnostics.surface };
pool.dispose();
assert.equal(pool.diagnostics().actors, 0);
assert.equal(pool.pending, 0);
assert.equal(pool.budget.diagnostics().claimedBytes, 0);
assert.equal(actor.f.h.diagnostics.surface.vertexBytes, 0);
for (const key of ["actors", "vertices", "nodes", "active", "pending"])
  assert.equal(actor.f.h.pool.stats[key], 0, key);
report.tests.disposalResourceZero = true;
timings.sort((a, b) => a - b);
report.cpuFrameMs = {
  samples: timings.length,
  median: timings[Math.floor(timings.length * 0.5)],
  p95: timings[Math.floor(timings.length * 0.95)],
  max: timings.at(-1),
  includes: "body + hybrid + anchors + secondary + effects; excludes GPU",
};
assert.equal(sha256(source), report.inputHashes.source);
assert.equal(sha256(hybrid), report.inputHashes.hybrid);
fs.writeFileSync(
  new URL("./evidence/integration-report.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
