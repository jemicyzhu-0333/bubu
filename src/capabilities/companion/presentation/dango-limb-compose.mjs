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

function frameAt(list, angle) { return list.find(f => angleOf(f) === angle) || null; }

// Solve one hand in asset space. side: 'l' | 'r' (asset screen side).
function solveAsset(source, { view, side, target, pose }) {
  const m = source.manifest(), J = source.joints();
  const S = m.sockets.find(s => s.kind === 'shoulder' && s.view === view && s.side === side)?.worldRoot;
  if (!S) return null;
  const mirrorArm = side === 'r';
  const ups = m.segments['arm-upper-l'].frames, fores = m.segments['arm-fore-l'].frames;
  const pawList = m.paws[pose]?.views?.[view] || [];
  const own = pawList.filter(f => sideOf(f) === side && f.semantic?.mirror === false);
  const pawCands = own.length ? own.map(f => ({ f, mirror: false, world: angleOf(f) }))
    : pawList.filter(f => sideOf(f) === 'l').map(f => ({ f, mirror: mirrorArm, world: mirrorArm ? 180 - angleOf(f) : angleOf(f) }));
  if (!pawCands.length) return null;
  const vec = (f, mirror) => { const d = sub(f.tip, f.root); return mirror ? [-d[0], d[1]] : d; };
  let best = null;
  for (const j of J.frames) {
    if (!j.allowedByBendLimit) continue;
    const U = frameAt(ups, j.upperAngle), F = frameAt(fores, j.foreAngle); if (!U || !F) continue;
    const E = add(S, vec(U, mirrorArm)), W = add(E, vec(F, mirrorArm));
    const axis = mirrorArm ? 180 - j.foreAngle : j.foreAngle;
    let paw = null; for (const c of pawCands) if (!paw || angDist(c.world, axis) < angDist(paw.world, axis)) paw = c;
    const g = sub(paw.f.grip, paw.f.root), contact = add(W, paw.mirror ? [-g[0], g[1]] : g);
    const error = Math.hypot(contact[0] - target[0], contact[1] - target[1]);
    const score = error + j.bendDegrees * 1e-4;
    if (!best || score < best.score) best = { score, error, S, E, W, contact, joint: j, U, F, paw: paw.f, pawMirror: paw.mirror, mirrorArm };
  }
  return best && { ...best, view, side, pose };
}

// Runtime -> asset mapping, then solve.
function solveLimb(source, { view, side, target, pose }) {
  const map = DANGO_LIMB_RIG.views[view]; if (!map) return null;
  const axis = map.reflectAxis;
  const assetSide = (side === 'left') !== Boolean(axis) ? 'l' : 'r';
  const t = axis ? [axis - target[0], target[1]] : target;
  const plan = solveAsset(source, { view: map.asset, side: assetSide, target: t, pose });
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
function composeLimb(source, plan) {
  const m = source.manifest(), P = id => source.pixels(id);
  const sock = m.sockets.find(s => s.kind === 'shoulder' && s.view === plan.view && s.side === plan.side);
  const stencil = P(sock.coverageStencil), sRoot = sock.root, S = plan.S, dirU = sub(plan.E, S);
  const inBody = (wx, wy) => {
    const x = wx - Math.round(S[0] - sRoot[0]), y = wy - Math.round(S[1] - sRoot[1]);
    if (!stencil || x < 0 || y < 0 || x >= stencil.width || y >= stencil.height) return false;
    return stencil.data[(y * stencil.width + x) * 4 + 3] > 0;
  };
  const proximalOk = (wx, wy) => ((wx + .5 - S[0]) * dirU[0] + (wy + .5 - S[1]) * dirU[1]) > 0 || inBody(wx, wy);
  const arm = buffer();
  blit(arm, P(plan.U.src), S, plan.U.root, plan.mirrorArm, proximalOk);
  blit(arm, P(plan.F.src), plan.E, plan.F.root, plan.mirrorArm);
  repair(arm, P(plan.joint.mask), P(plan.joint.patch), plan.E, plan.joint.root, plan.mirrorArm);
  const paw = buffer();
  blit(paw, P(plan.paw.src), plan.W, plan.paw.root, plan.pawMirror);
  for (const f of source.interfaces()?.frames || []) if (!plan.pawMirror && f.sourcePaw === plan.paw.src)
    repair(paw, P(f.mask), P(f.patch), plan.W, f.root, false);
  return { arm, paw, box: BOX, reflectAxis: plan.reflectAxis };
}

// Quarter view: asset 'l' is the far side (behind body), 'r' near (front).
function pawLayer(plan) { return plan.view === 'three-quarter-left' && plan.side === 'l' ? 'back' : 'front'; }

// ---- runtime painter ---------------------------------------------------------
import { recolorRasterPixels } from './raster/palette.mjs';
function createDangoLimbPainter({ source, createSurface }) {
  const plans = new Map(), surfaces = new Map();
  function plan(view, hand, action) {
    const target = hand.points?.at(-1) || hand.gripPoint; if (!target) return null;
    const pose = poseFor(action), key = `${view}|${hand.side}|${pose}|${target.map(v => v.toFixed(2))}`;
    if (!plans.has(key)) {
      const p = solveLimb(source, { view, side: hand.side, target, pose });
      // Runtime quarter actions hold props with the leading hand, which the
      // package defines as the far (behind-body) quarter side: composing it
      // would hide the grip behind body and prop, so that side stays legacy.
      plans.set(key, p && p.error <= DANGO_LIMB_RIG.maxContactError && pawLayer(p) === 'front' ? p : null);
      if (plans.size > 512) plans.delete(plans.keys().next().value);
    }
    return plans.get(key);
  }
  function surfaceFor(p, part, palette) {
    const key = `${p.view}|${p.side}|${p.pose}|${p.joint.key}|${p.paw.src}|${p.pawMirror}|${part}|${palette?.[2]}`;
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
  function paint(context, { view, hand, action, palette, layer }) {
    const p = plan(view, hand, action); if (!p) return false;
    const parts = layer === 'back' ? ['arm', ...(pawLayer(p) === 'back' ? ['paw'] : [])] : (pawLayer(p) === 'front' ? ['paw'] : []);
    for (const part of parts) {
      const surface = surfaceFor(p, part, palette);
      context.save(); context.imageSmoothingEnabled = false;
      if (p.reflectAxis != null) { context.translate(p.reflectAxis, 0); context.scale(-1, 1); }
      context.drawImage(surface, BOX.x, BOX.y, BOX.w, BOX.h);
      context.restore();
    }
    return true;
  }
  return Object.freeze({ plan, paint });
}

export { createDangoLimbPainter, poseFor, solveLimb, composeLimb, pawLayer, BOX as DANGO_LIMB_BOX };
