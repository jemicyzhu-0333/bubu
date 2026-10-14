'use strict';
import { smooth, clamp01 } from './easing.mjs';
import { memoFrame } from './memo.mjs';
// Data-driven body accents layered over each action's authored motion:
//   enter  – anticipation squash, then an overshooting pop that settles.
//   rhythm – damped squash/stretch impulses on the action's own beats
//            (count per action, `phase` offset in beats; negative = squash).
//   exit   – a small settle bounce that resolves to rest at progress 1.
//   ears   – follow-through gain for the secondary ear spring.
// All accents are 0 at progress 0 and 1, scale about the floor line (see
// applyAccent), and are disabled under calm / reduced motion.
const A = (enter, rhythm, exit, ears = 1, extra = {}) => Object.freeze({ enter, rhythm: rhythm && Object.freeze(rhythm), exit, ears, ...extra });
const ACTION_ACCENTS = Object.freeze({
  workout: A(.05, { count: 4, phase: .25, amount: -.045 }, .03, 1.2),
  'chase-butterfly': A(.05, { count: 6, phase: .5, amount: -.035 }, .03, 1.4),
  hiccup: A(.03, { count: 3, phase: .2, amount: .06 }, .025, 1.5),
  juggle: A(.04, { count: 6, phase: 0, amount: -.025 }, .03, .9),
  'carry-energy': A(.05, { count: 4, phase: .5, amount: -.03 }, .03, 1),
  'pit-fall': A(.06, null, .04, 1.6),
  'mirror-meet': A(.035, { count: 2, phase: .5, amount: .02 }, .025, .8),
  sing: A(.035, { count: 4, phase: .25, amount: .025 }, .03, 1),
  'stuck-corner': A(.04, { count: 2, phase: .5, amount: -.03 }, .03, .8),
  'chase-laser': A(.05, { count: 6, phase: .5, amount: -.035 }, .03, 1.4),
  'dig-treasure': A(.04, { count: 5, phase: .3, amount: -.03 }, .035, 1),
  yawn: A(.03, { count: 1, phase: .45, amount: .035 }, .03, .7),
  sneeze: A(.04, { count: 1, phase: .25, amount: -.07 }, .03, 1.8),
  'bubble-blow': A(.03, { count: 3, phase: .5, amount: .02 }, .025, .8),
  meditate: A(.025, null, .02, .5),
  wave: A(.04, { count: 4, phase: .25, amount: .02 }, .03, 1),
  stretch: A(.035, { count: 1, phase: .5, amount: .03 }, .03, .7),
  'happy-hop': A(.07, { count: 2, phase: .5, amount: -.06 }, .04, 1.6),
  'high-five': A(.05, { count: 1, phase: .5, amount: -.05 }, .035, 1.3),
  spin: A(.06, null, .045, 1.5),
  dance: A(.04, { count: 4, phase: .5, amount: -.04 }, .035, 1.3),
  'look-around': A(.03, { count: 2, phase: .25, amount: .02 }, .025, 1),
  'tail-wiggle': A(.03, { count: 3, phase: 0, amount: .02 }, .025, 1),
  'read-book': A(.03, { count: 2, phase: .5, amount: .015 }, .025, .6),
  'take-note': A(.03, { count: 3, phase: .5, amount: -.015 }, .025, .6),
  'type-keyboard': A(.03, { count: 6, phase: .5, amount: -.012 }, .025, .5),
  'sip-tea': A(.03, { count: 1, phase: .45, amount: .02 }, .025, .6),
  'paper-plane': A(.05, { count: 1, phase: .3, amount: -.045 }, .03, 1.2),
  sweep: A(.035, { count: 4, phase: .25, amount: -.02 }, .03, .8),
  telescope: A(.03, { count: 1, phase: .4, amount: .02 }, .025, .6),
  'plant-water': A(.03, { count: 1, phase: .3, amount: -.02 }, .025, .7),
  'knit-scarf': A(.025, { count: 4, phase: .5, amount: -.012 }, .02, .5),
  'drum-solo': A(.04, { count: 6, phase: .5, amount: -.03 }, .035, 1.2),
  'hide-box': A(.04, null, .035, 1),
  'build-blocks': A(.03, { count: 3, phase: .5, amount: -.02 }, .025, .7),
  'catch-star': A(.05, { count: 1, phase: .55, amount: -.05 }, .035, 1.3),
  'umbrella-dance': A(.04, { count: 4, phase: .5, amount: -.03 }, .035, 1.2),
  'snack-picnic': A(.03, { count: 3, phase: .5, amount: .015 }, .025, .6),
  'shadow-box': A(.05, { count: 4, phase: .5, amount: -.035 }, .035, 1.2),
  'tiny-chef': A(.03, { count: 3, phase: .5, amount: -.02 }, .025, .7),
  'photo-pose': A(.05, { count: 1, phase: .5, amount: .04 }, .035, 1),
  'magic-trick': A(.04, { count: 1, phase: .4, amount: .035 }, .03, 1.1)
});
// Damped impulse response, 0 at u=0, decays by u=1.
const impulse = u => u <= 0 || u >= 1 ? 0 : Math.exp(-4.5 * u) * Math.sin(Math.PI * 2.2 * u) * (1 - u);
function computeAccent(id, p) {
  const spec = ACTION_ACCENTS[id];
  if (!spec) return 0;
  let s = 0;
  // Anticipation dip (0→.05) then overshooting pop (.05→.2).
  s -= spec.enter * .6 * Math.sin(Math.PI * clamp01(p / .05)) * (p < .05 ? 1 : 0);
  s += spec.enter * impulse((p - .05) / .15);
  if (spec.rhythm) {
    const { count, phase, amount } = spec.rhythm, width = Math.min(.18, .9 / count);
    for (let i = 0; i < count; i++) {
      const at = .1 + (.8 * (i + phase)) / count;
      s += amount * impulse((p - at) / width);
    }
  }
  s -= spec.exit * impulse((p - .86) / .14);
  // Hard fade at both ends: frame 0/1 are exactly the authored pose.
  return s * smooth(p / .02) * smooth((1 - p) / .02);
}
const memoAccent = memoFrame(computeAccent, { size: 8 });
const REST = Object.freeze({ sx: 1, sy: 1, s: 0 });
function sampleAccent(action, progress, calmVisual = false) {
  if (calmVisual || !action || !ACTION_ACCENTS[action.id]) return REST;
  const s = memoAccent(action.id, clamp01(Number(progress) || 0));
  return s ? { sx: 1 - s * .6, sy: 1 + s, s } : REST;
}
const accentSignal = (action, durationMs) => ms => memoAccent(action.id, clamp01(ms / durationMs));
const accentSpec = id => ACTION_ACCENTS[id] || null;
export { ACTION_ACCENTS, sampleAccent, accentSignal, accentSpec };
