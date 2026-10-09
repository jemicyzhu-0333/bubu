'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { garmentView, isScarfHeadwearCombination } = require('../src/capabilities/companion/presentation/dango-raster-appearance.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { classifiedWardrobeCalls, expectedHiddenParts, assertSamePhysicalCache } = require('../test-support/dango-wardrobe-draw-assertions.mjs');
const SCARF = PET_APPEARANCE_ITEMS.find(item => item.id === 'milestone.scarf');
const HEADWEAR = ['milestone.sunhat', 'milestone.sprout'].map(id => PET_APPEARANCE_ITEMS.find(item => item.id === id));
const ACTION = { id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' };
const loadImage = async src => ({ src, width: 8, height: 8 });
const make = changes => createDangoRasterArtist({ manifest: DANGO_RASTER, runFootTiming: 'forward-recovery', loadImage, ...changes });
const wait = () => new Promise(resolve => setImmediate(resolve));
const options = (hat, view = 'three-quarter', extra = {}) => ({ view, motion: 'idle', elapsedMs: 1500,
  face: { eyes: 'neutral', mouth: 'neutral' }, appearance: { items: [SCARF, hat] }, ...extra });
const sprites = (item, view) => {
  const selected = garmentView(DANGO_RASTER.appearance[item.renderKey], view);
  return [...(selected?.back || []), ...(selected?.front || [])];
};
function draw(artist, artwork, appearance) {
  const context = recordingContext();
  for (const layer of ['back', 'front']) for (const item of appearance.items) {
    artist.appearance(context, { item, appearance, artwork, palette: PALETTES.pink, layer });
  }
  return classifiedWardrobeCalls(context.calls, artwork, appearance.items);
}

test('exact pair membership rejects inherited object-property IDs and malformed render keys', () => {
  for (const id of ['toString', 'constructor', '__proto__']) {
    assert.equal(isScarfHeadwearCombination([SCARF, { id, renderKey: Object.prototype[id] }]), false, id);
  }
  for (const hat of HEADWEAR) {
    assert.equal(isScarfHeadwearCombination([SCARF, hat]), true);
    assert.equal(isScarfHeadwearCombination([SCARF, { ...hat, renderKey: Object.prototype.toString }]), false);
  }
});

test('selected combinations retain saved art, head roots, shared body binding and explicit view aliases', () => {
  const source = JSON.parse(fs.readFileSync('assets/companion/dango/raster/source-specs/wardrobe.json', 'utf8'));
  for (const item of [SCARF, ...HEADWEAR]) {
    const entry = DANGO_RASTER.appearance[item.renderKey];
    assert.deepEqual(entry, source.appearance[item.renderKey]);
    assert.deepEqual(Object.keys(entry.views), ['front', 'three-quarter', 'back']);
    assert.strictEqual(garmentView(entry, 'profile'), entry.views['three-quarter']);
    assert.strictEqual(garmentView(entry, 'three-quarter-right'), entry.views['three-quarter']);
    assert.equal(garmentView(entry, 'three-quarter-left'), null);
    assert.equal(entry.leftFacingPolicy, 'runtime-mirror');
    for (const view of Object.keys(entry.views)) {
      assert.ok(sprites(item, view).every(sprite => !sprite.attachment), 'body-mounted, no extra drifting bone');
      if (item !== SCARF) {
        assert.deepEqual(entry.views[view].front, []);
        assert.ok(entry.views[view].back[0].src.includes('outer-piece'));
        assert.ok(entry.views[view].back[1].src.includes('hidden-root'));
      }
    }
  }
});

test('either pending component of each selected garment keeps the whole exact outfit atomic', async () => {
  for (const hat of HEADWEAR) for (const view of ['front', 'three-quarter', 'back']) {
    for (const held of [...sprites(SCARF, view), ...sprites(hat, view)]) {
      let release;
      const artist = make({ loadImage: src => new URL(src).pathname.endsWith(`/${held.src}`)
        ? new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); }) : loadImage(src) });
      const complete = artist.ready({ all: true }); await wait();
      const input = options(hat, view), cold = artist.resolveArtwork(input);
      assert.equal(cold.ready, false); assert.equal(cold.pending, true); assert.equal(cold.layeredReady, true);
      assert.equal(draw(artist, cold, input.appearance).length, 0, `${hat.id}/${held.src}: no partial outfit`);
      assert.equal(artist.body(recordingContext(), PALETTES.pink, view, cold), true);
      assert.deepEqual(cold.hiddenParts, []);
      release(); await complete;
      const warm = artist.resolveArtwork(input);
      assert.equal(warm.ready, true); assert.equal(warm.pending, false);
      assert.equal(draw(artist, warm, input.appearance).length, 4);
      assertSamePhysicalCache(warm, cold); assert.deepEqual(warm.hiddenParts, expectedHiddenParts(input.appearance.items));
      artist.dispose();
    }
  }
});

test('any failed selected layer is reported without showing a fragment or disabling the body', async () => {
  for (const hat of HEADWEAR) for (const view of ['front', 'three-quarter', 'back']) {
    for (const failed of [...sprites(SCARF, view), ...sprites(hat, view)]) {
      const artist = make({ loadImage: src => new URL(src).pathname.endsWith(`/${failed.src}`)
        ? Promise.reject(new Error('test garment failure')) : loadImage(src) });
      await artist.ready({ all: true });
      const input = options(hat, view), artwork = artist.resolveArtwork(input);
      assert.equal(artwork.ready, false); assert.equal(artwork.pending, false);
      assert.equal(artist.cacheStats().source.failed, 1); assert.equal(artwork.layeredReady, true);
      assert.equal(draw(artist, artwork, input.appearance).length, 0);
      assert.equal(artist.body(recordingContext(), PALETTES.pink, view, artwork), true);
      artist.dispose();
    }
  }
});

test('cold request completion redraws the newest outfit and disposal rejects late garment completion', async () => {
  const held = new Map(); let released = 0;
  const artist = make({ loadImage: src => src.includes('/wardrobe/')
    ? new Promise(resolve => held.set(src, () => resolve({ src, width: 8, height: 8, close() { released++; } }))) : loadImage(src) });
  await artist.ready(); let notifications = 0;
  const unsubscribe = artist.subscribeArtwork(() => notifications++);
  const input = options(HEADWEAR[0]), first = artist.resolveArtwork(input);
  assert.equal(first.ready, false); assert.equal(first.pending, true);
  assert.equal(draw(artist, first, input.appearance).length, 0); await wait();
  assert.equal(held.size, 4);
  notifications = 0;
  const bare = { ...input, appearance: { items: [] } }, before = artist.resolveArtwork(bare);
  [...held.values()].forEach(release => release()); await wait();
  assert.equal(notifications, 4); assert.equal(artist.resolveArtwork(input).ready, true);
  assert.deepEqual(draw(artist, artist.resolveArtwork(bare), bare.appearance), []);
  assert.equal(artist.resolveArtwork(bare).key, before.key);
  artist.resolveArtwork(options(HEADWEAR[1])); await wait();
  const late = [...held.entries()].filter(([src]) => src.includes('sprout'));
  unsubscribe(); artist.dispose(); const stopped = notifications;
  late.forEach(([, release]) => release()); await wait();
  assert.equal(notifications, stopped); assert.equal(artist.cacheStats().source.entries, 0);
  assert.equal(released, 6);
});

test('suppressed headwear preserves a ready scarf while other incomplete outfits now fall back atomically', async () => {
  const artist = make({ loadImage: src => src.includes('/sunhat-') || src.includes('/crown-three-quarter-hidden-root')
    ? Promise.reject(new Error('missing hat')) : loadImage(src) });
  await artist.ready({ all: true });
  const input = options(HEADWEAR[0], 'three-quarter', { action: { id: 'yawn', prop: 'sleep-cap', motion: 'idle' } });
  const artwork = artist.resolveArtwork(input);
  assert.deepEqual(artwork.suppressedAppearanceSlots, ['headwear']);
  const calls = draw(artist, artwork, input.appearance);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.image.src.includes('/scarf-')));
  const crown = PET_APPEARANCE_ITEMS.find(item => item.id === 'skin.crown');
  const unrelated = options(crown), other = draw(artist, artist.resolveArtwork(unrelated), unrelated.appearance);
  assert.equal(other.length, 0, 'all declared garments now share atomic whole-outfit readiness');
  artist.dispose();
});

test('explicit unsupported left view stays missing while profile aliases retain the four saved layers', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const hat of HEADWEAR) {
    for (const view of ['profile', 'three-quarter-right']) {
      const input = options(hat, view), artwork = artist.resolveArtwork(input);
      assert.equal(artwork.ready, true); assert.equal(draw(artist, artwork, input.appearance).length, 4);
    }
    const input = options(hat, 'three-quarter-left'), artwork = artist.resolveArtwork(input);
    assert.equal(artwork.ready, false); assert.equal(artwork.pending, false);
    assert.deepEqual(artwork.missingAssets, ['appearance:scarf@three-quarter-left', `appearance:${hat.renderKey}@three-quarter-left`]);
    assert.equal(draw(artist, artwork, input.appearance).length, 0);
  }
  artist.dispose();
});

test('selected outfits preserve body cache, face and limb matrices for idle, focus, sleep and wake', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const hat of HEADWEAR) for (const expressionId of ['life.idle', 'work.focus', 'life.sleep', 'life.wake']) {
    const expression = EXPRESSIONS.find(item => item.id === expressionId);
    for (const view of ['front', 'three-quarter', 'back']) for (const at of [0, 500, 1600, 2600, 4700]) {
      const input = options(hat, view, { expressionId, face: expression.face, elapsedMs: at, expressionElapsedMs: at });
      const dressed = artist.resolveArtwork(input), bare = artist.resolveArtwork({ ...input, appearance: { items: [] } });
      assertSamePhysicalCache(dressed, bare); assert.deepEqual(dressed.hiddenParts, expectedHiddenParts(input.appearance.items));
      for (const field of ['matrices', 'face', 'footwearTransforms']) assert.deepEqual(dressed[field], bare[field]);
      assert.equal(draw(artist, dressed, input.appearance).length, 4); assert.equal(dressed.clip, null);
    }
    const run = artist.resolveArtwork(options(hat, 'three-quarter', { action: ACTION, motion: 'dash', progress: .4 }));
    assert.equal(run.runFootTiming, 'forward-recovery', 'only the exact inspected pair shares the accepted timing');
    for (const change of [{ calmVisual: true }, { reducedMotion: true }, { state: 'dragged' }]) {
      const quiet = artist.resolveArtwork(options(hat, 'three-quarter', { action: ACTION, motion: 'dash', progress: .4, ...change }));
      assert.equal(quiet.runFootTiming, null); assert.equal(quiet.clip, null);
    }
  }
  artist.dispose();
});

test('only the exact inspected pairs share accepted run feet, without changing body, face or other outfits', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const hat of HEADWEAR) {
    for (const items of [[SCARF, hat], [hat, SCARF], [SCARF, { id: hat.id, renderKey: hat.renderKey }]]) {
      for (let frame = 0; frame <= 120; frame++) {
        const input = options(hat, 'three-quarter', { action: ACTION, motion: 'dash', progress: frame / 120,
          elapsedMs: frame / 120 * 9500, appearance: { items } });
        const dressed = artist.resolveArtwork(input), bare = artist.resolveArtwork({ ...input, appearance: { items: [] } });
        assert.equal(dressed.runFootTiming, 'forward-recovery'); assert.equal(dressed.clip, null);
        assertSamePhysicalCache(dressed, bare); assert.deepEqual(dressed.hiddenParts, expectedHiddenParts(input.appearance.items));
      for (const field of ['matrices', 'face', 'footwearTransforms']) assert.deepEqual(dressed[field], bare[field]);
      }
    }
    const variants = [
      { appearance: { items: [hat] } },
      { appearance: { items: [SCARF, { ...hat, id: 'other-hat' }] } },
      { appearance: { items: [SCARF, { ...hat, renderKey: 'crown' }] } },
      { appearance: { items: [SCARF, { ...hat, formId: 'usagi' }] } },
      { appearance: { items: [SCARF, hat, { id: 'milestone.boots', renderKey: 'boots' }] } },
      { appearance: { items: [SCARF, { id: 'skin.crown', renderKey: 'crown' }] } },
      { view: 'front' }, { view: 'back' }, { view: 'three-quarter-left' }, { view: 'three-quarter-right' },
      { action: { ...ACTION, id: 'chase-butterfly' } }, { calmVisual: true }, { reducedMotion: true }, { state: 'dragged' }
    ];
    for (const change of variants) {
      const artwork = artist.resolveArtwork(options(hat, 'three-quarter', { action: ACTION, motion: 'dash', progress: .4, ...change }));
      assert.equal(artwork.runFootTiming, null, JSON.stringify(change)); assert.equal(artwork.clip, null);
    }
  }
  artist.dispose();
});

const canvasPackage = process.env.DANGO_CANVAS_PACKAGE || process.env.USAGI_CANVAS_PACKAGE;
test('actual renderer keeps both outfits attached, ordered, visible and outside the face through states and a run stride',
  { skip: !canvasPackage && 'Set DANGO_CANVAS_PACKAGE or USAGI_CANVAS_PACKAGE for real Skia pair evidence' }, async () => {
    const path = require('node:path');
    const { pathToFileURL } = require('node:url');
    const backend = require(canvasPackage);
    const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
    const { loadSource, createRenderHarness } = await import('../tools/usagi-gallery/runtime-harness.mjs');
    const { createStateCycleDriver } = await import('../tools/dango-state-cycle-preview/driver.mjs');
    const { traceFrame } = await import('../tools/dango-state-cycle-preview/metrics.mjs');
    const { makeMetrics, summarize } = await import('../tools/dango-wardrobe-preview/metrics.mjs');
    installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
    globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
    globalThis.window = { devicePixelRatio: 2 };
    const source = await loadSource(pathToFileURL(path.resolve(__dirname, '..')).href);
    const metrics = makeMetrics(backend), rows = [];
    try {
      for (const hat of HEADWEAR) {
        const outfit = [SCARF.id, hat.id];
        for (const view of [{ view: 'front' }, { view: 'three-quarter' },
          { view: 'three-quarter', facing: -1 }, { view: 'back' }]) {
          const driver = createStateCycleDriver(source, { ...view, outfit, blink: false, dpr: 2 });
          try {
            for (const at of [0, 2600, 5200, 5500, 8500, 11200, 11500, 15000, 15300, 23400, 23700, 27000]) {
              const trace = traceFrame(driver, at);
              rows.push(metrics.measure(trace, driver.body, at, hat.renderKey, true));
            }
          } finally { driver.dispose(); }
        }
        const run = createRenderHarness(source, { skin: 'pink', view: 'three-quarter', outfit, blink: false, dpr: 2 });
        run.select('action', ACTION.id);
        try {
          for (let frame = 0; frame < 24; frame++) {
            const at = 1900 + frame / 24 * 950, trace = traceFrame(run, at);
            rows.push(metrics.measure(trace, run.body, at, hat.renderKey, true));
          }
        } finally { run.dispose(); }
      }
      const summary = summarize(rows);
      assert.equal(summary.frames, 144); assert.equal(summary.diagnosticSamples, 144);
      for (const key of ['blankFrames', 'edgeFrames', 'incompleteGroups', 'layerOrderFailures',
        'maxRootMatrixDifference', 'maxFaceFrontOverlap', 'maxFaceHeadOverlap', 'maxHeadFootOverlap']) {
        assert.equal(summary[key], 0, key);
      }
      assert.ok(summary.minVisibleHeadPixels > 0, 'back headwear remains readable beyond the body');
      assert.ok(summary.minHeadFootVerticalGapCss > 40, 'headwear stays separated from unchanged foot motion');
      assert.deepEqual(new Set(summary.observedViews), new Set(['front', 'three-quarter', 'back']));
    } finally { metrics.dispose(); }
  });
