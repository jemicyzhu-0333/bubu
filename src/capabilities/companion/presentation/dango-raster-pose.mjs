'use strict';

import { paperReturnFace } from './paper-return-story.mjs';
import { refinePaperReturn } from './dango-paper-return.mjs';
import { bodyOffset } from '../../../core/pet-action-art.mjs';
import { sampleVectorAction } from '../../../core/pet-action-vector.mjs';
import { sampleFeet, footMatrix } from './dango-performance.mjs';
import { sampleRunningPose } from '../../../core/pet-running-pose.mjs';
import { sampleMotion, idleProgress } from './rig/motions.mjs';
import { localMatrix, IDENTITY } from './rig/pose.mjs';
import { sampleDangoFace } from './dango-face.mjs';
import { refineRasterContact } from './dango-raster-contact.mjs';
import { refineSmallPawContact } from './dango-raster-paws.mjs';
import { sampleRasterMirror, refineMirrorContact, mirrorFeet, appendCombinationAccessories } from './dango-raster-mirror.mjs';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const pivotFor = sprite => sprite?.pivot || (sprite ? [sprite.rect[0] + sprite.rect[2] / 2, sprite.rect[1] + sprite.rect[3] / 2] : [33, 33]);

function sampleRasterRunningFeet(data, progress, calmVisual, footTiming = null) {
  const pose = sampleRunningPose(progress, { calmVisual }), feet = {};
  const spec = data.motion?.running || {};
  const strideX = clamp(spec.strideX ?? 3.5, 0, 6), liftY = clamp(spec.liftY ?? 4, 0, 5);
  const rotation = clamp(spec.rotation ?? .16, 0, .35);
  for (const [i, name] of ['foot-left', 'foot-right'].entries()) {
    const phase = pose.phase + i * Math.PI, step = Math.sin(phase);
    // Reviewed narrow timing: lift on forward recovery, not merely
    // while positioned forward. Horizontal stride, roll and body motion stay exact.
    const lift = footTiming === 'forward-recovery' ? Math.cos(phase) : step;
    feet[name] = pose.effort ? footMatrix(data.anchors[name], {
      x: step * strideX * pose.effort, y: -Math.max(0, lift) * liftY * pose.effort,
      r: -step * rotation * pose.effort
    }) : IDENTITY;
  }
  return Object.freeze(feet);
}

function sampleRasterPose(data, { view = 'front', motion = 'idle', action = null, progress = 0,
  elapsedMs = 0, calmVisual = false, reducedMotion = false, state, face, expressionId, expressionElapsedMs, toolSprites, lookback = null, runFootTiming = null } = {}) {
  const frozen = calmVisual || reducedMotion || state === 'dragged' || action?.mirrorPresentation?.static === true;
  const p = frozen ? action?.staticProgress ?? .5 : clamp(Number(progress) || 0, 0, 1);
  const mirror = sampleRasterMirror(action, p, frozen);
  const walking = !action && state === 'walking';
  const faceOptions = { motion, action: action || (motion === 'dash' ? { motion: 'dash' } : null),
    progress: p, elapsedMs: frozen ? 0 : elapsedMs,
    calmVisual: frozen, expressionId, expressionElapsedMs: frozen ? 0 : expressionElapsedMs };
  let sampledFace = sampleDangoFace(face || { eyes: 'neutral', mouth: 'neutral' }, faceOptions);
  sampledFace = paperReturnFace(sampledFace, faceOptions) || sampledFace;
  const expected = action?.baseExpression || action?.expression;
  const activityWins = !expressionId || !expected || expressionId === expected;
  if (activityWins && mirror) sampledFace = Object.freeze({ ...sampledFace, eyes: 'neutral', mouth: 'neutral',
    openness: 1, eyeOffsetX: 0, eyeOffsetY: mirror.eyeY, eyeInsetX: 0 });
  if (activityWins && lookback) sampledFace = Object.freeze({ ...sampledFace,
    eyes: lookback.blink > .75 ? 'closed' : 'neutral', mouth: 'neutral',
    openness: 1 - lookback.blink * .65, eyeOffsetX: -lookback.turn * .7,
    eyeOffsetY: 0, eyeInsetX: 0 });
  if (activityWins && action?.id === 'hiccup') sampledFace = Object.freeze({ ...sampledFace,
    eyes: 'neutral', mouth: 'neutral', openness: 1, eyeOffsetX: 0, eyeOffsetY: 0, eyeInsetX: 0 });
  if (activityWins && (action?.id === 'carry-energy' || action?.prop === 'umbrella')) {
    sampledFace = Object.freeze({ ...sampledFace, eyes: p > .88 ? 'content' : 'neutral',
      openness: p > .88 ? 1 : Math.max(.94, sampledFace.openness ?? 1) });
  }
  if (activityWins && action?.prop === 'cup' && motion === 'sip') {
    const contact = p >= .34 && p <= .66;
    const approaching = p > .18 && p < .82;
    sampledFace = Object.freeze({ ...sampledFace, eyes: contact ? 'closed' : approaching ? 'half' : 'neutral',
      mouth: contact ? 'closed' : 'neutral', openness: contact ? 0 : approaching ? .65 : 1,
      eyeOffsetX: 0, eyeOffsetY: approaching ? .3 : 0, eyeInsetX: 0 });
  }
  if (activityWins && action?.id === 'stuck-corner') {
    const asleep = frozen || p >= .22 && p <= .78;
    sampledFace = Object.freeze({ ...sampledFace, eyes: asleep ? 'closed' : 'neutral',
      mouth: 'closed', openness: asleep ? 0 : 1, eyeOffsetX: 0, eyeOffsetY: 0, eyeInsetX: 0 });
  }
  const muzzle = pivotFor(data.face?.mouth?.neutral);
  let contact = refineRasterContact(sampleVectorAction(action, p, view, { calmVisual: frozen, anchors: data.anchors,
    muzzle: { x: muzzle[0], y: muzzle[1] }, toolSprites,
    focusEye: data.face?.eyes?.neutral?.length ? pivotFor(data.face.eyes.neutral.at(-1)) : null }), action, p, view, toolSprites);
  if (contact && ['umbrella', 'high-five'].includes(action?.prop)) {
    const key = action.prop === 'umbrella' ? 'umbrella' : 'high-five-paw';
    const grip = toolSprites?.[key]?.anchors?.right, old = key === 'umbrella' ? [25, 49] : [3, 9];
    if (grip) for (const hand of contact.hands.filter(value => value.side === 'right')) {
      hand.points = hand.points.map((point, i) => i ? [point[0] + grip[0] - old[0], point[1] + grip[1] - old[1]] : point);
    }
  }
  const groundShift = motion === 'pushup' && action ? bodyOffset(action, p, { calmVisual: frozen }).y * (action.id === 'workout' ? .45 : 1) : 0;
  refinePaperReturn(contact, action, p, toolSprites);
  refineSmallPawContact(contact, action, view, toolSprites, groundShift);
  refineMirrorContact(contact, action, view, toolSprites, mirror);
  contact = appendCombinationAccessories(contact, action, view, toolSprites);
  const sink = motion === 'fall' && action?.prop === 'hole' ? bodyOffset(action, p, { calmVisual: frozen }).y : 0;
  if (motion === 'pushup' && contact) for (const hand of contact.hands.filter(hand => !hand.pawSprite)) {
    const delta = 61 - groundShift - hand.points.at(-1)[1];
    hand.points = hand.points.map((point, i) => i ? [point[0], point[1] + delta] : point);
  }
  if (motion === 'wave' && view !== 'front' && contact) for (const hand of contact.hands.filter(value => value.side === 'right')) {
    const target = [71.5 + (frozen ? 0 : Math.sin(p * Math.PI * 6) * .6), 32];
    const root = hand.points[0], distance = Math.hypot(root[0] - target[0], root[1] - target[1]);
    const reach = Math.min(6, distance) / distance;
    hand.points = [root, [target[0] + (root[0] - target[0]) * reach, target[1] + (root[1] - target[1]) * reach], target];
  }
  if (contact && ['workout', 'hiccup', 'carry-energy', 'dig-treasure', 'sneeze'].includes(action?.id)) for (const hand of contact.hands) {
    if (hand.pawSprite || hand.integrated || hand.connector === false) continue;
    const root = hand.points[0], target = hand.points.at(-1);
    if (target[1] < 38) continue;
    const left = hand.side === 'left';
    const inward = left ? target[0] > root[0] + 7 : target[0] < root[0] - 7;
    const elbow = inward ? [root[0] + (left ? 4 : -4), Math.min(54, Math.max(root[1] + 8, target[1] + 4))]
      : [(root[0] + target[0]) / 2, Math.max(root[1] + 3, target[1] - 6)];
    let palm = target;
    if (['carry-energy', 'dig-treasure', 'sneeze', 'hiccup'].includes(action?.id)) {
      const dx = target[0] - elbow[0], dy = target[1] - elbow[1], length = Math.hypot(dx, dy) || 1;
      hand.gripPoint = [...target];
      palm = [target[0] - dx / length * 3, target[1] - dy / length * 3];
    }
    hand.points = [root, elbow, palm];
    hand.attachedArm = true;
  }
  const sample = sampleMotion(motion, { view, calmVisual: frozen, progress: motion === 'idle' ? idleProgress(elapsedMs) : p, prop: action?.prop });
  if (lookback && contact) for (const detail of contact.details) if (detail.type === 'look-back') {
    detail.amount = lookback.cue; detail.at = [-1, 8];
  }
  const feet = mirrorFeet(data.anchors, mirror) || (motion === 'dash' ? sampleRasterRunningFeet(data, p, frozen, runFootTiming)
    : sampleFeet(walking || action?.id === 'carry-energy' ? 'walk' : action?.id === 'paper-return' ? 'idle' : motion,
      walking ? elapsedMs % 760 / 760 : p, view, frozen || Boolean(lookback), data.anchors));
  const matrices = {};
  for (const [side, bone] of [['left', 'ear_l'], ['right', 'ear_r']]) {
    const sprite = data.parts[`ear-${side}`];
    const r = frozen || mirror ? 0 : lookback ? (side === 'left' ? -.10 : .06) * lookback.cue
      : clamp((sample.bones[bone]?.r || 0) * .45, -.14, .14);
    matrices[`ear-${side}`] = localMatrix(pivotFor(sprite), { r });
  }
  for (const side of ['left', 'right']) {
    const sprite = data.parts[`hand-${side}`], pivot = pivotFor(sprite);
    const hand = contact?.hands.find(candidate => candidate.side === side);
    if (hand?.pawMatrix) { matrices[`hand-${side}`] = hand.pawMatrix; }
    else if (hand) {
      const target = hand.points.at(-1), root = hand.points.at(-2);
      const rawRotation = hand.rotation ?? (!hand.attachedArm || hand.integrated || hand.connector === false ? 0
        : Math.atan2(target[1] - root[1], target[0] - root[0]) - (side === 'left' ? Math.PI : 0));
      const rotation = Math.atan2(Math.sin(rawRotation), Math.cos(rawRotation));
      const c = Math.cos(rotation), s = Math.sin(rotation);
      // Contact coordinates are already bounded by the authored stage; the
      // rig's ±24 translation clamp must not detach cross-body raster grips.
      matrices[`hand-${side}`] = Object.freeze([c, s, -s, c,
        target[0] - c * pivot[0] + s * pivot[1], target[1] - s * pivot[0] - c * pivot[1]]);
    } else {
      const bone = sample.bones[side === 'left' ? 'arm_l' : 'arm_r'];
      const amount = frozen ? 0 : clamp(bone?.r || 0, -2.6, 2.6);
      matrices[`hand-${side}`] = localMatrix(pivot, { r: amount * .12, y: -Math.abs(amount) * .65 });
    }
  }
  matrices['foot-left'] = groundShift ? Object.freeze([1, 0, 0, 1, 0, -groundShift]) : feet['foot-left'];
  matrices['foot-right'] = groundShift ? Object.freeze([1, 0, 0, 1, 0, -groundShift]) : feet['foot-right'];
  if (action?.id === 'workout') {
    matrices['foot-left'] = Object.freeze([1, 0, 0, 1, view === 'front' ? 0 : -6, -groundShift]);
    matrices['foot-right'] = Object.freeze([1, 0, 0, 1, view === 'front' ? 0 : -6, -groundShift]);
  }
  return Object.freeze({ face: sampledFace, progress: p, calmVisual: frozen, contact, mirror,
    matrices: Object.freeze(matrices), footwearTransforms: feet, anchors: data.anchors,
    muzzle: { x: muzzle[0], y: muzzle[1] }, groundClipY: sink > .15 ? 63 - sink : null, sample, identity: IDENTITY });
}

export { pivotFor, sampleRasterPose, sampleRasterRunningFeet };
