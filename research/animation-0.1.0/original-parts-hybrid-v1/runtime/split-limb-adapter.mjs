/** Owns transforms only. Source geometry and material stay externally owned. */
const owners = new WeakMap();
const names = [
  "Bubu_body",
  "Bubu_hand-left",
  "Bubu_hand-right",
  "Bubu_foot-left",
  "Bubu_foot-right",
];
const joints = [0, 1, 2, 3, 4];

function requireRigid(matrix) {
  if (!matrix?.isMatrix4 || !matrix.elements.every(Number.isFinite))
    throw new TypeError("Expected a finite Matrix4");
  const e = matrix.elements;
  if (
    Math.abs(e[3]) + Math.abs(e[7]) + Math.abs(e[11]) + Math.abs(e[15] - 1) >
    1e-6
  )
    throw new RangeError("Expected an affine transform");
  for (let a = 0; a < 3; a++) {
    for (let b = a; b < 3; b++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += e[a * 4 + k] * e[b * 4 + k];
      if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-5)
        throw new RangeError("Limb transforms cannot scale or shear");
    }
  }
  if (Math.abs(matrix.determinant() - 1) > 1e-5)
    throw new RangeError("Limb transforms cannot reflect");
}

export function createSplitLimbAdapter({
  THREE,
  sourceSkin,
  parts,
  assertSourceCurrent,
}) {
  if (typeof assertSourceCurrent !== "function")
    throw new TypeError("A source ownership guard is required");
  assertSourceCurrent();
  if (
    !sourceSkin?.isSkinnedMesh ||
    !sourceSkin.parent ||
    Array.isArray(sourceSkin.material)
  )
    throw new TypeError("Expected an attached single-material SkinnedMesh");
  if (owners.has(sourceSkin))
    throw new Error("Source already has a split-limb owner");
  const templates = names.map((name) => parts.getObjectByName(name));
  const allMeshes = [];
  parts.traverse((object) => {
    if (object.isMesh) allMeshes.push(object);
  });
  if (
    allMeshes.length !== 5 ||
    templates.some(
      (mesh) =>
        !mesh?.isMesh ||
        mesh.isSkinnedMesh ||
        Object.values(mesh.geometry.morphAttributes).some(
          (list) => list.length,
        ),
    )
  )
    throw new TypeError("Expected five static, named body parts");
  if (
    sourceSkin.skeleton.bones.length < 5 ||
    sourceSkin.skeleton.boneInverses.length < 5
  )
    throw new TypeError("Missing limb skeleton");

  const root = new THREE.Group();
  root.name = "Bubu_split_limb_owner";
  root.matrixAutoUpdate = false;
  const meshes = templates.map((template) => {
    const mesh = new THREE.Mesh(template.geometry, sourceSkin.material);
    mesh.name = template.name;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = sourceSkin.castShadow;
    mesh.receiveShadow = sourceSkin.receiveShadow;
    mesh.renderOrder = sourceSkin.renderOrder;
    mesh.frustumCulled = sourceSkin.frustumCulled;
    mesh.layers.mask = sourceSkin.layers.mask;
    root.add(mesh);
    return mesh;
  });
  const scratch = names.map(() => new THREE.Matrix4());
  const bindInverse = new THREE.Matrix4();
  let disposed = false;
  const previousVisibility = sourceSkin.visible;
  const parent = sourceSkin.parent;
  const owner = { root, update, dispose };

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    if (owners.get(sourceSkin) === owner) {
      owners.delete(sourceSkin);
      sourceSkin.visible = previousVisibility;
    }
  }

  function update(options = {}) {
    if (disposed) throw new Error("Split-limb owner disposed");
    try {
      assertSourceCurrent();
    } catch (error) {
      dispose();
      throw error;
    }
    if (sourceSkin.parent !== parent) {
      dispose();
      throw new Error("Source parent changed");
    }
    const allowed = new Set(["limbMatrices"]);
    if (Object.keys(options).some((key) => !allowed.has(key)))
      throw new TypeError("Unsupported split-limb update option");
    const overrides = options.limbMatrices ?? {};
    if (Object.keys(overrides).some((key) => !names.slice(1).includes(key)))
      throw new TypeError("Unknown limb transform");
    // Validate all explicit transforms before changing the actor.
    for (const matrix of Object.values(overrides)) requireRigid(matrix);
    // updateWorldMatrix respects manually managed local matrices. Unlike
    // SkinnedMesh.updateMatrixWorld it does not refresh bindMatrixInverse,
    // so derive the current inverse without mutating the borrowed skin.
    sourceSkin.updateWorldMatrix(true, false);
    if (sourceSkin.bindMode === THREE.AttachedBindMode)
      bindInverse.copy(sourceSkin.matrixWorld).invert();
    else if (sourceSkin.bindMode === THREE.DetachedBindMode)
      bindInverse.copy(sourceSkin.bindMatrix).invert();
    else throw new TypeError("Unsupported skeleton bind mode");
    scratch[0].identity();
    for (let index = 1; index < 5; index++) {
      if (overrides[names[index]]) scratch[index].copy(overrides[names[index]]);
      else {
        const bone = sourceSkin.skeleton.bones[joints[index]];
        bone.updateWorldMatrix(true, false);
        scratch[index]
          .copy(bindInverse)
          .multiply(bone.matrixWorld)
          .multiply(sourceSkin.skeleton.boneInverses[joints[index]])
          .multiply(sourceSkin.bindMatrix);
        requireRigid(scratch[index]);
      }
    }
    root.matrix.copy(sourceSkin.matrix);
    root.matrixWorldNeedsUpdate = true;
    for (let index = 0; index < 5; index++) {
      meshes[index].matrix.copy(scratch[index]);
      meshes[index].matrixWorldNeedsUpdate = true;
    }
    return owner;
  }

  // First calculation precedes attachment, so invalid input cannot hide the source.
  update();
  owners.set(sourceSkin, owner);
  sourceSkin.visible = false;
  try {
    parent.add(root);
  } catch (error) {
    dispose();
    throw error;
  }
  return owner;
}
