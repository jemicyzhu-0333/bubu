'use strict';
// Dango limbs v2 production loop: limbs.json loader + full validator, image
// readiness, and an integer-pixel painter. Lifecycle:
//   idle -> loading -> ready | absent (no limbs.json) | invalid (schema) | failed (an image failed)
// Anything but `ready` keeps the legacy paw sprites drawing (fallback).
import { DANGO_LIMB_RIG } from '../../../content/companion/dango-limbs.mjs';

const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPair = v => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isSize = v => isPair(v) && v.every(n => Number.isInteger(n) && n > 0);
const inside = (p, size) => p[0] >= 0 && p[1] >= 0 && p[0] <= size[0] && p[1] <= size[1];

function validateDangoLimbManifest(json) {
  const errors = [], err = (path, msg) => errors.push(`${path}: ${msg}`);
  const srcs = new Set();
  if (!json || typeof json !== 'object') return { ok: false, errors: ['root: not an object'], sources: [] };
  if (json.schema !== DANGO_LIMB_RIG.schema) err('schema', `expected ${DANGO_LIMB_RIG.schema}`);
  if (!Number.isInteger(json.version) || json.version < 1) err('version', 'positive integer required');
  const grid = json.grid || {};
  if (!(Number.isInteger(grid.unitPx) && grid.unitPx > 0)) err('grid.unitPx', 'positive integer required');
  if (!isNum(grid.outline)) err('grid.outline', 'number required');
  const arm = json.bones?.arm;
  if (!arm || !isNum(arm.upper) || !isNum(arm.fore)) err('bones.arm', 'upper and fore lengths required');
  const sprite = (path, f, extra = []) => {
    if (!f || typeof f !== 'object') return err(path, 'missing');
    if (typeof f.src !== 'string' || !/\.png$/.test(f.src) || f.src.includes('..')) err(`${path}.src`, 'relative .png required'); else srcs.add(f.src);
    if (!isSize(f.size)) err(`${path}.size`, 'integer [w,h] required');
    for (const k of ['root', ...extra]) {
      if (!isPair(f[k])) err(`${path}.${k}`, '[x,y] required');
      else if (isSize(f.size) && !inside(f[k], f.size)) err(`${path}.${k}`, 'outside the sprite');
    }
  };
  const frames = (path, list, extra) => {
    if (!Array.isArray(list) || !list.length) return err(path, 'at least one frame required');
    const seen = new Set();
    list.forEach((f, i) => { sprite(`${path}[${i}]`, f, extra); if (!isNum(f?.angle)) err(`${path}[${i}].angle`, 'number required');
      else if (seen.has(f.angle)) err(`${path}[${i}].angle`, 'duplicate angle'); else seen.add(f.angle); });
  };
  for (const side of ['l']) {
    const s = json.sockets?.[`shoulder-${side}`];
    if (!s) err(`sockets.shoulder-${side}`, 'missing');
    else for (const [view, v] of Object.entries(s)) {
      if (!VIEWS.includes(view)) err(`sockets.shoulder-${side}.${view}`, 'unknown view');
      sprite(`sockets.shoulder-${side}.${view}`, v);
      if (typeof v?.mask !== 'string') err(`sockets.shoulder-${side}.${view}.mask`, 'mask required'); else srcs.add(v.mask);
      if (typeof v?.bodyAnchor !== 'string') err(`sockets.shoulder-${side}.${view}.bodyAnchor`, 'required');
    }
    frames(`segments.arm-upper-${side}.frames`, json.segments?.[`arm-upper-${side}`]?.frames, ['tip']);
    frames(`segments.arm-fore-${side}.frames`, json.segments?.[`arm-fore-${side}`]?.frames, ['tip']);
  }
  if (!json.paws || typeof json.paws !== 'object' || !Object.keys(json.paws).length) err('paws', 'at least one pose required');
  else for (const [pose, p] of Object.entries(json.paws)) {
    if (!p?.views || !Object.keys(p.views).length) { err(`paws.${pose}.views`, 'required'); continue; }
    for (const [view, list] of Object.entries(p.views)) {
      if (!VIEWS.includes(view)) err(`paws.${pose}.views.${view}`, 'unknown view');
      frames(`paws.${pose}.views.${view}`, list, pose === 'grip' ? ['grip'] : []);
    }
  }
  return { ok: !errors.length, errors, sources: [...srcs] };
}

async function defaultLoadJson(url) {
  if (typeof fetch !== 'function') return null;
  const res = await fetch(url); if (!res.ok) return null; return res.json();
}

function createDangoLimbSource({ baseUrl, loadJson = defaultLoadJson, loadImage, manifestPath = DANGO_LIMB_RIG.manifestPath } = {}) {
  let state = 'idle', manifest = null, errors = [], images = new Map(), pending = null;
  const root = new URL(manifestPath, baseUrl).href, dir = new URL('./', root).href;
  function start() {
    if (pending) return pending;
    state = 'loading';
    pending = Promise.resolve().then(() => loadJson(root)).catch(() => null).then(async json => {
      if (!json) { state = 'absent'; return state; }
      const v = validateDangoLimbManifest(json);
      if (!v.ok) { state = 'invalid'; errors = v.errors; return state; }
      try {
        const loaded = await Promise.all(v.sources.map(async src => [src, await loadImage(new URL(src, dir).href)]));
        if (loaded.some(([, img]) => !img)) throw Error('empty image');
        images = new Map(loaded); manifest = json; state = 'ready';
      } catch (e) { state = 'failed'; errors = [`image: ${e?.message || e}`]; images = new Map(); }
      return state;
    });
    return pending;
  }
  return Object.freeze({
    start, ready: start,
    state: () => state, errors: () => errors,
    manifest: () => (state === 'ready' ? manifest : null),
    image: src => images.get(src) || null
  });
}

// Integer-pixel placement: every sprite lands with its `root` pixel on the
// rounded joint (no rotation, no sub-pixel resampling). Right side mirrors.
function place(context, img, frame, at, mirror) {
  const x = Math.round(at[0]), y = Math.round(at[1]);
  context.save();
  if (mirror) { context.translate(x, y); context.scale(-1, 1); context.drawImage(img, -Math.round(frame.root[0]), -Math.round(frame.root[1]), frame.size[0], frame.size[1]); }
  else context.drawImage(img, x - Math.round(frame.root[0]), y - Math.round(frame.root[1]), frame.size[0], frame.size[1]);
  context.restore();
}

// Paint one hand's chain. Returns false (caller draws the legacy sprite) unless
// every needed image is ready.
function paintDangoLimb(context, hand, source, { view = 'front' } = {}) {
  const m = source?.manifest?.(), limb = hand?.limb;
  if (!m || !limb?.frames || limb.source !== 'limbs.json') return false;
  const { upper, fore, paw } = limb.frames, socket = m.sockets['shoulder-l']?.[view];
  const need = [upper, fore, paw, socket].filter(Boolean);
  if (need.length < 4 || need.some(f => !source.image(f.src)) || !source.image(socket.mask)) return false;
  const mirror = !!limb.frames.mirror, c = limb.chain;
  // Socket mask first: erase the body outline where the limb exits, then the socket.
  context.save(); context.globalCompositeOperation = 'destination-out';
  place(context, source.image(socket.mask), socket, limb.socket, mirror); context.restore();
  place(context, source.image(socket.src), socket, limb.socket, mirror);
  place(context, source.image(upper.src), upper, c.root, mirror);
  place(context, source.image(fore.src), fore, c.elbow, mirror);
  place(context, source.image(paw.src), paw, c.wrist, mirror);
  return true;
}

export { validateDangoLimbManifest, createDangoLimbSource, paintDangoLimb, VIEWS as DANGO_LIMB_VIEWS };
