import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createMixedBindingAdapter } from "../mixed-binding-adapter.mjs";
const names = [
  "Bubu_body",
  "Bubu_hand-left",
  "Bubu_hand-right",
  "Bubu_foot-left",
  "Bubu_foot-right",
];
function geometry() {
  const g = new T.BoxGeometry(),
    count = g.attributes.position.count;
  const indices = new Uint16Array(count * 4),
    weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = 0;
    indices[i * 4 + 1] = 3;
    weights[i * 4] = 0.35;
    weights[i * 4 + 1] = 0.65;
  }
  g.setAttribute("skinIndex", new T.BufferAttribute(indices, 4));
  g.setAttribute("skinWeight", new T.BufferAttribute(weights, 4));
  return g;
}
function fixture() {
  const parent = new T.Group(),
    sourceSkin = new T.SkinnedMesh(geometry(), new T.MeshBasicMaterial());
  parent.add(sourceSkin);
  const bones = names.map(() => new T.Bone());
  bones.forEach((b) => sourceSkin.add(b));
  sourceSkin.bind(new T.Skeleton(bones));
  const parts = new T.Group();
  for (const name of names) {
    const mesh = new T.Mesh(sourceSkin.geometry, sourceSkin.material);
    mesh.name = name;
    parts.add(mesh);
  }
  let current = true;
  return {
    THREE: T,
    sourceSkin,
    parts,
    bones,
    parent,
    assertSourceCurrent() {
      if (!current) throw Error("stale");
    },
    stale() {
      current = false;
    },
  };
}
function compare(f, a) {
  f.parent.updateMatrixWorld(true);
  const p = new T.Vector3(),
    q = new T.Vector3();
  for (const m of a.nativeMeshes)
    for (let i = 0; i < m.geometry.attributes.position.count; i++) {
      f.sourceSkin
        .getVertexPosition(i, p)
        .applyMatrix4(f.sourceSkin.matrixWorld);
      m.getVertexPosition(i, q).applyMatrix4(m.matrixWorld);
      assert.ok(p.distanceTo(q) < 1e-10);
    }
}
test("native body and feet reproduce original weighted skin through actor motion", () => {
  const f = fixture(),
    a = createMixedBindingAdapter(f);
  compare(f, a);
  f.bones[3].rotation.z = 0.14;
  f.bones[3].position.x = 0.2;
  f.parent.position.set(2, 3, 1);
  f.parent.rotation.y = 0.4;
  a.update();
  compare(f, a);
  a.nativeMeshes.forEach((m) => {
    assert.equal(m.skeleton, f.sourceSkin.skeleton);
    assert.equal(m.geometry, f.sourceSkin.geometry);
    assert.equal(m.frustumCulled, false);
  });
  assert.equal(
    a.root.getObjectByName("Bubu_hand-left").isSkinnedMesh,
    undefined,
  );
  a.dispose();
});
test("concurrent actors can share geometry but never cross skeleton ownership", () => {
  const f = fixture(),
    g = fixture();
  g.parts = f.parts;
  const a = createMixedBindingAdapter(f),
    b = createMixedBindingAdapter(g);
  assert.equal(a.nativeMeshes[0].geometry, b.nativeMeshes[0].geometry);
  assert.notEqual(a.nativeMeshes[0].skeleton, b.nativeMeshes[0].skeleton);
  f.bones[3].rotation.z = 0.1;
  a.update();
  b.update();
  const p = a.nativeMeshes[0].getVertexPosition(0, new T.Vector3()),
    q = b.nativeMeshes[0].getVertexPosition(0, new T.Vector3());
  assert.ok(p.distanceTo(q) > 0.001);
  a.dispose();
  b.update();
  b.dispose();
});
test("disposal restores visibility and never disposes borrowed geometry/material/skeleton", () => {
  const f = fixture();
  let disposed = 0;
  f.sourceSkin.geometry.addEventListener("dispose", () => disposed++);
  f.sourceSkin.material.addEventListener("dispose", () => disposed++);
  const old = f.sourceSkin.skeleton.dispose;
  f.sourceSkin.skeleton.dispose = () => disposed++;
  const a = createMixedBindingAdapter(f);
  a.dispose();
  a.dispose();
  assert.equal(disposed, 0);
  assert.equal(f.sourceSkin.visible, true);
  assert.equal(a.root.parent, null);
  f.sourceSkin.skeleton.dispose = old;
});
test("stale guards and changed source skeleton invalidate owner", () => {
  const f = fixture(),
    a = createMixedBindingAdapter(f);
  f.stale();
  assert.throws(() => a.update(), /stale/);
  assert.equal(a.root.parent, null);
  const g = fixture(),
    b = createMixedBindingAdapter(g);
  g.sourceSkin.skeleton = new T.Skeleton(g.bones);
  assert.throws(() => b.update(), /binding changed/);
  assert.equal(g.sourceSkin.visible, true);
});
test("only hands accept rigid override; malformed native weights fail atomically", () => {
  const f = fixture(),
    a = createMixedBindingAdapter(f);
  assert.throws(
    () => a.update({ limbMatrices: { "Bubu_foot-left": new T.Matrix4() } }),
    /only hand/,
  );
  const m = new T.Matrix4().makeTranslation(0.1, 0, 0);
  a.update({ limbMatrices: { "Bubu_hand-left": m } });
  assert.deepEqual(
    a.root.getObjectByName("Bubu_hand-left").matrix.elements,
    m.elements,
  );
  a.dispose();
  const g = fixture();
  g.sourceSkin.geometry.attributes.skinWeight.array[0] = NaN;
  assert.throws(() => createMixedBindingAdapter(g), /binding/);
  assert.equal(g.sourceSkin.visible, true);
  assert.equal(g.parent.children.length, 1);
});
