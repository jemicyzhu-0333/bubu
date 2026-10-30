import * as T from "three";

const hinges = Object.freeze([
  Object.freeze({ name: "sakura_petal_1", degrees: 30, pivotVertex: 0, vertices: 49, indices: 144 }),
  Object.freeze({ name: "sakura_petal_2", degrees: 25, pivotVertex: 0, vertices: 49, indices: 144 }),
  // The leaf's authored proximal tip stays fixed. Axis is in the baked D2
  // asset frame, derived from the measured inward leaf/body witness.
  Object.freeze({ name: "sakura_leaf_-019", degrees: 10, pivotVertex: 185, vertices: 691, indices: 3648,
    axis: Object.freeze([0.3983094239615776, -0.7290999759862429, -0.5565634086070127]) }),
]);

/** Private, baked binding asset only. Preserve every source vertex, each petal
 * centre and the leaf's proximal tip; change only their rigid local frames.
 * ARCHITECTURE「V2 动画研究底座」: no canonical model or controller writes. */
export function fitSakuraParts(asset) {
  const prepared = hinges.map(({ name, degrees, pivotVertex, vertices, indices: indexCount, axis: fixedAxis }) => {
    const mesh = asset.getObjectByName(name);
    const position = mesh?.geometry?.attributes.position;
    const indices = mesh?.geometry?.index;
    if (
      !mesh?.isMesh || mesh.parent !== asset ||
      !mesh.matrix.equals(new T.Matrix4()) ||
      mesh.position.lengthSq() !== 0 ||
      mesh.quaternion.angleTo(new T.Quaternion()) !== 0 ||
      !mesh.scale.equals(new T.Vector3(1, 1, 1)) ||
      position?.count !== vertices || position.itemSize !== 3 ||
      indices?.count !== indexCount ||
      !position.array.every(Number.isFinite) ||
      !indices.array.every(i => Number.isSafeInteger(i) && i >= 0 && i < vertices)
    ) throw new Error("Unmodified baked sakura part required");
    const pivot = new T.Vector3().fromBufferAttribute(position, pivotVertex);
    const radial = new T.Vector3();
    for (let i = 1; i < position.count; i++)
      radial.add(new T.Vector3().fromBufferAttribute(position, i).sub(pivot));
    const normal = new T.Triangle(...[0, 1, 2].map(i =>
      new T.Vector3().fromBufferAttribute(position, indices.getX(i)),
    )).getNormal(new T.Vector3());
    const axis = fixedAxis ? new T.Vector3(...fixedAxis) : new T.Vector3().crossVectors(radial, normal);
    if (!axis.toArray().every(Number.isFinite) || axis.lengthSq() < 1e-10)
      throw new Error("Degenerate sakura hinge frame");
    axis.normalize();
    const matrix = new T.Matrix4().makeTranslation(...pivot.toArray())
      .multiply(new T.Matrix4().makeRotationAxis(axis, degrees * Math.PI / 180))
      .multiply(new T.Matrix4().makeTranslation(...pivot.clone().negate().toArray()));
    return { mesh, matrix };
  });
  // Validate all corrections before mutating any private part frame.
  for (const { mesh, matrix } of prepared) mesh.applyMatrix4(matrix);
  asset.updateMatrixWorld(true);
}
