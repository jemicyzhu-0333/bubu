/** Exact posed-surface picking. A private CPU mesh feeds the upstream MeshBVH;
 * the render mesh, topology, normals, materials and skinning methods stay owned
 * by the actor. Pose caching never reuses a stale skeleton or morph snapshot.
 */
import {
  captureAttributeLayout,
  sameAttributeLayout,
} from "./attribute-layout.mjs";
import { createRigidSurfacePartition } from "./rigid-surface-partition.mjs";
export const SURFACE_QUERY_RESERVATION_BYTES = 32 * 1024 * 1024;
export function createSurfaceQuery({ THREE: T, MeshBVH, skin, assertCurrent }) {
  assertCurrent();
  if (!skin?.isSkinnedMesh || typeof MeshBVH !== "function")
    throw Error("Skinned surface and MeshBVH required");
  if (
    skin.getVertexPosition !== T.SkinnedMesh.prototype.getVertexPosition ||
    skin.applyBoneTransform !== T.SkinnedMesh.prototype.applyBoneTransform
  )
    throw Error("Standard Three.js skinning required");
  const source = skin.geometry,
    skeleton = skin.skeleton;
  const count = source.attributes.position.count,
    triangles = (source.index?.count ?? count) / 3;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 100000 ||
    !Number.isSafeInteger(triangles) ||
    triangles > 200000
  )
    throw Error("Surface query admission budget exceeded");
  const attributes = Object.entries(source.attributes).map(([name, a]) => [
    name,
    captureAttributeLayout(a),
  ]);
  const index = source.index,
    indexLayout = captureAttributeLayout(index);
  const morphs = Object.entries(source.morphAttributes).flatMap(
    ([name, items]) =>
      items.map((a, i) => [name, i, captureAttributeLayout(a)]),
  );
  const groups = source.groups.map((g) => [g.start, g.count, g.materialIndex]),
    range = [source.drawRange.start, source.drawRange.count],
    relative = source.morphTargetsRelative;
  const bones = [...skeleton.bones],
    inverses = [...skeleton.boneInverses];
  if (bones.length > 256) throw Error("Surface skeleton budget exceeded");
  let geometry = new T.BufferGeometry(),
    vertices = new Float64Array(count * 3),
    bvh = null,
    closed = false,
    stamp = null;
  let partition = null;
  const materialArray = Array.isArray(skin.material);
  for (const [name, { attribute: a }] of attributes)
    if (!["skinIndex", "skinWeight"].includes(name))
      geometry.setAttribute(name, a);
  geometry.setIndex(index);
  geometry.setAttribute("position", new T.BufferAttribute(vertices, 3));
  for (const group of source.groups)
    geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  const matrices = bones.map(() => new T.Matrix4()),
    point = new T.Vector3(),
    base = new T.Vector4(),
    weighted = new T.Vector4();
  const indices = new T.Vector4(),
    weights = new T.Vector4(),
    inverse = new T.Matrix4(),
    ray = new T.Ray(),
    direction = new T.Vector4();
  const triangleA = new T.Vector3(),
    triangleB = new T.Vector3(),
    triangleC = new T.Vector3();
  // Covers the posed buffer, worst-case binary BVH nodes, primitive bounds and
  // indirect indices. Source-owned shared attributes are accounted by the actor.
  const residentUpperBoundBytes =
    count * 28 + triangles * 116 + bones.length * 256 + 65536;
  const diagnostics = {
    preparations: 0,
    refits: 0,
    cacheHits: 0,
    queries: 0,
    vertexBytes: vertices.byteLength,
    residentUpperBoundBytes,
    vertices: count,
    deformedVertices: count,
    rigidGroups: 0,
  };
  function guard() {
    if (closed) throw Error("Surface query disposed");
    assertCurrent();
    if (
      skin.getVertexPosition !== T.SkinnedMesh.prototype.getVertexPosition ||
      skin.applyBoneTransform !== T.SkinnedMesh.prototype.applyBoneTransform
    )
      throw Error("Surface skinning method changed");
    if (Array.isArray(skin.material) !== materialArray)
      throw Error("Surface material layout changed");
    if (
      skin.geometry !== source ||
      skin.skeleton !== skeleton ||
      source.index !== index ||
      !sameAttributeLayout(index, indexLayout) ||
      source.morphTargetsRelative !== relative ||
      source.drawRange.start !== range[0] ||
      source.drawRange.count !== range[1] ||
      source.groups.length !== groups.length ||
      source.groups.some(
        (g, i) =>
          g.start !== groups[i][0] ||
          g.count !== groups[i][1] ||
          g.materialIndex !== groups[i][2],
      )
    )
      throw Error("Surface source changed; readmission required");
    if (Object.keys(source.attributes).length !== attributes.length)
      throw Error("Surface attribute layout changed");
    for (const [name, layout] of attributes)
      if (!sameAttributeLayout(source.attributes[name], layout))
        throw Error("Surface attribute changed");
    for (const [name, i, layout] of morphs)
      if (!sameAttributeLayout(source.morphAttributes[name]?.[i], layout))
        throw Error("Surface morph source changed");
    if (
      Object.values(source.morphAttributes).reduce(
        (n, a) => n + a.length,
        0,
      ) !== morphs.length ||
      skeleton.bones.length !== bones.length ||
      skeleton.boneInverses.length !== inverses.length
    )
      throw Error("Surface structure changed");
    for (let i = 0; i < bones.length; i++)
      if (
        skeleton.bones[i] !== bones[i] ||
        skeleton.boneInverses[i] !== inverses[i]
      )
        throw Error("Surface skeleton changed");
  }
  function prepare() {
    guard();
    skin.updateWorldMatrix(true, false);
    skin.updateMatrixWorld(true);
    const next = [
      ...skin.bindMatrix.elements,
      ...skin.bindMatrixInverse.elements,
      ...(skin.morphTargetInfluences ?? []),
    ];
    for (let b = 0; b < bones.length; b++) {
      bones[b].updateWorldMatrix(true, false);
      matrices[b].multiplyMatrices(bones[b].matrixWorld, inverses[b]);
      next.push(...matrices[b].elements);
    }
    if (
      !next.every(Number.isFinite) ||
      !skin.matrixWorld.elements.every(Number.isFinite) ||
      Math.abs(skin.matrixWorld.determinant()) < 1e-12
    )
      throw Error("Invalid surface pose");
    if (
      stamp &&
      stamp.length === next.length &&
      next.every((v, i) => v === stamp[i])
    ) {
      diagnostics.cacheHits++;
      return;
    }
    const dynamicVertices = partition?.dynamicVertices;
    for (
      let cursor = 0;
      cursor < (dynamicVertices?.length ?? count);
      cursor++
    ) {
      const i = dynamicVertices ? dynamicVertices[cursor] : cursor;
      T.Mesh.prototype.getVertexPosition.call(skin, i, point);
      base.set(point.x, point.y, point.z, 1).applyMatrix4(skin.bindMatrix);
      point.set(0, 0, 0);
      indices.fromBufferAttribute(source.attributes.skinIndex, i);
      weights.fromBufferAttribute(source.attributes.skinWeight, i);
      for (let j = 0; j < 4; j++) {
        const weight = weights.getComponent(j);
        if (!weight) continue;
        const matrix = matrices[indices.getComponent(j)];
        if (!matrix || !Number.isFinite(weight))
          throw Error("Invalid surface binding");
        point.addScaledVector(weighted.copy(base).applyMatrix4(matrix), weight);
      }
      point.applyMatrix4(skin.bindMatrixInverse);
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z)
      )
        throw Error("Non-finite posed vertex");
      if (
        Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > 1e6
      )
        throw Error("Posed surface exceeds bounded scene coordinates");
      const offset = i * 3;
      vertices[offset] = point.x;
      vertices[offset + 1] = point.y;
      vertices[offset + 2] = point.z;
    }
    geometry.attributes.position.needsUpdate = true;
    if (bvh) {
      bvh.refit();
      diagnostics.refits++;
    } else {
      bvh = new MeshBVH(geometry, { indirect: true });
      diagnostics.preparations++;
    }
    stamp = next;
  }
  function dispose() {
    if (closed) return;
    closed = true;
    bvh = null;
    stamp = null;
    vertices = null;
    partition?.dispose();
    partition = null;
    geometry.dispose();
    geometry = null;
    diagnostics.vertexBytes = 0;
    diagnostics.residentUpperBoundBytes = 0;
  }
  try {
    partition = createRigidSurfacePartition({ THREE: T, MeshBVH, skin });
    if (partition) {
      geometry.setIndex(new T.Uint32BufferAttribute(partition.mixedIndex, 1));
      diagnostics.deformedVertices = partition.dynamicVertices.length;
      diagnostics.rigidGroups = partition.groupCount;
    }
    prepare();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    diagnostics,
    firstHit(caster) {
      if (
        ![...caster.ray.origin, ...caster.ray.direction, caster.near].every(
          Number.isFinite,
        ) ||
        caster.near < 0 ||
        !(caster.far >= caster.near)
      )
        throw Error("Invalid surface ray interval");
      prepare();
      diagnostics.queries++;
      if (!caster.layers.test(skin.layers) || skin.material === undefined)
        return null;
      inverse.copy(skin.matrixWorld).invert();
      ray.copy(caster.ray).applyMatrix4(inverse);
      direction
        .set(
          caster.ray.direction.x,
          caster.ray.direction.y,
          caster.ray.direction.z,
          0,
        )
        .applyMatrix4(inverse);
      const scale = Math.hypot(direction.x, direction.y, direction.z);
      if (!Number.isFinite(scale) || scale <= 0)
        throw Error("Invalid surface ray");
      let hit = bvh.raycastFirst(
        ray,
        skin.material,
        caster.near * scale,
        caster.far * scale,
      );
      if (hit) {
        hit.point.applyMatrix4(skin.matrixWorld);
        hit.distance = caster.ray.origin.distanceTo(hit.point);
        hit.object = skin;
        if (partition) hit.faceIndex = partition.mixedTriangles[hit.faceIndex];
      }
      const rigid = partition?.firstHit(caster, matrices);
      if (
        rigid &&
        (!hit ||
          rigid.distance < hit.distance ||
          (rigid.distance === hit.distance && rigid.faceIndex < hit.faceIndex))
      )
        hit = rigid;
      if (!hit) return null;
      // Return native mesh-space face/attribute semantics even when a rigid
      // partition was intersected in its bone-local frame.
      {
        const first = hit.faceIndex * 3;
        const a = source.index ? source.index.getX(first) : first,
          b = source.index ? source.index.getX(first + 1) : first + 1,
          c = source.index ? source.index.getX(first + 2) : first + 2;
        skin.getVertexPosition(a, triangleA);
        skin.getVertexPosition(b, triangleB);
        skin.getVertexPosition(c, triangleC);
        point.copy(hit.point).applyMatrix4(inverse);
        hit.barycoord = T.Triangle.getBarycoord(
          point,
          triangleA,
          triangleB,
          triangleC,
          new T.Vector3(),
        );
        T.Triangle.getNormal(triangleA, triangleB, triangleC, hit.face.normal);
        for (const key of ["uv", "uv1"])
          if (source.attributes[key])
            hit[key] = T.Triangle.getInterpolatedAttribute(
              source.attributes[key],
              a,
              b,
              c,
              hit.barycoord,
              new T.Vector2(),
            );
        if (source.attributes.normal) {
          hit.normal = T.Triangle.getInterpolatedAttribute(
            source.attributes.normal,
            a,
            b,
            c,
            hit.barycoord,
            new T.Vector3(),
          );
          if (hit.normal.dot(ray.direction) > 0) hit.normal.multiplyScalar(-1);
        }
      }
      if (
        !Number.isFinite(hit.distance) ||
        !hit.point.toArray().every(Number.isFinite)
      )
        throw Error("Non-finite surface intersection");
      return hit.distance >= caster.near && hit.distance <= caster.far
        ? hit
        : null;
    },
    dispose,
  };
}
