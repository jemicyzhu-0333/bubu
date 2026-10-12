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
import { USAGI_LIMB_RIG, USAGI_LIMB_INTENTS } from '../../../content/companion/usagi-limbs.mjs';

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
  const bend = n[0] * prefer[0] + n[1] * prefer[1] >= 0 ? 1 : -1;
  const chain = solveTwoBone(socket, to, { upper: spec.upper, lower: spec.lower, bend, maxBend: bendSpec.maxBend });
  // Visible limb = socket -> wrist. The IK chain fixes the elbow: its offset
  // from the chord is the bounded bend height (elbow range), on the outward side.
  const along = Math.min(l, spec.upper + spec.lower) * (chain.chord ? (upperShare(spec, chain)) : .5);
  const rawElbow = [socket[0] + d[0] / l * along + n[0] * bend * chain.bendHeight,
    socket[1] + d[1] / l * along + n[1] * bend * chain.bendHeight];
  const clock = artwork.clock;
  const elbow = filters.filter(`${clock?.channel ?? 'pet'}:${side}`, rawElbow, clock?.elapsedMs);
  // Bury the root under the body line, towards the body centre (socket axis).
  const centre = applyPoint(world.root, ...USAGI_LIMB_RIG.bodyCentre);
  const inward = [centre[0] - socket[0], centre[1] - socket[1]], il = Math.hypot(...inward) || 1;
  const from = [socket[0] + inward[0] / il * USAGI_LIMB_RIG.bury, socket[1] + inward[1] / il * USAGI_LIMB_RIG.bury];
  const control = controlThrough(from, elbow, to);
  // `from` is the socket (visible limb start); `root` is the buried paint root.
  const root = from;
  return { from: socket, root, to, control, elbow, socket, chain, intent,
    radius: USAGI_LIMB_RIG.wristRadius, rootRadius: USAGI_LIMB_RIG.rootRadius,
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

// ---- painter ---------------------------------------------------------------
function supportAmount(geometry) {
  const reach = Math.hypot(geometry.to[0] - geometry.socket[0], geometry.to[1] - geometry.socket[1]);
  // Continuous retract: the support limb's width ramps with reach; no on/off threshold.
  const t = Math.max(0, Math.min(1, (reach - USAGI_LIMB_RIG.restReach) / 4));
  return t * t * (3 - 2 * t);
}
function paintLimb(ctx, artwork, data, side, { mergeSocket = true, alpha = 1 } = {}) {
  const geometry = limbGeometry(artwork, data, side);
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
  ctx.beginPath(); outline(); ctx.closePath();
  ctx.fillStyle = shape?.fill || '#fff5de'; ctx.fill();
  // Socket union: the limb outline is drawn only outside the body contour,
  // so it meets the body line exactly; the fill above already covers the
  // part of the body line that lies under the limb. One stroke, no cream patch.
  if (mergeSocket && !behindBody(artwork.drawnView, side)) {
    // Socket mask: inside the body near the socket the limb outline is erased,
    // so the root merges into the body silhouette (no cap, no double line).
    const s = geometry.socket, r = USAGI_LIMB_RIG.socketRadius;
    if (typeof ctx.clip === 'function') {
      ctx.beginPath(); ctx.moveTo(-200, -200); ctx.lineTo(300, -200); ctx.lineTo(300, 300); ctx.lineTo(-200, 300);
      for (let i = 0; i <= 24; i++) { const a = -i / 24 * Math.PI * 2; (i ? ctx.lineTo : ctx.moveTo).call(ctx, s[0] + Math.cos(a) * r, s[1] + Math.sin(a) * r); }
      ctx.clip('evenodd');
    }
  }
  ctx.beginPath(); outline();
  ctx.strokeStyle = shape?.stroke || '#351710'; ctx.lineWidth = USAGI_LIMB_RIG.outline;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
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

// Hook: before parts on each action layer (replaces the connector pass).
function paintLimbsBefore(ctx, { artwork, data, layer }) {
  let painted = false;
  for (const side of ['l', 'r']) {
    const intent = intentFor(artwork, side, data); if (!intent) continue;
    const where = limbLayer(artwork, side, intent);
    const partLayer = data.parts.find(p => p.bone === `hand_${side}`)?.layer;
    const wanted = where === 'back' ? 'back' : where === 'pre-part' ? partLayer : null;
    if (wanted !== layer) continue;
    if (intent.kind === 'support') {
      // Support tubes sit under the authored paw and grow continuously from the socket.
      painted = paintSupport(ctx, artwork, data, side) || painted;
    } else painted = paintLimb(ctx, artwork, data, side) || painted;
  }
  return painted;
}
function paintSupport(ctx, artwork, data, side) { return paintLimb(ctx, artwork, data, side); }

// Hook: in place of an authored hand part. true = handled (painted or deliberately skipped).
function paintLimbPart(ctx, { part, data, artwork }) {
  const side = part?.bone === 'hand_l' ? 'l' : part?.bone === 'hand_r' ? 'r' : null;
  if (!side) return false;
  const intent = intentFor(artwork, side, data);
  if (!intent || intent.kind === 'support') return false;
  const where = limbLayer(artwork, side, intent, part);
  if (where !== 'part') return true; // painted on 'back' or 'under-cloth' already
  return paintLimb(ctx, artwork, data, side);
}

function paintLimbsUnderCloth(ctx, { artwork }) {
  const data = artwork?.rig?.views?.[artwork.drawnView];
  if (!data) return false;
  let painted = false;
  for (const side of ['l', 'r']) {
    const intent = intentFor(artwork, side, data);
    if (limbLayer(artwork, side, intent) === 'under-cloth') painted = paintLimb(ctx, artwork, data, side) || painted;
  }
  return painted;
}

// ---- trace (detectors) -----------------------------------------------------
function traceUsagiLimb(artwork, data, side) {
  const intent = intentFor(artwork, side, data), wrist = wristOf(artwork, data, side);
  if (!intent) return { mode: 'rest', len: 0, wrist };
  const g = limbGeometry(artwork, data, side, intent);
  if (intent.kind === 'support' && supportAmount(g) <= 0) return { mode: 'rest', len: 0, wrist };
  const visible = Math.hypot(g.to[0] - g.socket[0], g.to[1] - g.socket[1]);
  return { mode: 'limb', kind: intent.kind, len: +(visible * (intent.kind === 'support' ? supportAmount(g) : 1)).toFixed(3), wrist, elbow: g.elbow, retract: g.chain.retract, reached: g.chain.reached };
}

export { USAGI_LIMB_RIG, sockets, intentFor, limbGeometry, limbLayer, paintLimb, paintLimbsBefore, paintLimbPart,
  paintLimbsUnderCloth, traceUsagiLimb, bodyPolygon, behindBody, filters as usagiLimbFilters };
