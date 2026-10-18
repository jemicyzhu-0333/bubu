import { admitProfile, geometrySignature } from './profile-admission.mjs';
import { requireFiniteMatrix, sampleWeightedFrame } from './weighted-frame.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Character-independent final-pose registry. No default character or asset discovery. */
export function createAnchorRegistry({ THREE: T, sourceSkin, hybridRoot, profile, assertSourceCurrent, assertPoseCurrent }) {
  if (!T || !sourceSkin?.isSkinnedMesh || !hybridRoot ||
      typeof assertSourceCurrent !== 'function' || typeof assertPoseCurrent !== 'function') {
    throw new TypeError('Actor skin, part root and ownership/final-pose guards required');
  }
  assertSourceCurrent();
  if (hybridRoot.parent !== sourceSkin.parent) throw new Error('Part root must belong to source actor parent');
  const skeleton = sourceSkin.skeleton;
  const sourceGeometry = sourceSkin.geometry;
  const sourceBind = sourceSkin.bindMatrix.clone();
  const sourceParent = sourceSkin.parent;
  const sourceBindMode = sourceSkin.bindMode;
  const { meshes, records } = admitProfile(profile, skeleton, hybridRoot);
  const bones = [...skeleton.bones];
  const inverses = skeleton.boneInverses.map(matrix => matrix.clone());
  const ids = Object.freeze([...records.keys()]);
  const definitions = freeze([...records.values()].map(record => record.definition));
  let revision;
  let disposed = false;
  let samples = new Map();
  let matrixEntries = [];
  let morphEntries = [];
  let fingerprintValues = new Float64Array(0);

  function guard(poseRevision) {
    if (disposed) throw new Error('Anchor registry disposed');
    assertSourceCurrent();
    if (poseRevision === undefined || poseRevision === null) throw new TypeError('Explicit final pose revision required');
    assertPoseCurrent(poseRevision);
    if (sourceSkin.skeleton !== skeleton || sourceSkin.geometry !== sourceGeometry ||
        sourceSkin.parent !== sourceParent || hybridRoot.parent !== sourceParent ||
        sourceSkin.bindMode !== sourceBindMode || !sourceSkin.bindMatrix.equals(sourceBind)) {
      throw new Error('Source binding changed');
    }
    if (bones.length !== skeleton.bones.length || inverses.length !== skeleton.boneInverses.length) {
      throw new Error('Actor skeleton changed');
    }
    for (let i = 0; i < bones.length; i++) {
      if (bones[i] !== skeleton.bones[i] || !inverses[i].equals(skeleton.boneInverses[i])) {
        throw new Error('Actor skeleton changed');
      }
    }
    for (const [name, record] of meshes) {
      const mesh = record.mesh;
      const signature = geometrySignature(mesh.geometry);
      if (signature.length !== record.geometrySignature.length ||
          signature.some((value, index) => value !== record.geometrySignature[index])) {
        throw new Error('Character geometry attributes or topology changed');
      }
      if (hybridRoot.getObjectByName(name) !== mesh || mesh.geometry !== record.geometry ||
          (mesh.isSkinnedMesh && mesh.skeleton !== skeleton)) throw new Error('Character parts changed');
      if (mesh.isSkinnedMesh && (!mesh.bindMatrix.equals(record.bind) || mesh.bindMode !== record.bindMode)) {
        throw new Error('Character part binding changed');
      }
    }
  }

  function captureFingerprint(selectedRecords) {
    const requiredBones = new Set();
    const requiredMeshes = new Set();
    for (const { definition, mesh } of selectedRecords) {
      requiredMeshes.add(mesh);
      if (!mesh.isSkinnedMesh) continue;
      definition.skinWeights.forEach((weight, index) => {
        if (weight) requiredBones.add(definition.skinIndices[index]);
      });
    }
    matrixEntries = [...requiredBones].map(index => [bones[index], 'matrixWorld']);
    for (const mesh of requiredMeshes) {
      matrixEntries.push([mesh, 'matrixWorld']);
      if (mesh.isSkinnedMesh) matrixEntries.push([mesh, 'bindMatrixInverse']);
    }
    morphEntries = [...requiredMeshes].map(mesh => [mesh, [...(mesh.morphTargetInfluences ?? [])]]);
    for (const [mesh, values] of morphEntries) {
      const count = Math.max(mesh.geometry.morphAttributes.position?.length ?? 0,
        mesh.geometry.morphAttributes.normal?.length ?? 0);
      if (values.length !== count || !values.every(Number.isFinite)) throw new Error('Invalid morph influences');
    }
    const size = matrixEntries.length * 16;
    if (fingerprintValues.length !== size) fingerprintValues = new Float64Array(size);
    let cursor = 0;
    for (const [object, key] of matrixEntries) {
      requireFiniteMatrix(object[key]);
      for (const value of object[key].elements) fingerprintValues[cursor++] = value;
    }
  }

  function verifyFingerprint() {
    for (const [mesh, values] of morphEntries) {
      const current = mesh.morphTargetInfluences ?? [];
      if (current.length !== values.length || values.some((value, index) => value !== current[index]))
        throw new Error('Final pose changed since anchor sample');
    }
    let cursor = 0;
    for (const [object, key] of matrixEntries) {
      for (const value of object[key].elements) {
        if (value !== fingerprintValues[cursor++]) throw new Error('Final pose changed since anchor sample');
      }
    }
  }

  function sampleFinalPose(poseRevision, requestedIds = ids) {
    guard(poseRevision);
    if (!Array.isArray(requestedIds) || requestedIds.length > ids.length || new Set(requestedIds).size !== requestedIds.length) {
      throw new TypeError('Unique bounded anchor IDs required');
    }
    const selected = requestedIds.map(id => {
      const record = records.get(id);
      if (!record) throw new RangeError('Unknown anatomical anchor ' + id);
      return record;
    });
    const next = new Map();
    for (const record of selected) {
      next.set(record.definition.id, sampleWeightedFrame(T, record, bones, inverses));
    }
    captureFingerprint(selected);
    samples = next;
    revision = poseRevision;
    return api;
  }

  function getTransform(id, { poseRevision = revision, offset = [0, 0, 0], target } = {}) {
    guard(poseRevision);
    if (poseRevision !== revision) throw new Error('Final pose not sampled');
    const record = records.get(id);
    if (!record) throw new RangeError('Unknown anatomical anchor ' + id);
    if (!samples.has(id)) throw new Error('Anchor was not requested in final pose sample');
    verifyFingerprint();
    const bounds = record.definition.offsetBounds;
    if (!Array.isArray(offset) || offset.length !== 3 ||
        offset.some((value, i) => !Number.isFinite(value) || value < bounds[i][0] || value > bounds[i][1])) {
      throw new RangeError('Anchor offset outside permitted bounds');
    }
    if (target !== undefined && !target?.isMatrix4) throw new TypeError('Expected caller-owned target Matrix4');
    const result = target ?? new T.Matrix4();
    result.copy(samples.get(id));
    const e = result.elements;
    e[12] += e[0] * offset[0] + e[4] * offset[1] + e[8] * offset[2];
    e[13] += e[1] * offset[0] + e[5] * offset[1] + e[9] * offset[2];
    e[14] += e[2] * offset[0] + e[6] * offset[1] + e[10] * offset[2];
    requireFiniteMatrix(result);
    return result;
  }

  function dispose() {
    disposed = true;
    samples.clear();
    records.clear();
    meshes.clear();
    matrixEntries = [];
    morphEntries = [];
    fingerprintValues = new Float64Array(0);
  }
  const api = Object.freeze({ ids, definitions, sampleFinalPose, getTransform, dispose });
  return api;
}
