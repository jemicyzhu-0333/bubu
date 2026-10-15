'use strict';
import { browserSurface } from './raster/paint.mjs';
// Dango limbs v2: loader, validator and readiness for the delivered package
// (assets/companion/dango/raster/limbs, "dango-limbs/1" manifest version 2,
// contract COMPOSITION.md). Lifecycle:
//   idle -> loading -> ready | absent | invalid | not-ready (runtimeReady=false
//   and the host does not implement this contract version) | failed (image)
//   dispose is terminal: cancel pending reads and release the pixel group.
// Anything but `ready` keeps the legacy hands (fallback).
import { DANGO_LIMB_RIG } from '../../../content/companion/dango-limbs.mjs';

const ASSET_VIEWS = ['front', 'three-quarter-left', 'back'];
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPair = v => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isSize = v => isPair(v) && v.every(n => Number.isInteger(n) && n > 0);
const inside = (p, size) => p[0] >= 0 && p[1] >= 0 && p[0] <= size[0] && p[1] <= size[1];
const angleOf = f => (isNum(f?.angle) ? f.angle : f?.semantic?.nominalAngle);
const sideOf = f => f?.semantic?.side || 'l';

function validateDangoLimbManifest(json, { joints = null, interfaces = null } = {}) {
  const errors = [], err = (path, msg) => errors.push(`${path}: ${msg}`);
  const srcs = new Set(), add = s => { if (typeof s === 'string') srcs.add(s); };
  if (!json || typeof json !== 'object') return { ok: false, errors: ['root: not an object'], sources: [] };
  if (json.schema !== DANGO_LIMB_RIG.schema) err('schema', `expected ${DANGO_LIMB_RIG.schema}`);
  if (!Number.isInteger(json.version) || json.version < 1) err('version', 'positive integer required');
  else if (!DANGO_LIMB_RIG.contractVersions.includes(json.version)) err('version', `contract v${json.version} not implemented (have ${DANGO_LIMB_RIG.contractVersions})`);
  if (!(Number.isInteger(json.grid?.unitPx) && json.grid.unitPx > 0)) err('grid.unitPx', 'positive integer required');
  if (!Array.isArray(json.grid?.palette) || json.grid.palette.length < 2) err('grid.palette', 'palette required');
  const arm = json.bones?.arm;
  if (!arm || !isNum(arm.upper) || !isNum(arm.fore)) err('bones.arm', 'upper and fore lengths required');
  const sprite = (path, f, extra = []) => {
    if (!f || typeof f !== 'object') return err(path, 'missing');
    if (typeof f.src !== 'string' || !/\.png$/.test(f.src) || f.src.includes('..')) err(`${path}.src`, 'relative .png required'); else add(f.src);
    if (!isSize(f.size)) err(`${path}.size`, 'integer [w,h] required');
    for (const k of ['root', ...extra]) {
      if (!isPair(f[k])) err(`${path}.${k}`, '[x,y] required');
      else if (isSize(f.size) && !inside(f[k], f.size)) err(`${path}.${k}`, 'outside the sprite');
    }
  };
  const frames = (path, list, extra) => {
    if (!Array.isArray(list) || !list.length) return err(path, 'at least one frame required');
    const seen = new Set();
    list.forEach((f, i) => {
      sprite(`${path}[${i}]`, f, extra);
      const a = angleOf(f), key = `${sideOf(f)}:${a}`;
      if (!isNum(a)) err(`${path}[${i}].angle`, 'angle or semantic.nominalAngle required');
      else if (seen.has(key)) err(`${path}[${i}].angle`, 'duplicate angle'); else seen.add(key);
    });
  };
  // Sockets: array of { kind, view, side, worldRoot, coverageStencil }.
  if (!Array.isArray(json.sockets)) err('sockets', 'array required');
  else {
    for (const view of ASSET_VIEWS) for (const side of ['l', 'r']) {
      const s = json.sockets.find(k => k.kind === 'shoulder' && k.view === view && k.side === side);
      if (!s) { err(`sockets.shoulder.${view}.${side}`, 'missing'); continue; }
      if (!isPair(s.worldRoot)) err(`sockets.shoulder.${view}.${side}.worldRoot`, 'required');
      sprite(`sockets.shoulder.${view}.${side}`, s);
      if (s.maskRole !== 'attachment-coverage') err(`sockets.shoulder.${view}.${side}.maskRole`, 'attachment-coverage expected');
      if (typeof s.coverageStencil !== 'string') err(`sockets.shoulder.${view}.${side}.coverageStencil`, 'required'); else add(s.coverageStencil);
      if (s.sourceBody) {
        const body = s.sourceBody;
        if (typeof body.src !== 'string' || !body.src.endsWith('.png') || body.src.includes('..')) err(`sockets.shoulder.${view}.${side}.sourceBody`, 'safe relative .png required');
        else if (!Array.isArray(body.rect) || body.rect.length !== 4 || !body.rect.every(isNum) || body.rect[2] <= 0 || body.rect[3] <= 0) err(`sockets.shoulder.${view}.${side}.sourceBody`, 'valid art rectangle required');
        else add(body.src);
      }
    }
  }
  for (const k of ['arm-upper-l', 'arm-fore-l']) frames(`segments.${k}.frames`, json.segments?.[k]?.frames, ['tip']);
  if (!json.paws || !Object.keys(json.paws).length) err('paws', 'at least one pose required');
  else for (const [pose, p] of Object.entries(json.paws)) for (const [view, list] of Object.entries(p?.views || {})) {
    if (!ASSET_VIEWS.includes(view)) err(`paws.${pose}.views.${view}`, 'unknown view');
    frames(`paws.${pose}.views.${view}`, list, ['grip']);
  }
  if (joints) {
    if (joints.schema !== 'dango-elbow-pairs/2') err('joints.schema', 'dango-elbow-pairs/2 expected');
    for (const [i, j] of (joints.frames || []).entries()) {
      if (!isNum(j.upperAngle) || !isNum(j.foreAngle) || typeof j.allowedByBendLimit !== 'boolean') err(`joints[${i}]`, 'angles/allowed required');
      if (j.allowedByBendLimit) { if (!isPair(j.root)) err(`joints[${i}].root`, 'required'); add(j.mask); add(j.patch); }
    }
  } else err('extensions.jointPairs', 'joint pairs not loaded');
  if (interfaces) for (const f of interfaces.frames || []) { add(f.mask); add(f.patch); }
  const ready = json.extensions?.runtimeReady === true;
  return { ok: !errors.length, errors, sources: [...srcs], runtimeReady: ready };
}

async function defaultLoadJson(url, { signal } = {}) {
  if (typeof fetch !== 'function') return null;
  const res = await fetch(url, { signal }); if (!res.ok) return null; return res.json();
}

// acceptContract: the host declares it implements COMPOSITION.md for this
// manifest version (wrist/contact, side selection, coverage without body
// (pixels are read once at load: 1x art units, tiny)
function defaultReadPixels(image) {
  const s = browserSurface(image.width, image.height), c = s?.getContext('2d'); if (!c) return null;
  c.drawImage(image, 0, 0); return c.getImageData(0, 0, image.width, image.height);
}
// erasure, paired elbow repair, conditional interfaces). Without it, a
// package marked runtimeReady=false stays inactive ('not-ready').
function createDangoLimbSource({ baseUrl, loadJson = defaultLoadJson, loadImage, readPixels = defaultReadPixels,
  manifestPath = DANGO_LIMB_RIG.manifestPath, acceptContract = null } = {}) {
  let state = 'idle', manifest = null, joints = null, interfaces = null, errors = [], pixels = new Map(), pending = null;
  const controller = new AbortController();
  const release = value => value?.close?.();
  const clear = () => { for (const value of pixels.values()) release(value); pixels.clear(); manifest = joints = interfaces = null; };
  const root = new URL(manifestPath, baseUrl).href, dir = new URL('./', root).href;
  const json = rel => Promise.resolve().then(() => controller.signal.aborted ? null
    : loadJson(new URL(rel, dir).href, { signal: controller.signal })).catch(() => null);
  function start() {
    if (state === 'disposed') return Promise.resolve(state);
    if (pending) return pending;
    state = 'loading';
    const cancelled = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(state), { once: true }));
    const loading = json(root.slice(dir.length)).then(async m => {
      if (controller.signal.aborted) return state;
      if (!m) { state = 'absent'; return state; }
      const [j, i] = await Promise.all([json(m.extensions?.jointPairs || 'joints/elbow.json'), json(m.extensions?.poseRootInterfaces || 'interfaces/interfaces.json')]);
      if (controller.signal.aborted) return state;
      const v = validateDangoLimbManifest(m, { joints: j, interfaces: i });
      if (!v.ok) { state = 'invalid'; errors = v.errors; return state; }
      if (!v.runtimeReady && acceptContract !== m.version) { state = 'not-ready'; errors = ['extensions.runtimeReady=false and host has not accepted this contract version']; return state; }
      try {
        await Promise.all(v.sources.map(async src => {
          const image = await loadImage(new URL(src, dir).href, { signal: controller.signal });
          if (controller.signal.aborted) { release(image); return; }
          if (!image) throw Error(`empty ${src}`);
          let value;
          try {
            value = readPixels ? readPixels(image) : image;
            if (!value || readPixels && (!isSize([value.width, value.height])
              || !(value.data instanceof Uint8ClampedArray || value.data instanceof Uint8Array)
              || value.data.length !== value.width * value.height * 4)) throw Error(`invalid pixels ${src}`);
          } finally { if (readPixels) release(image); }
          pixels.set(src, value);
        }));
        if (!controller.signal.aborted) { manifest = m; joints = j; interfaces = i; state = 'ready'; }
      } catch (e) {
        if (state !== 'disposed') { state = 'failed'; errors = [`image: ${e?.message || e}`]; controller.abort(); clear(); }
      }
      return state;
    });
    pending = Promise.race([loading, cancelled]);
    return pending;
  }
  // Full canonical alpha resolves the stencil's deliberately unknown margins.
  // Inputs are asset-view art-space pixel centers, never runtime-reflected twice.
  function bodyAlpha(view, wx, wy) {
    if (state !== 'ready' || !isNum(wx) || !isNum(wy)) return null;
    const body = manifest.sockets.find(s => s.kind === 'shoulder' && s.view === view)?.sourceBody;
    const image = body && pixels.get(body.src);
    if (!image?.data || !isNum(image.width) || !isNum(image.height)) return null;
    const [x, y, w, h] = body.rect;
    const px = Math.floor((wx - x) * image.width / w), py = Math.floor((wy - y) * image.height / h);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return false;
    return image.data[(py * image.width + px) * 4 + 3] > 0;
  }
  return Object.freeze({
    start, ready: start, bodyAlpha,
    state: () => state, errors: () => errors,
    manifest: () => (state === 'ready' ? manifest : null),
    joints: () => (state === 'ready' ? joints : null),
    interfaces: () => (state === 'ready' ? interfaces : null),
    pixels: src => state === 'ready' ? pixels.get(src) || null : null,
    image: src => state === 'ready' ? pixels.get(src) || null : null,
    dispose() { if (state === 'disposed') return; state = 'disposed'; controller.abort(); clear(); }
  });
}

export { validateDangoLimbManifest, createDangoLimbSource, ASSET_VIEWS as DANGO_LIMB_VIEWS, angleOf, sideOf };
