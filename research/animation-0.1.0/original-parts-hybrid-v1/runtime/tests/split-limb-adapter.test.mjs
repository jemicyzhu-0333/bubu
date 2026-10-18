import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSplitLimbAdapter } from "../split-limb-adapter.mjs";
const names = [
  "Bubu_body",
  "Bubu_hand-left",
  "Bubu_hand-right",
  "Bubu_foot-left",
  "Bubu_foot-right",
];
function fixture() {
  const parent = new THREE.Group();
  const sourceSkin = new THREE.SkinnedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  parent.add(sourceSkin);
  const bones = names.map(() => new THREE.Bone());
  bones.forEach((b) => sourceSkin.add(b));
  sourceSkin.bind(new THREE.Skeleton(bones));
  const parts = new THREE.Group();
  names.forEach((name) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    mesh.name = name;
    parts.add(mesh);
  });
  let current = true;
  const config = {
    THREE,
    sourceSkin,
    parts,
    assertSourceCurrent() {
      if (!current) throw new Error("stale source");
    },
  };
  return {
    ...config,
    parent,
    bones,
    config,
    stale() {
      current = false;
    },
  };
}
function closeMatrix(actual, expected) {
  actual.elements.forEach((v, i) =>
    assert.ok(
      Math.abs(v - expected.elements[i]) < 1e-9,
      `element ${i}: ${v} != ${expected.elements[i]}`,
    ),
  );
}
test("borrows immutable geometry/material and restores visibility without disposing resources", () => {
  const f = fixture();
  const snapshots = f.parts.children.map((m) =>
    Array.from(m.geometry.attributes.position.array),
  );
  let disposed = 0;
  f.parts.children.forEach((m) =>
    m.geometry.addEventListener("dispose", () => disposed++),
  );
  f.sourceSkin.material.addEventListener("dispose", () => disposed++);
  const owner = createSplitLimbAdapter(f.config);
  assert.equal(f.sourceSkin.visible, false);
  assert.equal(owner.root.parent, f.parent);
  owner.root.children.forEach((m, i) => {
    assert.equal(m.geometry, f.parts.children[i].geometry);
    assert.equal(m.material, f.sourceSkin.material);
  });
  for (let i = 0; i < 50; i++)
    owner.update({
      limbMatrices: {
        "Bubu_hand-left": new THREE.Matrix4().makeRotationZ(i / 10),
      },
    });
  f.parts.children.forEach((m, i) =>
    assert.deepEqual(
      Array.from(m.geometry.attributes.position.array),
      snapshots[i],
    ),
  );
  owner.dispose();
  owner.dispose();
  assert.equal(disposed, 0);
  assert.equal(owner.root.parent, null);
  assert.equal(f.sourceSkin.visible, true);
  assert.throws(() => owner.update(), /disposed/);
  createSplitLimbAdapter(f.config).dispose();
});
test("preserves originally invisible source and enforces exclusive owner", () => {
  const f = fixture();
  f.sourceSkin.visible = false;
  const owner = createSplitLimbAdapter(f.config);
  assert.throws(() => createSplitLimbAdapter(f.config), /already/);
  owner.dispose();
  assert.equal(f.sourceSkin.visible, false);
});
test("stale guard detaches owner and restores source; cannot mutate source geometry", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  f.stale();
  assert.throws(() => owner.update(), /stale/);
  assert.equal(owner.root.parent, null);
  assert.equal(f.sourceSkin.visible, true);
});
test("source reparenting fails closed and releases ownership", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  new THREE.Group().add(f.sourceSkin);
  assert.throws(() => owner.update(), /parent changed/);
  assert.equal(owner.root.parent, null);
  assert.equal(f.sourceSkin.visible, true);
});
test("rejects unsupported options, nonfinite, scale, shear and reflection atomically", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  const before = owner.root.children.map((m) => m.matrix.clone());
  const invalid = [
    new THREE.Matrix4().makeScale(2, 1, 1),
    new THREE.Matrix4().makeScale(-1, 1, 1),
    new THREE.Matrix4().makeShear(0.2, 0, 0, 0, 0, 0),
  ];
  const nonfinite = new THREE.Matrix4();
  nonfinite.elements[12] = NaN;
  invalid.push(nonfinite);
  for (const matrix of invalid)
    assert.throws(() =>
      owner.update({
        limbMatrices: {
          "Bubu_hand-left": new THREE.Matrix4().makeTranslation(7, 0, 0),
          "Bubu_foot-right": matrix,
        },
      }),
    );
  assert.throws(() => owner.update({ bodyClosure: true }), /Unsupported/);
  assert.throws(
    () => owner.update({ limbMatrices: { bad: new THREE.Matrix4() } }),
    /Unknown/,
  );
  owner.root.children.forEach((m, i) => closeMatrix(m.matrix, before[i]));
});
test("invalid skeleton pose fails atomically and failed creation leaves source attached and visible", () => {
  const f = fixture();
  f.bones[4].scale.x = 2;
  assert.throws(() => createSplitLimbAdapter(f.config), /scale/);
  assert.equal(f.sourceSkin.visible, true);
  assert.equal(f.parent.children.length, 1);
  f.bones[4].scale.x = 1;
  const owner = createSplitLimbAdapter(f.config);
  const before = owner.root.children.map((m) => m.matrix.clone());
  f.bones[1].position.x = 2;
  f.bones[4].scale.x = 2;
  assert.throws(() => owner.update(), /scale/);
  owner.root.children.forEach((m, i) => closeMatrix(m.matrix, before[i]));
});
test("manual source local matrix is respected", () => {
  const f = fixture();
  f.sourceSkin.matrixAutoUpdate = false;
  f.sourceSkin.matrix.makeTranslation(3, 2, 1);
  const expected = f.sourceSkin.matrix.clone();
  const owner = createSplitLimbAdapter(f.config);
  closeMatrix(f.sourceSkin.matrix, expected);
  closeMatrix(owner.root.matrix, expected);
});
test("attached bind inverse follows moved source without requiring render first", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  f.parent.position.set(2, 1, 0);
  f.sourceSkin.position.set(3, 0, 0);
  f.bones[1].rotation.z = 0.5;
  owner.update();
  closeMatrix(
    owner.root.children[1].matrix,
    new THREE.Matrix4().makeRotationZ(0.5),
  );
  owner.root.children
    .slice(2)
    .forEach((m) => closeMatrix(m.matrix, new THREE.Matrix4()));
});
test("detached bind mode preserves bind-space behavior", () => {
  const f = fixture();
  f.sourceSkin.bindMode = THREE.DetachedBindMode;
  f.sourceSkin.position.x = 3;
  const owner = createSplitLimbAdapter(f.config);
  closeMatrix(
    owner.root.children[1].matrix,
    new THREE.Matrix4().makeTranslation(3, 0, 0),
  );
});
test("explicit proper rigid transforms are copied and never mutated", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  const matrix = new THREE.Matrix4().makeRotationY(0.4).setPosition(1, 2, 3);
  const before = matrix.clone();
  owner.update({ limbMatrices: { "Bubu_hand-right": matrix } });
  closeMatrix(owner.root.children[2].matrix, matrix);
  closeMatrix(matrix, before);
  matrix.identity();
  closeMatrix(owner.root.children[2].matrix, before);
});
test("requires current source guard, named static parts and morph-free geometry", () => {
  const f = fixture();
  assert.throws(
    () =>
      createSplitLimbAdapter({ ...f.config, assertSourceCurrent: undefined }),
    /guard/,
  );
  f.parts.children[0].geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute([0, 0, 0], 3),
  ];
  assert.throws(() => createSplitLimbAdapter(f.config), /static/);
  delete f.parts.children[0].geometry.morphAttributes.position;
  f.parts.children[0].name = "wrong";
  assert.throws(() => createSplitLimbAdapter(f.config), /static/);
  assert.equal(f.sourceSkin.visible, true);
  assert.equal(f.parent.children.length, 1);
  f.parts.children[0].name = names[0];
  f.parts.children[0].isSkinnedMesh = true;
  assert.throws(() => createSplitLimbAdapter(f.config), /static/);
});
test("attachment failure rolls back source visibility and ownership", () => {
  const f = fixture();
  const fail = () => {
    throw new Error("attachment failed");
  };
  f.parent.addEventListener("childadded", fail);
  assert.throws(() => createSplitLimbAdapter(f.config), /attachment failed/);
  assert.equal(f.sourceSkin.visible, true);
  assert.equal(f.parent.children.length, 1);
  f.parent.removeEventListener("childadded", fail);
  createSplitLimbAdapter(f.config).dispose();
});
test("all borrowed vertex attributes, indices and material values stay unchanged", () => {
  const f = fixture();
  const geometries = [
    f.sourceSkin.geometry,
    ...f.parts.children.map((m) => m.geometry),
  ];
  const snapshot = () =>
    geometries.map((g) => ({
      attributes: Object.fromEntries(
        Object.entries(g.attributes).map(([k, a]) => [k, Array.from(a.array)]),
      ),
      index: Array.from(g.index.array),
      groups: structuredClone(g.groups),
    }));
  const before = snapshot();
  const material = f.sourceSkin.material.toJSON();
  const owner = createSplitLimbAdapter(f.config);
  for (let i = 0; i < 100; i++) {
    f.bones[1].rotation.z = i / 20;
    f.bones[3].position.x = i / 100;
    owner.update();
  }
  owner.dispose();
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(f.sourceSkin.material.toJSON(), material);
});
test("rigid skeleton pose is correct under translated and rotated actor ancestry", () => {
  const f = fixture();
  const owner = createSplitLimbAdapter(f.config);
  f.parent.position.set(5, 3, -2);
  f.parent.rotation.set(0.2, 0.7, 0.3);
  f.sourceSkin.rotation.set(0.3, -0.2, 0.1);
  f.bones[2].position.set(0.2, -0.1, 0.3);
  f.bones[2].rotation.set(0.1, 0.3, -0.2);
  owner.update();
  closeMatrix(owner.root.children[2].matrix, f.bones[2].matrix);
});
