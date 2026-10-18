import { createSplitLimbAdapter } from "./split-limb-adapter.mjs";
const names = [
  "Bubu_body",
  "Bubu_hand-left",
  "Bubu_hand-right",
  "Bubu_foot-left",
  "Bubu_foot-right",
];
const nativeNames = ["Bubu_body", "Bubu_foot-left", "Bubu_foot-right"];
/** Experimental native-skinned body/feet + rigid hands. Geometry, material and
 * THIS source actor's skeleton remain borrowed, never disposed here.
 * Uses the static owner's existing exclusivity/visibility/lifecycle contract.
 */
export function createMixedBindingAdapter({
  THREE,
  sourceSkin,
  parts,
  assertSourceCurrent,
}) {
  if (typeof assertSourceCurrent !== "function")
    throw new TypeError("A source ownership guard is required");
  assertSourceCurrent();
  if (!sourceSkin?.isSkinnedMesh || !sourceSkin.skeleton)
    throw new TypeError("Expected source SkinnedMesh with actor skeleton");
  const skeleton = sourceSkin.skeleton,
    bind = sourceSkin.bindMatrix.clone(),
    bindMode = sourceSkin.bindMode,
    material = sourceSkin.material,
    sourceGeometry = sourceSkin.geometry;
  const proxy = new THREE.Group();
  for (const name of names) {
    const template = parts?.getObjectByName(name);
    if (!template?.isMesh) throw new TypeError("Missing split part " + name);
    const geometry = template.geometry;
    if (nativeNames.includes(name)) {
      const p = geometry.attributes.position,
        i = geometry.attributes.skinIndex,
        w = geometry.attributes.skinWeight;
      if (
        !p ||
        !i ||
        !w ||
        i.itemSize !== 4 ||
        w.itemSize !== 4 ||
        i.count !== p.count ||
        w.count !== p.count
      )
        throw new TypeError(
          "Native body/feet require original four-component skin indices/weights",
        );
      for (let v = 0; v < p.count; v++) {
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const index = i.getComponent(v, k),
            weight = w.getComponent(v, k);
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= skeleton.bones.length ||
            !Number.isFinite(weight) ||
            weight < 0 ||
            weight > 1
          )
            throw new RangeError("Invalid native skin binding");
          total += weight;
        }
        if (Math.abs(total - 1) > 1e-4)
          throw new RangeError(
            "Native weights must preserve normalized source binding",
          );
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    proxy.add(mesh);
  }
  let base,
    owner,
    disposed = false;
  const nativeMeshes = [];
  function dispose() {
    if (disposed) return;
    disposed = true;
    base?.dispose();
  }
  function update(options = {}) {
    if (disposed) throw new Error("Mixed-binding owner disposed");
    try {
      assertSourceCurrent();
      if (
        sourceSkin.skeleton !== skeleton ||
        !sourceSkin.bindMatrix.equals(bind) ||
        sourceSkin.bindMode !== bindMode ||
        sourceSkin.material !== material ||
        sourceSkin.geometry !== sourceGeometry
      )
        throw new Error("Source actor binding changed");
    } catch (error) {
      dispose();
      throw error;
    }
    if (
      Object.keys(options.limbMatrices ?? {}).some((name) =>
        nativeNames.includes(name),
      )
    )
      throw new TypeError(
        "Native-bound body/feet follow the actor skeleton; only hand overrides are supported",
      );
    try {
      base.update(options);
    } catch (error) {
      if (!base.root.parent) dispose();
      throw error;
    }
    // Native children occupy the original skin's local coordinates. Their own
    // updateMatrixWorld refreshes Attached/Detached bindMatrixInverse correctly.
    base.root.updateWorldMatrix(true, false);
    base.root.updateMatrixWorld(true);
    return owner;
  }
  try {
    base = createSplitLimbAdapter({
      THREE,
      sourceSkin,
      parts: proxy,
      assertSourceCurrent,
    });
    for (const name of nativeNames) {
      const old = base.root.getObjectByName(name),
        mesh = new THREE.SkinnedMesh(old.geometry, material);
      mesh.name = name;
      mesh.bindMode = bindMode;
      mesh.bind(skeleton, bind);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.identity();
      mesh.frustumCulled = false;
      mesh.castShadow = old.castShadow;
      mesh.receiveShadow = old.receiveShadow;
      mesh.renderOrder = old.renderOrder;
      mesh.layers.mask = old.layers.mask;
      old.removeFromParent();
      base.root.add(mesh);
      nativeMeshes.push(mesh);
    }
    owner = {
      root: base.root,
      update,
      dispose,
      nativeMeshes,
      kind: "experimental-native-body-feet-plus-rigid-hands",
    };
    update();
    return owner;
  } catch (error) {
    dispose();
    throw error;
  }
}
