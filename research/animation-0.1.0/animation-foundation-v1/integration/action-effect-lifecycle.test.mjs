import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createEffectRuntime } from "../effects/bounded-effects.mjs";
import { FoundationPool, FoundationActor } from "./foundation-host.mjs";
import {
  AUTHORED_HALO_FIXTURE,
  AUTHORED_CLIP_LIBRARY,
} from "../configuration/fixtures/authored.mjs";

function setup() {
  const scene = new T.Group();
  const anchor = new T.Object3D();
  const effects = createEffectRuntime({ THREE: T, scene });
  const enter = () =>
    effects.enter({ effectId: "halo-sparks", anchor, rateHz: 0 });
  return { scene, effects, enter };
}

test("entering burst is bounded and consumed once at the next current-pose tick", () => {
  const { effects, enter } = setup();
  const h = enter();
  assert.equal(h.burst(6), 6);
  assert.equal(h.burst(6), 2);
  assert.equal(h.liveCount, 0);
  effects.tick({ dt: 0, poseRevision: 1 });
  assert.equal(h.liveCount, 8);
  effects.tick({ dt: 0, poseRevision: 2 });
  assert.equal(h.liveCount, 8);
  h.stop();
  assert.equal(h.burst(2), 0);
  const next = enter();
  assert.equal(next.burst(2), 2);
  effects.tick({ dt: 0, poseRevision: 3 });
  assert.equal(next.liveCount, 2);
  effects.dispose();
});

for (const policy of ["hidden", "paused", "reducedMotion"]) {
  test(`entering burst is discarded under ${policy}, never replayed on resume`, () => {
    const { effects, enter } = setup();
    const h = enter();
    h.burst(2);
    effects.tick({ dt: 0, poseRevision: 1, [policy]: true });
    assert.equal(h.liveCount, 0);
    effects.tick({ dt: 0, poseRevision: 2 });
    assert.equal(h.liveCount, 0);
    h.reset();
    h.burst(2);
    h.stop();
    effects.tick({ dt: 0, poseRevision: 3 });
    assert.equal(h.liveCount, 0);
    effects.dispose();
  });
}

test("throwing effect disposal observer cannot skip other resources or keep runtime valid", () => {
  const { effects, scene, enter } = setup();
  const h = enter(),
    root = scene.children[0];
  let meshes = 0,
    geometry = 0,
    materials = 0;
  const materialSet = new Set();
  root.traverse((x) => {
    if (x.material) materialSet.add(x.material);
  });
  root.children[0].geometry.addEventListener("dispose", () => geometry++);
  for (const material of materialSet)
    material.addEventListener("dispose", () => materials++);
  for (const child of root.children.filter((x) => x.isInstancedMesh))
    child.addEventListener("dispose", () => {
      meshes++;
      if (meshes === 1) throw Error("observer");
    });
  assert.throws(() => effects.dispose(), AggregateError);
  assert.equal(meshes, 4);
  assert.equal(geometry, 1);
  assert.equal(materials, materialSet.size);
  assert.equal(scene.children.length, 0);
  assert.equal(effects.diagnostics().disposed, true);
  assert.equal(h.state, "disposed");
  assert.equal(h.burst(2), 0);
  assert.throws(() => enter(), /disposed/);
  effects.dispose();
  assert.equal(meshes, 4);
});

test("real authored action reopens burst; duplicate timestamp does not recommit canonical body; hidden rewind cleans actor", async () => {
  const pool = new FoundationPool({ maxActors: 1 });
  try {
    const actor = await pool.create();
    const config = structuredClone(AUTHORED_HALO_FIXTURE);
    for (const effect of config.effects) effect.rateHz = 0;
    await actor.equip(config, { clipLibrary: AUTHORED_CLIP_LIBRARY });
    const step = (t, facts = ["greeting"]) => actor.step(t, { facts });
    step(0.01);
    step(0.4);
    assert.equal(actor.handles[0].liveCount, 2);
    step(0.9);
    assert.equal(actor.handles[0].state, "disposed");
    step(2);
    step(2.1, []);
    step(2.2);
    step(2.6);
    assert.equal(actor.handles[0].liveCount, 2);
    const commits = actor.f.h.diagnostics.commits;
    step(2.6);
    assert.equal(actor.f.h.diagnostics.commits, commits);
    assert.equal(actor.handles[0].liveCount, 2);
    assert.throws(() => actor.step(1, { hidden: true }), /Monotonic reset/);
    assert.equal(actor.disposed, true);
    assert.equal(pool.budget.diagnostics().claimedBytes, 0);
    assert.equal(pool.actors.size, 0);
  } finally {
    pool.dispose();
  }
});

test("pre-frame suspend error and disposal error are both preserved", () => {
  const actor = Object.create(FoundationActor.prototype);
  actor.disposed = false;
  actor.f = {
    doc: { hidden: false },
    h: {
      suspend() {
        throw Error("suspend failed");
      },
    },
  };
  actor.dispose = () => {
    actor.disposed = true;
    throw Error("dispose failed");
  };
  assert.throws(
    () => actor.step(1, { reducedMotion: true }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0].message === "suspend failed" &&
      error.errors[1].message === "dispose failed",
  );
  assert.equal(actor.disposed, true);
});

for (const policy of ["hidden", "paused", "reducedMotion"]) {
  test(`deferred action burst uses current ${policy} policy, including resume frame`, () => {
    const { effects, enter } = setup();
    const h = enter();
    effects.tick({ dt: 0, poseRevision: 1, [policy]: true });
    assert.equal(h.burst(2), 2);
    effects.tick({ dt: 0, poseRevision: 2 });
    assert.equal(h.liveCount, 2);
    h.reset();
    effects.tick({ dt: 0, poseRevision: 3 });
    assert.equal(h.burst(2), 2);
    effects.tick({ dt: 0, poseRevision: 4, [policy]: true });
    assert.equal(h.liveCount, 0);
    effects.tick({ dt: 0, poseRevision: 5 });
    assert.equal(h.liveCount, 0);
    effects.dispose();
  });
}
