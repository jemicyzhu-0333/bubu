'use strict';
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * ease(t));
// A small stage trick: emerge below the mouth, clear the cheek, hover, and
// retrace the route into the brim. Never cross the character's eye corridor.
function sampleHatStar(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const brim = [33, 55], side = [77, 55], reveal = [77, 29];
  const center = p < .4 ? mix(brim, side, (p - .26) / .14)
    : p < .56 ? mix(side, reveal, (p - .4) / .16)
      : p < .7 ? reveal : p < .82 ? mix(reveal, side, (p - .7) / .12)
        : mix(side, brim, (p - .82) / .12);
  const opacity = ease((p - .26) / .035) * ease((.94 - p) / .035);
  return Object.freeze({ center: Object.freeze(center), opacity });
}
export { sampleHatStar };
