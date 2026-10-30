import * as T from "three";

const parts = Object.freeze([
  Object.freeze(["satchel_pouch", 346, 1764]),
  Object.freeze(["satchel_flap", 288, 1716]),
  Object.freeze(["satchel_square_catch", 316, 1596]),
]);

/** ARCHITECTURE「V2 动画研究底座」: assembly owns private part frames.
 * Keep the admitted geometry, pin weights, spring controller and strap intact.
 * The pouch, flap and catch rotate together around the original support vertex.
 * This is a sampled outfit fit, not cloth or continuous contact acceptance. */
export function fitSatchelParts(root) {
  const prepared = parts.map(([name, vertices, indexCount]) => {
    const mesh = root.getObjectByName(name);
    const position = mesh?.geometry?.attributes.position;
    const indices = mesh?.geometry?.index;
    if (
      !mesh?.isMesh || mesh.parent !== root ||
      !mesh.matrix.equals(new T.Matrix4()) ||
      mesh.position.lengthSq() !== 0 ||
      mesh.quaternion.angleTo(new T.Quaternion()) !== 0 ||
      !mesh.scale.equals(new T.Vector3(1, 1, 1)) ||
      position?.count !== vertices || position.itemSize !== 3 ||
      indices?.count !== indexCount ||
      !position.array.every(Number.isFinite) ||
      !indices.array.every(i => Number.isSafeInteger(i) && i >= 0 && i < vertices)
    ) throw new Error("Unmodified admitted satchel part required");
    return mesh;
  });
  const pivot = new T.Vector3().fromBufferAttribute(prepared[0].geometry.attributes.position, 255);
  const fit = new T.Matrix4().makeTranslation(...pivot.toArray())
    .multiply(new T.Matrix4().makeRotationY(55 * Math.PI / 180))
    .multiply(new T.Matrix4().makeTranslation(...pivot.clone().negate().toArray()));
  // All parts pass before the first mutation; no new geometry or frame writer.
  for (const mesh of prepared) mesh.applyMatrix4(fit);
  root.updateMatrixWorld(true);
}
