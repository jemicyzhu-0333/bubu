import * as T from "three";
import { cleanupOwned } from "./cleanup-owned.mjs";
export function bakeGroup(root, frame = new T.Matrix4()) {
  root.updateWorldMatrix(true, true);
  const result = new T.Group(),
    inv = frame.clone().invert();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const geometry = m.geometry.clone();
    geometry.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    const mesh = new T.Mesh(geometry, m.material.clone());
    mesh.name = m.name;
    result.add(mesh);
  });
  return result;
}
/** Release owned asset resources once per batch; never pass borrowed source roots. */
export function disposeAssets(roots) {
  const gs = new Set(),
    ms = new Set(),
    ts = new Set();
  for (const root of new Set(roots))
    root.traverse((m) => {
      if (m.geometry) gs.add(m.geometry);
      for (const mat of Array.isArray(m.material)
        ? m.material
        : m.material
          ? [m.material]
          : []) {
        ms.add(mat);
        for (const v of Object.values(mat)) if (v?.isTexture) ts.add(v);
      }
    });
  cleanupOwned(
    [...gs, ...ms, ...ts].map((resource) => () => resource.dispose()),
    "Owned asset disposal failures",
  );
}
export function disposeAsset(root) {
  disposeAssets([root]);
}
