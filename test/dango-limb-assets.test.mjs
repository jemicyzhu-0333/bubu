import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDangoLimbManifest, createDangoLimbSource } from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
import { solveLimb, composeLimb, createDangoLimbPainter, DANGO_LIMB_BOX as B } from '../src/capabilities/companion/presentation/dango-limb-compose.mjs';
import { DANGO_LIMB_RIG } from '../src/content/companion/dango-limbs.mjs';

const dir = new URL('../assets/companion/dango/raster/limbs/', import.meta.url);
const read = rel => JSON.parse(fs.readFileSync(new URL(rel, dir)));
const M = read('limbs.json'), J = read('joints/elbow.json'), I = read('interfaces/interfaces.json');
const base = new URL('../assets/companion/dango/raster/', import.meta.url).href;
const loadJson = async u => JSON.parse(fs.readFileSync(fileURLToPath(u)));
// Pixel-free fake: every image is a 1x1 opaque dot (enough for lifecycle/solver).
const loadImage = async src => ({ src, width: 1, height: 1 });
const readPixels = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) });

test('the shipped v2 package validates with no errors', () => {
  const v = validateDangoLimbManifest(M, { joints: J, interfaces: I });
  assert.deepEqual(v.errors, []); assert.equal(v.runtimeReady, false);
});

test('validator reports concrete contract errors', () => {
  const bad = structuredClone(M); bad.schema = 'x'; bad.sockets = bad.sockets.filter(s => !(s.view === 'front' && s.side === 'l'));
  const e = validateDangoLimbManifest(bad, { joints: J, interfaces: I }).errors.join('\n');
  assert.match(e, /schema/); assert.match(e, /front/);
});

test('lifecycle: absent / not-ready (runtimeReady=false) / ready only when the host accepts v2', async () => {
  assert.equal(await createDangoLimbSource({ baseUrl: base, loadJson: async () => null, loadImage }).start(), 'absent');
  const off = createDangoLimbSource({ baseUrl: base, loadJson, loadImage, readPixels });
  assert.equal(await off.start(), 'not-ready'); assert.equal(off.manifest(), null);
  const on = createDangoLimbSource({ baseUrl: base, loadJson, loadImage, readPixels, acceptContract: 2 });
  assert.equal(await on.start(), 'ready'); assert.equal(on.manifest().version, 2);
});

test('production host keeps the contract inactive until explicitly accepted', () => {
  assert.equal(DANGO_LIMB_RIG.hostAcceptsContract, null);
});

const ready = (async () => { const s = createDangoLimbSource({ baseUrl: base, loadJson, loadImage, readPixels, acceptContract: 2 }); await s.start(); return s; })();

test('solver: fixed shoulder, allowed elbow pair, wrist = contact - (grip - root)', async () => {
  const s = await ready, p = solveLimb(s, { view: 'front', side: 'left', target: [20, 52], pose: 'hold' });
  assert.deepEqual(p.S, [4.5, 45.5]); assert.ok(p.joint.allowedByBendLimit);
  assert.ok(p.error <= DANGO_LIMB_RIG.maxContactError);
  const g = [p.paw.grip[0] - p.paw.root[0], p.paw.grip[1] - p.paw.root[1]];
  assert.deepEqual(p.contact, [p.W[0] + g[0], p.W[1] + g[1]]);
});

test('runtime three-quarter reflects the three-quarter-left package about x=66', async () => {
  const s = await ready, p = solveLimb(s, { view: 'three-quarter', side: 'left', target: [50, 50], pose: 'grip' });
  assert.equal(p.view, 'three-quarter-left'); assert.equal(p.side, 'r'); assert.equal(p.reflectAxis, 66);
  assert.equal(p.contactWorld[0], 66 - p.contact[0]);
});

test('painter gate: unreachable contacts and quarter far palms stay legacy', async () => {
  const s = await ready, painter = createDangoLimbPainter({ source: s, createSurface: () => null });
  assert.equal(painter.plan('front', { side: 'left', points: [[0, 0], [90, 90]] }, { prop: 'cup' }), null);
  assert.ok(painter.plan('front', { side: 'left', points: [[0, 0], [20, 52]] }, { prop: 'cup' }));
  // runtime right hand in three-quarter -> asset far (l) side -> behind body -> legacy.
  const far = solveLimb(s, { view: 'three-quarter', side: 'right', target: [66 - 2.5, 40], pose: 'grip' });
  assert.equal(far.side, 'l');
  assert.equal(painter.plan('three-quarter', { side: 'right', points: [[0, 0], far.contactWorld] }, { prop: 'broom' }), null);
});

test('coverage: proximal upper-arm pixels use valid stencil and canonical body beyond it', async () => {
  const sock = M.sockets.find(x => x.view === 'front' && x.side === 'l');
  const stencilOn = new Set();
  const s = createDangoLimbSource({ baseUrl: base, loadJson, loadImage: async src => ({ src, width: 25, height: 25 }), acceptContract: 2,
    readPixels: img => { const d = new Uint8ClampedArray(img.width * img.height * 4);
      const stencil = img.src.endsWith(sock.coverageStencil);
      for (let i = 0; i < img.width * img.height; i++) if (!stencil || (i % 25) >= 12) { d[i * 4 + 3] = 255; if (stencil) stencilOn.add(i); }
      return { width: img.width, height: img.height, data: d }; } });
  await s.start();
  const p = solveLimb(s, { view: 'front', side: 'left', target: [20, 52], pose: 'hold' });
  const c = composeLimb(s, { ...p, F: { ...p.F, src: '__none__' }, joint: { ...p.joint, mask: null } });
  const dir = [p.E[0] - p.S[0], p.E[1] - p.S[1]], off = [Math.round(p.S[0] - sock.root[0]), Math.round(p.S[1] - sock.root[1])];
  for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
    if (!c.arm.data[(y * B.w + x) * 4 + 3]) continue;
    const wx = x + B.x, wy = y + B.y;
    if ((wx + .5 - p.S[0]) * dir[0] + (wy + .5 - p.S[1]) * dir[1] > 0) continue;
    const sx = wx - off[0], sy = wy - off[1];
    const [x0,y0,x1,y1] = sock.usefulLocalRect;
    if (sx >= x0 && sx < x1 && sy >= y0 && sy < y1) assert.ok(sx >= 12, `proximal pixel ${wx},${wy} outside valid stencil coverage`);
    else assert.equal(s.bodyAlpha(p.view, wx + .5, wy + .5), true, `proximal pixel ${wx},${wy} outside canonical body`);
  }
});
