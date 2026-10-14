import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDangoLimbSource } from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
import { solveLimb, composeLimb, pawLayer, createDangoLimbPainter, DANGO_LIMB_BOX } from '../src/capabilities/companion/presentation/dango-limb-compose.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { DANGO_LIMB_RIG } from '../src/content/companion/dango-limbs.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
const { createCanvas, loadImage } = createRequire(import.meta.url)('@napi-rs/canvas');
const load = url => loadImage(fileURLToPath(url));
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
const source = createDangoLimbSource({ baseUrl: DANGO_RASTER.baseUrl, acceptContract: 2,
  loadJson: async url => JSON.parse(fs.readFileSync(fileURLToPath(url))), loadImage: load,
  readPixels(image) { const c = createCanvas(image.width, image.height); c.getContext('2d').drawImage(image, 0, 0);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height); } });
await source.start();
assert.equal(source.state(), 'ready');
const cases = [
  { side: 'left', assetSide: 'l', target: [17.5, 45.5], shoulder: [2.5, 36.5], role: 'observed-far-left', layer: 'back' },
  { side: 'right', assetSide: 'r', target: [35.5, 48.5], shoulder: [52.5, 43.5], role: 'observed-near-right', layer: 'front' }
];
const reflect = p => [66 - p[0], p[1]];

test('quarter hold keeps independently authored near/far identity through world reflection', () => {
  const sourceHashes = new Set();
  for (const item of cases) {
    const left = solveLimb(source, { view: 'three-quarter-left', side: item.side, target: item.target, pose: 'hold' });
    assert.equal(left.error, 0); assert.equal(left.side, item.assetSide);
    assert.equal(left.paw.semantic.sideRole, item.role); assert.equal(left.pawMirror, false);
    assert.deepEqual(left.S, item.shoulder); assert.equal(pawLayer(left), item.layer);
    sourceHashes.add(left.paw.sourceSha256);
    for (const view of ['three-quarter-right', 'three-quarter']) {
      const right = solveLimb(source, { view, side: item.side === 'left' ? 'right' : 'left', target: reflect(item.target), pose: 'hold' });
      assert.equal(right.paw.src, left.paw.src); assert.equal(right.pawMirror, false);
      assert.deepEqual(right.S, left.S); assert.deepEqual(right.E, left.E); assert.deepEqual(right.W, left.W);
      assert.deepEqual(right.contactWorld, reflect(left.contactWorld));
      assert.equal(right.reflectAxis, 66); assert.equal(pawLayer(right), item.layer);
      const n = left.paw.contactResolution.projectedNormal;
      const normalPlan = solveLimb(source, { view, side: item.side === 'left' ? 'right' : 'left',
        target: reflect(item.target), pose: 'hold', contract: { normal: [-n[0], n[1]], normalTolerance: 0 } });
      assert.equal(normalPlan.paw.src, left.paw.src, 'contact normal must reflect with the whole pose');
    }
  }
  assert.equal(sourceHashes.size, 2, 'near/far cannot be one mirrored source');
});

test('quarter paw composition equals source pixels at the authored wrist, without a second mirror', () => {
  const B = DANGO_LIMB_BOX;
  for (const item of cases) {
    const p = solveLimb(source, { view: 'three-quarter-left', side: item.side, target: item.target, pose: 'hold' });
    const actual = composeLimb(source, p, { outline: false }).paw.data, expected = new Uint8ClampedArray(actual.length);
    const raw = source.pixels(p.paw.src), dx = p.W[0] - p.paw.root[0] - B.x, dy = p.W[1] - p.paw.root[1] - B.y;
    assert.ok(Number.isInteger(dx) && Number.isInteger(dy));
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
      const from = (y * raw.width + x) * 4;
      if (raw.data[from + 3]) expected.set(raw.data.subarray(from, from + 4), ((y + dy) * B.w + x + dx) * 4);
    }
    assert.deepEqual(actual, expected);
  }
});

test('outline pass only recolours palm boundary pixels to the palm ink; silhouette unchanged', () => {
  for (const item of cases) {
    const p = solveLimb(source, { view: 'three-quarter-left', side: item.side, target: item.target, pose: 'hold' });
    const raw = composeLimb(source, p, { outline: false }).paw.data, out = composeLimb(source, p).paw.data;
    let changed = 0;
    for (let i = 0; i < raw.length; i += 4) {
      assert.equal(Boolean(raw[i + 3]), Boolean(out[i + 3]));
      if (raw[i] !== out[i] || raw[i + 1] !== out[i + 1] || raw[i + 2] !== out[i + 2]) { changed++; assert.ok(out[i] * .3 + out[i + 1] * .59 + out[i + 2] * .11 < 80); }
    }
    assert.ok(changed < 40);
  }
});

test('Skia painter reflects the near palm exactly once and keeps far palms fail-closed', () => {
  const painter = createDangoLimbPainter({ source, createSurface: createCanvas });
  try {
    const item = cases[1], action = { prop: 'cup' }, frames = [];
    for (const [view, facing] of [['three-quarter-left', 1], ['three-quarter-right', 1], ['three-quarter', 1], ['three-quarter', -1]]) {
      const flipped = view !== 'three-quarter-left';
      const c = createCanvas(114, 96), ctx = c.getContext('2d');
      if (facing === -1) { ctx.translate(114, 0); ctx.scale(-1, 1); }
      ctx.translate(24, 8);
      const hand = { side: flipped ? 'left' : 'right', gripPoint: flipped ? reflect(item.target) : item.target };
      assert.equal(painter.paint(ctx, { view, hand, action, layer: 'front', palette: PALETTES.pink }), true);
      frames.push(pixels(c));
      const far = cases[0];
      assert.equal(painter.plan(view, { side: flipped ? 'right' : 'left', gripPoint: flipped ? reflect(far.target) : far.target }, action), null);
    }
    const expected = new Uint8ClampedArray(frames[0].length);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 114; x++) {
      const i = (y * 114 + x) * 4, j = (y * 114 + 113 - x) * 4;
      expected.set(frames[0].subarray(i, i + 4), j);
    }
    assert.deepEqual(frames[1], expected); assert.deepEqual(frames[2], expected);
    assert.deepEqual(frames[3], frames[0], 'renderer facing reverses the entire canonical pose once');
  } finally { painter.dispose(); }
});

test('standard quarter artist preserves canonical body, props, shoulders and inactive defaults', async () => {
  const base = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: load, createSurface: createCanvas });
  const preview = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: load, createSurface: createCanvas, limbs: source });
  await Promise.all([base.ready({ all: true }), preview.ready({ all: true })]);
  const body = (artist, a) => { const c = createCanvas(114, 96), ctx = c.getContext('2d'); ctx.translate(24, 8);
    artist.body(ctx, PALETTES.pink, a.view, a); return pixels(c); };
  try {
    assert.equal(DANGO_LIMB_RIG.hostAcceptsContract, 2);
    assert.equal(source.manifest().extensions.runtimeReady, false);
    for (const id of ['carry-energy', 'read-book']) for (let i = 0; i <= 32; i++) { // sip-tea is front-only now
      const action = PET_ACTIONS[id], options = { action, motion: action.motion, view: 'three-quarter', progress: i / 32, elapsedMs: i * 125 };
      const a = base.resolveArtwork(options), b = preview.resolveArtwork(options);
      assert.equal(a.view, 'three-quarter'); assert.equal(b.view, a.view);
      assert.deepEqual(b.data.anchors, a.data.anchors); assert.deepEqual(b.contact.tools, a.contact.tools);
      assert.deepEqual(b.matrices, a.matrices); assert.deepEqual(body(preview, b), body(base, a));
      // Runtime screen-right maps to the authored far-left palm, which remains legacy.
      assert.ok(b.contact.hands.filter(h => h.side === 'right').every(h => h.limb !== true));
    }
  } finally { base.dispose(); preview.dispose(); }
});
