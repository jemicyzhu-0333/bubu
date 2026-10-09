'use strict';
import { sampleUsagiFall } from './usagi-ground.mjs';
import { sampleUsagiEventBody } from './usagi-event-actions.mjs';
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const ease = t => t * t * (3 - 2 * t);

// Art-space transforms move the entire cached torso, face and live rig
// together. Bone-only root rotation would pull the limbs off a static body.
function sampleBodyMotion(motion, progress) {
  const p = clamp(progress), s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  const lift = Math.sin(Math.PI * p) ** 2;
  let x = 0, y = 0, r = 0, sx = 1, sy = 1;
  switch (motion) {
    case 'hop': x = s * 2; y = -Math.abs(Math.sin(TAU * p)) * 5; r = s * .07; break;
    case 'dance': x = s * 3.2; y = -Math.abs(Math.sin(TAU * p * 2)) * 2.3; r = s * .11; break;
    case 'sway': x = s * 1.8; r = s * .08; break;
    case 'spin': x = s * 2; y = -lift * 2.5; r = TAU * ease(p); break;
    case 'dash': x = s * 5; y = -Math.abs(Math.sin(TAU * p * 3)) * 2; r = s * .055; break;
    case 'glide': x = s * 5; y = -lift * 3; r = s * .07; break;
    case 'moonwalk': x = -s * 5; y = -Math.abs(Math.sin(TAU * p * 2)) * .8; r = -s * .035; break;
    case 'float': x = s * 2; y = -lift * 4; r = s * .045; break;
    case 'carry': x = s * 1.3; y = Math.abs(Math.sin(TAU * p * 2)) * 1; r = s * .035; break;
    case 'stretch': y = -lift * 1.7; sx = 1 - lift * .025; sy = 1 + lift * .035; break;
    case 'breathe': sx = 1 + lift * .018; sy = 1 + lift * .02; break;
    case 'pushup': y = lift * 2.4; r = Math.sin(TAU * p * 2) * .075; break;
    case 'fall': y = sampleUsagiFall(p); break;
    case 'hide': y = lift * 5.5; sx = 1 + lift * .02; sy = 1 - lift * .07; break;
    case 'squish': x = lift * 2; sx = 1 - lift * .06; sy = 1 + lift * .035; break;
    case 'hiccup': y = -(Math.max(0, Math.sin(TAU * p * 3)) ** 6) * 2.4; r = s * .025; break;
    case 'recoil': x = -(Math.max(0, Math.sin(TAU * p)) ** 4) * 2.8; r = -Math.sin(TAU * p) * .09; break;
    case 'wave': case 'high-five': r = Math.sin(TAU * p * 2) * .04; break;
    case 'box': x = Math.sin(TAU * p * 2) * 1.5; r = Math.sin(TAU * p * 2) * .06; break;
    case 'umbrella': x = s * 2; r = s * .085; break;
    case 'wag': r = Math.sin(TAU * p * 3) * .035; break;
    case 'drum': y = -Math.abs(Math.sin(TAU * p * 3)) * .6; break;
    // The pot, soil and sweeping floor share a stationary ground plane.
    case 'dig': case 'sweep': case 'water': break;
    default: break;
  }
  return Object.freeze({ x, y, r, sx, sy });
}
function motionOffset(motion, progress, calmVisual, { action } = {}) {
  if (calmVisual) return { x: 0, y: 0 };
  const { x, y } = sampleUsagiEventBody(action, progress, calmVisual) || sampleBodyMotion(motion, progress);
  return { x, y };
}
function applyMotionTransform(ctx, motion, progress, { calmVisual, size, translate, action }) {
  if (calmVisual) return;
  const pose = sampleUsagiEventBody(action, progress, calmVisual) || sampleBodyMotion(motion, progress);
  const move = translate || ((x, y) => ctx.translate(x, y));
  move(size / 2, size / 2);
  ctx.rotate(pose.r);
  if (pose.sx !== 1 || pose.sy !== 1) ctx.scale(pose.sx, pose.sy);
  move(-size / 2, -size / 2);
}
export { sampleBodyMotion, motionOffset, applyMotionTransform };
