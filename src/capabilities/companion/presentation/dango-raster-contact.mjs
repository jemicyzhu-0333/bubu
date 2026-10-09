'use strict';

import { COMPANION_ACTIVITY_STORIES } from '../../../content/companion/activity-stories.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Dango-only placement of the saved raster anatomy. The shared contact
// sampler and the other form's story/rig poses remain unchanged.
function refineRasterContact(contact, action, progress, view, toolSprites = {}) {
  if (!contact) return contact;
  if (action.id === 'dig-treasure') {
    const shift = view === 'front' ? 28 : 18;
    for (const tool of contact.tools) tool.x += shift;
    for (const detail of contact.details) detail.at[0] += shift;
    contact.hands = contact.hands.filter(hand => hand.side === 'right');
    for (const hand of contact.hands) hand.points = hand.points.map((point, i) => i ? [point[0] + shift, point[1]] : point);
  }
  if (action.id === 'chase-laser') for (const detail of contact.details) {
    if (detail.type === 'laser') detail.at = [72 + Math.sin(progress * Math.PI * 6) * 3, 60 + Math.cos(progress * Math.PI * 4) * 1.5];
  }
  if (action.id === 'sweep' && action.prop === 'broom') {
    // One near paw wraps the inspected handle anchor. The old second paw
    // sat on the bristles and implied an arm across the entire torso.
    contact.hands = contact.hands.filter(hand => hand.side === 'right');
  }
  if (action.id === 'rest-nap' && action.motion === 'stretch') {
    const stretch = ease(progress / .14) * ease((1 - progress) / .16);
    const phase = action.sequencePhase, stages = COMPANION_ACTIVITY_STORIES['rest-nap'].stages;
    const span = phase ? stages[phase.index].until - (stages[phase.index - 1]?.until || 0) : 1;
    const elapsed = phase ? phase.progress * span * (action.durationMs || action.duration || 30000) : 240;
    const blend = ease(elapsed / 240);
    for (const hand of contact.hands) {
      const left = hand.side === 'left', prior = hand.points.at(-1);
      const target = [left ? 3 - stretch * 3.5 : 63 + stretch * 3.5, 39 - stretch * 12];
      hand.points = [hand.points[0], hand.points[0], prior.map((value, axis) => value + (target[axis] - value) * blend)];
      // The source paw already includes a wrist. Turn that wrist into the
      // flank rather than adding a second outlined oval below the palm.
      hand.rotation = (left ? 1 : -1) * stretch * .95 * blend;
      hand.connector = false;
    }
  }
  if (action.id === 'tail-wiggle' && action.prop === 'tail') {
    const tail = contact.tools.find(item => item.key === 'tail');
    if (tail) {
      const back = view === 'back', front = view === 'front';
      const sway = Math.sin(progress * Math.PI * 6);
      const sprite = toolSprites.tail, root = sprite?.anchors?.root || [1.5, 7.25];
      const flip = !back && !front;
      const pivot = [flip ? (sprite?.width || 13) - root[0] : root[0], root[1]];
      const scale = back || front ? .9 : .88;
      const anchor = back || front ? [33, 52] : [5, 48.5];
      // PET_VISUAL「摇尾巴的视角解剖」: the same round tuft projects
      // upward from the central rump in back view, but outward from the rear
      // flank in the approved angled view. Front view is hidden by the torso.
      // The open source root turns downward on the back surface, keeping a
      // connected attachment rather than a closed badge or a lateral nub.
      Object.assign(tail, { x: anchor[0] - scale * pivot[0], y: anchor[1] - scale * pivot[1],
        layer: 'back', surface: back, surfaceOpacity: (tail.opacity ?? 1) * (tail.persistent ? 1 : action.propOpacity ?? 1), scale, flip, pivot,
        rotate: back || front ? -Math.PI / 2 + sway * .24 : .12 + sway * .24 });
    }
  }
  return contact;
}

export { refineRasterContact };
