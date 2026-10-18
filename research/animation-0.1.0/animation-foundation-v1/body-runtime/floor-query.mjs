/** Exact branch-and-bound surface minimum. Bounds are conservative for arbitrary
 * bone matrices: each cluster encloses every vertex's weighted homogeneous
 * contribution to every bone. Only clusters provably above the best exact point
 * are skipped. Morph-active surfaces use the full reference path. */
export function createFloorQuery(THREE, skin, diagnostics) {
  const point = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  const boneIndex = new THREE.Vector4();
  const boneWeight = new THREE.Vector4();
  let prepared = null;

  function sourceKey() {
    const geometry = skin.geometry;
    const key = [geometry];
    for (const name of ["position", "skinIndex", "skinWeight"]) {
      const attribute = geometry.attributes[name];
      key.push(attribute, attribute.version, attribute.count);
    }
    key.push(...skin.bindMatrix.elements);
    for (const matrix of skin.skeleton.boneInverses)
      key.push(...matrix.elements);
    return key;
  }

  function prepare(key) {
    const geometry = skin.geometry;
    const position = geometry.attributes.position;
    const inverses = skin.skeleton.boneInverses.map((inverse) =>
      inverse.clone().multiply(skin.bindMatrix),
    );
    const groups = new Map();
    for (let index = 0; index < position.count; index++) {
      boneIndex.fromBufferAttribute(geometry.attributes.skinIndex, index);
      boneWeight.fromBufferAttribute(geometry.attributes.skinWeight, index);
      const influences = [];
      for (let slot = 0; slot < 4; slot++) {
        const weight = boneWeight.getComponent(slot);
        if (weight) influences.push([boneIndex.getComponent(slot), Math.floor(weight * 32)]);
      }
      influences.sort((a,b) => a[0] - b[0]);
      const groupKey = JSON.stringify(influences);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(index);
    }
    const clusters = [];
    for (const indices of groups.values()) {
    indices.sort((a, b) => position.getY(a) - position.getY(b));
    for (let start = 0; start < indices.length; start += 64) {
      const vertices = indices.slice(start, start + 64);
      const bounds = new Map();
      for (const index of vertices) {
        point.fromBufferAttribute(position, index);
        boneIndex.fromBufferAttribute(geometry.attributes.skinIndex, index);
        boneWeight.fromBufferAttribute(geometry.attributes.skinWeight, index);
        const contributions = new Map();
        for (let slot = 0; slot < 4; slot++) {
          const weight = boneWeight.getComponent(slot);
          if (!weight) continue;
          const bone = boneIndex.getComponent(slot);
          transformed.copy(point).applyMatrix4(inverses[bone]);
          let value = contributions.get(bone);
          if (!value) contributions.set(bone, (value = [0, 0, 0, 0]));
          value[0] += transformed.x * weight;
          value[1] += transformed.y * weight;
          value[2] += transformed.z * weight;
          value[3] += weight;
        }
        for (const [bone, value] of contributions) {
          let bound = bounds.get(bone);
          if (!bound)
            bounds.set(
              bone,
              (bound = {
                bone,
                count: 0,
                min: [Infinity, Infinity, Infinity, Infinity],
                max: [-Infinity, -Infinity, -Infinity, -Infinity],
              }),
            );
          bound.count++;
          for (let axis = 0; axis < 4; axis++) {
            bound.min[axis] = Math.min(bound.min[axis], value[axis]);
            bound.max[axis] = Math.max(bound.max[axis], value[axis]);
          }
        }
      }
      // Include zero only when a cluster vertex has no influence from this bone.
      for (const bound of bounds.values())
        if (bound.count < vertices.length) {
          for (let axis = 0; axis < 4; axis++) {
            bound.min[axis] = Math.min(0, bound.min[axis]);
            bound.max[axis] = Math.max(0, bound.max[axis]);
          }
        }
      clusters.push({ vertices, bounds: [...bounds.values()], lower: 0 });
    }
    }
    prepared = { key, clusters };
    diagnostics.preparations++;
  }

  function fullMinimum() {
    let minimum = Infinity;
    for (
      let index = 0;
      index < skin.geometry.attributes.position.count;
      index++
    ) {
      skin.getVertexPosition(index, point).applyMatrix4(skin.matrixWorld);
      minimum = Math.min(minimum, point.y);
      diagnostics.vertices++;
    }
    diagnostics.fallbacks++;
    return minimum;
  }

  return function minimum() {
    if ((skin.morphTargetInfluences ?? []).some((value) => value !== 0))
      return fullMinimum();
    const key = sourceKey();
    if (
      !prepared ||
      key.length !== prepared.key.length ||
      key.some((value, index) => value !== prepared.key[index])
    )
      prepare(key);
    const skinToWorld = skin.matrixWorld
      .clone()
      .multiply(skin.bindMatrixInverse);
    const rows = skin.skeleton.bones.map((bone) => {
      const elements = skinToWorld.clone().multiply(bone.matrixWorld).elements;
      return [elements[1], elements[5], elements[9], elements[13]];
    });
    for (const cluster of prepared.clusters) {
      let lower = 0;
      for (const bound of cluster.bounds) {
        const row = rows[bound.bone];
        for (let axis = 0; axis < 4; axis++)
          lower +=
            row[axis] * (row[axis] >= 0 ? bound.min[axis] : bound.max[axis]);
      }
      cluster.lower = lower;
    }
    prepared.clusters.sort((a, b) => a.lower - b.lower);
    let minimum = Infinity;
    for (const cluster of prepared.clusters) {
      // Conservative rounding guard retains ties and nearly equal candidates.
      if (
        cluster.lower >
        minimum +
          1e-10 * Math.max(1, Math.abs(minimum), Math.abs(cluster.lower))
      )
        break;
      for (const index of cluster.vertices) {
        skin.getVertexPosition(index, point).applyMatrix4(skin.matrixWorld);
        minimum = Math.min(minimum, point.y);
        diagnostics.vertices++;
      }
    }
    return minimum;
  };
}
