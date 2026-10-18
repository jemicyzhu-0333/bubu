import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { createDetachedProp } from "../secondary-motion/rapier.mjs";
const report = {
  scope:
    "Actual open-book mesh and actual palm anchor; synthetic cuboid+ground contact only, no authored hand action or native acceptance",
  rates: {},
};
for (const fps of [30, 60, 120]) {
  const pool = new FoundationPool(),
    actor = await pool.create();
  await actor.equip(FIXTURES[3]);
  const item = actor.mounts.get("book");
  const bbox = new T.Box3().setFromObject(item.asset),
    center = bbox.getCenter(new T.Vector3()),
    extents = bbox.getSize(new T.Vector3()).multiplyScalar(0.5);
  const object = new T.Group(),
    content = item.asset.clone(true);
  content.position.sub(center);
  object.add(content);
  const physics = await createDetachedProp({
    object,
    parent: actor.mountRoot,
    halfExtents: extents.toArray(),
  });
  item.root.visible = false;
  const pose = new T.Matrix4()
    .copy(item.root.matrixWorld)
    .multiply(new T.Matrix4().makeTranslation(...center.toArray()));
  physics.reset(0, pose);
  let releasePose,
    minMeshY = Infinity,
    releaseDelta;
  for (let i = 1; i <= fps * 4; i++) {
    const t = i / fps;
    actor.step(t);
    if (i < fps) {
      const m = actor.anchors.getTransform("palm.gripR", {
        poseRevision: actor.revision,
      });
      physics.setHeldPose(m);
    }
    if (i === fps) {
      releasePose = physics.root.matrixWorld.clone();
      physics.release();
      releaseDelta = Math.max(
        ...physics.root.matrixWorld.elements.map((v, j) =>
          Math.abs(v - releasePose.elements[j]),
        ),
      );
      assert.equal(releaseDelta, 0);
      assert.throws(() => physics.setHeldPose(pose), /solver-owned/);
    }
    physics.update({ time: t });
    if (i >= fps) {
      const v = new T.Vector3();
      physics.root.traverse((m) => {
        if (!m.isMesh) return;
        for (let j = 0; j < m.geometry.attributes.position.count; j++) {
          m.getVertexPosition(j, v).applyMatrix4(m.matrixWorld);
          minMeshY = Math.min(minMeshY, v.y);
        }
      });
    }
  }
  const final = physics.diagnostics();
  assert(final.released);
  assert(final.position.y > -0.01);
  assert(final.position.y < 0.5);
  assert(physics.root.matrixWorld.elements.every(Number.isFinite));
  physics.reset(4, releasePose);
  assert.equal(physics.diagnostics().released, false);
  physics.release();
  physics.update({ time: 104, paused: true });
  physics.update({ time: 104.1 });
  physics.dispose();
  assert.equal(physics.diagnostics().bodies, 0);
  assert.equal(physics.diagnostics().colliders, 0);
  pool.dispose();
  report.rates[fps] = {
    position: final.position,
    velocity: final.velocity,
    minMeshY,
    releasePoseDelta: releaseDelta,
    steps: final.steps,
    resetRegrab: true,
    disposed: true,
  };
}
report.rateError30vs120 = {};
for (const axis of ["x", "y", "z"])
  report.rateError30vs120[axis] = Math.abs(
    report.rates[30].position[axis] - report.rates[120].position[axis],
  );
report.outstanding = [
  "Fast thin-edge CCD acceptance not covered",
  "Synthetic cuboid does not establish detailed book contact",
];
for (const axis of ["x", "y", "z"])
  assert(
    Math.abs(
      report.rates[30].position[axis] - report.rates[120].position[axis],
    ) < 0.06,
  );
fs.writeFileSync(
  new URL("./evidence/book-release-report.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
