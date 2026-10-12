'use strict';
import { clamp01, smooth } from './motion-core/easing.mjs';
import { memoFrame } from './motion-core/memo.mjs';
// A planted foot owns its world-space position until the other foot has
// completed its slide. Body and both shoe attachments sample this same clock
// (memoized: one computation per frame however many layers ask).
const TARGETS = Object.freeze([-3, -3, -6, -6, -3, -3, 0, 0]);
const CALM = Object.freeze({ x: 0, feet: Object.freeze([Object.freeze({ x: 0, y: 0, r: 0 }), Object.freeze({ x: 0, y: 0, r: 0 })]),
  support: Object.freeze([0, 1]), lean: 0, bob: 0 });
function compute(p, calmVisual) {
  if (calmVisual) return CALM;
  const step = Math.max(0, Math.min(8, (p - .12) / .76 * 8));
  const index = Math.min(7, Math.floor(step)), t = step >= 8 ? 1 : step - index;
  const positions = [0, 0];
  for (let i = 0; i < index; i++) positions[i % 2] = TARGETS[i];
  const moving = index % 2;
  positions[moving] += (TARGETS[index] - positions[moving]) * smooth(t);
  const x = (positions[0] + positions[1]) / 2;
  // The travelling foot skims the floor; the opposite sole stays flat.
  const feet = positions.map((worldX, side) => Object.freeze({ x: worldX - x,
    y: side === moving ? -(Math.sin(Math.PI * t) ** 2) * 1.8 : 0, r: 0 }));
  // Performance accents, pinned at the floor so soles never lift: a backward
  // lean (shear) while gliding and a small sink on each weight transfer.
  const active = smooth((p - .08) / .08) * smooth((.94 - p) / .08);
  const lean = -.045 * active;
  const bob = .03 * active * Math.sin(Math.PI * t) ** 2;
  return Object.freeze({ x, feet: Object.freeze(feet),
    support: Object.freeze(t === 0 || t === 1 ? [0, 1] : [1 - moving]), lean, bob });
}
const memoized = memoFrame(compute, { size: 4 });
function sampleGroundedMoonwalk(progress, calmVisual = false) {
  return memoized(clamp01(Number(progress) || 0), Boolean(calmVisual));
}
sampleGroundedMoonwalk.stats = memoized.stats;
function sampleMoonwalkBody(progress, calmVisual = false) {
  const pose = sampleGroundedMoonwalk(progress, calmVisual);
  return { x: pose.x, y: 0, r: 0, sx: 1, sy: 1 - pose.bob, shear: pose.lean, ground: true };
}
export { sampleGroundedMoonwalk, sampleMoonwalkBody };
