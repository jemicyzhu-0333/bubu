import * as T from "three";

/** ARCHITECTURE「V2 动画研究底座」: rigid assembly only. Keep the
 * satchel spring origin or cape mount origin fixed, without editing geometry,
 * simulation parameters, pin weights, or the instance's anchor bounds. */
export function fitWearableCalibration(kind, calibration) {
  const e = calibration?.elements;
  if (!["satchel", "cape"].includes(kind) || !calibration?.isMatrix4 ||
      !e.every(Number.isFinite) ||
      Math.abs(calibration.determinant() - 1) > 1e-8 ||
      [0, 4, 8].some(i => Math.abs(Math.hypot(e[i], e[i + 1], e[i + 2]) - 1) > 1e-8) ||
      [[0, 4], [0, 8], [4, 8]].some(([i, j]) =>
        Math.abs(e[i] * e[j] + e[i + 1] * e[j + 1] + e[i + 2] * e[j + 2]) > 1e-8) ||
      [3, 7, 11].some(i => e[i] !== 0) || e[15] !== 1)
    throw new Error("Rigid admitted wearable calibration required");
  const pivot = kind === "satchel"
    ? new T.Vector3(-.91, .57, .35)
    : new T.Vector3().applyMatrix4(calibration.clone().invert());
  const rotation = kind === "satchel"
    ? new T.Matrix4().makeRotationFromEuler(new T.Euler(
      4 * Math.PI / 180, -Math.PI / 180, -6 * Math.PI / 180))
    : new T.Matrix4().makeRotationX(2 * Math.PI / 180);
  return calibration.clone().multiply(new T.Matrix4()
    .makeTranslation(...pivot.toArray()).multiply(rotation)
    .multiply(new T.Matrix4().makeTranslation(...pivot.clone().negate().toArray())));
}
