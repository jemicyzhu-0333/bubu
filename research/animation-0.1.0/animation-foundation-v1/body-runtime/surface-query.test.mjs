import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import { createSurfaceQuery } from "./surface-query.mjs";
import { fixture } from "./fixture.mjs";

function compare(skin, query, caster) {
  skin.computeBoundingSphere();
  const nativeHits = caster.intersectObject(skin, false);
  let expected = nativeHits[0] ?? null;
  const actual = query.firstHit(caster);
  assert.equal(!!actual, !!expected);
  if (actual) {
    assert.equal(actual.object, skin);
    assert.ok(actual.point.distanceTo(expected.point) < 1e-8);
    assert.ok(Math.abs(actual.distance - expected.distance) < 1e-8);
    // Shared edges and overlapping reflected faces can be co-nearest. BVH
    // traversal need not reproduce the native triangle iteration tie order,
    // but the reported face must itself be a native co-nearest intersection.
    expected = nativeHits.find(
      (hit) =>
        hit.faceIndex === actual.faceIndex &&
        Math.abs(hit.distance - nativeHits[0].distance) < 1e-8,
    );
    assert.ok(expected, "reported face must be a native co-nearest face");
    assert.ok(actual.face.normal.distanceTo(expected.face.normal) < 1e-7);
    assert.deepEqual(
      [actual.face.a, actual.face.b, actual.face.c, actual.face.materialIndex],
      [
        expected.face.a,
        expected.face.b,
        expected.face.c,
        expected.face.materialIndex,
      ],
    );
    if (expected.uv) assert.ok(actual.uv.distanceTo(expected.uv) < 1e-7);
    if (expected.normal)
      assert.ok(actual.normal.distanceTo(expected.normal) < 1e-7);
    assert.ok(actual.barycoord.distanceTo(expected.barycoord) < 1e-7);
  }
}

test("approved D2 surface matches native hits and never mutates source geometry", async () => {
  const f = await fixture(),
    skin = f.h.body.skin;
  const position = skin.geometry.attributes.position.array.slice(),
    index = skin.geometry.index.array.slice(),
    vertexMethod = skin.getVertexPosition;
  const query = createSurfaceQuery({
    THREE: T,
    MeshBVH,
    skin,
    assertCurrent: () => f.h.owner.assertCurrent(),
  });
  const caster = new T.Raycaster();
  try {
    for (let pose = 0; pose < 4; pose++) {
      f.h.body.applyPose({
        body: { z: pose * 0.04 },
        joints: {
          Shoulder_L: { z: -pose * 0.05 },
          Shoulder_R: { z: pose * 0.06 },
          Hip_L: { x: pose * 0.03 },
        },
      });
      skin.updateWorldMatrix(true, false);
      for (const [x, y] of [
        [0, 1.4],
        [-0.6, 1.5],
        [0.6, 1.3],
        [0, 0.3],
        [1.5, 1.5],
      ]) {
        const p = new T.Vector3(x, y, 0).project(f.camera);
        caster.setFromCamera(new T.Vector2(p.x, p.y), f.camera);
        compare(skin, query, caster);
      }
    }
    const refits = query.diagnostics.refits;
    query.firstHit(caster);
    query.firstHit(caster);
    assert.equal(query.diagnostics.refits, refits);
    assert.deepEqual(skin.geometry.attributes.position.array, position);
    assert.deepEqual(skin.geometry.index.array, index);
    assert.equal(skin.getVertexPosition, vertexMethod);
  } finally {
    query.dispose();
    query.dispose();
    assert.equal(query.diagnostics.vertexBytes, 0);
    f.h.dispose();
  }
  assert.throws(() => query.firstHit(caster), /disposed/);
});

function synthetic(relative = true) {
  const geometry = new T.BoxGeometry(1, 1, 1, 2, 2, 2),
    count = geometry.attributes.position.count;
  const joints = new Uint16Array(count * 4),
    weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    joints[i * 4] = 0;
    joints[i * 4 + 1] = 1;
    weights[i * 4] = 0.4;
    weights[i * 4 + 1] = 0.6;
  }
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  const morph = geometry.attributes.position.clone();
  for (let i = 0; i < count; i++)
    morph.setXYZ(
      i,
      relative ? 0.08 : morph.getX(i) + 0.08,
      relative ? 0 : morph.getY(i),
      relative ? 0 : morph.getZ(i),
    );
  geometry.morphAttributes.position = [morph];
  geometry.morphTargetsRelative = relative;
  const skin = new T.SkinnedMesh(
    geometry,
    new T.MeshBasicMaterial({ side: T.DoubleSide }),
  );
  const root = new T.Bone(),
    child = new T.Bone();
  root.add(child);
  skin.add(root);
  skin.bind(new T.Skeleton([root, child]));
  skin.updateMatrixWorld(true);
  return {
    skin,
    child,
    close() {
      geometry.dispose();
      skin.material.dispose();
      skin.skeleton.dispose();
    },
  };
}
for (const relative of [true, false])
  test(`morph ${relative ? "relative" : "absolute"}, nonuniform scale, reflection, ray interval and layers`, () => {
    const { skin, child, close } = synthetic(relative),
      query = createSurfaceQuery({
        THREE: T,
        MeshBVH,
        skin,
        assertCurrent: () => {},
      });
    try {
      for (const influence of [0, 0.35, 1]) {
        skin.morphTargetInfluences[0] = influence;
        child.rotation.z = influence * 0.2;
        skin.scale.set(influence === 1 ? -1.3 : 1.3, 0.8, 1.7);
        skin.rotation.y = 0.2;
        skin.position.set(0.1, 0.2, -0.3);
        skin.updateMatrixWorld(true);
        for (const near of [0, 3.3, 8])
          compare(
            skin,
            query,
            new T.Raycaster(
              new T.Vector3(0.1, 0.2, 4),
              new T.Vector3(0, 0, -1),
              near,
              10,
            ),
          );
      }
      const caster = new T.Raycaster(
        new T.Vector3(0.1, 0.2, 4),
        new T.Vector3(0, 0, -1),
      );
      caster.layers.set(2);
      compare(skin, query, caster);
      caster.near = NaN;
      assert.throws(() => query.firstHit(caster), /interval/);
      skin.geometry.attributes.position.needsUpdate = true;
      caster.near = 0;
      assert.throws(() => query.firstHit(caster), /attribute changed/);
    } finally {
      query.dispose();
      close();
    }
  });

test("morph mode changes require readmission, invalid pose fails closed", () => {
  const { skin, close } = synthetic(),
    query = createSurfaceQuery({
      THREE: T,
      MeshBVH,
      skin,
      assertCurrent: () => {},
    }),
    caster = new T.Raycaster();
  try {
    skin.geometry.morphTargetsRelative = false;
    assert.throws(() => query.firstHit(caster), /source changed/);
    skin.geometry.morphTargetsRelative = true;
    skin.morphTargetInfluences[0] = NaN;
    assert.throws(() => query.firstHit(caster), /Invalid surface pose/);
  } finally {
    query.dispose();
    close();
  }
});

test("attribute normalization, backing replacement and NaN draw ranges cannot reuse cached hits", () => {
  const { skin, close } = synthetic(),
    query = createSurfaceQuery({
      THREE: T,
      MeshBVH,
      skin,
      assertCurrent: () => {},
    }),
    caster = new T.Raycaster();
  const attribute = skin.geometry.attributes.position,
    array = attribute.array;
  try {
    attribute.normalized = true;
    assert.throws(() => query.firstHit(caster), /attribute changed/);
    attribute.normalized = false;
    attribute.array = array.slice();
    assert.throws(() => query.firstHit(caster), /attribute changed/);
    attribute.array = array;
    skin.geometry.drawRange.count = NaN;
    assert.throws(() => query.firstHit(caster), /source changed/);
  } finally {
    query.dispose();
    close();
  }
});

test("rigid partitions preserve reflected-bone winding and native face normals", () => {
  const { skin, child, close } = synthetic();
  delete skin.geometry.morphAttributes.position;
  skin.morphTargetInfluences = undefined;
  skin.geometry.clearGroups();
  const sw = skin.geometry.attributes.skinWeight,
    si = skin.geometry.attributes.skinIndex,
    position = skin.geometry.attributes.position;
  for (let i = 0; i < sw.count; i++) {
    sw.setXYZW(i, 1, 0, 0, 0);
    si.setXYZW(i, position.getX(i) > 0 ? 0 : 1, 0, 0, 0);
  }
  const query = createSurfaceQuery({
    THREE: T,
    MeshBVH,
    skin,
    assertCurrent: () => {},
  });
  assert(query.diagnostics.rigidGroups > 0);
  try {
    for (const scale of [1, -1])
      for (const side of [T.FrontSide, T.BackSide, T.DoubleSide]) {
        child.scale.set(scale, 1, 1);
        child.rotation.z = 0.23;
        skin.material.side = side;
        skin.updateMatrixWorld(true);
        for (const x of [-0.29, 0.17, 0.41])
          compare(
            skin,
            query,
            new T.Raycaster(
              new T.Vector3(x, 0.137, 3),
              new T.Vector3(0, 0, -1),
            ),
          );
      }
  } finally {
    query.dispose();
    close();
  }
});

test("non-indexed geometry keeps source topology and native hit metadata", () => {
  const { skin, close } = synthetic();
  const nonIndexed = skin.geometry.toNonIndexed();
  skin.geometry = nonIndexed;
  skin.updateMorphTargets();
  const query = createSurfaceQuery({
    THREE: T,
    MeshBVH,
    skin,
    assertCurrent: () => {},
  });
  try {
    compare(
      skin,
      query,
      new T.Raycaster(new T.Vector3(0.17, 0.13, 3), new T.Vector3(0, 0, -1)),
    );
    assert.equal(nonIndexed.index, null);
  } finally {
    query.dispose();
    nonIndexed.dispose();
    close();
  }
});
