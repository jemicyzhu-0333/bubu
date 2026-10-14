'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleFeet, footMatrix, resolveDangoPerformance, drawFeet } = require('../src/capabilities/companion/presentation/dango-performance.mjs');
const { BODY_ANCHORS } = require('../src/content/companion/dango-body.mjs');
const formArt = require('../src/capabilities/companion/presentation/form-art.mjs').default;
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const IDENTITY = [1, 0, 0, 1, 0, 0];
const at = (matrix, anchor) => [matrix[0] * anchor.x + matrix[2] * anchor.y + matrix[4], matrix[1] * anchor.x + matrix[3] * anchor.y + matrix[5]];

test('authored foot pivots rotate in place and locomotion alternates bounded independent feet', () => {
  for (const [view, anchors] of Object.entries(BODY_ANCHORS)) {
    for (const side of ['foot-left', 'foot-right']) {
      assert.deepEqual(at(footMatrix(anchors[side], { r: .5, x: 0, y: 0 }), anchors[side]), [anchors[side].x, anchors[side].y]);
    }
    for (const motion of ['walk', 'dash', 'moonwalk', 'glide', 'dance', 'hop']) {
      const seen = new Set();
      for (let i = 0; i <= 100; i++) {
        const feet = sampleFeet(motion, i / 100, view, false);
        seen.add(JSON.stringify(feet));
        for (const [side, matrix] of Object.entries(feet)) {
          assert.ok(matrix.every(Number.isFinite));
          const point = at(matrix, anchors[side]);
          assert.ok(Math.hypot(point[0] - anchors[side].x, point[1] - anchors[side].y) < 3.5);
        }
      }
      assert.ok(seen.size > 40, `${motion}/${view} must articulate over time`);
      assert.deepEqual(sampleFeet(motion, .37, view, true), { 'foot-left': IDENTITY, 'foot-right': IDENTITY });
    }
    const feet = sampleFeet('moonwalk', .17, view, false);
    const left = at(feet['foot-left'], anchors['foot-left'])[0] - anchors['foot-left'].x;
    const right = at(feet['foot-right'], anchors['foot-right'])[0] - anchors['foot-right'].x;
    assert.ok(left * right < 0, 'feet slide in opposite directions');
  }
});

test('walking animates without a catalog action while dragging and reduced-motion keep feet held', () => {
  const a = resolveDangoPerformance({ state: 'walking', elapsedMs: 160, view: 'profile' });
  const b = resolveDangoPerformance({ state: 'walking', elapsedMs: 400, view: 'profile' });
  assert.notDeepEqual(a.footwearTransforms, b.footwearTransforms);
  assert.deepEqual(resolveDangoPerformance({ state: 'dragged', motion: 'dash', progress: .2 }).footwearTransforms,
    { 'foot-left': IDENTITY, 'foot-right': IDENTITY });
  assert.deepEqual(resolveDangoPerformance({ state: 'walking', elapsedMs: 500, calmVisual: true }).footwearTransforms,
    { 'foot-left': IDENTITY, 'foot-right': IDENTITY });
});

test('foot sprite cache keys exclude phase and glints reuse the same two attachment matrices', () => {
  const matrices = [], rectangles = [], keys = new Set();
  const context = { globalAlpha: 1, save() {}, restore() {}, translate() {}, transform(...m) { matrices.push(m); },
    drawImage() {}, fillRect(...r) { rectangles.push(r); } };
  const sprites = { acquire(key) { keys.add(key); return {}; } };
  const options = { palette: { 1: '#111', 2: '#222', 3: '#333' }, stage: { cell: 2, bodySize: 66, deviceScale: 2 }, offX: 0, offY: 0, sprites };
  for (let i = 0; i < 20; i++) {
    const artwork = resolveDangoPerformance({ motion: 'moonwalk', action: { prop: 'sparkle-shoes' }, progress: i / 20 });
    drawFeet(context, { ...options, artwork, layer: 'back' });
    drawFeet(context, { ...options, artwork, layer: 'front' });
    assert.deepEqual(matrices.slice(-4, -2), matrices.slice(-2), 'glints follow actual foot transforms');
  }
  assert.equal(keys.size, 2, 'only one cached bitmap per foot, never a cache entry per frame');
  assert.equal(rectangles.length, 80, 'two tiny crosses, no third shoe or filled shoe silhouette');
  assert.ok(rectangles.every(([, , w, h]) => w <= 4 && h <= 4));
  assert.equal(drawFeet(context, { ...options, artwork: resolveDangoPerformance(), layer: 'front' }), false);
});

test('default expression and activity faces are temporally distinct without random gaze or automatic blink', () => {
  const face = { eyes: 'neutral', mouth: 'neutral', openness: 1 };
  const faces = Array.from({ length: 9 }, (_, i) => resolveDangoPerformance({ face, action: { motion: 'type' }, motion: 'type', progress: i / 9 }).face);
  assert.ok(new Set(faces.map(value => JSON.stringify(value))).size >= 7);
  assert.ok(faces.slice(0, 7).every(value => ['focused', 'half'].includes(value.eyes)), 'typing stays attentive rather than randomly switching emotions');
  assert.strictEqual(resolveDangoPerformance({ face, calmVisual: true, action: { motion: 'type' }, motion: 'type', progress: .5 }).face, face);
});


test('current raster dango cache identity excludes time while feet use generated-layer anchors', () => {
  const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
  const keys = new Set();
  for (let i = 0; i < 30; i++) {
    const artwork = formArt.resolveArtwork(PET_FORMS.dango, { view: 'three-quarter', motion: 'moonwalk', progress: i / 30 });
    assert.equal(artwork.kind, 'dango-raster');
    assert.deepEqual(artwork.anchors, DANGO_RASTER.views['three-quarter-right'].anchors);
    keys.add(formArt.bodySpriteKey(PET_FORMS.dango, 'pink', 'normal', 'three-quarter', false, artwork));
  }
  assert.equal(keys.size, 1);
  assert.match([...keys][0], /dango-raster:/);
});
