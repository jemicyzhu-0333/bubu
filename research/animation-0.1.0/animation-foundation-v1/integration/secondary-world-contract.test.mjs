import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  admitSecondaryAsset,
  createSecondaryMotion,
} from "../secondary-motion/index.mjs";
import {
  geometryIdentity,
  admittedState,
} from "../secondary-motion/asset-admission.mjs";
async function fixture() {
  const asset = new T.Group(),
    descriptor = {
      version: 2,
      profile: {
        chains: [
          [
            [0, 0, 0],
            [0, 1, 0],
          ],
        ],
        proxies: [{ center: [0, 0, 0], radius: 0.5 }],
        colliderLinks: [[0]],
        radius: 0.05,
        stiffness: 1,
        dragForce: 1,
        gravityPower: 0,
        maxAngleRad: 0.25,
      },
      parts: [],
    };
  for (let i = 0; i < 2; i++) {
    const g = new T.BufferGeometry().setAttribute(
      "position",
      new T.Float32BufferAttribute([0, 1, 0, 0.1, 1, 0, 0, 1, 0.1], 3),
    );
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial());
    mesh.name = "part" + i;
    asset.add(mesh);
    descriptor.parts.push({
      name: mesh.name,
      vertexCount: 3,
      geometrySHA256: await geometryIdentity(g),
      jointIndices: Array(12).fill(0),
      weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      pins: [true, true, true],
    });
  }
  const admission = await admitSecondaryAsset({ asset, descriptor });
  return {
    admission,
    close() {
      admission.dispose();
      asset.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
test("secondary rejects scaled, sheared and reflected parent at construction", async () => {
  const f = await fixture();
  try {
    for (const matrix of [
      new T.Matrix4().makeScale(0.5, 0.5, 0.5),
      new T.Matrix4().makeScale(-1, 1, 1),
      new T.Matrix4().set(1, 0.1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
    ]) {
      const parent = new T.Group();
      parent.matrixAutoUpdate = false;
      parent.matrix.copy(matrix);
      parent.matrixWorldNeedsUpdate = true;
      assert.throws(
        () => createSecondaryMotion({ admission: f.admission, parent }),
        /rigid unit-scale/,
      );
      assert.equal(parent.children.length, 0);
    }
  } finally {
    f.close();
  }
});
test("secondary validates parent and sampled world on every display path and fails closed", async () => {
  const f = await fixture();
  try {
    for (const mode of ["no-step", "paused", "resume", "reset", "sampled"]) {
      const parent = new T.Group(),
        m = createSecondaryMotion({ admission: f.admission, parent });
      m.update({ time: 0, paused: mode === "paused" || mode === "resume" });
      const action =
        mode === "sampled"
          ? () =>
              m.update({
                time: 1 / 120,
                sampleAnchor: (t, r) => r.scale.setScalar(0.5),
              })
          : () => {
              parent.scale.setScalar(0.5);
              if (mode === "reset") m.reset();
              else m.update({ time: 1 / 120, paused: mode === "paused" });
            };
      assert.throws(action, /rigid unit-scale/);
      assert.equal(m.diagnostics().disposed, true);
      assert.equal(parent.children.length, 0);
      assert.throws(() => m.update({ time: 1 }), /disposed/);
      m.dispose();
    }
  } finally {
    f.close();
  }
});
test("secondary preserves translated rotated rigid transforms", async () => {
  const f = await fixture(),
    parent = new T.Group();
  parent.position.set(1, 2, 3);
  parent.rotation.y = 0.4;
  const m = createSecondaryMotion({ admission: f.admission, parent });
  try {
    m.update({ time: 0 });
    m.update({ time: 1 / 60 });
    assert.equal(m.diagnostics().disposed, false);
  } finally {
    m.dispose();
    f.close();
  }
});
test("secondary dispose completes all independent releases after observer error", async () => {
  const f = await fixture(),
    parent = new T.Group(),
    m = createSecondaryMotion({ admission: f.admission, parent });
  let released = 0;
  m.parts[0].mesh.geometry.addEventListener("dispose", () => {
    throw Error("observer");
  });
  m.parts[1].mesh.geometry.addEventListener("dispose", () => released++);
  assert.throws(() => m.dispose(), AggregateError);
  assert.equal(released, 1);
  assert.equal(m.diagnostics().disposed, true);
  assert.equal(parent.children.length, 0);
  m.dispose();
  f.close();
});
test("admission disposal releases later parts and cannot be reused after failure", async () => {
  const f = await fixture(),
    state = admittedState(f.admission);
  let released = 0;
  state.parts[0].geometry.addEventListener("dispose", () => {
    throw Error("observer");
  });
  state.parts[1].geometry.addEventListener("dispose", () => released++);
  assert.throws(() => f.admission.dispose(), AggregateError);
  assert.equal(released, 1);
  assert.throws(() => admittedState(f.admission), /Live secondary/);
  f.close();
});
test("reset and sampled callback errors invalidate partially advanced instances", async () => {
  const f = await fixture();
  try {
    for (const mode of ["reset", "callback"]) {
      const parent = new T.Group(),
        m = createSecondaryMotion({ admission: f.admission, parent });
      m.update({ time: 0 });
      assert.throws(() =>
        mode === "reset"
          ? m.reset(NaN)
          : m.update({
              time: 1 / 60,
              sampleAnchor() {
                throw Error("sample failed");
              },
            }),
      );
      assert.equal(m.diagnostics().disposed, true);
      assert.equal(parent.children.length, 0);
      assert.throws(() => m.reset(), /disposed/);
    }
  } finally {
    f.close();
  }
});
test("construction cleans an attachment when a parent observer throws", async () => {
  const f = await fixture(),
    parent = new T.Group();
  parent.addEventListener("childadded", () => {
    throw Error("parent observer");
  });
  try {
    assert.throws(
      () => createSecondaryMotion({ admission: f.admission, parent }),
      /parent observer/,
    );
    assert.equal(parent.children.length, 0);
  } finally {
    f.close();
  }
});
test("equip preserves original failure when lease cleanup also fails", async () => {
  const { FoundationActor } = await import("./foundation-host.mjs");
  const { FIXTURES } = await import("../configuration/fixtures/index.mjs");
  const original = Error("original equipment failure"),
    release = Error("lease cleanup failure");
  let releases = 0;
  const actor = {
    assertActive() {},
    f: { h: { facePort: null } },
    body: { authoredFaces: [] },
    bindings: {
      describe() {
        return { bytes: 0 };
      },
    },
    pendingEquips: 0,
    generation: 1,
    equipLease: null,
    mounts: new Map(),
    budget: {
      reserve() {
        return {
          release() {
            releases++;
            throw release;
          },
        };
      },
    },
    remove() {
      throw original;
    },
  };
  await assert.rejects(
    FoundationActor.prototype.equip.call(actor, FIXTURES[0]),
    (error) => {
      const flatten = (e) => [e, ...(e.errors ?? []).flatMap(flatten)];
      assert(flatten(error).includes(original));
      assert(flatten(error).includes(release));
      return true;
    },
  );
  assert.equal(releases, 1);
  assert.equal(actor.pendingEquips, 0);
});
