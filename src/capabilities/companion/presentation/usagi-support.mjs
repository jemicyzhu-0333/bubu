// Body and face stay exclusively in the rig; presentation additions are focused painters.
import { appearance } from './usagi-appearance.mjs';
import { expressionAccent, statusEffect } from './usagi-accents.mjs';

import { motionOffset, applyMotionTransform } from './usagi-body-motion.mjs';
import { prepareUsagiSample, usagiPropMatrix, paintUsagiProp } from './usagi-contact.mjs';
import { usagiPartLayer } from './usagi-garment-depth.mjs';
import { integratedUsagiPaw, paintUsagiContactPart } from './usagi-contact-limbs.mjs';
import { usagiGesture, paintUsagiGesturePart, paintUsagiGestureBack } from './usagi-gesture-limbs.mjs';
import { prepareUsagiEventSample } from './usagi-event-actions.mjs';
import { paintUsagiEventProp } from './usagi-event-equipment.mjs';

// Contacts keep their exact endpoints. Bringing a cup or carried object in
// toward the belly bends the elbow below the wrist instead of making a rigid
// diagonal tube across the chest. Other gestures retain their existing arc.
function connectorControl(from, to, side, motion) {
  const direction = side === 'l' ? -1 : 1;
  if (motion === 'sip' || motion === 'carry' || motion === 'reach') {
    const reach = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [(from[0] + to[0]) / 2 + direction * Math.min(3, reach * .15),
      Math.max(from[1], to[1]) + Math.min(6.5, reach * .35)];
  }
  return [(from[0] + to[0]) / 2 + direction * 1.5, (from[1] + to[1]) / 2 + 1.5];
}

function connectors(ctx, { motion, layer, data, world, artwork }) {
  if (usagiGesture(artwork)) return paintUsagiGestureBack(ctx, { artwork, data, layer });
  if (!motion || motion === 'idle' || !data.anchors?.['usagi.umbrella-grip']) return false;
  const map = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  let painted = false;
  for (const side of ['l', 'r']) {
    const arm = data.bones[`arm_${side}`], handBone = `hand_${side}`;
    if (integratedUsagiPaw(artwork, side)) continue;
    const part = data.parts.find(value => value.bone === handBone);
    // A reaching forearm emerges from behind the torso edge. Painting its
    // round root cap over the belly would read as a detached outlined patch.
    const tuckedRoot = (motion === 'umbrella' || motion === 'reach') && side === 'r';
    const desiredLayer = tuckedRoot ? 'back' : usagiPartLayer(part, artwork);
    if (desiredLayer !== layer) continue;
    const from = map(world[arm.parent], ...arm.pivot), to = map(world[handBone], ...data.bones[handBone].pivot);
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 8) continue;
    const hand = part?.shapes.find(shape => shape.fill && shape.fill !== 'none');
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(...from);
    ctx.quadraticCurveTo(...connectorControl(from, to, side, motion), ...to);
    const reaching = motion === 'reach';
    ctx.strokeStyle = hand?.stroke || '#351710'; ctx.lineWidth = reaching ? 7.4 : 5.2; ctx.stroke();
    ctx.strokeStyle = hand?.fill || '#fff6dc'; ctx.lineWidth = reaching ? 5.2 : 3; ctx.stroke();
    ctx.restore(); painted = true;
  }
  return painted;
}

const support = Object.freeze({
  appearance, connectors,
  paintPart: (context, options) => paintUsagiGesturePart(context, options) || paintUsagiContactPart(context, options),
  prepareSample: (sample, options) => prepareUsagiEventSample(sample, options) || prepareUsagiSample(sample, options),
  propMatrix: usagiPropMatrix,
  paintProp: (ctx, options, paint) => paintUsagiEventProp(ctx, options, paint) || paintUsagiProp(ctx, options, paint),
  motionOffset,
  applyMotionTransform,
  expressionAccent,
  statusEffect,
  body: () => false,
  face: () => null,
  action: () => false
});
export { connectorControl };
export default support;
