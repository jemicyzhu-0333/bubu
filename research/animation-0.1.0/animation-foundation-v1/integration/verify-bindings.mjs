import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import {
  AUTHORED_HALO_FIXTURE,
  AUTHORED_CLIP_LIBRARY,
} from "../configuration/fixtures/authored.mjs";
const pool = new FoundationPool(),
  actor = await pool.create();
await actor.equip(FIXTURES[4]);
const zero = actor.mounts.get("halo").root.getWorldPosition(new T.Vector3());
const changed = structuredClone(FIXTURES[4]);
changed.mounts[0].offset = [0.02, 0, 0];
await actor.equip(changed);
const moved = actor.mounts.get("halo").root.getWorldPosition(new T.Vector3());
assert(Math.abs(zero.distanceTo(moved) - 0.02) < 1e-8);
const start = actor.f.point(-0.2, 1.4);
actor.f.emit("pointerdown", 0.01, start);
actor.step(0.01);
actor.f.emit("pointermove", 0.1, {
  clientX: start.clientX + 50,
  clientY: start.clientY - 50,
});
actor.step(0.1);
await actor.equip(FIXTURES[4]);
const mount = actor.mounts.get("halo");
const expected = actor.anchors
  .getTransform("crown", { poseRevision: actor.revision })
  .multiply(mount.calibration);
assert.deepEqual(mount.root.matrixWorld.elements, expected.elements);
const before = mount.root.matrixWorld.clone();
actor.step(0.1);
assert.deepEqual(mount.root.matrixWorld.elements, before.elements);
actor.reset();
assert.equal(actor.f.h.state.pointerId, null);
assert.equal(actor.f.target?.captured?.size ?? actor.f.target.captured.size, 0);
assert.equal(actor.f.h.state.mode, "idle");
const renamed = structuredClone(FIXTURES[4]);
renamed.mounts[0].id = "instance-two";
renamed.secondaryMotion[0].mountId = "instance-two";
for (const effect of renamed.effects) effect.mountId = "instance-two";
await actor.equip(renamed);
assert(actor.mounts.has("instance-two"));
await actor.equip(AUTHORED_HALO_FIXTURE, {
  clipLibrary: AUTHORED_CLIP_LIBRARY,
});
actor.step(0.2, { facts: ["greeting"] });
actor.step(0.6, { facts: ["greeting"] });
const q = actor.mounts.get("halo").delta.quaternion.z;
assert(q > 0.05);
actor.step(2, { facts: ["greeting"] });
assert(Math.abs(actor.mounts.get("halo").delta.quaternion.z) < 1e-12);
actor.step(3, { hidden: true });
assert.equal(actor.f.h.state.hidden, true);
actor.step(4);
assert.equal(actor.f.h.state.hidden, false);
pool.dispose();
const report = {
  nonzeroOffsetDistance: zero.distanceTo(moved),
  equipDuringDragUsesRestBinding: true,
  resetReleasesPointerAndFace: true,
  arbitraryInstanceId: true,
  authoredHaloQuaternionZ: q,
  authoredExitNeutral: true,
  hiddenPolicySuspendsBody: true,
};
fs.writeFileSync(
  new URL("./evidence/binding-report.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(report);
