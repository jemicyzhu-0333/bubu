'use strict';

import { placePaw } from './usagi-contact.mjs';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const mix = (a, b, amount) => a.map((value, i) => value + (b[i] - value) * amount);

// Only these existing category actions own the new quiet presentation. The
// lifecycle is supplied by playback; no app phase, text, BPM or timer is read.
function eventSample(action, progress = 0, calmVisual = false) {
  const category = action?.id === 'mirror-music' ? 'music' : action?.id === 'mirror-ai' ? 'ai' : null;
  if (!category) return null;
  const presentation = action.mirrorPresentation;
  const calm = calmVisual || presentation?.static === true;
  const p = calm ? .5 : ((Number(presentation?.loopProgress ?? progress) || 0) % 1 + 1) % 1;
  const weight = calm ? 1 : Number.isFinite(action.propOpacity) ? clamp(action.propOpacity) : 1;
  return { category, p, weight, calm, phase: presentation?.phase || 'loop' };
}

function prepareUsagiEventSample(sample, { data, view, progress, calmVisual, action } = {}) {
  const event = eventSample(action, progress, calmVisual);
  if (!event || !data?.anchors?.['usagi.umbrella-grip']) return null;
  const { category, p, weight, calm } = event;
  const wave = calm ? 0 : Math.sin(TAU * p * 8), bones = {}, propPoses = {};
  if (category === 'music') {
    // The authored short paws stay body-rooted. Feet pulse at a deliberately
    // slow illustrative cadence, independent of the person's music tempo.
    bones.arm_l = { r: -.10 * weight };
    bones.arm_r = { r: .10 * weight };
    bones.ear_l = { r: -.028 * wave * weight };
    bones.ear_r = { r: .035 * wave * weight };
    bones.leg_l = { y: -.6 * Math.max(0, wave) * weight };
    bones.leg_r = { y: -.6 * Math.max(0, -wave) * weight };
  } else {
    const turned = view === 'three-quarter';
    const local = (p * 5) % 1;
    // Quiet observation occupies most of each cycle. Small key touches are
    // context illustration, never a claim about an actual AI response phase.
    const touching = !calm && local > .14 && local < .48;
    const tap = touching ? Math.sin(TAU * (local - .14) / .34 * 2) ** 2 : 0;
    for (const side of ['l', 'r']) {
      const target = [turned ? (side === 'l' ? 28 : 43) : (side === 'l' ? 16 : 50),
        (turned ? 51 : 47) - (side === 'r' ? tap : tap * .65) * .65];
      placePaw(bones, data, side, mix(data.bones[`hand_${side}`].pivot, target, weight), side === 'l' ? -.28 : .28);
    }
    bones.ear_l = { r: -.018 * Math.sin(TAU * p * 5) * weight };
    bones.ear_r = { r: .023 * Math.sin(TAU * p * 5) * weight };
    propPoses.laptop = { y: -2 + (1 - weight) * 2 };
  }
  return Object.freeze({ ...sample, key: `usagi-event:${category}:${view}`, motion: category === 'ai' ? 'browse' : 'sway',
    props: Object.freeze(category === 'ai' ? ['laptop'] : []), bones: Object.freeze(bones),
    propPoses: Object.freeze(propPoses), event: Object.freeze(event), contactPhase: p,
    calmVisual: calm, contactView: view, contactAction: action.id });
}

function sampleUsagiEventBody(action, progress, calmVisual) {
  const event = eventSample(action, progress, calmVisual);
  if (!event) return null;
  const { p, weight, calm, category } = event;
  if (!weight || calm) return Object.freeze({ x: 0, y: 0, r: 0, sx: 1, sy: 1 });
  const wave = calm ? 0 : Math.sin(TAU * p * (category === 'music' ? 8 : 5));
  return Object.freeze(category === 'music'
    ? { x: 0, y: .22 * (1 - Math.cos(TAU * p * 8)) * weight * !calm,
      r: .016 * wave * weight, sx: 1, sy: 1 - .005 * (1 - Math.cos(TAU * p * 8)) * weight * !calm }
    : { x: 0, y: 0, r: .004 * wave * weight, sx: 1, sy: 1 });
}

function sampleUsagiEventFace(face, { action, progress, calmVisual, expressionId } = {}) {
  const event = eventSample(action, progress, calmVisual);
  if (!event || !face) return null;
  const expected = action.baseExpression || action.expression;
  if (expressionId && expected && expressionId !== expected) return face;
  const { category, p, weight, calm } = event;
  return Object.freeze({ ...face, eyes: category === 'music' ? 'content' : 'waiting', mouth: 'neutral',
    openness: 1, eyeOffsetX: calm ? 0 : Math.sin(TAU * p * 5) * .25 * weight,
    eyeOffsetY: category === 'ai' ? .45 * weight : 0 });
}

function paintCup(ctx, x, y, rx, ry, near = true) {
  // A cream cushion outside the lavender shell gives the cup physical depth
  // without letting its dark outline swallow the small native-size highlight.
  ctx.beginPath(); ctx.ellipse(x + (near ? -1.35 : 1.35), y, rx + .5, ry, 0, 0, TAU);
  ctx.fillStyle = '#fff4dc'; ctx.fill(); ctx.strokeStyle = '#351710'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = '#bda0d3'; ctx.fill(); ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x + .3, y - .45, rx * .65, ry * .78, 0, 0, TAU);
  ctx.fillStyle = '#ddc8ed'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y - ry + .4); ctx.lineTo(x, y - ry - 3.2);
  ctx.strokeStyle = '#351710'; ctx.lineWidth = 2.7; ctx.stroke();
  ctx.strokeStyle = '#c7acdf'; ctx.lineWidth = 1.2; ctx.stroke();
}

// Reference: real-events/sources/context-emphasis-v2/relationship-study.master.png. The study supplied
// fit direction only; no generated body or feet enter this canonical rig.
// Rear band is underneath body/ears; lateral cups precede complete clothing.
function paintUsagiEventHeadphones(ctx, artwork, layer) {
  const primary = artwork?.pose?.sample?.event;
  const event = primary?.category === 'music' ? primary
    : artwork?.combinationAccessories?.headphones ? artwork.combinationAccessories.sample : null;
  if (!event || event.weight <= 0) return false;
  const turned = artwork.drawnView === 'three-quarter';
  ctx.save(); ctx.globalAlpha *= event.weight;
  const world = artwork.pose.world.root;
  ctx.transform(...world); ctx.translate(0, (1 - event.weight) * -2);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (layer === 'back') {
    ctx.beginPath(); ctx.moveTo(turned ? 6 : 1, 24);
    ctx.bezierCurveTo(turned ? 0 : -4, 5, 13, -3.3, 25, -2.3);
    ctx.moveTo(41, -2.3); ctx.bezierCurveTo(56, -2.3, 70, 9, 65, 24);
    ctx.strokeStyle = '#351710'; ctx.lineWidth = 5.4; ctx.stroke();
    ctx.strokeStyle = '#bca3d2'; ctx.lineWidth = 3.2; ctx.stroke();
    if (turned) paintCup(ctx, 5.7, 23.5, 4.5, 8.8, false);
  } else if (layer === 'front') {
    if (!turned) paintCup(ctx, -.7, 23.5, 5.5, 9.5, false);
    paintCup(ctx, 66.2, 23.5, turned ? 6.1 : 5.5, 9.5);
  }
  ctx.restore(); return true;
}

export { eventSample, prepareUsagiEventSample, sampleUsagiEventBody,
  sampleUsagiEventFace, paintUsagiEventHeadphones };
