'use strict';
import { clamp01, smooth, mix, cubicPoint, cubicTangent } from './motion-core/easing.mjs';
import { createTrack } from './motion-core/track.mjs';
import { memoFrame } from './motion-core/memo.mjs';
import { storyAnchors } from './motion-core/form-anchors.mjs';
// Presentation-only choreography for an existing paper prop and one short
// paw. The scene stays in the stage's right margin and returns to its grip.
// Keyframes are data (per-form anchors); one sampler, memoized per frame.
const PHASES = [[.14, 'anticipation'], [.34, 'grip'], [.7, 'flight'], [.76, 'receive'], [.84, 'contact'], [.96, 'recovery'], [Infinity, 'idle']];
const tracks = new Map();
function storyFor(formId) {
  let entry = tracks.get(formId);
  if (!entry) {
    const a = storyAnchors('paper-return', formId);
    entry = { a, hand: createTrack([{ at: .04, value: a.rest }, { at: .2, value: a.ready }, { at: .34, value: a.release },
      { at: .5, value: a.hold }, { at: .7, value: a.hold }, { at: .76, value: a.release }, { at: .82, value: a.release },
      { at: .96, value: a.rest }]) };
    tracks.set(formId, entry);
  }
  return entry;
}
const phaseOf = p => PHASES.find(([end]) => p < end)[1];
function computePaperReturn(progress, calmVisual, exitProgress, exitT, formId) {
  if (exitT !== null && !calmVisual) return samplePaperReturnExit({ progress: exitProgress, t: exitT }, formId);
  const p = calmVisual ? .78 : clamp01(Number(progress) || 0);
  const { a, hand: track } = storyFor(formId);
  const hand = track.sample(p, [0, 0]);
  let grip = hand, angle = 0;
  if (p >= .34 && p < .76) {
    const t = smooth((p - .34) / .42), f = a.flight;
    const first = t < .5, local = first ? t * 2 : (t - .5) * 2;
    const pts = first ? [f[0], f[1], f[2], f[3]] : [f[3], f[4], f[5], f[6]];
    grip = cubicPoint(...pts, local);
    // The nose pitches along its flight tangent; the weight fades it in/out
    // so release and catch remain level with the paw.
    const tangent = cubicTangent(...pts, local);
    const pitch = Math.atan2(tangent[1], Math.abs(tangent[0]) + 1e-6);
    angle = Math.max(-1.1, Math.min(1.1, pitch)) * Math.sin(Math.PI * t);
  }
  const opacity = smooth((p - .08) / .06) * smooth((.96 - p) / .08);
  return Object.freeze({ hand: Object.freeze(hand), grip: Object.freeze(grip), angle, opacity, phase: phaseOf(p) });
}
const memoized = memoFrame(computePaperReturn, { size: 6 });
function samplePaperReturn(progress, calmVisual = false, exit = null, formId = 'usagi') {
  return memoized(Number(progress) || 0, Boolean(calmVisual), exit ? exit.progress : null, exit ? exit.t : null, formId);
}
samplePaperReturn.stats = memoized.stats;
export { samplePaperReturn };

function paperReturnFace(face, { action, progress = 0, calmVisual, expressionId } = {}) {
  if (action?.id !== 'paper-return' || (expressionId && expressionId !== (action.baseExpression || action.expression))) return null;
  const p = calmVisual ? .78 : progress;
  const returning = p >= .58 && p < .76, caught = p >= .76 && p < .9;
  return Object.freeze({ ...face, eyes: returning ? 'wide' : caught ? 'content' : 'neutral',
    mouth: caught ? 'smile' : 'neutral', openness: 1, eyeInsetX: 0,
    eyeOffsetX: returning ? .35 : 0, eyeOffsetY: p > .38 && p < .7 ? -.35 : 0 });
}
export { paperReturnFace };

function samplePaperReturnExit({ progress, t }, formId = 'usagi') {
  const start = samplePaperReturn(progress, false, null, formId), airborne = ['flight', 'receive'].includes(start.phase);
  const { a } = storyFor(formId);
  t = clamp01(t);
  const catchAt = .45;
  const hand = airborne && t < catchAt ? mix(start.hand, a.release, t / catchAt)
    : mix(airborne ? a.release : start.hand, a.rest, (t - (airborne ? catchAt : 0)) / (airborne ? 1 - catchAt : 1));
  const grip = airborne && t < catchAt ? mix(start.grip, a.release, t / catchAt) : hand;
  return Object.freeze({ hand: Object.freeze(hand), grip: Object.freeze(grip),
    angle: start.angle * (1 - smooth(t / catchAt)), opacity: start.opacity * (1 - smooth((t - .6) / .3)),
    phase: airborne && t < catchAt ? 'flight' : 'recovery' });
}

// Body accent owned by the story: a small recoil away from the throw and a
// squash/settle on the catch (outBack recovery). Feet stay on the floor.
function samplePaperReturnBody(progress, calmVisual = false) {
  if (calmVisual) return REST;
  const p = clamp01(progress);
  const recoil = p > .3 && p < .5 ? Math.sin(Math.PI * clamp01((p - .3) / .2)) ** 2 : 0;
  const caught = p > .76 && p < .92 ? clamp01((p - .76) / .16) : 0;
  // Damped settle: compress, overshoot once, rest.
  const squash = caught ? Math.exp(-4 * caught) * Math.sin(Math.PI * 2 * caught * .9 + .3) : 0;
  return { x: -1.3 * recoil, y: 0, r: 0, sx: 1 + .035 * squash, sy: 1 - .045 * squash, shear: .02 * recoil, ground: true };
}
const REST = Object.freeze({ x: 0, y: 0, r: 0, sx: 1, sy: 1, shear: 0, ground: true });
export { samplePaperReturnBody };

