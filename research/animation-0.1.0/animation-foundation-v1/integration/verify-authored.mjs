import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { AUTHORED_CASES } from "../configuration/fixtures/authored.mjs";
import { createDetachedProp } from "../secondary-motion/rapier.mjs";
const results = [];
for (const authored of AUTHORED_CASES) {
  const pool = new FoundationPool(),
    actor = await pool.create({ authoredFaces: authored.authoredFaces });
  const contactEvents = [];
  await actor.equip(authored.configuration, {
    clipLibrary: authored.clipLibrary,
    contactPort: (event) => contactEvents.push(event),
  });
  let physics,
    book,
    center,
    processed = 0,
    releaseDelta = null;
  if (actor.mounts.has("book")) {
    book = actor.mounts.get("book");
    const box = new T.Box3().setFromObject(book.asset);
    center = box.getCenter(new T.Vector3());
    const object = new T.Group(),
      content = book.asset.clone(true);
    content.position.sub(center);
    object.add(content);
    physics = await createDetachedProp({
      object,
      parent: actor.mountRoot,
      halfExtents: box.getSize(new T.Vector3()).multiplyScalar(0.5).toArray(),
    });
    physics.root.visible = false;
  }
  let maxQuaternion = 0,
    faceAmount = 0,
    faceOwners = new Set();
  for (let i = 0; i <= 120; i++) {
    const time = i / 60;
    const state = actor.step(time, { facts: ["acknowledge"] });
    faceAmount = Math.max(faceAmount, state.face?.amount ?? 0);
    faceOwners.add(state.face?.owner ?? "none");
    for (const item of actor.mounts.values())
      maxQuaternion = Math.max(
        maxQuaternion,
        Math.abs(item.delta.quaternion.z),
      );
    if (physics) {
      const pose = book.delta.matrixWorld
        .clone()
        .multiply(new T.Matrix4().makeTranslation(...center.toArray()));
      while (processed < contactEvents.length) {
        const event = contactEvents[processed++];
        if (event.active) {
          physics.reset(event.time, pose);
          book.root.visible = true;
          physics.root.visible = false;
        } else {
          physics.setHeldPose(pose);
          const before = physics.root.matrixWorld.clone();
          physics.release();
          releaseDelta = Math.max(
            ...before.elements.map((v, j) =>
              Math.abs(v - physics.root.matrixWorld.elements[j]),
            ),
          );
          book.root.visible = false;
          physics.root.visible = true;
        }
      }
      if (!physics.diagnostics().released) physics.setHeldPose(pose);
      physics.update({ time });
    }
  }
  assert(faceAmount > 0, "authored face executes");
  assert.equal(actor.strategy.snapshot().phase, "idle");
  if (authored.clipLibrary) assert(maxQuaternion > 0.05);
  if (physics) {
    assert(contactEvents.some((e) => e.active));
    assert(contactEvents.some((e) => !e.active));
    assert.equal(releaseDelta, 0);
    physics.dispose();
  }
  results.push({
    fixture: authored.configuration.id,
    faceAmount,
    faceOwners: [...faceOwners],
    maxQuaternion,
    contactEvents,
    releaseDelta,
    secondary: [...actor.mounts.values()]
      .filter((x) => x.secondary)
      .map((x) => x.secondary.diagnostics()),
  });
  actor.reset();
  pool.dispose();
  assert.equal(pool.diagnostics().budget.claimedBytes, 0);
}
fs.writeFileSync(
  new URL("./evidence/authored-actions-report.json", import.meta.url),
  JSON.stringify(
    {
      scope:
        "Real D2 sole face owner, existing QuaternionLane, config event/contact ports, optional synthetic Rapier book release; CPU research only",
      results,
    },
    null,
    2,
  ),
);
console.log(results);
