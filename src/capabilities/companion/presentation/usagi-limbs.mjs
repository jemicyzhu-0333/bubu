'use strict';
// Usagi limbs: the single arm module. Every usagi arm, in every action, view
// and outfit, is produced here from
//   socket (USAGI_LIMB_RIG.sockets[view][side])
//   + fixed bone lengths (USAGI_LIMB_RIG.arm)
//   + a declared intent (USAGI_LIMB_INTENTS rules, or action caps `limbs`)
// through motion-core's two-bone IK, and painted as ONE closed silhouette
// whose root is merged into the body outline (socket union: the outline is
// clipped outside the body contour; the fill covers the body line it crosses).
// The previous three painters (support connector tube with a cream overstroke,
// per-motion bezier contact paws, gesture paws with private shoulders) are
// gone; their exported names remain as thin views of this module.
import { applyPoint } from './rig/pose.mjs';
import { solveTwoBone, controlThrough, quadPoint, limbSilhouette, createLimbFilter,
  resolveLimbIntent, insidePolygon, flattenPath } from './motion-core/limbs.mjs';
import { motionCapsById } from './motion-core/action-capabilities.mjs';
import { USAGI_LIMB_RIG, USAGI_LIMB_INTENTS, USAGI_LEG_RIG } from '../../../content/companion/usagi-limbs.mjs';

const filters = createLimbFilter({ speed: USAGI_LIMB_RIG.elbowSpeed });

function sockets(view, side) { return (USAGI_LIMB_RIG.sockets[view] || USAGI_LIMB_RIG.sockets.front)[side].slice(); }

// Body contour polygon per view (rest art space), cached by rig view data.
const bodyCache = new WeakMap();
function bodyPolygon(data) {
  if (!data) return null;
  if (bodyCache.has(data)) return bodyCache.get(data);
  const shape = data.parts.find(p => p.bone === 'root')?.shapes?.find(s => s.fill && s.fill !== 'none' && /Z\s*$/.test(s.d));
  const poly = shape ? flattenPath(shape.d) : null;
  bodyCache.set(data, poly);
  return poly;
}
const invert = m => { const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; };

function wristOf(artwork, data, side) {
  return applyPoint(artwork.pose.world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot);
}

// ---- intent -------------------------------------------------------------
function intentFor(artwork, side, data = artwork?.rig?.views?.[artwork?.drawnView]) {
  const sample = artwork?.pose?.sample;
  if (!data?.anchors?.['usagi.umbrella-grip'] || !sample) return null;
  const declared = motionCapsById(sample.contactAction)?.limbs;
  const intent = resolveLimbIntent(USAGI_LIMB_INTENTS, { sample, side, declared });
  if (!intent) return null;
  // Quiet AI key contacts keep a compact paw rather than a full table elbow.
  if (intent.expanded && sample.event?.category === 'ai') return { ...intent, bend: 'compact' };
  if (intent.whileExtended && artwork.pose.world) {
    const arm = data.bones[`arm_${side}`];
    const from = applyPoint(artwork.pose.world[arm.parent], ...arm.pivot), to = wristOf(artwork, data, side);
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) <= USAGI_LIMB_RIG.releaseReach) return null;
  }
  if (intent.kind === 'support' && (!sample.motion || sample.motion === 'idle')) return null;
  return intent;
}

function behindBody(view, side) {
  return view === 'back' || (['three-quarter', 'profile'].includes(view) && side === 'l');
}

const upperShare = (spec, chain) => ((spec.upper ** 2 - spec.lower ** 2 + chain.chord ** 2) / (2 * chain.chord)) / chain.chord;

// ---- geometry -------------------------------------------------------------
// One solver for every intent. The wrist is the exact posed hand pivot, so
// equipment matrices (which use the same hand bone) stay in the paw.
function limbGeometry(artwork, data, side, intent = intentFor(artwork, side, data)) {
  const world = artwork.pose.world, view = artwork.drawnView;
  const arm = data.bones[`arm_${side}`];
  // Support limbs grow out from under the authored paw, i.e. its own shoulder
  // pivot; every other intent uses the shared shoulder socket.
  const socket = applyPoint(world[arm.parent] || world.root, ...(intent?.kind === 'support' ? arm.pivot : sockets(view, side)));
  const to = wristOf(artwork, data, side);
  const spec = USAGI_LIMB_RIG.arm, bendSpec = USAGI_LIMB_RIG.bends[intent?.bend || 'table'];
  const direction = side === 'l' ? -1 : 1;
  // Outward/downward elbow preference -> bend sign for the chord normal.
  const d = [to[0] - socket[0], to[1] - socket[1]], l = Math.hypot(...d) || 1, n = [-d[1] / l, d[0] / l];
  const prefer = [direction * bendSpec.out, bendSpec.down];
  const bend = bendSpec.side ? direction : n[0] * prefer[0] + n[1] * prefer[1] >= 0 ? 1 : -1;
  const chain = solveTwoBone(socket, to, { upper: spec.upper, lower: spec.lower, bend, maxBend: bendSpec.maxBend });
  // Visible limb = socket -> wrist. The IK chain fixes the elbow: its offset
  // from the chord is the bounded bend height (elbow range), on the outward side.
  const along = Math.min(l, spec.upper + spec.lower) * (chain.chord ? (upperShare(spec, chain)) : .5);
  const rawElbow = [socket[0] + d[0] / l * along + n[0] * bend * chain.bendHeight,
    socket[1] + d[1] / l * along + n[1] * bend * chain.bendHeight];
  const clock = artwork.clock;
  const elbow = clock?.calm ? rawElbow : filters.filter(`${clock?.channel ?? 'pet'}:${side}`, rawElbow, clock?.elapsedMs);
  // Bury the root under the body line, towards the body centre (socket axis).
  const centre = applyPoint(world.root, ...USAGI_LIMB_RIG.bodyCentre);
  const inward = [centre[0] - socket[0], centre[1] - socket[1]], il = Math.hypot(...inward) || 1;
  const from = [socket[0] + inward[0] / il * USAGI_LIMB_RIG.bury, socket[1] + inward[1] / il * USAGI_LIMB_RIG.bury];
  const control = controlThrough(from, elbow, to);
  // `from` is the socket (visible limb start); `root` is the buried paint root.
  const root = from;
  return { from: socket, root, to, control, elbow, socket, chain, intent,
    radius: bendSpec.wristRadius ?? USAGI_LIMB_RIG.wristRadius, rootRadius: bendSpec.rootRadius ?? USAGI_LIMB_RIG.rootRadius,
    // Contact family keeps an open shoulder: no stroke closes the root.
    openRoot: true, inside: socket };
}

// The visible limb starts at the shoulder socket: the retracted part of the
// chain (between the IK root and the socket) is inside the body and never
// drawn. A fixed bury keeps the root fill under the body line.
function socketT(geometry) {
  const N = 48; let best = 0, bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    const p = quadPoint(geometry.from, geometry.control, geometry.to, i / N);
    const d = Math.hypot(p[0] - geometry.socket[0], p[1] - geometry.socket[1]);
    if (d < bestD) { bestD = d; best = i / N; }
  }
  const arc = Math.hypot(geometry.to[0] - geometry.from[0], geometry.to[1] - geometry.from[1]) || 1;
  return Math.max(0, Math.min(.9, best - USAGI_LIMB_RIG.bury / arc));
}

function traceBodyContour(ctx, artwork, data) {
  const poly = bodyPolygon(data), m = artwork.pose.world.root;
  if (!poly || !m) return false;
  const pts = poly.map(p => applyPoint(m, ...p));
  ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath();
  return true;
}


// Clip to the outside of the posed body contour, plus keep-out islands
// (palms) that stay visible over it. Nonzero winding: outer box +1, body -1,
// islands +1, so an island inside the body is still painted.
function clipOutsideBody(ctx, artwork, data, islands = []) {
  const poly = bodyPolygon(data), m = artwork?.pose?.world?.root;
  if (!poly || !m || typeof ctx.clip !== 'function') return false;
  const pts = poly.map(p => applyPoint(m, ...p));
  let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const body = area > 0 ? pts.slice().reverse() : pts;
  const c = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]), R = 45;
  ctx.beginPath();
  ctx.moveTo(c[0] - R, c[1] - R); ctx.lineTo(c[0] + R, c[1] - R); ctx.lineTo(c[0] + R, c[1] + R); ctx.lineTo(c[0] - R, c[1] + R); ctx.closePath();
  ctx.moveTo(...body[0]); for (const p of body.slice(1)) ctx.lineTo(...p); ctx.closePath();
  for (const { x, y, rx, ry = rx } of islands) {
    ctx.moveTo(x + rx, y);
    for (let i = 1; i <= 24; i++) { const a = i / 24 * Math.PI * 2; ctx.lineTo(x + Math.cos(a) * rx, y + Math.sin(a) * ry); }
    ctx.closePath();
  }
  ctx.clip('nonzero');
  return true;
}

// ---- painter ---------------------------------------------------------------
function supportAmount(geometry) {
  const reach = Math.hypot(geometry.to[0] - geometry.socket[0], geometry.to[1] - geometry.socket[1]);
  // Continuous retract: the support limb's width ramps with reach; no on/off threshold.
  const t = Math.max(0, Math.min(1, (reach - USAGI_LIMB_RIG.restReach) / 4));
  return t * t * (3 - 2 * t);
}
function paintLimb(ctx, artwork, data, side, { mergeSocket = true, alpha = 1, intent } = {}) {
  const geometry = intent === undefined ? limbGeometry(artwork, data, side) : limbGeometry(artwork, data, side, intent);
  if (geometry.intent?.kind === 'support') {
    const k = supportAmount(geometry);
    if (k <= 0) return false;
    geometry.radius *= .72 * k; geometry.rootRadius *= .96 * k;
  }
  if (!geometry.intent) return false;
  const startT = 0;
  const { outer, inner, angle } = limbSilhouette(geometry.root, geometry.control, geometry.to,
    { rootRadius: geometry.rootRadius, wristRadius: geometry.radius, startT });
  const shape = data.parts.find(part => part.bone === `hand_${side}`)?.shapes.find(v => v.fill && v.fill !== 'none');
  const outline = () => {
    ctx.moveTo(...outer[0]);
    for (const p of outer.slice(1)) ctx.lineTo(...p);
    ctx.arc(...geometry.to, geometry.radius, angle, angle - Math.PI, true);
    for (const p of inner.slice().reverse().slice(1)) ctx.lineTo(...p);
  };
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  // Support limbs grow out of the body edge: paint only outside the body
  // contour so the body line stays continuous while the limb retracts.
  const support = geometry.intent.kind === 'support';
  // Back view: the arm is on the far side of the body; only the palm shows
  // over the back (as the authored paw does), the rest only beside the body.
  if (artwork.drawnView === 'back') clipOutsideBody(ctx, artwork, data,
    support ? [] : [{ x: geometry.to[0], y: geometry.to[1], rx: geometry.radius + 1.2 }]);
  else if (support && typeof ctx.clip === 'function') {
    const s = geometry.socket, R = 40; ctx.beginPath();
    ctx.moveTo(s[0] - R, s[1] - R); ctx.lineTo(s[0] + R, s[1] - R); ctx.lineTo(s[0] + R, s[1] + R); ctx.lineTo(s[0] - R, s[1] + R); ctx.closePath();
    if (traceBodyContour(ctx, artwork, data)) ctx.clip('evenodd');
  }
  ctx.beginPath(); outline(); ctx.closePath();
  ctx.fillStyle = shape?.fill || '#fff5de'; ctx.fill();
  // Socket union: the limb outline is drawn only outside the body contour,
  // so it meets the body line exactly; the fill above already covers the
  // part of the body line that lies under the limb. One stroke, no cream patch.
  const stroke = (o = outer, i = inner) => {
    ctx.beginPath(); ctx.moveTo(...o[0]);
    for (const p of o.slice(1)) ctx.lineTo(...p);
    ctx.arc(...geometry.to, geometry.radius, angle, angle - Math.PI, true);
    for (const p of i.slice().reverse().slice(1)) ctx.lineTo(...p);
    ctx.strokeStyle = shape?.stroke || '#351710'; ctx.lineWidth = USAGI_LIMB_RIG.outline;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  };
  const poly = mergeSocket && !support && !behindBody(artwork.drawnView, side) ? bodyPolygon(data) : null;
  const m = artwork.pose?.world?.root;
  if (poly && m) {
    // Socket union, done geometrically: each edge's outline starts where it
    // leaves (inside body ∩ socket disc). Inside that region it would double
    // the body line; outside the body it always meets the body line. The cut
    // is a clean round line end, never a clipped sliver.
    const local = invert(m), s = geometry.socket, r = USAGI_LIMB_RIG.socketRadius;
    const erased = p => Math.hypot(p[0] - s[0], p[1] - s[1]) < r && insidePolygon(poly, applyPoint(local, ...p));
    // Edges run root -> wrist; stop once the edge has left the socket disc.
    const trim = edge => { let k = 0; for (let n = 0; n < edge.length - 2; n++) {
      const p = edge[n]; if (Math.hypot(p[0] - s[0], p[1] - s[1]) >= r * 1.5) break; if (erased(p)) k = n + 1; }
      return edge.slice(k); };
    stroke(trim(outer), trim(inner));
  } else stroke();
  ctx.restore();
  return true;
}

// Layer a limb paints on. 'part' = in place of the authored hand part.
function limbLayer(artwork, side, intent, part) {
  if (!intent) return null;
  const view = artwork.drawnView;
  if (intent.kind === 'gesture') {
    if (behindBody(view, side)) return 'back';
    return artwork.wardrobe?.wrapsBody ? 'under-cloth' : 'part';
  }
  if (intent.kind === 'support') return intent.tuck ? 'back' : 'pre-part';
  return 'part';
}

// ---- intent continuity ------------------------------------------------------
// An intent switch (story beat, release, gesture end) never pops: the leaving
// limb fades out over the new state and an arriving limb fades in, on the
// channel clock. Stateless callers (no elapsedMs) see the plain intent.
const memory = new Map();
const signature = intent => intent ? `${intent.kind}:${intent.bend}` : 'rest';
function limbState(artwork, side, data) {
  const intent = intentFor(artwork, side, data), clock = artwork?.clock, now = clock?.elapsedMs;
  if (!Number.isFinite(now)) return { intent, leaving: null, arriving: 1 };
  const key = `${clock.channel ?? 'pet'}:${side}`;
  // Calm / reduced motion: the static pose, immediately; clear channel state.
  if (clock.calm) { memory.delete(key); filters.drop(key); return { intent, leaving: null, arriving: 1 }; }
  const sig = signature(intent), FADE = USAGI_LIMB_RIG.intentFadeMs;
  let m = memory.get(key);
  if (!m || now < m.t || now - m.t > 500) m = { sig, intent, t: now, since: -Infinity, from: null };
  else if (m.sig !== sig) m = { sig, intent, t: now, since: now, from: m.intent };
  else m.t = now;
  memory.set(key, m); if (memory.size > 256) memory.delete(memory.keys().next().value);
  const k = Math.min(1, (now - m.since) / FADE);
  return { intent, leaving: k < 1 && m.from ? { intent: m.from, alpha: 1 - k } : null, arriving: k };
}

// Hook: before parts on each action layer (behind-body limbs, support limbs,
// and the fade-in of an arriving grip under the still-visible authored paw).
function paintLimbsBefore(ctx, { artwork, data, layer }) {
  let painted = false;
  const partLayerOf = side => data.parts.find(p => p.bone === `hand_${side}`)?.layer;
  const wantedFor = (side, intent) => {
    const where = limbLayer(artwork, side, intent);
    return where === 'back' ? 'back' : where === 'pre-part' ? partLayerOf(side) : null;
  };
  for (const side of ['l', 'r']) {
    const { intent, leaving, arriving } = limbState(artwork, side, data);
    if (intent && wantedFor(side, intent) === layer) painted = paintLimb(ctx, artwork, data, side, { intent, alpha: intent.kind === 'support' ? 1 : arriving }) || painted;
    else if (intent && arriving < 1 && limbLayer(artwork, side, intent) === 'part' && partLayerOf(side) === layer)
      painted = paintLimb(ctx, artwork, data, side, { intent, alpha: arriving }) || painted;
    if (leaving && wantedFor(side, leaving.intent) === layer) painted = paintLimb(ctx, artwork, data, side, { intent: leaving.intent, alpha: leaving.alpha }) || painted;
  }
  return painted;
}

// Hook: in place of an authored hand part. true = handled (painted or deliberately skipped).
function paintLimbPart(ctx, { part, data, artwork }) {
  const side = part?.bone === 'hand_l' ? 'l' : part?.bone === 'hand_r' ? 'r' : null;
  if (!side) return false;
  const { intent, leaving, arriving } = limbState(artwork, side, data);
  // A leaving in-place limb fades out on top of the authored paw / new state.
  const fadeOut = () => leaving && limbLayer(artwork, side, leaving.intent) === 'part'
    && paintLimb(ctx, artwork, data, side, { intent: leaving.intent, alpha: leaving.alpha });
  if (!intent || intent.kind === 'support') { fadeOut(); return false; }
  const where = limbLayer(artwork, side, intent, part);
  if (where !== 'part') { fadeOut(); return true; }
  // Arriving grip: painted under the authored paw by the before-hook until it is complete.
  if (arriving < 1) { return false; }
  const painted = paintLimb(ctx, artwork, data, side, { intent });
  fadeOut();
  return painted;
}

function paintLimbsUnderCloth(ctx, { artwork }) {
  const data = artwork?.rig?.views?.[artwork.drawnView];
  if (!data) return false;
  let painted = false;
  for (const side of ['l', 'r']) {
    const { intent, arriving } = limbState(artwork, side, data);
    if (limbLayer(artwork, side, intent) === 'under-cloth') painted = paintLimb(ctx, artwork, data, side, { intent, alpha: arriving }) || painted;
  }
  return painted;
}

// ---- legs (2-point IK: hip socket -> foot target) --------------------------
// Feet are the IK targets: the authored pose decides where each sole lands.
// The leg is re-aimed about its foot so its top stays on the hip socket; its
// width is unchanged, only its length follows the hip-foot distance.
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
// Tucked = the leg top sits at/above its hip in body space and inside the body.
function legTucked(world, data, hip, top) {
  const local = invert(world.root), t = applyPoint(local, ...top), h = applyPoint(local, ...hip);
  return t[1] <= h[1] + 1e-3 && insidePolygon(bodyPolygon(data) || [], t);
}
const legOutline = new WeakMap();
function legPoints(data, side) {
  let byData = legOutline.get(data); if (!byData) { byData = {}; legOutline.set(data, byData); }
  if (!(side in byData)) {
    const part = data.parts.find(p => p.bone === `leg_${side}`);
    byData[side] = (part?.shapes || []).flatMap(sh => sh.d ? flattenPath(sh.d) : []);
  }
  return byData[side];
}
function legCorrection(world, data, side) {
  const bone = data.bones?.[`leg_${side}`], M = world[`leg_${side}`], P = world[bone?.parent];
  if (!bone || !M || !P) return null;
  const [px, py] = bone.pivot;
  const hip = applyPoint(P, px, py), top = applyPoint(M, px, py);
  if (Math.hypot(hip[0] - top[0], hip[1] - top[1]) < 1e-3) return null; // already attached
  // A tucked leg (top above the hip, inside the body) is already joined and
  // hidden behind the body: keep the authored pixels. Only an extended leg
  // (top pulled below the hip socket) would open a gap, so only it is solved.
  if (legTucked(world, data, hip, top)) return null;
  // Floor line: the posed leg's lowest outline point (outer stroke edge) in
  // world space. A world-horizontal shear + vertical scale about that line
  // keeps every floor pixel and moves the leg top onto the hip socket.
  const pts = legPoints(data, side); if (!pts.length) return null;
  const sy = Math.hypot(M[2], M[3]) || 1;
  const y0 = Math.max(...pts.map(p => applyPoint(M, ...p)[1])) + USAGI_LIMB_RIG.outline / 2 * sy;
  const h = y0 - top[1]; if (h <= 1e-3) return null;
  const [lo, hi] = USAGI_LEG_RIG.stretch, k = Math.min(hi, Math.max(lo, (y0 - hip[1]) / h));
  const sh = (hip[0] - top[0]) / -h;
  // x' = x + sh*(y - y0), y' = y0 + k*(y - y0)
  const W = [1, 0, sh, k, -sh * y0, y0 - k * y0];
  return mul(W, M);
}
function solveUsagiLegs(world, { data } = {}) {
  let out = null;
  for (const side of ['l', 'r']) {
    const m = legCorrection(world, data, side);
    if (m) { out ||= {}; out[`leg_${side}`] = m; }
  }
  return out;
}
function traceUsagiLegs(artwork, data) {
  const world = { ...artwork.pose.world, ...(artwork.pose.partWorld || {}) };
  return ['l', 'r'].map(side => {
    const bone = data.bones[`leg_${side}`]; if (!bone || !world[`leg_${side}`]) return null;
    const [px, py] = bone.pivot;
    const hip = applyPoint(world[bone.parent], px, py), top = applyPoint(world[`leg_${side}`], px, py);
    const tucked = legTucked(world, data, hip, top);
    return { side, hip, top, tucked,
      foot: applyPoint(world[`leg_${side}`], px, py + USAGI_LEG_RIG.footDrop) };
  }).filter(Boolean);
}

// ---- trace (detectors) -----------------------------------------------------
function traceOne(artwork, data, side, intent) {
  const wrist = wristOf(artwork, data, side);
  if (!intent) return { mode: 'rest', len: 0, wrist };
  const g = limbGeometry(artwork, data, side, intent);
  if (intent.kind === 'support' && supportAmount(g) <= 0) return { mode: 'rest', len: 0, wrist };
  const visible = Math.hypot(g.to[0] - g.socket[0], g.to[1] - g.socket[1]);
  return { mode: 'limb', kind: intent.kind, len: +(visible * (intent.kind === 'support' ? supportAmount(g) : 1)).toFixed(3), wrist, socket: g.socket, elbow: g.elbow, retract: g.chain.retract, reached: g.chain.reached };
}

// Visible-length trace including intent cross-fades (what the detectors see).
function traceUsagiLimb(artwork, data, side) {
  const { intent, leaving, arriving } = limbState(artwork, side, data);
  const now = traceOne(artwork, data, side, intent);
  if (!leaving && arriving >= 1) return now;
  const before = leaving ? traceOne(artwork, data, side, leaving.intent) : { len: 0 };
  const k = arriving;
  return { ...now, mode: k < 1 ? 'fade' : now.mode, len: +(before.len * (1 - k) + now.len * k).toFixed(3) };
}

export { solveUsagiLegs, traceUsagiLegs, clipOutsideBody, bodyPolygon as bodyContour, USAGI_LIMB_RIG, limbState, sockets, intentFor, limbGeometry, limbLayer, paintLimb, paintLimbsBefore, paintLimbPart,
  paintLimbsUnderCloth, traceUsagiLimb, bodyPolygon, behindBody, filters as usagiLimbFilters };
