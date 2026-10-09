'use strict';

// Forward kinematics for a rig view. Bones rotate and scale about their own
// pivot (art coordinates at rest) and inherit their parent's transform. The
// result is one canvas matrix [a, b, c, d, e, f] per bone.
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

function multiply(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1
  ];
}

function applyPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A local pose is bounded so a malformed motion cannot fling a limb off the
// transparent window: ±180° rotation, ±24 art units of travel, 0.5–1.6 scale.
function localMatrix(pivot, local = {}) {
  const r = clamp(Number(local.r) || 0, -Math.PI, Math.PI);
  const x = clamp(Number(local.x) || 0, -24, 24);
  const y = clamp(Number(local.y) || 0, -24, 24);
  const sx = clamp(Number.isFinite(local.sx) ? local.sx : 1, 0.5, 1.6);
  const sy = clamp(Number.isFinite(local.sy) ? local.sy : 1, 0.5, 1.6);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const [px, py] = pivot;
  // translate(x,y) · translate(p) · rotate(r) · scale(sx,sy) · translate(-p)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, px + x - (a * px + c * py), py + y - (b * px + d * py)];
}

function orderBones(bones) {
  const order = [];
  const placed = new Set();
  const visit = id => {
    if (placed.has(id)) return;
    const parent = bones[id].parent;
    if (parent) visit(parent);
    placed.add(id);
    order.push(id);
  };
  for (const id of Object.keys(bones)) visit(id);
  return order;
}

const orderCache = new WeakMap();

function computeBoneWorld(bones, localPose = {}) {
  let order = orderCache.get(bones);
  if (!order) { order = orderBones(bones); orderCache.set(bones, order); }
  const world = {};
  for (const id of order) {
    const bone = bones[id];
    const local = localMatrix(bone.pivot, localPose[id]);
    world[id] = bone.parent ? multiply(world[bone.parent], local) : local;
  }
  return world;
}

export { IDENTITY, multiply, applyPoint, localMatrix, computeBoneWorld };
export default Object.freeze({ IDENTITY, multiply, applyPoint, localMatrix, computeBoneWorld });
