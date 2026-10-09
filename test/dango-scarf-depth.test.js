'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { garmentView } = require('../src/capabilities/companion/presentation/dango-raster-appearance.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { SCARF, ACTION, intent } = require('../tools/dango-scarf-preview/painter.mjs');
const loadImage = async src => ({ src, width: 8, height: 8 });
const make = options => createDangoRasterArtist({ manifest: DANGO_RASTER, runFootTiming: 'forward-recovery', loadImage, ...options });
const drawScarf = (artist, artwork) => {
  const context = recordingContext();
  for (const layer of ['back', 'front']) artist.appearance(context, { item: SCARF, artwork, palette: PALETTES.pink, layer });
  return context.calls;
};

test('scarf keeps its six saved front/back PNGs and existing angle fallback policy', () => {
  const source = JSON.parse(fs.readFileSync('assets/companion/dango/raster/source-specs/wardrobe.json', 'utf8'));
  const entry = DANGO_RASTER.appearance.scarf;
  assert.deepEqual(entry, source.appearance.scarf);
  assert.deepEqual(Object.keys(entry.views), ['front', 'three-quarter', 'back']);
  for (const [view, layers] of Object.entries(entry.views)) {
    assert.deepEqual(layers.back.map(s => s.src), [`wardrobe/scarf-${view}-hidden-return.png`]);
    assert.deepEqual(layers.front.map(s => s.src), [`wardrobe/scarf-${view}-visible-cloth.png`]);
    assert.ok([...layers.back, ...layers.front].every(sprite => !sprite.attachment));
  }
  assert.equal(garmentView(entry, 'profile'), entry.views['three-quarter']);
  assert.equal(garmentView(entry, 'three-quarter-right'), entry.views['three-quarter']);
  assert.equal(garmentView(entry, 'three-quarter-left'), null);
  assert.equal(entry.leftFacingPolicy, 'runtime-mirror');
});

test('scarf front and back load atomically in all supported views while the original body remains available', async () => {
  for (const view of ['front', 'three-quarter', 'back']) for (const held of ['hidden-return', 'visible-cloth']) {
    let release;
    const artist = make({ loadImage: src => src.includes(`scarf-${view}-${held}`)
      ? new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); }) : loadImage(src) });
    const ready = artist.ready({ all: true }); await new Promise(resolve => setImmediate(resolve));
    const options = intent(1500, { running: false, view }), cold = artist.resolveArtwork(options);
    assert.equal(cold.ready, false); assert.equal(cold.pending, true); assert.equal(cold.layeredReady, true);
    assert.deepEqual(drawScarf(artist, cold), [], `${view}/${held} must not expose the other layer`);
    assert.equal(artist.body(recordingContext(), PALETTES.pink, view, cold), true);
    release(); await ready;
    const warm = artist.resolveArtwork(options), calls = drawScarf(artist, warm);
    assert.equal(warm.ready, true); assert.equal(warm.pending, false); assert.equal(calls.length, 2);
    assert.ok(calls[0].image.src.includes('hidden-return')); assert.ok(calls[1].image.src.includes('visible-cloth'));
    artist.dispose();
  }
});

test('a failed scarf layer leaves both layers absent without hiding or invalidating the original body', async () => {
  for (const held of ['hidden-return', 'visible-cloth']) {
    const artist = make({ loadImage: src => src.includes(`scarf-three-quarter-${held}`)
      ? Promise.reject(new Error('missing scarf layer')) : loadImage(src) });
    await artist.ready({ all: true }); const artwork = artist.resolveArtwork(intent(1500));
    assert.equal(artwork.ready, false); assert.equal(artwork.pending, false); assert.equal(artwork.layeredReady, true);
    assert.deepEqual(drawScarf(artist, artwork), []);
    assert.equal(artist.body(recordingContext(), PALETTES.pink, artwork.view, artwork), true);
    artist.dispose();
  }
});

test('single scarf identity stays narrow; unreviewed outfits and unsupported views keep the old path', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const item of [SCARF, { id: SCARF.id, renderKey: SCARF.renderKey }]) {
    assert.equal(artist.resolveArtwork(intent(1500, { appearance: { items: [item] } })).runFootTiming, 'forward-recovery');
  }
  const unreviewed = [
    { appearance: { items: [{ ...SCARF, id: 'other-scarf' }] } },
    { appearance: { items: [{ ...SCARF, formId: 'usagi' }] } },
    { appearance: { items: [SCARF, { id: 'milestone.boots', renderKey: 'boots' }] } },
    { appearance: { items: [{ ...SCARF, renderKey: 'boots' }] } },
    { view: 'front' }, { view: 'back' }, { view: 'three-quarter-left' }, { calmVisual: true },
    { reducedMotion: true }, { state: 'dragged' }, { action: { ...ACTION, id: 'chase-butterfly' } }
  ];
  for (const override of unreviewed) {
    const artwork = artist.resolveArtwork(intent(1500, override));
    assert.equal(artwork.runFootTiming, null, JSON.stringify(override)); assert.equal(artwork.clip, null);
  }
  const backAction = artist.resolveArtwork(intent(1500, { view: 'back' }));
  assert.equal(backAction.view, 'three-quarter', 'semantic action policy remains explicit');
  artist.dispose();
});

test('scarf and bare body share all pose matrices, face, cache and body breathing throughout run and idle', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const running of [false, true]) for (let frame = 0; frame <= 120; frame++) {
    const at = frame / 120 * 9500, bareOptions = intent(at, { running, outfit: false }), scarfOptions = intent(at, { running });
    const bare = artist.resolveArtwork(bareOptions), scarf = artist.resolveArtwork(scarfOptions);
    for (const key of ['matrices', 'face', 'footwearTransforms', 'key', 'runFootTiming']) assert.deepEqual(bare[key], scarf[key], key);
    assert.equal(scarf.clip, null);
    const contexts = [recordingContext(), recordingContext()];
    for (const [i, artwork] of [bare, scarf].entries()) {
      artist.applyMotionTransform(contexts[i], bareOptions.motion, bareOptions.progress, { artwork,
        action: bareOptions.action, size: 146, bodySize: 66, facing: 1 }); contexts[i].drawImage({}, 0, 0);
    }
    assert.deepEqual(contexts[0].calls[0].matrix, contexts[1].calls[0].matrix);
  }
  artist.dispose();
});

const canvasPackage = process.env.DANGO_CANVAS_PACKAGE || process.env.USAGI_CANVAS_PACKAGE;
test('real Skia verifies protected face pixels, hidden return cloth and actual production shared layer transforms',
  { skip: !canvasPackage && 'Set DANGO_CANVAS_PACKAGE or USAGI_CANVAS_PACKAGE to the existing @napi-rs/canvas package' }, async () => {
    const backend = require(canvasPackage);
    const { makeRuntime, makeIsolatedPainter } = require('../tools/dango-scarf-preview/painter.mjs');
    const { auditDepth, traceProductionDraw } = require('../tools/dango-scarf-preview/audit.mjs');
    const isolated = await makeIsolatedPainter(backend), depth = auditDepth(backend, isolated);
    assert.equal(depth.samples, 144); assert.equal(depth.maxClothFaceOverlap, 0);
    assert.equal(depth.minIdleTorsoOcclusionFraction, 1); assert.equal(depth.edgeTouchFrames, 0);
    assert.ok(depth.records.every(record => record.ready && record.clip === null)); isolated.dispose();
    const runtime = await makeRuntime(backend), matrices = { run: new Set(), idle: new Set() };
    try {
      for (const item of runtime.cases.filter(row => row.outfit)) for (const at of [0, 950, 1500, 1900, 2137.5, 2612.5, 4700, 9000]) {
        const trace = traceProductionDraw(item.harness, at), calls = trace.calls;
        assert.equal(trace.scarf.length, 2);
        const back = calls.findIndex(call => call.src?.includes('scarf-three-quarter-hidden-return'));
        const body = calls.findIndex(call => !call.src);
        const face = calls.findIndex(call => call.src?.includes('eye-left-') || call.src?.includes('/face/eyes-'));
        const front = calls.findIndex(call => call.src?.includes('scarf-three-quarter-visible-cloth'));
        assert.ok(back >= 0 && back < body && body < face && face < front, `actual production painter ordering at ${at}, running=${item.running}: ${JSON.stringify(calls.map(call => call.src))}`);
        assert.deepEqual(calls[back].matrix, calls[body].matrix);
        assert.deepEqual(calls[front].matrix, calls[body].matrix);
        matrices[item.running ? 'run' : 'idle'].add(JSON.stringify(calls[body].matrix));
      }
      assert.ok(matrices.run.size > 4, 'run breathing and lean remain animated');
      assert.ok(matrices.idle.size > 4, 'idle expression breathing remains animated');
    } finally { runtime.dispose(); }
  });
