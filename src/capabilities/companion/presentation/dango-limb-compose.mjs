'use strict';
// Contract-aware composer for the Dango limbs v2 package (COMPOSITION.md):
//  - fixed per-view/side shoulder (sockets[].worldRoot), 6 + 6 art-unit bones,
//    pre-baked segment directions; only allowed elbow pairs (<=150 deg);
//  - wrist = desired contact - (paw.grip - paw.root) of the selected frame;
//  - screen-side selection; quarter hold uses observed l/r palms (mirror:false),
//    other right-side frames reflect pixels and anchors (x' = width - x);
//  - shoulder coverage: upper-arm pixels in the proximal half-space are kept
//    only inside the side's body-coverage stencil; the body is never erased;
//  - paired elbow repair (mask -> patch) and the declared 225 wave interfaces;
//  - runtime view three-quarter(-right) reflects the whole three-quarter-left
//    placement about the measured anchor axis.
// Integer translation only; no rotation, no stretching.
import { DANGO_LIMB_RIG } from '../../../content/companion/dango-limbs.mjs';
import { angleOf, sideOf } from './dango-limb-assets.mjs';

const norm = a => ((a % 360) + 360) % 360;
const angDist = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

function poseFor(action) {
  const R = DANGO_LIMB_RIG;
  return R.poseByProp[action?.prop] || R.poseByMotion[action?.motion] || R.defaultPose;
}

// Final sampled coordinates own the contact; legacy endpoints can be palm centers.
// Only observed surface roles receive a normal. Free gestures retain authored axes.
function contactContract(hand, action) {
  if (hand.integrated) return null;
  const authored = hand.sourceContact;
  if (authored?.kind === 'continuous-hold'
    && (authored.sourcePoseId === 'hiccup-front-v1' && action?.id === 'hiccup'
      || ['sip-front-v2', 'sip-front-short-v1'].includes(authored.sourcePoseId) && action?.id === 'sip-tea') && [authored.target, authored.boundaryNormal].every(p =>
      Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    return { target: authored.target, pose: 'hold', role: 'continuous-hold', normal: authored.boundaryNormal,
      normalTolerance: 0, pass: 'front', sourcePoseId: authored.sourcePoseId,
      legacyHandleAxisSatisfied: authored.legacyHandleAxisSatisfied,
      opacity: Math.max(0, Math.min(1, hand.opacity ?? 1)) };
  }
  const target = hand.gripPoint || hand.points?.at(-1); if (!target) return null;
  let pose = poseFor(action), role = 'free', normal = null;
  if (action?.prop === 'document') {
    pose = hand.side === 'right' ? 'grip' : 'press';
    role = hand.side === 'right' ? 'shaft-grip' : 'surface-press';
  } else if (pose === 'support') role = 'planted-support';
  else if (pose === 'press') role = 'surface-press';
  else if (pose === 'grip') role = 'shaft-grip';
  else if (pose === 'hold') role = 'edge-hold';
  if (role === 'surface-press' || role === 'planted-support') normal = [0, 1];
  const pass = hand.pawOcclusion === 'behind-tool' ? 'before-tools' : 'front';
  return { target, pose, role, normal, normalTolerance: 22.5, pass,
    opacity: Math.max(0, Math.min(1, hand.opacity ?? 1)) };
}

function normalMatches(paw, mirror, contract) {
  if (!contract?.normal) return true;
  const n = paw.contactResolution?.projectedNormal; if (!n) return false;
  const x = mirror ? -n[0] : n[0], y = n[1], target = contract.normal;
  const cosine = (x * target[0] + y * target[1]) / (Math.hypot(x,y) * Math.hypot(...target));
  return cosine >= Math.cos((contract.normalTolerance ?? 22.5) * Math.PI / 180) - 1e-9;
}

function interfaceApplies(frame, plan) {
  const v = frame.verifiedPose, equal = (a,b) => a?.length === b?.length && a.every((n,i) => n === b[i]);
  return Boolean(v && !plan.pawMirror && !plan.mirrorArm && frame.sourcePaw === plan.paw.src
    && v.view === plan.view && v.side === plan.side && v.pawAngle === angleOf(plan.paw)
    && v.upperAngle === plan.joint.upperAngle && v.foreAngle === plan.joint.foreAngle
    && equal(v.fixedShoulder,plan.S) && equal(v.wristWorld,plan.W)
    && v.handLayer === (pawLayer(plan) === 'front' ? 'foreground' : 'background'));
}

function frameAt(list, angle) { return list.find(f => angleOf(f) === angle) || null; }

// Solve one hand in asset space. side: 'l' | 'r' (asset screen side).
function solveAsset(source, { view, side, target, pose, contract }) {
  const m = source.manifest(), J = source.joints();
  const S = m.sockets.find(s => s.kind === 'shoulder' && s.view === view && s.side === side)?.worldRoot;
  if (!S) return null;
  const mirrorArm = side === 'r';
  const ups = m.segments['arm-upper-l'].frames, fores = m.segments['arm-fore-l'].frames;
  const pawList = m.paws[pose]?.views?.[view] || [];
  const own = pawList.filter(f => sideOf(f) === side && f.semantic?.mirror === false);
  const pawCands = own.length ? own.map(f => ({ f, mirror: false, world: angleOf(f) }))
    : pawList.filter(f => sideOf(f) === 'l').map(f => ({ f, mirror: mirrorArm, world: mirrorArm ? 180 - angleOf(f) : angleOf(f) }));
  const allowedPaws = pawCands.filter(c => normalMatches(c.f, c.mirror, contract));
  if (!allowedPaws.length) return null;
  const vec = (f, mirror) => { const d = sub(f.tip, f.root); return mirror ? [-d[0], d[1]] : d; };
  let best = null;
  const candidates = [];
  for (const j of J.frames) {
    if (!j.allowedByBendLimit) continue;
    const U = frameAt(ups, j.upperAngle), F = frameAt(fores, j.foreAngle); if (!U || !F) continue;
    const E = add(S, vec(U, mirrorArm)), W = add(E, vec(F, mirrorArm));
    const axis = mirrorArm ? 180 - j.foreAngle : j.foreAngle;
    let paw = null; for (const c of allowedPaws) if (!paw || angDist(c.world, axis) < angDist(paw.world, axis)) paw = c;
    if (angDist(paw.world, axis) > 22.5 + 1e-9) continue;
    const g = sub(paw.f.grip, paw.f.root), contact = add(W, paw.mirror ? [-g[0], g[1]] : g);
    const error = Math.hypot(contact[0] - target[0], contact[1] - target[1]);
    const score = error + j.bendDegrees * 1e-4;
    const candidate = { score, error, S, E, W, contact, joint: j, U, F, paw: paw.f, pawMirror: paw.mirror, mirrorArm, view, side, pose };
    candidates.push(candidate);
    if (!best || error < best.error) best = candidate;
  }
  if (!best) return null;
  // Contact error has priority. Inspect real alpha only for equally accurate
  // branches; cache finite discrete compositions rather than scan every frame.
  for (const candidate of candidates.filter(c => Math.abs(c.error - best.error) < 1e-9)) {
    candidate.exposedArea = exposedArmArea(source, candidate);
    if (best.exposedArea == null || candidate.exposedArea < best.exposedArea
      || (candidate.exposedArea === best.exposedArea && candidate.score < best.score)) best = candidate;
  }
  return best;
}

// Runtime -> asset mapping, then solve.
function solveLimb(source, { view, side, target, pose, contract = null }) {
  const map = DANGO_LIMB_RIG.views[view]; if (!map) return null;
  const axis = map.reflectAxis;
  const assetSide = (side === 'left') !== Boolean(axis) ? 'l' : 'r';
  const t = axis ? [axis - target[0], target[1]] : target;
  const assetContract = axis && contract?.normal ? { ...contract, normal: [-contract.normal[0], contract.normal[1]] } : contract;
  const plan = solveAsset(source, { view: map.asset, side: assetSide, target: t, pose, contract: assetContract });
  return plan && { ...plan, runtimeView: view, reflectAxis: axis ?? null,
    contactWorld: axis ? [axis - plan.contact[0], plan.contact[1]] : plan.contact };
}

// ---- pixel composition (1x art units) ---------------------------------------
const BOX = { x: -24, y: -8, w: 120, h: 96 };
const buffer = () => ({ data: new Uint8ClampedArray(BOX.w * BOX.h * 4) });
function blit(buf, px, at, root, mirror, keep = null) {
  if (!px) return;
  const ox = Math.round(at[0] - (mirror ? px.width - root[0] : root[0])), oy = Math.round(at[1] - root[1]);
  for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) {
    const sx = mirror ? px.width - 1 - x : x, i = (y * px.width + sx) * 4; if (!px.data[i + 3]) continue;
    const wx = ox + x, wy = oy + y; if (keep && !keep(wx, wy)) continue;
    const bx = wx - BOX.x, by = wy - BOX.y; if (bx < 0 || by < 0 || bx >= BOX.w || by >= BOX.h) continue;
    const o = (by * BOX.w + bx) * 4; buf.data.set(px.data.subarray(i, i + 4), o);
  }
}
function repair(buf, mask, patch, at, root, mirror) {
  if (!mask || !patch) return;
  const ox = Math.round(at[0] - (mirror ? mask.width - root[0] : root[0])), oy = Math.round(at[1] - root[1]);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const sx = mirror ? mask.width - 1 - x : x, i = (y * mask.width + sx) * 4; if (!mask.data[i + 3]) continue;
    const bx = ox + x - BOX.x, by = oy + y - BOX.y; if (bx < 0 || by < 0 || bx >= BOX.w || by >= BOX.h) continue;
    const o = (by * BOX.w + bx) * 4; if (!buf.data[o + 3]) continue; // alpha union unchanged
    if (patch.data[i + 3]) buf.data.set(patch.data.subarray(i, i + 3), o);
  }
}
function composeLimb(source, plan, { outline = true } = {}) {
  const m = source.manifest(), P = id => source.pixels(id);
  const sock = m.sockets.find(s => s.kind === 'shoulder' && s.view === plan.view && s.side === plan.side);
  const stencil = P(sock.coverageStencil), sRoot = sock.root, S = plan.S, dirU = sub(plan.E, S);
  const inBody = (wx, wy) => {
    const x = wx - Math.round(S[0] - sRoot[0]), y = wy - Math.round(S[1] - sRoot[1]);
    const rect = sock.usefulLocalRect || [0, 0, stencil?.width || 0, stencil?.height || 0];
    if (!stencil || x < rect[0] || y < rect[1] || x >= rect[2] || y >= rect[3]) {
      // Transparent padding is unknown, not proof that the body is absent.
      return source.bodyAlpha?.(plan.view, wx + .5, wy + .5) ?? true;
    }
    return stencil.data[(y * stencil.width + x) * 4 + 3] > 0;
  };
  const proximalOk = (wx, wy) => ((wx + .5 - S[0]) * dirU[0] + (wy + .5 - S[1]) * dirU[1]) > 0 || inBody(wx, wy);
  const arm = buffer();
  blit(arm, P(plan.U.src), S, plan.U.root, plan.mirrorArm, proximalOk);
  blit(arm, P(plan.F.src), plan.E, plan.F.root, plan.mirrorArm);
  repair(arm, P(plan.joint.mask), P(plan.joint.patch), plan.E, plan.joint.root, plan.mirrorArm);
  const paw = buffer();
  blit(paw, P(plan.paw.src), plan.W, plan.paw.root, plan.pawMirror);
  for (const f of source.interfaces()?.frames || []) if (interfaceApplies(f, plan))
    repair(paw, P(f.mask), P(f.patch), plan.W, f.root, false);
  if (outline) closePawOutline(paw, arm, (x, y) => source.bodyAlpha?.(plan.view, x + .5, y + .5) ?? false);
  return { arm, paw, box: BOX, reflectAxis: plan.reflectAxis };
}
// Arm pixels hidden behind the body do not count as a visible join.
// Palms are authored with an open edge where they met the old body contact.
// Composed over the body that edge reads as a ghost blob, so every palm pixel
// bordering empty space (neither palm nor arm) takes the palm's own darkest
// (outline) colour. One pixel, inside the silhouette: no growth, no new hue.
function closePawOutline(paw, arm, underBody) {
  const d = paw.data, a = arm.data, W = BOX.w, H = BOX.h;
  let dark = null, lum = Infinity;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) {
    const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; if (l < lum) { lum = l; dark = [d[i], d[i + 1], d[i + 2]]; }
  }
  if (!dark || lum > 80) return;
  const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || (!d[(y * W + x) * 4 + 3] && (!a[(y * W + x) * 4 + 3] || underBody(x + BOX.x, y + BOX.y)));
  const edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (!d[i + 3]) continue;
    if (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1)) edge.push(i);
  }
  for (const i of edge) { d[i] = dark[0]; d[i + 1] = dark[1]; d[i + 2] = dark[2]; d[i + 3] = 255; }
}

// Quarter view: asset 'l' is the far side (behind body), 'r' near (front).
function pawLayer(plan) { return plan.view === 'three-quarter-left' && plan.side === 'l' ? 'back' : 'front'; }

const exposureCaches = new WeakMap();
function exposedArmArea(source, plan) {
  if (!source.bodyAlpha) return Infinity;
  let cache = exposureCaches.get(source);
  if (!cache) { cache = new Map(); exposureCaches.set(source, cache); }
  const key = `${plan.view}|${plan.side}|${plan.joint.key}|${plan.paw.src}|${plan.pawMirror}`;
  if (cache.has(key)) return cache.get(key);
  const { arm, paw } = composeLimb(source, plan); let count = 0;
  for (let y = 0; y < BOX.h; y++) for (let x = 0; x < BOX.w; x++) {
    const i = (y * BOX.w + x) * 4 + 3; if (!arm.data[i]) continue;
    const body = source.bodyAlpha(plan.view, x + BOX.x + .5, y + BOX.y + .5);
    if (body == null) { count = Infinity; break; }
    if (!body && !(pawLayer(plan) === 'front' && paw.data[i])) count++;
  }
  cache.set(key, count); if (cache.size > 1024) cache.delete(cache.keys().next().value);
  return count;
}

// ---- runtime painter ---------------------------------------------------------
import { recolorRasterPixels } from './raster/palette.mjs';
function createDangoLimbPainter({ source, createSurface }) {
  const plans = new Map(), surfaces = new Map();
  function plan(view, hand, action) {
    const contract = contactContract(hand, action); if (!contract) return null;
    const { target, pose } = contract, key = JSON.stringify([view, hand.side, pose, target, contract.normal, contract.normalTolerance, hand.layer]);
    if (!plans.has(key)) {
      const p = solveLimb(source, { view, side: hand.side, target, pose, contract });
      // Runtime quarter actions hold props with the leading hand, which the
      // package defines as the far (behind-body) quarter side: composing it
      // would hide the grip behind body and prop, so that side stays legacy.
      plans.set(key, p && p.error <= DANGO_LIMB_RIG.maxContactError && pawLayer(p) === 'front'
        && hand.layer !== 'back' ? p : null);
      if (plans.size > 512) plans.delete(plans.keys().next().value);
    }
    return plans.get(key);
  }
  function surfaceFor(p, part, palette) {
    const key = `${p.view}|${p.side}|${p.pose}|${p.joint.key}|${p.paw.src}|${p.pawMirror}|${part}|${JSON.stringify(palette)}`;
    let entry = surfaces.get(key);
    if (!entry) {
      const c = composeLimb(source, p), buf = c[part], data = new Uint8ClampedArray(buf.data);
      if (palette?.[2] && palette[2] !== '#f7768e') recolorRasterPixels(data, palette, 'body');
      const surface = createSurface(BOX.w, BOX.h), ctx = surface.getContext('2d');
      const img = ctx.createImageData(BOX.w, BOX.h); img.data.set(data); ctx.putImageData(img, 0, 0);
      entry = surface; surfaces.set(key, entry);
      if (surfaces.size > 256) surfaces.delete(surfaces.keys().next().value);
    }
    return entry;
  }
  // layer: 'back' paints arms (behind the body) and far quarter palms;
  // 'front' paints near/front palms. Returns the sides it drew.
  function paint(context, { view, hand, action, palette, layer, covered = false }) {
    const p = plan(view, hand, action), contract = contactContract(hand, action); if (!p || !contract || !contract.opacity) return false;
    const parts = layer === 'back' ? ['arm', ...(pawLayer(p) === 'back' ? ['paw'] : [])]
      : (pawLayer(p) === 'front' && layer === contract.pass ? ['paw'] : []);
    for (const part of parts) {
      if (part === 'paw' && covered) continue;
      const surface = surfaceFor(p, part, palette);
      context.save(); context.globalAlpha *= contract.opacity; context.imageSmoothingEnabled = false;
      if (p.reflectAxis != null) { context.translate(p.reflectAxis, 0); context.scale(-1, 1); }
      context.drawImage(surface, BOX.x, BOX.y, BOX.w, BOX.h);
      context.restore();
    }
    return true;
  }
  return Object.freeze({ plan, paint, stats: () => ({ plans: plans.size, surfaces: surfaces.size }),
    dispose() { plans.clear(); surfaces.clear(); exposureCaches.delete(source); } });
}

export { exposedArmArea, contactContract, interfaceApplies, createDangoLimbPainter, poseFor, solveLimb, composeLimb, pawLayer, BOX as DANGO_LIMB_BOX };
