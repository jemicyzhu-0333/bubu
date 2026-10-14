'use strict';
import { smooth } from './motion-core/easing.mjs';
import { createTrack } from './motion-core/track.mjs';
import { memoFrame } from './motion-core/memo.mjs';
import { storyAnchors } from './motion-core/form-anchors.mjs';
// A small stage trick: emerge below the mouth, clear the cheek, hover, and
// retrace the route into the brim. Never cross the character's eye corridor.
// Segments arc below the chin / outside the cheek (quadratic `via` points).
const tracks = new Map();
function trackFor(formId) {
  let track = tracks.get(formId);
  if (!track) {
    const a = storyAnchors('hat-star', formId);
    track = createTrack([{ at: .26, value: a.brim }, { at: .4, value: a.side, via: a.belly },
      { at: .56, value: a.reveal, via: a.outer, ease: 'outCubic' }, { at: .7, value: a.reveal },
      { at: .82, value: a.side, via: a.outer }, { at: .94, value: a.brim, via: a.belly }]);
    tracks.set(formId, track);
  }
  return track;
}
function compute(p, formId) {
  const center = trackFor(formId).sample(p, [0, 0]);
  const opacity = smooth((p - .26) / .035) * smooth((.94 - p) / .035);
  // Twinkle while hovering at the reveal: spin + gentle pulse.
  const hover = p >= .56 && p < .7 ? (p - .56) / .14 : 0;
  const spin = hover ? Math.sin(Math.PI * hover) * .5 : 0;
  const scale = 1 + (hover ? .12 * Math.sin(Math.PI * 4 * hover) ** 2 : 0);
  return Object.freeze({ center: Object.freeze(center), opacity, spin, scale });
}
const memoized = memoFrame(compute, { size: 4 });
function sampleHatStar(progress, formId = 'usagi') {
  return memoized(Math.max(0, Math.min(1, Number(progress) || 0)), formId);
}
export { sampleHatStar };
