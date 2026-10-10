'use strict';
const clamp = t => Math.max(0, Math.min(1, t));
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * ease(t));
const cubic = (a, b, c, d, t) => a.map((n, i) => (1-t)**3*n + 3*(1-t)**2*t*b[i] + 3*(1-t)*t*t*c[i] + t**3*d[i]);
// Presentation-only choreography for an existing paper prop and one short
// paw. The scene stays in the stage's right margin and returns to its grip.
function samplePaperReturn(progress, calmVisual = false, exit = null) {
  if (exit && !calmVisual) return samplePaperReturnExit(exit);
  const p = calmVisual ? .78 : clamp(Number(progress) || 0);
  const rest = [59, 49], ready = [64, 46], release = [69, 43];
  let hand = p < .2 ? mix(rest, ready, (p - .04) / .16)
    : p < .34 ? mix(ready, release, (p - .2) / .14)
      : p < .7 ? mix(release, [63, 48], (p - .34) / .16)
        : p < .76 ? mix([63, 48], release, (p - .7) / .06)
          : mix(release, rest, (p - .82) / .14);
  let grip = hand, angle = 0;
  if (p >= .34 && p < .76) {
    const t = ease((p - .34) / .42);
    // Two joined cubics make a broad hooked return outside the face. The
    // shared join has matching tangents; endpoints are the exact release grip.
    grip = t < .5 ? cubic(release, [89, 40], [94, 8], [82, 10], t * 2)
      : cubic([82, 10], [70, 12], [69, 34], release, (t - .5) * 2);
    angle = -Math.sin(Math.PI * t) * 1.2;
  }
  const opacity = ease((p - .08) / .06) * ease((.96 - p) / .08);
  const phase = p < .14 ? 'anticipation' : p < .34 ? 'grip' : p < .7 ? 'flight'
    : p < .76 ? 'receive' : p < .84 ? 'contact' : p < .96 ? 'recovery' : 'idle';
  return Object.freeze({ hand: Object.freeze(hand), grip: Object.freeze(grip), angle, opacity, phase });
}
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

function samplePaperReturnExit({ progress, t }) {
  const start = samplePaperReturn(progress), airborne = ['flight', 'receive'].includes(start.phase);
  t = clamp(t);
  const catchAt = .45, release = [69, 43], rest = [59, 49];
  const hand = airborne && t < catchAt ? mix(start.hand, release, t / catchAt)
    : mix(airborne ? release : start.hand, rest, (t - (airborne ? catchAt : 0)) / (airborne ? 1 - catchAt : 1));
  const grip = airborne && t < catchAt ? mix(start.grip, release, t / catchAt) : hand;
  return Object.freeze({ hand: Object.freeze(hand), grip: Object.freeze(grip),
    angle: start.angle * (1 - ease(t / catchAt)), opacity: start.opacity * (1 - ease((t - .6) / .3)),
    phase: airborne && t < catchAt ? 'flight' : 'recovery' });
}
