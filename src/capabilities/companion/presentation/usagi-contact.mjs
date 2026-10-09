'use strict';

import { MOTIONS } from './rig/motions.mjs';
import { applyPoint } from './rig/pose.mjs';
import { gestureShoulder } from './usagi-gesture-limbs.mjs';

const TAU = Math.PI * 2;
const ease = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const rotate = (point, angle) => [point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
  point[0] * Math.sin(angle) + point[1] * Math.cos(angle)];
const VIEWS = Object.freeze({
  front: { mouth: [33, 33], eye: [43, 25] },
  'three-quarter': { mouth: [46, 33], eye: [53, 25] },
  profile: { mouth: [58, 30], eye: [50, 25] },
  back: { mouth: [33, 33], eye: [43, 25] }
});

function contactWeight(t, start = .08, ready = .32, release = .68, end = .94) {
  if (t <= start || t >= end) return 0;
  if (t < ready) return ease((t - start) / (ready - start));
  if (t <= release) return 1;
  return 1 - ease((t - release) / (end - release));
}

// Solve the wrist after orienting the tool. Hand and equipment then share the
// same complete bone matrix, including the artist's action transition blend.
function placePaw(bones, data, side, target, armAngle, toolAngle = 0) {
  const arm = `arm_${side}`, hand = `hand_${side}`;
  const shoulder = data.bones[arm].pivot, wrist = data.bones[hand].pivot;
  const offset = rotate([wrist[0] - shoulder[0], wrist[1] - shoulder[1]], armAngle);
  bones[arm] = { r: armAngle, x: target[0] - shoulder[0] - offset[0], y: target[1] - shoulder[1] - offset[1] };
  bones[hand] = { r: toolAngle - armAngle };
}

function pawForAnchor(anchor, localAnchor, toolAngle) {
  const offset = rotate(localAnchor, toolAngle);
  return [anchor[0] - offset[0], anchor[1] - offset[1]];
}

function prepareUsagiSample(sample, { data, view, progress = 0, calmVisual = false, action } = {}) {
  // The optional artist hook also accepts third-party rigs. Usagi contacts
  // require this identity's authored attachment and all four arm bones.
  if (!data?.anchors?.['usagi.umbrella-grip']
    || ['arm_l', 'arm_r', 'hand_l', 'hand_r'].some(id => !data.bones[id])) return sample;
  const t = calmVisual ? MOTIONS[sample.motion].hold : ((Number(progress) || 0) % 1 + 1) % 1;
  const bones = { ...sample.bones }, propPoses = { ...sample.propPoses };
  const layout = VIEWS[view] || VIEWS.front, hold = contactWeight(t), wave = Math.sin(TAU * t);
  // Keep the story's original lavender pillow through preparation, sleep
  // and waking. Its final stretch explicitly releases the prop.
  const napping = action?.id === 'rest-nap';
  const props = sample.props;
  const has = id => props.includes(id);
  const near = data.bones.hand_r.pivot;
  if (has('cup')) {
    // Shift the cup so the paw sits on the handle, not through its bowl.
    propPoses.cup = { x: -5 };
    const sipping = sample.motion === 'sip';
    const tilt = sipping ? hold * .14 : 0;
    const rest = [view === 'profile' ? 59 : view === 'three-quarter' ? 49 : sample.motion === 'carry' ? 33 : 43, 47];
    const rim = mix(rest, layout.mouth, sipping ? hold : 0);
    placePaw(bones, data, 'r', pawForAnchor(rim, [-5, -3], tilt), .55 + hold * .75, tilt);
    if (action?.prop === 'cup' && sample.motion === 'carry') {
      const support = [rim[0] - 3, rim[1] + 7];
      placePaw(bones, data, 'l', support, -.8);
    }
  }
  if (has('telescope')) {
    const tilt = -.06 * hold;
    propPoses.telescope = { x: -7, y: -6 };
    const eye = mix([layout.eye[0], 42], layout.eye, hold);
    // The authored eyepiece is (-2,+5) relative to the wrist; its equipment
    // offset places the visible supporting paw below the telescope tube.
    placePaw(bones, data, 'r', pawForAnchor(eye, [-9, -1], tilt), .9 + hold * .45, tilt);
    bones.arm_l = { r: 0 };
    bones.hand_l = { r: 0 };
  }
  if (has('binoculars')) {
    const y = 20 * (1 - hold);
    propPoses.binoculars = { y };
    placePaw(bones, data, 'l', [17, 28 + y], -.5);
    placePaw(bones, data, 'r', [49, 28 + y], .5);
  }
  if (has('watering-can')) {
    const pour = contactWeight(t, .12, .34, .66, .9), tilt = pour * .5;
    propPoses['watering-can'] = { x: 8 };
    const spout = mix([63, 49], [62, 47], pour);
    placePaw(bones, data, 'r', pawForAnchor(spout, [19, -4], tilt), .5 + pour * .35, tilt);
    // A grounded plant never wobbles with the watering wrist.
    delete propPoses.plant;
  }
  if (has('pan')) {
    propPoses.pan = { x: -4 };
    placePaw(bones, data, 'r', [48, 51 + wave * .45], .65, wave * .055);
    placePaw(bones, data, 'l', [31 + wave * 1.6, 48 - Math.cos(TAU * t) * .7], -.7);
  }
  if (has('broom')) {
    const tilt = wave * .3, ground = [59 + wave * 9, 67];
    placePaw(bones, data, 'r', pawForAnchor(ground, [0, 18], tilt), .25, tilt);
  }
  if (has('energy')) {
    propPoses.energy = { x: -7, y: 1 };
    const right = [view === 'profile' ? 58 : view === 'three-quarter' ? 45 : 40, 49 + Math.abs(wave) * .5];
    placePaw(bones, data, 'r', right, .8);
    placePaw(bones, data, 'l', [right[0] - 13, right[1]], -.8);
  }
  if (has('plane')) {
    const windup = contactWeight(t, 0, .28, .32, .68);
    placePaw(bones, data, 'r', mix([50, 48], [54, 43], windup), .35 - windup * 1.1, 0);
    propPoses.plane = { opacity: t < .86 ? 1 : 1 - ease(Math.min(1, (t - .86) / .1)) };
  }
  if (sample.motion === 'reach' && has('star')) {
    // Let the falling star meet a short, open paw outside the cheek. The old
    // independent forehead bob never reached the hand at any phase.
    const catchWeight = contactWeight(t, .08, .4, .64, .94);
    const caught = view === 'front' || view === 'back' ? [64, 53] : [60, 54];
    placePaw(bones, data, 'r', mix(near, caught, catchWeight), -.35 * catchWeight);
    propPoses.star = { catchWeight };
  }
  if (sample.motion === 'juggle' && has('balls-l')) {
    const origins = [[17, 8], [49, 8], [33, -1]];
    for (const [i, id] of ['balls-l', 'balls-r', 'balls-top'].entries()) {
      const angle = TAU * (t + i / 3), point = [33 + Math.sin(angle) * 33, 41.5 - Math.abs(Math.cos(angle)) * 72.5];
      propPoses[id] = { x: point[0] - origins[i][0], y: point[1] - origins[i][1] };
    }
    placePaw(bones, data, 'l', [0, 48 + wave * .7], -.55);
    placePaw(bones, data, 'r', [66, 48 - wave * .7], .55);
  }
  if (has('box')) propPoses.box = { sx: 1.48, sy: 1.2 };
  if (has('blocks')) {
    const lift = contactWeight(t, .05, .2, .38, .62), shift = lift * 15;
    propPoses.blocks = { x: shift, y: -lift * 10 };
    placePaw(bones, data, 'r', [41 + shift, 53 - lift * 10], .5);
    placePaw(bones, data, 'l', [22, 58], -.55);
  }
  if (has('pillow')) {
    if (['organize', 'doze', 'daydream'].includes(sample.motion)) {
      placePaw(bones, data, 'l', [15, 56 + wave * .4], -.3);
      placePaw(bones, data, 'r', [34, 56 - wave * .4], .5);
    }
  }
  if (has('pen') && sample.motion === 'write') {
    const tip = [32 + wave * 4, 57 + Math.cos(TAU * t * 2) * .7];
    placePaw(bones, data, 'r', pawForAnchor(tip, [-1.6, 6], -.05), .65, -.05);
  }
  if (has('plant') && !has('watering-can') && sample.motion === 'organize') {
    placePaw(bones, data, 'r', [56, 56 + Math.abs(wave) * .4], .2);
  }
  if (napping && sample.motion === 'stretch') {
    // Both stretches keep the reviewed sideways gesture. Pillow-holding
    // phases retain their contact pose above instead of the bare-paw rest.
    const lift = Math.sin(Math.PI * t) ** 2;
    const spread = 1.55 * lift;
    bones.arm_l = { r: spread };
    bones.arm_r = { r: -spread };
    bones.hand_l = { r: 0 };
    bones.hand_r = { r: 0 };
  }
  const freeWave = sample.motion === 'wave' && ['wave', 'rest-window', 'rest-plant'].includes(action?.id);
  const freeStretch = sample.motion === 'stretch'
    && ['stretch', 'rest-stretch', 'rest-daydream'].includes(action?.id) && props.length === 0;
  const gesture = ['yawn', 'high-five'].includes(action?.id) ? action.id
    : freeWave ? 'wave' : freeStretch ? 'stretch' : null;
  if (gesture === 'yawn' || gesture === 'high-five') {
    const lift = gesture === 'yawn' ? Math.sin(Math.PI * t) ** 2 : contactWeight(t, .04, .32, .6, .96);
    for (const side of ['l', 'r']) {
      const root = gestureShoulder(view, side), direction = side === 'l' ? -1 : 1;
      const amount = gesture === 'high-five' && side === 'l' ? lift * .1 : lift;
      // Recovery coefficients fit the approved bare entry/peak/return pixels.
      // They are not claimed to be the lost original numeric source.
      const peak = gesture === 'yawn' ? [9.7, -8.05] : [11.1, -10.5];
      const target = [root[0] + direction * (2.25 + (peak[0] - 2.25) * amount),
        root[1] + 4.5 + (peak[1] - 4.5) * amount];
      placePaw(bones, data, side, target, -direction * amount * 1.4);
    }
  }
  if (freeWave || freeStretch) {
    for (const side of ['l', 'r']) {
      const shoulder = gestureShoulder(view, side), direction = side === 'l' ? -1 : 1;
      // Preserve the repeated wave timing; the stretch uses its existing
      // upward gesture. Neither replaces the approved yawn/high-five solve.
      const amount = freeWave ? (side === 'l' ? 0 : Math.max(0, -sample.bones.arm_r.r / 2.4))
        : Math.sin(Math.PI * t) ** 2;
      let spread = freeWave ? 8 : 10, rise = freeWave ? 14 : 14.5;
      if (view === 'profile' && side === 'r') {
        // The near arm reaches forward below the projected open mouth while
        // the far arm rises behind the torso. Keep the canonical face fixed.
        spread = 12.3; rise = 7;
      }
      const target = [shoulder[0] + direction * (2.2 + amount * spread),
        shoulder[1] + 4.5 - amount * rise];
      placePaw(bones, data, side, target, -direction * amount * 1.6);
    }
  }
  return Object.freeze({ ...sample, props, bones: Object.freeze(bones), propPoses: Object.freeze(propPoses), gesture,
    contactPhase: t, contactHold: hold, calmVisual, contactView: view, contactNear: near, contactAction: action?.id });
}

function usagiPropMatrix(matrix, { id, artwork, data }) {
  if (!data?.anchors?.['usagi.umbrella-grip']) return matrix;
  if (id === 'star' && artwork.pose.sample.motion === 'magic'
    && artwork.pose.sample.contactAction === 'magic-trick' && artwork.pose.sample.props.includes('hat')) {
    // The ordinary hat trick rises from the actual brim, clears the lower
    // face laterally, then lifts outside the cheek. Keep its original rotation
    // and reveal/fade; contextual click-30 uses a different presentation.
    const reveal = artwork.pose.sample.propPoses.star.opacity || 0;
    const center = reveal < .5 ? mix([33, 52], [74, 51], ease(reveal * 2))
      : mix([74, 51], [74, 24], ease((reveal - .5) * 2));
    const target = applyPoint(artwork.pose.world.root, ...center);
    const previous = applyPoint(matrix, 62, 8);
    return [matrix[0], matrix[1], matrix[2], matrix[3],
      matrix[4] + target[0] - previous[0], matrix[5] + target[1] - previous[1]];
  }
  if (id === 'star' && artwork.pose.sample.motion === 'reach') {
    const wrist = applyPoint(artwork.pose.world.hand_r, ...data.bones.hand_r.pivot);
    const weight = artwork.pose.sample.propPoses.star.catchWeight;
    const point = mix([62, 8], [wrist[0] + 2, wrist[1] - 6], weight);
    // Arc around the cheek on approach/release, then land on the short paw.
    point[0] += Math.sin(Math.PI * weight) * (artwork.drawnView === 'profile' ? 16 : 12);
    // The visible star center is (62,8). Use the blended wrist, so action
    // transitions cannot briefly separate an already caught star from its paw.
    return [1, 0, 0, 1, point[0] - 62, point[1] - 8];
  }
  if (['balls-l', 'balls-r', 'balls-top'].includes(id) && artwork.pose.sample.motion === 'juggle') {
    const pose = artwork.pose.sample.propPoses[id];
    return [1, 0, 0, 1, pose.x, pose.y];
  }
  if (id !== 'plane' || artwork.pose.sample.contactPhase <= .3) return matrix;
  const t = artwork.pose.sample.contactPhase, flight = Math.min(1, (t - .3) / .56);
  const origin = data.bones.hand_r.pivot;
  return [1, 0, 0, 1, 54 + flight * 35 - origin[0], 44 - Math.sin(flight * Math.PI * .8) * 21 - (origin[1] + 1)];
}

function paintUsagiProp(context, { id, prop, artwork, data = artwork?.rig?.views?.[artwork.drawnView], matrix }, paint) {
  if (!data?.anchors?.['usagi.umbrella-grip']) return false;
  if (id === 'binoculars' && artwork.pose.sample.motion === 'look') {
    // The front-facing pet looks through two forward-facing objective lenses.
    // The old downward barrel bottoms made the binoculars point at its feet.
    const shape = (d, fill, stroke = '#351710', width = 1.1) => ({ d, fill, stroke, width, opacity: 1, m: [1, 0, 0, 1, 0, 0] });
    const lenses = [23, 43].flatMap(x => [
      shape(`M${x - 5.6} 25 A5.6 5.6 0 1 0 ${x + 5.6} 25 A5.6 5.6 0 1 0 ${x - 5.6} 25Z`, '#a4bad7'),
      shape(`M${x - 3.6} 25 A3.6 3.6 0 1 0 ${x + 3.6} 25 A3.6 3.6 0 1 0 ${x - 3.6} 25Z`, '#55788b', '#351710', .7),
      shape(`M${x - 2} 23.3 Q${x - .7} 22.2 ${x + .2} 23`, 'none', '#c8e0ec', 1.2)
    ]);
    paint([shape('M28 23.5 Q33 21.5 38 23.5 L38 27 Q33 25 28 27Z', '#a4bad7'), ...lenses], matrix);
    return true;
  }
  if (id !== 'blocks') return false;
  const offset = artwork.pose.sample.propPoses.blocks || {};
  paint(prop.shapes.slice(0, 2), [1, 0, 0, 1, 0, 0]);
  paint(prop.shapes.slice(2), [1, 0, 0, 1, offset.x || 0, offset.y || 0]);
  return true;
}

function posedPropPoint(artwork, id, relative) {
  const data = artwork.rig.views[artwork.drawnView], prop = data.props[id];
  if (!prop) return null;
  const pivot = data.bones[prop.bone].pivot;
  const offset = artwork.pose.sample.propPoses[id] || {};
  // Contact equipment uses a pure local translation; wrist owns rotation.
  return applyPoint(artwork.pose.world[prop.bone], pivot[0] + relative[0] + (offset.x || 0),
    pivot[1] + relative[1] + (offset.y || 0));
}

export { contactWeight, placePaw, prepareUsagiSample, posedPropPoint, usagiPropMatrix, paintUsagiProp };
