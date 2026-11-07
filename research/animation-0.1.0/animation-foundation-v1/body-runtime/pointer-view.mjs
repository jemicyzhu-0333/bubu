/** Copied ray/render mapping only. Device pixels and motion samples are absent. */
export function readPointerView(target, camera) {
  try {
    const rect = target.getBoundingClientRect();
    const values = [rect.left, rect.top, rect.width, rect.height];
    if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
    camera.updateMatrixWorld(true);
    for (const matrix of [camera.matrixWorld, camera.projectionMatrix, camera.projectionMatrixInverse]) {
      if (!matrix?.elements || matrix.elements.length !== 16) return null;
      values.push(...matrix.elements);
    }
    return values.every(Number.isFinite) ? Object.freeze(values) : null;
  } catch { return null; }
}
export function samePointerView(a, b) {
  return a !== null && b !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}
