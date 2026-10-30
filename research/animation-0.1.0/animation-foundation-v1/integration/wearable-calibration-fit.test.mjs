import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "three";
import { fitWearableCalibration } from "./wearable-calibration-fit.mjs";
import { FoundationPool } from "./foundation-host.mjs";
import { createCompleteOutfit } from "../configuration/fixtures/complete-outfit.mjs";

test("wearable calibration preserves physical support origins and remains a rigid assembly", async () => {
  const pool = new FoundationPool();
  try {
    const actor = await pool.create(), outfit = createCompleteOutfit();
    const profile = JSON.parse(fs.readFileSync(new URL("../secondary-motion/descriptors/satchel.json", import.meta.url)));
    for (const kind of ["satchel", "cape"]) {
      const mount = outfit.mounts.find(m => m.id === kind);
      const anchor = actor.anchors.getTransform(mount.anchor, { poseRevision: actor.revision });
      const base = anchor.clone().invert().multiply(actor.f.h.body.skin.matrixWorld);
      const original = base.clone(), fitted = fitWearableCalibration(kind, base);
      const support = kind === "satchel" ? new T.Vector3(...profile.profile.chains[0][0])
        : new T.Vector3().applyMatrix4(base.clone().invert());
      assert(support.clone().applyMatrix4(base).distanceTo(support.clone().applyMatrix4(fitted)) < 1e-12);
      assert(base.equals(original)); assert(!fitted.equals(base));
      assert(Math.abs(fitted.determinant() - 1) < 1e-12);
      const a = new T.Vector3(.3, .6, -.8), b = new T.Vector3(-.7, .2, .4), distance = a.distanceTo(b);
      assert(Math.abs(a.applyMatrix4(fitted).distanceTo(b.applyMatrix4(fitted)) - distance) < 1e-12);
      const actual = actor.bindings.describe(mount, outfit.secondaryMotion.find(s => s.mountId === mount.id));
      assert(actual.calibration.equals(fitted));
    }
    await actor.equip(outfit); actor.step(0);
  } finally { pool.dispose(); }
});

test("wearable calibration refuses nonrigid or unknown assembly frames", () => {
  assert.throws(() => fitWearableCalibration("unknown", new T.Matrix4()), /Rigid/);
  for (const matrix of [new T.Matrix4().makeScale(2, .5, 1), new T.Matrix4().makeShear(.1, 0, 0, 0, 0, 0),
    new T.Matrix4().makeScale(-1, 1, 1), new T.Matrix4().makeTranslation(NaN, 0, 0)])
    assert.throws(() => fitWearableCalibration("satchel", matrix), /Rigid/);
});
