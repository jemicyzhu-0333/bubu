'use strict';

import { applyPoint } from './rig/pose.mjs';

// Shoulder anchors preserve the approved view-specific layering and proportions.
// Curve and width coefficients are fitted to the approved rendered appearance.
const SHOULDERS = Object.freeze({
  front: Object.freeze({ l: [12, 44], r: [54, 44] }),
  'three-quarter': Object.freeze({ l: [16, 44], r: [55, 43] }),
  profile: Object.freeze({ l: [18, 44], r: [55, 43] }),
  back: Object.freeze({ l: [12, 44], r: [54, 44] })
});

function usagiGesture(artwork) {
  const gesture = artwork?.pose?.sample?.gesture;
  const data = artwork?.rig?.views?.[artwork.drawnView];
  return data?.anchors?.['usagi.umbrella-grip'] && ['yawn', 'high-five', 'wave', 'stretch'].includes(gesture)
    ? gesture : null;
}

function gestureShoulder(view, side) {
  return (SHOULDERS[view] || SHOULDERS.front)[side].slice();
}

function behindBody(artwork, side) {
  return artwork.drawnView === 'back'
    || (['three-quarter', 'profile'].includes(artwork.drawnView) && side === 'l');
}

function gesturePawGeometry(artwork, data, side) {
  const world = artwork.pose.world, arm = data.bones[`arm_${side}`];
  const root = gestureShoulder(artwork.drawnView, side);
  const from = applyPoint(world[arm.parent], ...root);
  const to = applyPoint(world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot);
  const direction = side === 'l' ? -1 : 1;
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy) || 1;
  // A bounded perpendicular bow cannot reverse the short centerline tangent.
  const bow = Math.min(1.4, length * .125) * direction;
  const control = [(from[0] + to[0]) / 2 - dy / length * bow,
    (from[1] + to[1]) / 2 + dx / length * bow];
  const inside = applyPoint(world[arm.parent], root[0] - direction * 2.5, root[1]);
  return { from, to, control, inside, radius: 3.4, rootRadius: 2.9 };
}

function paintPaw(ctx, artwork, data, side) {
  const { from, to, control, inside, radius, rootRadius } = gesturePawGeometry(artwork, data, side);
  const edge = sign => Array.from({ length: 17 }, (_, index) => {
    const t = index / 16, u = 1 - t;
    const x = u * u * from[0] + 2 * u * t * control[0] + t * t * to[0];
    const y = u * u * from[1] + 2 * u * t * control[1] + t * t * to[1];
    const dx = 2 * (u * (control[0] - from[0]) + t * (to[0] - control[0]));
    const dy = 2 * (u * (control[1] - from[1]) + t * (to[1] - control[1]));
    const length = Math.hypot(dx, dy) || 1, width = rootRadius + (radius - rootRadius) * t;
    return [x - sign * dy / length * width, y + sign * dx / length * width];
  });
  const outer = edge(1), inner = edge(-1);
  const angle = Math.atan2(outer.at(-1)[1] - to[1], outer.at(-1)[0] - to[0]);
  const rootShift = [inside[0] - from[0], inside[1] - from[1]];
  const shape = data.parts.find(part => part.bone === `hand_${side}`)?.shapes
    .find(value => value.fill && value.fill !== 'none');
  const outline = () => {
    ctx.moveTo(...outer[0]);
    for (const point of outer.slice(1)) ctx.lineTo(...point);
    ctx.arc(...to, radius, angle, angle - Math.PI, true);
    for (const point of inner.slice().reverse().slice(1)) ctx.lineTo(...point);
  };
  ctx.save();
  ctx.beginPath(); outline();
  ctx.lineTo(inner[0][0] + rootShift[0], inner[0][1] + rootShift[1]);
  ctx.lineTo(outer[0][0] + rootShift[0], outer[0][1] + rootShift[1]);
  ctx.closePath(); ctx.fillStyle = shape?.fill || '#fff5de'; ctx.fill();
  // Outline is deliberately open at the shoulder; no root cap or wrist ring.
  ctx.beginPath(); outline();
  ctx.strokeStyle = shape?.stroke || '#351710'; ctx.lineWidth = 1.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
  return true;
}

function paintUsagiGesturePart(ctx, { part, data, artwork }) {
  const side = part?.bone === 'hand_l' ? 'l' : part?.bone === 'hand_r' ? 'r' : null;
  if (!side || !usagiGesture(artwork)) return false;
  // Far hands have already painted behind the body. Wrapped near hands paint
  // between body/face and complete front cloth, then skip this foreground pass.
  if (behindBody(artwork, side) || artwork.wardrobe?.wrapsBody) return true;
  return paintPaw(ctx, artwork, data, side);
}

function paintUsagiGestureBack(ctx, { artwork, data, layer }) {
  if (!usagiGesture(artwork) || layer !== 'back') return false;
  let painted = false;
  for (const side of ['l', 'r']) if (behindBody(artwork, side)) {
    painted = paintPaw(ctx, artwork, data, side) || painted;
  }
  return painted;
}

function paintUsagiGestureUnderCloth(ctx, { artwork }) {
  if (!usagiGesture(artwork) || !artwork.wardrobe?.wrapsBody) return false;
  const data = artwork.rig.views[artwork.drawnView];
  let painted = false;
  for (const side of ['l', 'r']) if (!behindBody(artwork, side)) {
    painted = paintPaw(ctx, artwork, data, side) || painted;
  }
  return painted;
}

export { usagiGesture, gestureShoulder, gesturePawGeometry,
  paintUsagiGesturePart, paintUsagiGestureBack, paintUsagiGestureUnderCloth };
