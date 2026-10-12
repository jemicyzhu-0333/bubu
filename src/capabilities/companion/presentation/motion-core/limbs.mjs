'use strict';
// Unified limb core (form-agnostic). Every limb of every form goes through the
// same pipeline:  socket (form/view) + bone lengths + declared intent  ->
// two-bone IK chain (fixed lengths, bounded elbow, outward bend)  ->
// form output (closed vector silhouette for usagi, angle-frame selection for
// dango).  No painter is chosen by action name; intents come from data.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);

// Two-bone IK with fixed bone lengths.
//   root, target   : points in the same space
//   upper, lower   : fixed bone lengths (never stretched)
//   bend           : +1 / -1, which side of root->target the elbow sits on
//                    (callers pass "outward" for the limb's side)
//   maxBend        : max elbow offset from the chord, as a fraction of upper+lower.
//                    When the target is closer than this bend allows, the chain
//                    root retracts along the chord into the socket instead of
//                    folding further (continuous retract; no visibility threshold).
// Returns { root, elbow, wrist, reached, retract, chord }. The wrist is the
// target when reachable; when not, it is clamped onto the reach circle.
function solveTwoBone(root, target, { upper, lower, bend = 1, maxBend = .22 } = {}) {
  const reach = upper + lower, d = sub(target, root), dist = len(d) || 1e-9;
  const u = [d[0] / dist, d[1] / dist];
  const reached = dist <= reach;
  const wrist = reached ? [target[0], target[1]] : [root[0] + u[0] * reach, root[1] + u[1] * reach];
  // Minimum chord for which the elbow offset stays within maxBend.
  const minChord = Math.min(reach, Math.max(Math.abs(upper - lower), solveChordForOffset(upper, lower, maxBend * reach)));
  const chord = clamp(Math.min(dist, reach), minChord, reach);
  const retract = Math.max(0, chord - Math.min(dist, reach));
  const base = [wrist[0] - u[0] * chord, wrist[1] - u[1] * chord];
  // Law of cosines: distance along chord to the elbow foot, and its height.
  const a = (upper * upper - lower * lower + chord * chord) / (2 * chord);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const n = [-u[1] * bend, u[0] * bend];
  const elbow = [base[0] + u[0] * a + n[0] * h, base[1] + u[1] * a + n[1] * h];
  return { root: base, socket: [root[0], root[1]], elbow, wrist, reached, retract, chord, bendHeight: h };
}
function solveChordForOffset(upper, lower, offset) {
  // For upper == lower the elbow height for chord c is sqrt(u^2 - (c/2)^2).
  const m = (upper + lower) / 2;
  return 2 * Math.sqrt(Math.max(0, m * m - offset * offset));
}

// Elbow interior angle in degrees (180 = straight).
function elbowAngle(chain) {
  const a = sub(chain.root, chain.elbow), b = sub(chain.wrist, chain.elbow);
  const cos = (a[0] * b[0] + a[1] * b[1]) / ((len(a) * len(b)) || 1);
  return Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
}

// Quadratic control so the curve passes through the elbow at t = .5.
const controlThrough = (from, elbow, to) => [2 * elbow[0] - (from[0] + to[0]) / 2, 2 * elbow[1] - (from[1] + to[1]) / 2];

function quadPoint(from, control, to, t) {
  const v = 1 - t;
  return [v * v * from[0] + 2 * v * t * control[0] + t * t * to[0], v * v * from[1] + 2 * v * t * control[1] + t * t * to[1]];
}

// Closed silhouette: tapered tube from root width to wrist radius plus one
// palm cap. Returns { outer, inner, angle, centre } so painters can fill and
// stroke the very same contour.
function limbSilhouette(from, control, to, { rootRadius = 2.7, wristRadius = 3.6, samples = 16, startT = 0 } = {}) {
  const edge = sign => Array.from({ length: samples + 1 }, (_, n) => {
    const t = startT + (1 - startT) * n / samples, v = 1 - t;
    const p = quadPoint(from, control, to, t);
    const dx = 2 * (v * (control[0] - from[0]) + t * (to[0] - control[0]));
    const dy = 2 * (v * (control[1] - from[1]) + t * (to[1] - control[1]));
    const l = Math.hypot(dx, dy) || 1, w = rootRadius + (wristRadius - rootRadius) * t;
    return [p[0] - sign * dy / l * w, p[1] + sign * dx / l * w];
  });
  const outer = edge(1), inner = edge(-1);
  return { outer, inner, angle: Math.atan2(outer.at(-1)[1] - to[1], outer.at(-1)[0] - to[0]) };
}

// Per-channel temporal filter for the elbow (and any limb point that is not a
// contact). Contacts (wrist on a prop) are never filtered, so props stay in
// hand. Stateless callers (no finite elapsedMs) get the exact target, which
// keeps tests and offline renders deterministic. Big gaps or rewinds reset.
function createLimbFilter({ speed = .045, resetMs = 250 } = {}) {
  const state = new Map();
  function filter(key, point, elapsedMs) {
    if (!Number.isFinite(elapsedMs)) return point;
    const prev = state.get(key), dt = prev ? elapsedMs - prev.t : 0;
    let out = point;
    if (prev && dt > 0 && dt <= resetMs) {
      const d = sub(point, prev.p), l = len(d), limit = speed * dt;
      if (l > limit) out = [prev.p[0] + d[0] / l * limit, prev.p[1] + d[1] / l * limit];
    } else if (prev && dt === 0) out = prev.p;
    state.set(key, { t: elapsedMs, p: out });
    if (state.size > 256) state.delete(state.keys().next().value);
    return out;
  }
  return Object.freeze({ filter, clear: () => state.clear(), get size() { return state.size; } });
}

// Intent resolution: rules are data. Each rule:
//   { motion?, motions?, props?: [all-of], anyProps?, side?, notActions?, intent }
// The first matching rule wins; actions may override per side via
// capabilities `limbs: { l: intent, r: intent }`.
function resolveLimbIntent(rules, { sample, side, declared }) {
  if (declared?.[side] !== undefined) return declared[side];
  if (!sample) return null;
  const has = id => sample.props?.includes(id);
  for (const rule of rules) {
    if (rule.side && rule.side !== side) continue;
    if (rule.motion && rule.motion !== sample.motion) continue;
    if (rule.motions && !rule.motions.includes(sample.motion)) continue;
    if (rule.props && !rule.props.every(has)) continue;
    if (rule.anyProps && !rule.anyProps.some(has)) continue;
    if (rule.notContact && rule.notContact.includes(sample.contactAction)) continue;
    if (rule.contact && rule.contact !== sample.contactAction) continue;
    if (rule.gesture && rule.gesture !== sample.gesture) continue;
    if (rule.event && rule.event !== sample.event?.category) continue;
    return rule.intent;
  }
  return null;
}

// Angle-frame selection for raster limbs (dango limbs.json "dango-limbs/1").
function nearestFrame(frames, degrees) {
  if (!frames?.length) return null;
  const norm = a => ((a % 360) + 360) % 360;
  let best = null, bestD = Infinity;
  for (const f of frames) {
    const d = Math.min(Math.abs(norm(f.angle) - norm(degrees)), 360 - Math.abs(norm(f.angle) - norm(degrees)));
    if (d < bestD) { best = f; bestD = d; }
  }
  return best;
}
const segmentAngle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;

// Point-in-polygon (even-odd) used for socket union tests.
function insidePolygon(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Flatten an SVG path made of M/L/C/Q/Z (absolute) into polygon points.
function flattenPath(d, steps = 8) {
  const tokens = d.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = []; let i = 0, cmd = null, cur = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z' || cmd === 'z') { cmd = null; continue; }
    if (cmd === 'M' || cmd === 'L') { cur = [num(), num()]; out.push(cur); if (cmd === 'M') cmd = 'L'; }
    else if (cmd === 'C') { const c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()];
      for (let s = 1; s <= steps; s++) { const t = s / steps, v = 1 - t;
        out.push([v ** 3 * cur[0] + 3 * v * v * t * c1[0] + 3 * v * t * t * c2[0] + t ** 3 * p[0],
          v ** 3 * cur[1] + 3 * v * v * t * c1[1] + 3 * v * t * t * c2[1] + t ** 3 * p[1]]); }
      cur = p; }
    else if (cmd === 'Q') { const c = [num(), num()], p = [num(), num()];
      for (let s = 1; s <= steps; s++) out.push(quadPoint(cur, c, p, s / steps)); cur = p; }
    else i++;
  }
  return out;
}

export { solveTwoBone, elbowAngle, controlThrough, quadPoint, limbSilhouette,
  createLimbFilter, resolveLimbIntent, smoothstep as limbSmoothstep, nearestFrame, segmentAngle, insidePolygon, flattenPath };
