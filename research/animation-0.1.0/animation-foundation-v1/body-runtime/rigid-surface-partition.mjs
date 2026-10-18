/** Split only mathematically rigid single-bone triangles. Every original face
 * remains present exactly once. Blended triangles retain full CPU skinning.
 * Morph/grouped-material meshes keep the general posed-buffer route.
 */
export function createRigidSurfacePartition({ THREE: T, MeshBVH, skin }) {
  const source = skin.geometry;
  if (
    !source.index ||
    source.groups.length ||
    Array.isArray(skin.material) ||
    Object.values(source.morphAttributes).some((a) => a.length)
  )
    return null;
  const index = source.index.array,
    si = source.attributes.skinIndex,
    sw = source.attributes.skinWeight;
  const sole = new Int32Array(sw.count);
  sole.fill(-1);
  for (let i = 0; i < sw.count; i++) {
    let bone = -1,
      valid = true;
    for (let j = 0; j < 4; j++) {
      const weight = sw.getComponent(i, j);
      if (weight === 1 && bone === -1) bone = si.getComponent(i, j);
      else if (weight !== 0) {
        valid = false;
        break;
      }
    }
    if (
      valid &&
      bone >= 0 &&
      (!Number.isSafeInteger(bone) || bone >= skin.skeleton.bones.length)
    )
      throw Error("Invalid rigid surface binding");
    if (valid) sole[i] = bone;
  }
  const groups = new Map(),
    mixed = [];
  const start = source.drawRange.start,
    end = Math.min(index.length, start + source.drawRange.count);
  if (start !== 0 || end !== index.length) return null;
  for (let t = 0; t < index.length / 3; t++) {
    const a = index[t * 3],
      b = index[t * 3 + 1],
      c = index[t * 3 + 2],
      bone = sole[a];
    if (bone >= 0 && bone === sole[b] && bone === sole[c]) {
      if (!groups.has(bone)) groups.set(bone, []);
      groups.get(bone).push(t);
    } else mixed.push(t);
  }
  // Keep admission/setup bounded, including degenerate all-rigid fixtures.
  if (!groups.size || groups.size > 32 || !mixed.length) return null;
  const parts = [];
  const inverse = new T.Matrix4(),
    world = new T.Matrix4(),
    ray = new T.Ray(),
    direction = new T.Vector4();
  function indicesFor(tris) {
    const values = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++)
      values.set(index.subarray(tris[i] * 3, tris[i] * 3 + 3), i * 3);
    return values;
  }
  try {
    for (const [bone, tris] of groups) {
      const geometry = new T.BufferGeometry();
      for (const [key, attribute] of Object.entries(source.attributes))
        if (!["skinIndex", "skinWeight"].includes(key))
          geometry.setAttribute(key, attribute);
      geometry.setIndex(new T.Uint32BufferAttribute(indicesFor(tris), 1));
      const part = { bone, tris: Uint32Array.from(tris), geometry, bvh: null };
      parts.push(part);
      part.bvh = new MeshBVH(geometry, { indirect: true });
    }
  } catch (error) {
    for (const p of parts) p.geometry.dispose();
    throw error;
  }
  const mixedIndex = indicesFor(mixed),
    dynamicVertices = Uint32Array.from(new Set(mixedIndex));
  return {
    mixedTriangles: Uint32Array.from(mixed),
    mixedIndex,
    dynamicVertices,
    groupCount: parts.length,
    firstHit(caster, matrices) {
      let closest = null;
      for (const part of parts) {
        world
          .copy(skin.bindMatrixInverse)
          .multiply(matrices[part.bone])
          .multiply(skin.bindMatrix);
        let side = skin.material.side;
        // Bone-local reflections reverse triangle winding inside mesh space.
        if (world.determinant() < 0 && side !== T.DoubleSide)
          side = side === T.FrontSide ? T.BackSide : T.FrontSide;
        world.premultiply(skin.matrixWorld);
        inverse.copy(world).invert();
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
          throw Error("Invalid rigid surface transform");
        const hit = part.bvh.raycastFirst(
          ray,
          side,
          caster.near * scale,
          caster.far * scale,
        );
        if (!hit) continue;
        hit.point.applyMatrix4(world);
        hit.distance = caster.ray.origin.distanceTo(hit.point);
        hit.faceIndex = part.tris[hit.faceIndex];
        hit.object = skin;
        if (hit.distance < caster.near || hit.distance > caster.far) continue;
        if (
          !closest ||
          hit.distance < closest.distance ||
          (hit.distance === closest.distance &&
            hit.faceIndex < closest.faceIndex)
        )
          closest = hit;
      }
      return closest;
    },
    dispose() {
      for (const p of parts) {
        p.bvh = null;
        p.geometry.dispose();
      }
      parts.length = 0;
    },
  };
}
