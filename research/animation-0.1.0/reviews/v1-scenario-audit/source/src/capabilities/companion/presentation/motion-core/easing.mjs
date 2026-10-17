'use strict';
// One curve library for presentation code. Every function is pure and
// allocation-free unless an explicit `out` array is omitted.
const clamp01 = value => { const t = Number(value); return t > 0 ? (t < 1 ? t : 1) : 0; };
const linear = t => clamp01(t);
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const inOutCubic = value => { const t = clamp01(value); return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const outCubic = value => 1 - (1 - clamp01(value)) ** 3;
// Overshoots past 1 then settles; s=1.70158 is the classic 10% overshoot.
function outBack(value, s = 1.70158) { const t = clamp01(value) - 1; return 1 + t * t * ((s + 1) * t + s); }
// Closed-form damped spring step response (0 → 1). Deterministic: no state.
function spring(value, { frequency = 2.2, damping = .38 } = {}) {
  const t = clamp01(value); if (t === 1) return 1;
  const w = 2 * Math.PI * frequency, z = Math.min(.999, Math.max(.01, damping)), wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
// CSS-style cubic-bezier(x1,y1,x2,y2) easing. Solved by Newton + bisection fallback.
function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return value => {
    const x = clamp01(value); let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6) return sy(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 24; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
const EASINGS = Object.freeze({ linear, smooth, inOutCubic, outCubic, outBack, spring, standard: cubicBezier(.4, 0, .2, 1) });
const easing = name => typeof name === 'function' ? name : EASINGS[name] || smooth;
// Rising then falling window, like an attack/hold/release envelope.
const envelope = (p, a, b, c, d, curve = smooth) => curve((p - a) / (b - a)) * curve((d - p) / (d - c));
function mix(a, b, t, curve = smooth, out = new Array(a.length)) {
  const k = curve(t); for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * k; return out;
}
function cubicPoint(a, b, c, d, t, out = [0, 0]) {
  const u = 1 - t; for (let i = 0; i < 2; i++) out[i] = u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]; return out;
}
function cubicTangent(a, b, c, d, t, out = [0, 0]) {
  const u = 1 - t; for (let i = 0; i < 2; i++) out[i] = 3 * u * u * (b[i] - a[i]) + 6 * u * t * (c[i] - b[i]) + 3 * t * t * (d[i] - c[i]); return out;
}
function quadPoint(a, c, b, t, out = [0, 0]) {
  const u = 1 - t; for (let i = 0; i < 2; i++) out[i] = u * u * a[i] + 2 * u * t * c[i] + t * t * b[i]; return out;
}
export { clamp01, linear, smooth, inOutCubic, outCubic, outBack, spring, cubicBezier, EASINGS, easing, envelope, mix, cubicPoint, cubicTangent, quadPoint };
// Raw cubic Hermite (no clamping): for callers that clamp or extrapolate themselves.
const hermite = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export { hermite, lerp };

