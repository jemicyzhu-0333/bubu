'use strict';

import { applyPoint } from './rig/pose.mjs';

function extendedReleaseHand(artwork, side) {
  const data = artwork?.rig?.views?.[artwork.drawnView], world = artwork?.pose?.world;
  if (!data || !world) return false;
  const arm = data.bones[`arm_${side}`], hand = data.bones[`hand_${side}`];
  const from = applyPoint(world[arm.parent], ...arm.pivot);
  const to = applyPoint(world[`hand_${side}`], ...hand.pivot);
  // Match the support painter's existing connector threshold. Once the wrist
  // has returned to the short authored paw, the ordinary rest outline resumes.
  return Math.hypot(to[0] - from[0], to[1] - from[1]) > 8;
}

function expandedContactPaw(sample, side, artwork) {
  if (!sample || sample.contactAction === 'rest-nap') return false;
  const has = id => sample.props.includes(id);
  return (has('book') && ['read', 'organize', 'breathe'].includes(sample.motion))
    || (['paper', 'notes', 'chart'].some(has) && ['write', 'read', 'organize', 'trade'].includes(sample.motion))
    || (has('keyboard') && sample.motion === 'type')
    || (has('laptop') && (['browse', 'organize'].includes(sample.motion)
      || (sample.motion === 'breathe' && extendedReleaseHand(artwork, side))))
    || (has('needle-l') && has('needle-r') && sample.motion === 'knit')
    || (has('drum') && sample.motion === 'drum')
    || (has('blocks') && sample.motion === 'build')
    || (has('cup') && sample.motion === 'sip' && side === 'r')
    // Keep the same contour while the story's world-pose blend releases the
    // left cup hand. Switching painters at the beat boundary restores the old
    // separate paw/connector for the first few retracting frames.
    || (has('cup') && sample.contactAction === 'rest-tea'
      && (side === 'r' || sample.motion === 'carry' || extendedReleaseHand(artwork, side)))
    || (has('pan') && sample.motion === 'cook')
    || (side === 'r' && has('plant') && sample.motion === 'organize' && sample.contactAction === 'rest-plant')
    || (side === 'r' && ((has('broom') && sample.motion === 'sweep')
      || (has('umbrella') && sample.motion === 'umbrella')
      || (has('snack') && sample.motion === 'picnic')
      || (has('bubble-wand') && sample.motion === 'float')
      || (has('microphone') && sample.motion === 'sway')
      || (has('watering-can') && sample.motion === 'water')));
}

// PET_RIG「渲染顺序」: the authored paw already contains a short forearm.
// These contact poses therefore replace that whole part, rather than putting
// a second outlined connector underneath it. Other actions keep their art.
function integratedUsagiPaw(artwork, side) {
  const sample = artwork?.pose?.sample;
  if (!artwork?.rig?.views?.[artwork.drawnView]?.anchors?.['usagi.umbrella-grip'] || !sample) return false;
  const has = id => sample.props.includes(id);
  return (sample.motion === 'hiccup' && has('cup') && side === 'r')
    || (sample.motion === 'juggle' && has('balls-l'))
    || (sample.motion === 'carry' && has('energy'))
    || (sample.motion === 'telescope' && has('telescope'))
    || (sample.motion === 'look' && has('binoculars'))
    || expandedContactPaw(sample, side, artwork);
}

function contactPawGeometry(artwork, data, side) {
  const world = artwork.pose.world, arm = data.bones[`arm_${side}`];
  // The turned body's near shoulder is the authored contour junction (55,43).
  // Its legacy hand-bone pivot sits inside the belly and is not a visible root.
  // Keep that rig pivot for equipment matrices, but expose the limb at the contour.
  const root = side === 'r' && ['three-quarter', 'profile'].includes(artwork.drawnView) ? [55, 43] : arm.pivot;
  let from = applyPoint(world[arm.parent], ...root);
  const to = applyPoint(world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot);
  const direction = side === 'l' ? -1 : 1, motion = artwork.pose.sample.motion;
  let control;
  if (motion === 'hiccup') control = [(from[0] + to[0]) / 2 + direction * 2, (from[1] + to[1]) / 2 + 1];
  else if (motion === 'carry') control = [from[0] + direction * 1.5, Math.max(from[1], to[1]) + 5];
  else if (motion === 'juggle') control = [from[0] + direction * 5, from[1] + 6];
  else if (motion === 'telescope') control = [(from[0] + to[0]) / 2 + (side === 'r' ? 1 : 0), (from[1] + to[1]) / 2 + (side === 'r' ? 1 : 0)];
  else if (motion === 'look') control = [from[0] + direction * 3, (from[1] + to[1]) / 2];
  else if (expandedContactPaw(artwork.pose.sample, side, artwork)) {
    const reach = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (artwork.pose.sample.event?.category === 'ai') {
      // These quiet key contacts use a compact paw, not the full generic
      // browse elbow arc that made two rails cradle the whole computer.
      control = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + .35];
    } else if (['sip', 'picnic', 'sway', 'float'].includes(motion)) {
      // Bringing a held tool toward the face folds the elbow below the wrist.
      control = [(from[0] + to[0]) / 2 + direction * Math.min(2.5, reach * .12),
        Math.max(from[1], to[1]) + Math.min(5, reach * .24)];
    } else if (['sweep', 'umbrella', 'water'].includes(motion)) {
      // Lateral tools keep a shallow outward arc, with their exact grip retained.
      control = [(from[0] + to[0]) / 2 + direction,
        (from[1] + to[1]) / 2 + Math.min(2, reach * .12)];
    } else {
      // Table work keeps the palm near the work surface and a soft low elbow.
      control = [(from[0] + to[0]) / 2 + direction * Math.min(2, reach * .1),
        Math.max(from[1], to[1]) + Math.min(3, reach * .2)];
    }
  }
  else control = [from[0] + direction * 7, Math.max(from[1], to[1]) + 3];
  const expanded = expandedContactPaw(artwork.pose.sample, side, artwork);
  if (expanded) {
    // Recess only this new family's open root into the unchanged torso. The
    // tool's exact wrist is untouched; no second cap or cream cover strip.
    const dx = control[0] - from[0], dy = control[1] - from[1], length = Math.hypot(dx, dy) || 1;
    from = [from[0] - dx / length * 2, from[1] - dy / length * 2];
  }
  return { from, to, control, radius: motion === 'juggle' ? 3.6 : 3.7, ...(expanded ? { openRoot: true } : {}) };
}

function paintUsagiContactPart(ctx, { part, data, artwork }) {
  const side = part.bone === 'hand_l' ? 'l' : part.bone === 'hand_r' ? 'r' : null;
  if (!side || !integratedUsagiPaw(artwork, side)) return false;
  const { from, to, control, radius, openRoot } = contactPawGeometry(artwork, data, side);
  const edge = sign => Array.from({ length: 17 }, (_, n) => {
    const t = n / 16, u = 1 - t;
    const p = [u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]];
    const dx = 2 * (u * (control[0] - from[0]) + t * (to[0] - control[0]));
    const dy = 2 * (u * (control[1] - from[1]) + t * (to[1] - control[1]));
    const length = Math.hypot(dx, dy) || 1, width = 2.5 + (radius - 2.5) * t;
    return [p[0] - sign * dy / length * width, p[1] + sign * dx / length * width];
  });
  const outer = edge(1), inner = edge(-1), startAngle = Math.atan2(outer.at(-1)[1] - to[1], outer.at(-1)[0] - to[0]);
  const hand = part.shapes.find(shape => shape.fill && shape.fill !== 'none');
  ctx.save(); ctx.beginPath(); ctx.moveTo(...outer[0]);
  for (const point of outer.slice(1)) ctx.lineTo(...point);
  ctx.arc(...to, radius, startAngle, startAngle - Math.PI, true);
  for (const point of inner.reverse().slice(1)) ctx.lineTo(...point);
  // Fill closes the shoulder edge, while the outline deliberately stays open.
  // There is one palm cap and no wrist ring or second authored paw underneath.
  ctx.fillStyle = hand?.fill || '#fff5de'; ctx.fill();
  if (openRoot) {
    // Start both exposed contours beyond the buried root, without drawing a
    // closing shoulder stroke. This also preserves the canonical belly line.
    ctx.beginPath(); ctx.moveTo(...outer[3]);
    for (const point of outer.slice(4)) ctx.lineTo(...point);
    ctx.arc(...to, radius, startAngle, startAngle - Math.PI, true);
    for (const point of edge(-1).slice(3, -1).reverse()) ctx.lineTo(...point);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = hand?.stroke || '#351710';
  ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  return true;
}

export { expandedContactPaw, integratedUsagiPaw, contactPawGeometry, paintUsagiContactPart };
