export function requireFiniteMatrix(matrix) {
  if (!matrix?.isMatrix4 || !matrix.elements.every(Number.isFinite)) {
    throw new Error('Invalid anchor matrix elements');
  }
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
    throw new Error('Invalid or singular anchor transform');
  }
}

/** Pure weighted surface sampling using final actor matrices, never actor mutation. */
export function sampleWeightedFrame(T, { definition: d, mesh }, bones, inverses) {
  const deformation = new T.Matrix4();
  if (mesh.isSkinnedMesh) {
    deformation.elements.fill(0);
    for (let c = 0; c < 4; c++) {
      const index = d.skinIndices[c];
      const weight = d.skinWeights[c];
      if (!weight) continue;
      const bone = new T.Matrix4().multiplyMatrices(bones[index].matrixWorld, inverses[index]);
      requireFiniteMatrix(bone);
      for (let k = 0; k < 16; k++) deformation.elements[k] += weight * bone.elements[k];
    }
    deformation.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
  }
  const surface = new T.Matrix4().multiplyMatrices(mesh.matrixWorld, deformation);
  requireFiniteMatrix(surface);
  // Three evaluates position morphs before its bind-space skin deformation.
  const position = mesh.getVertexPosition(d.vertex, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
  const normalMatrix = new T.Matrix3().getNormalMatrix(surface);
  const normal = new T.Vector3(...d.normal);
  const morphNormals = mesh.geometry.morphAttributes.normal ?? [];
  const baseNormal = normal.clone();
  const morph = new T.Vector3();
  for (let index = 0; index < morphNormals.length; index++) {
    const weight = mesh.morphTargetInfluences[index];
    if (!Number.isFinite(weight)) throw new Error('Invalid morph influence');
    morph.fromBufferAttribute(morphNormals[index], d.vertex);
    if (!mesh.geometry.morphTargetsRelative) morph.sub(baseNormal);
    normal.addScaledVector(morph, weight);
  }
  if (!normal.toArray().every(Number.isFinite) || normal.lengthSq() < 1e-12)
    throw new Error('Degenerate anchor morph normal');
  const normalRotation = new T.Quaternion().setFromUnitVectors(baseNormal.clone().normalize(), normal.clone().normalize());
  normal.applyMatrix3(normalMatrix).normalize();
  if (!normal.toArray().every(Number.isFinite) || normal.lengthSq() < 0.99)
    throw new Error('Degenerate anchor normal');
  const tangent = new T.Vector3(...d.tangentX).applyQuaternion(normalRotation).transformDirection(surface);
  tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
  if (tangent.lengthSq() < 0.99) throw new Error('Degenerate anchor tangent');
  const bitangent = new T.Vector3().crossVectors(normal, tangent).normalize();
  const frame = new T.Matrix4().makeBasis(tangent, bitangent, normal).setPosition(position);
  requireFiniteMatrix(frame);
  return frame;
}
