import { createTeaCup } from "./cup-model.mjs";
/** Caller owns time and actor. These resources own the cup only. */
export function createTeaSceneResources(options = {}) {
  const cup = createTeaCup({
    radius: 0.23081978518525692,
    height: 0.3091484835864778,
    ...options,
  });
  let disposed = false;
  cup.root.traverse((o) => {
    if (o.isMesh) o.material.transparent = true;
  });
  function apply(sample) {
    if (disposed) throw Error("Disposed tea resources");
    const c = sample?.cup;
    if (
      !c ||
      !Array.isArray(c.center) ||
      c.center.length !== 3 ||
      !c.center.every(Number.isFinite) ||
      !Array.isArray(c.quaternion) ||
      c.quaternion.length !== 4 ||
      !c.quaternion.every(Number.isFinite) ||
      Math.abs(Math.hypot(...c.quaternion) - 1) > 1e-6 ||
      !Number.isFinite(c.scale) ||
      c.scale < 0 ||
      c.scale > 1 ||
      !Number.isFinite(c.opacity) ||
      c.opacity < 0 ||
      c.opacity > 1
    )
      throw TypeError("Valid cup sample required");
    cup.root.position.fromArray(c.center);
    cup.root.quaternion.fromArray(c.quaternion);
    cup.root.scale.setScalar(c.scale);
    cup.root.visible = c.scale > 1e-8 && c.opacity > 0;
    cup.root.traverse((o) => {
      if (o.isMesh) o.material.opacity = c.opacity;
    });
  }
  return {
    root: cup.root,
    apply,
    dispose() {
      if (disposed) return;
      disposed = true;
      cup.dispose();
    },
    get disposed() {
      return disposed;
    },
  };
}
/** Adapter names are explicit so original matrix semantics remain unambiguous. */
export function teaLimbOverrides(sample) {
  return {
    "Bubu_hand-left": sample.matrices.handL,
    "Bubu_hand-right": sample.matrices.handR,
  };
}
