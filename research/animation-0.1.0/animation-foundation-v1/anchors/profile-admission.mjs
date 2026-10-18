// Bounded metadata fingerprint; buffer writes require Three's needsUpdate contract.
export function geometrySignature(geometry) {
  const result = [geometry, geometry.index, geometry.index?.version, geometry.morphTargetsRelative];
  for (const key of ['position', 'normal', 'skinIndex', 'skinWeight']) {
    const attribute = geometry.attributes[key];
    result.push(attribute, attribute?.array, attribute?.version, attribute?.count, attribute?.itemSize,
      attribute?.data, attribute?.data?.version, attribute?.offset);
  }
  for (const key of ['position', 'normal']) {
    const attributes = geometry.morphAttributes[key] ?? [];
    if (attributes.length > 128) throw new Error('Bounded morph targets required');
    result.push(attributes.length);
    for (const attribute of attributes) result.push(attribute, attribute.array, attribute.version,
      attribute.count, attribute.itemSize, attribute.data, attribute.data?.version, attribute.offset);
  }
  return result;
}

const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

/** Profiles are trusted authored descriptors, copied once; never inferred from actor names. */
export function admitProfile(profile, skeleton, root) {
  if (!profile || typeof profile.id !== 'string' || !profile.id.length) {
    throw new TypeError('An explicit authored character profile is required');
  }
  if (!Number.isInteger(profile.boneCount) || profile.boneCount < 1 || profile.boneCount > 128 ||
      skeleton.bones.length !== profile.boneCount || skeleton.boneInverses.length !== profile.boneCount) {
    throw new Error('Character profile skeleton mismatch');
  }
  const partEntries = Object.entries(profile.parts ?? {});
  if (!partEntries.length || partEntries.length > 64) throw new Error('Invalid profile part count');
  if (!Array.isArray(profile.anchors) || !profile.anchors.length || profile.anchors.length > 256) {
    throw new Error('Invalid profile anchor count');
  }
  const meshes = new Map();
  for (const [name, spec] of partEntries) {
    const mesh = root.getObjectByName(name);
    if (!['skinned', 'rigid'].includes(spec.mode) || !Number.isInteger(spec.vertexCount) || spec.vertexCount < 1) {
      throw new Error('Invalid authored part declaration');
    }
    if (!mesh?.isMesh || mesh.geometry.attributes.position?.count !== spec.vertexCount ||
        Boolean(mesh.isSkinnedMesh) !== (spec.mode === 'skinned') ||
        (mesh.isSkinnedMesh && mesh.skeleton !== skeleton)) {
      throw new Error('Missing, incompatible or foreign character part ' + name);
    }
    meshes.set(name, {
      mesh,
      geometry: mesh.geometry,
      geometrySignature: geometrySignature(mesh.geometry),
      bind: mesh.bindMatrix?.clone(),
      bindMode: mesh.bindMode
    });
  }
  const records = new Map();
  for (const original of profile.anchors) {
    const d = JSON.parse(JSON.stringify(original));
    if (typeof d.id !== 'string' || !d.id || records.has(d.id) || !meshes.has(d.part) ||
        !Number.isInteger(d.vertex) || d.vertex < 0 || !vector(d.position, 3) ||
        !vector(d.normal, 3) || !vector(d.tangentX, 3) || !vector(d.skinIndices, 4) || !vector(d.skinWeights, 4)) {
      throw new Error('Invalid authored anchor definition');
    }
    if (!Array.isArray(d.offsetBounds) || d.offsetBounds.length !== 3 ||
        d.offsetBounds.some(b => !vector(b, 2) || b[0] > b[1] || Math.max(...b.map(Math.abs)) > 1)) {
      throw new Error('Invalid authored anchor bounds');
    }
    const normalLength = Math.hypot(...d.normal);
    const tangentLength = Math.hypot(...d.tangentX);
    const alignment = d.normal.reduce((sum, value, i) => sum + value * d.tangentX[i], 0);
    if (Math.abs(normalLength - 1) > 1e-4 || Math.abs(tangentLength - 1) > 1e-4 || Math.abs(alignment) > 1e-4) {
      throw new Error('Authored anchor axes must be orthonormal');
    }
    const mesh = meshes.get(d.part).mesh;
    const attrs = mesh.geometry.attributes;
    for (const attributes of Object.values(mesh.geometry.morphAttributes)) {
      for (const attribute of attributes) {
        if (attribute.count !== attrs.position.count || attribute.itemSize !== 3)
          throw new Error('Invalid morph target layout');
      }
    }
    if (d.vertex >= attrs.position.count) throw new Error('Anchor vertex outside part');
    for (let c = 0; c < 3; c++) {
      if (!Number.isFinite(attrs.position.getComponent(d.vertex, c)) || Math.abs(attrs.position.getComponent(d.vertex, c) - d.position[c]) > 1e-7) {
        throw new Error('Character anchor vertex mismatch');
      }
    }
    if (mesh.isSkinnedMesh) {
      if (!attrs.skinIndex || !attrs.skinWeight || attrs.skinIndex.itemSize !== 4 || attrs.skinWeight.itemSize !== 4 ||
          attrs.skinIndex.count !== attrs.position.count || attrs.skinWeight.count !== attrs.position.count) {
        throw new Error('Native anchor requires original four-component skin attributes');
      }
      if (Math.abs(d.skinWeights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-4) {
        throw new Error('Anchor weights must sum to one');
      }
      for (let c = 0; c < 4; c++) {
        const index = d.skinIndices[c];
        const weight = d.skinWeights[c];
        if (!Number.isInteger(index) || index < 0 || index >= profile.boneCount || weight < 0 || weight > 1 ||
            attrs.skinIndex.getComponent(d.vertex, c) !== index ||
            !Number.isFinite(attrs.skinWeight.getComponent(d.vertex, c)) ||
            Math.abs(attrs.skinWeight?.getComponent(d.vertex, c) - weight) > 1e-7) {
          throw new Error('Character anchor weights mismatch');
        }
      }
    }
    records.set(d.id, { definition: d, mesh });
  }
  return { meshes, records };
}
