import * as T from "three";
import { sample as timeline, DURATION } from "./timeline.mjs";
export { DURATION };
const v = (a) => new T.Vector3(...a);
const clamp = (x) => Math.max(0, Math.min(1, x));
function lerp(a, b, u) {
  return a + (b - a) * u;
}
function radiusAt(config, y) {
  const h = config.carrier.height,
    r = config.carrier.radius;
  if (y <= h[0]) return r[0];
  for (let i = 1; i < h.length; i++)
    if (y <= h[i])
      return lerp(r[i - 1], r[i], (y - h[i - 1]) / (h[i] - h[i - 1]));
  return r.at(-1);
}
function alpha(theta, depth) {
  return Math.atan2(Math.sin(theta) / depth, Math.cos(theta));
}
function cupRotation(tilt, yaw) {
  return new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4()
      .makeRotationY(yaw)
      .multiply(new T.Matrix4().makeRotationX(tilt)),
  );
}
/** Returns proper rigid matrices in immutable source-mesh coordinates.
 * No clocks, loops, source writes, skin deformation, or geometric reconstruction. */
export function createRigidTeaController({ config, hold, sip }) {
  if (
    !config?.hands?.handL ||
    !config?.hands?.handR ||
    config.sourceSHA256 !==
      "84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a"
  )
    throw Error("Approved original source config required");
  const finite = (x, label) => {
    if (!Number.isFinite(x)) throw TypeError("Finite " + label + " required");
  };
  const vec = (x, label) => {
    if (!Array.isArray(x) || x.length !== 3 || !x.every(Number.isFinite))
      throw TypeError("Finite vec3 " + label + " required");
  };
  finite(config.depth, "depth");
  finite(config.exponent, "exponent");
  if (
    config.depth <= 0 ||
    config.depth > 2 ||
    config.exponent < 1 ||
    config.exponent > 8
  )
    throw RangeError("Carrier parameters");
  const heights = config.carrier?.height,
    radii = config.carrier?.radius;
  if (
    !Array.isArray(heights) ||
    !Array.isArray(radii) ||
    heights.length < 2 ||
    heights.length !== radii.length ||
    !heights.every(Number.isFinite) ||
    !radii.every((x) => Number.isFinite(x) && x > 0) ||
    heights.some((x, i) => i > 0 && x <= heights[i - 1])
  )
    throw TypeError("Finite monotonic carrier required");
  if (Object.keys(config.hands).sort().join(",") !== "handL,handR")
    throw TypeError("Exactly two hands required");
  for (const [name, h] of Object.entries(config.hands)) {
    for (const k of [
      "root",
      "gripSource",
      "cupLocalGrip",
      "cupLocalCorrection",
      "cupLocalHoldOffset",
    ])
      vec(h[k], name + "." + k);
    for (const k of ["theta0", "thetaHold", "holdHeight", "inset", "side"])
      finite(h[k], name + "." + k);
    if (
      h.side !== (name === "handL" ? -1 : 1) ||
      h.inset < 0 ||
      h.inset > 0.15 ||
      h.holdHeight < heights[0] ||
      h.holdHeight > heights.at(-1) ||
      Math.abs(h.theta0) > Math.PI ||
      Math.abs(h.thetaHold) > Math.PI
    )
      throw RangeError("Hand geometry configuration");
  }
  for (const [name, fit] of [
    ["hold", hold],
    ["sip", sip],
  ]) {
    vec(fit?.cupCenter, name + " cup center");
    for (const k of ["cupTiltX", "cupYawY"]) {
      finite(fit?.parameters?.[k], name + " " + k);
      if (Math.abs(fit.parameters[k]) > Math.PI) throw RangeError("Cup angle");
    }
  }
  // Defensive copies keep later caller edits from changing the controller.
  config = structuredClone(config);
  hold = structuredClone(hold);
  sip = structuredClone(sip);
  const holdQ = cupRotation(hold.parameters.cupTiltX, hold.parameters.cupYawY);
  function entryMatrix(hand, u) {
    if (u === 0) return new T.Matrix4();
    const theta = lerp(hand.theta0, hand.thetaHold, u),
      height = lerp(hand.root[1], hand.holdHeight, u),
      angle = alpha(theta, config.depth),
      a0 = alpha(hand.theta0, config.depth),
      root = v(hand.root);
    const sourceRadius =
      (Math.abs(root.x) ** config.exponent +
        Math.abs(root.z / config.depth) ** config.exponent) **
      (1 / config.exponent);
    const radius =
      radiusAt(config, height) +
      (sourceRadius - radiusAt(config, root.y)) * (1 - u);
    const norm =
      (Math.abs(Math.cos(theta)) ** config.exponent +
        Math.abs(Math.sin(theta)) ** config.exponent) **
      (1 / config.exponent);
    const target = new T.Vector3(
      (hand.side * radius * Math.cos(theta)) / norm,
      height,
      (config.depth * radius * Math.sin(theta)) / norm,
    ).addScaledVector(
      new T.Vector3(hand.side * Math.cos(angle), 0, Math.sin(angle)),
      -hand.inset * u,
    );
    target.addScaledVector(
      v(hand.cupLocalHoldOffset).applyQuaternion(holdQ),
      u,
    );
    return new T.Matrix4()
      .makeTranslation(...target.toArray())
      .multiply(new T.Matrix4().makeRotationY(-hand.side * (angle - a0)))
      .multiply(new T.Matrix4().makeTranslation(-root.x, -root.y, -root.z));
  }
  const holds = Object.fromEntries(
    Object.entries(config.hands).map(([name, h]) => [name, entryMatrix(h, 1)]),
  );
  function sample(time, options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).some(
        (k) => !["cancelAt", "reducedMotion"].includes(k),
      )
    )
      throw TypeError("Unknown tea sample options");
    const state = timeline(time, options),
      u = clamp(state.lift);
    const tilt = lerp(hold.parameters.cupTiltX, sip.parameters.cupTiltX, u),
      yaw = lerp(hold.parameters.cupYawY, sip.parameters.cupYawY, u),
      quaternion = cupRotation(tilt, yaw),
      center = v(hold.cupCenter).lerp(v(sip.cupCenter), u);
    center.z += 0.0035 * Math.sin(Math.PI * u);
    const fullDelta = quaternion.clone().multiply(holdQ.clone().invert()),
      halfDelta = new T.Quaternion().slerp(fullDelta, 0.5),
      matrices = {};
    for (const [name, hand] of Object.entries(config.hands)) {
      if (u === 0) {
        matrices[name] = entryMatrix(hand, state.handEntry);
        continue;
      }
      const grip = v(hand.gripSource).applyMatrix4(holds[name]);
      const target = v(hand.cupLocalGrip)
        .addScaledVector(v(hand.cupLocalCorrection), u * u)
        .applyQuaternion(quaternion)
        .add(center);
      matrices[name] = new T.Matrix4()
        .makeTranslation(...target.toArray())
        .multiply(new T.Matrix4().makeRotationFromQuaternion(halfDelta))
        .multiply(new T.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z))
        .multiply(holds[name]);
    }
    return {
      ...state,
      matrices,
      cup: {
        center: center.toArray(),
        quaternion: quaternion.toArray(),
        scale: state.cupScale,
        opacity: state.cupOpacity,
      },
      sourceSHA256: config.sourceSHA256,
    };
  }
  return Object.freeze({ sample });
}
