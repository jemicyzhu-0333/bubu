'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { createRasterRootPainter } = require('../src/capabilities/companion/presentation/dango-raster-roots.mjs');
const { rasterFixture, recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const identity = [1, 0, 0, 1, 0, 0];

function fixture() {
  const manifest = rasterFixture();
  for (const data of Object.values(manifest.views)) {
    data.variants = { running: { rootJoins: {
      outline: { src: 'torso-contour.png', rect: [0, 0, 66, 66] },
      contour: { rect: [0, 0, 66, 66], width: 66, height: 66, runs: [[50, 10, 56, 2]] },
      fills: Object.fromEntries(['foot-left', 'foot-right', 'hand-left', 'hand-right'].map(name =>
        [name, { ...data.parts[name], src: `${name}-interior.png` }]))
    } } };
  }
  return manifest;
}

test('a cold or failed overlap mask keeps the exact neutral fallback until every root asset is ready', async () => {
  const manifest = fixture(); let release;
  const artist = createDangoRasterArtist({ manifest, loadImage: src => src.includes('torso-contour.png')
    ? new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); })
    : Promise.resolve({ src, width: 8, height: 8 }) });
  const ready = artist.ready({ all: true });
  await new Promise(resolve => setImmediate(resolve));
  const options = { action: PET_ACTIONS['chase-butterfly'], motion: 'dash', progress: .275 };
  const cold = artist.resolveArtwork(options);
  assert.equal(cold.layeredReady, false); assert.equal(cold.pending, true);
  const context = recordingContext();
  artist.body(context, PALETTES.pink, cold.view, cold);
  assert.equal(context.calls.length, 1);
  assert.ok(context.calls[0].image.src.includes(cold.neutral.src));
  release(); await ready;
  assert.equal(artist.resolveArtwork(options).layeredReady, true);
  artist.dispose();
  const broken = createDangoRasterArtist({ manifest, loadImage: src => src.includes('foot-left-interior.png')
    ? Promise.reject(new Error('unavailable join')) : Promise.resolve({ src, width: 8, height: 8 }) });
  await broken.ready({ all: true });
  assert.equal(broken.resolveArtwork(options).layeredReady, false);
  assert.equal(broken.resolveArtwork(options).pending, false);
  broken.dispose();
});

test('live roots clip static source pixels to one reused contour without allocating frame surfaces', () => {
  const paints = [], paths = [], oldPath = globalThis.Path2D;
  globalThis.Path2D = class {
    constructor() { this.rectangles = []; paths.push(this); }
    rect(...rect) { this.rectangles.push(rect); }
  };
  const context = recordingContext();
  const clips = []; context.clip = path => clips.push(path);
  const roots = createRasterRootPainter({
    painter: { paint(_ctx, sprite, _palette, matrix) { paints.push({ src: sprite.src, matrix }); return true; } },
    createSurface() { throw new Error('root composition must not allocate a mutable frame surface'); }
  });
  const rootJoins = fixture().views.front.variants.running.rootJoins;
  const matrices = Object.fromEntries(Object.keys(rootJoins.fills).map((name, i) => [name, [...identity.slice(0, 4), i, -i]]));
  const artwork = { data: { rootJoins }, layeredReady: true, actionReady: true, hiddenParts: [], matrices,
    contact: { hands: [{ side: 'left', integrated: true }, { side: 'right', integrated: false }] } };
  try {
    roots.paint(context, artwork, PALETTES.pink);
    assert.deepEqual(paints.map(row => row.src), ['foot-left-interior.png', 'foot-right-interior.png', 'hand-left-interior.png']);
    assert.deepEqual(paths[0].rectangles, [[10, 50, 46, 2]], 'the clip uses exact saved raster-mask runs');
    assert.strictEqual(clips[0], paths[0]);
    assert.deepEqual(paints[0].matrix, matrices['foot-left']);
    roots.paint(context, artwork, PALETTES.moon);
    assert.equal(paths.length, 1);
    paints.length = 0;
    roots.paint(context, { ...artwork, hiddenParts: ['foot-left', 'foot-right'], contact: null }, PALETTES.moon);
    assert.deepEqual(paints, [], 'boots must never reveal bare root fill');
    assert.deepEqual(roots.stats(), { contours: 1, surfaces: 0, bytes: 0 });
    roots.dispose(); assert.deepEqual(roots.stats(), { contours: 0, surfaces: 0, bytes: 0 });
  } finally { if (oldPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = oldPath; }
});

test('running root pixels remain outside face-only rendering and do not add phase cache keys', async () => {
  const manifest = fixture();
  const artist = createDangoRasterArtist({ manifest, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true });
  const options = { action: PET_ACTIONS['chase-butterfly'], motion: 'dash' };
  const first = artist.resolveArtwork({ ...options, progress: .275 });
  const second = artist.resolveArtwork({ ...options, progress: .325 });
  assert.equal(first.key, second.key);
  const context = recordingContext();
  artist.face(context, PALETTES.pink, {}, false, first.view, null, first);
  assert.equal(context.calls.length, 3, 'only two eyes and one mouth');
  assert.ok(context.calls.every(call => !call.image.src.includes('interior') && !call.image.src.includes('contour')));
  const calm = artist.resolveArtwork({ ...options, calmVisual: true, progress: .275 });
  assert.equal(calm.data.rootJoins, undefined);
  assert.deepEqual(calm.matrices['foot-left'], identity);
  artist.dispose();
});

test('the saved lower contour includes every possible authored running root rectangle', async () => {
  const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true });
  for (let frame = 0; frame <= 540; frame++) {
    const artwork = artist.resolveArtwork({ view: 'three-quarter', motion: 'dash',
      action: PET_ACTIONS['chase-butterfly'], progress: frame / 540 });
    const joins = artwork.data.rootJoins;
    const names = ['foot-left', 'foot-right', ...artwork.contact.hands.filter(hand => hand.integrated).map(hand => `hand-${hand.side}`)];
    for (const name of names) {
      const [x, y, width, height] = joins.fills[name].rect;
      const matrix = artwork.matrices[name];
      for (const [px, py] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
        const actualY = matrix[1] * px + matrix[3] * py + matrix[5];
        assert.ok(actualY >= joins.contour.minArtY, `${name} escapes the saved contour at frame ${frame}`);
      }
    }
  }
  artist.dispose();
});
