'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { createSleepTransition } = require('../src/surfaces/pet/sleep-transition.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const loadImage = async src => ({ src, width: 8, height: 8 });
const wait = () => new Promise(resolve => setImmediate(resolve));
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} / ${b}`);

function options(expressionId, extras = {}) {
  const expression = EXPRESSIONS.find(item => item.id === expressionId);
  return { expressionId, face: expression.face, motion: 'idle', view: 'three-quarter',
    expressionElapsedMs: 0, elapsedMs: 0, ...extras };
}
function faceCalls(artist, artwork, blinking = false) {
  const context = recordingContext();
  artist.face(context, PALETTES.pink, artwork.face, blinking, artwork.view, null, artwork);
  return context.calls;
}
function sampleInput(now, sleeping, extras = {}) {
  return { formId: 'dango', skinId: 'pink', view: 'three-quarter', state: sleeping ? 'sleeping' : 'idle',
    expressionId: sleeping ? 'life.sleep' : 'life.idle', now, offX: 40, offY: sleeping ? 44 : 40,
    bodyPose: { x: 0, y: sleeping ? 2 : 0, scaleX: 1, scaleY: sleeping ? .96 : 1, rotateDeg: 0, tone: 'normal' },
    ...extras };
}

test('focus and wake preserve glyphs, widths, pivots and near-eye scale while fixing only far-eye height', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage });
  await artist.ready({ all: true });
  try {
    for (const view of ['three-quarter', 'three-quarter-left', 'three-quarter-right']) {
      for (const expressionId of ['work.focus', 'work.deep-focus', 'life.wake']) {
        for (const at of [0, 1600, 2600]) {
          const artwork = artist.resolveArtwork(options(expressionId, { view, elapsedMs: at, expressionElapsedMs: at }));
          const after = faceCalls(artist, artwork);
          const before = faceCalls(artist, { ...artwork, view: 'front' });
          const neutral = artwork.data.face.eyes.neutral;
          const far = neutral[0].rect[2] < neutral[1].rect[2] ? 0 : 1, near = 1 - far;
          assert.deepEqual(after[near], before[near], `${view}/${expressionId}: near eye is exact`);
          assert.deepEqual(after[2], before[2], `${view}/${expressionId}: mouth is exact`);
          assert.strictEqual(after[far].image, before[far].image, 'original glyph retained');
          assert.deepEqual(after[far].rect, before[far].rect, 'authored width and rect retained');
          for (const channel of [0, 1, 2, 4]) close(after[far].matrix[channel], before[far].matrix[channel], 'horizontal channels');
          const heights = after.slice(0, 2).map(call => call.rect[3] * call.matrix[3]);
          close(heights[0] / heights[1], neutral[0].rect[3] / neutral[1].rect[3], 'canonical height ratio');
          const pivot = artwork.data.face.eyes[artwork.face.eyes][far].pivot;
          close(after[far].matrix[3] * pivot[1] + after[far].matrix[5],
            before[far].matrix[3] * pivot[1] + before[far].matrix[5], 'vertical pivot');
        }
      }
    }
  } finally { artist.dispose(); }
});

test('blink, sleep, approved idle and frontal/back geometry retain their original eye painting', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage });
  await artist.ready({ all: true });
  try {
    for (const expressionId of ['life.idle', 'life.sleep']) {
      for (const at of [0, 1600, 2600]) {
        const artwork = artist.resolveArtwork(options(expressionId, { elapsedMs: at, expressionElapsedMs: at }));
        assert.deepEqual(faceCalls(artist, artwork), faceCalls(artist, { ...artwork, view: artwork.view === 'back' ? 'back' : 'front' }));
      }
    }
    for (const expressionId of ['work.focus', 'work.deep-focus', 'life.wake']) {
      for (const view of ['front', 'back', 'three-quarter']) {
        const artwork = artist.resolveArtwork(options(expressionId, { view }));
        assert.deepEqual(faceCalls(artist, artwork, true), faceCalls(artist, { ...artwork, view: artwork.view === 'back' ? 'back' : 'front' }, true));
        if (view !== 'three-quarter') assert.deepEqual(faceCalls(artist, artwork), faceCalls(artist, { ...artwork, view: artwork.view === 'back' ? 'back' : 'front' }));
      }
    }
  } finally { artist.dispose(); }
});

test('focus cold load is pair-atomic, neutral fallback is unscaled, and late eyes cannot replace newer idle', async () => {
  const targetPaths = new Set(DANGO_RASTER.views['three-quarter'].face.eyes.focused.map(sprite => sprite.src));
  const deferred = new Map();
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: src =>
    [...targetPaths].some(suffix => new URL(src).pathname.endsWith(`/${suffix}`))
      ? new Promise(resolve => deferred.set(src, resolve)) : loadImage(src) });
  await artist.ready();
  try {
    const initial = artist.resolveArtwork(options('work.focus'));
    assert.equal(initial.layeredReady, true); assert.equal(initial.ready, false);
    assert.deepEqual(faceCalls(artist, initial).slice(0, 2).map(call => call.matrix[3]), [1, 1]);
    await wait();
    const pending = [...deferred.entries()];
    assert.equal(pending.length, 2);
    pending[0][1](await loadImage(pending[0][0])); await wait();
    const partial = artist.resolveArtwork(options('work.focus'));
    assert.equal(partial.ready, false);
    assert.ok(faceCalls(artist, partial).slice(0, 2).every(call => call.image.src.includes('neutral')));
    const idle = artist.resolveArtwork(options('life.idle'));
    const beforeIdle = faceCalls(artist, idle);
    pending[1][1](await loadImage(pending[1][0])); await wait();
    const loaded = artist.resolveArtwork(options('work.focus'));
    assert.equal(loaded.ready, true); assert.equal(loaded.key, initial.key);
    assert.ok(faceCalls(artist, loaded)[1].matrix[3] > 1.5);
    const afterIdle = artist.resolveArtwork(options('life.idle'));
    assert.deepEqual(faceCalls(artist, afterIdle), beforeIdle);
    assert.equal(afterIdle.key, idle.key);
  } finally { artist.dispose(); }
});

test('calm focus, sleep and wake remain static across elapsed time without changing body cache identity', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage });
  await artist.ready({ all: true });
  try {
    const keys = new Set();
    for (const expressionId of ['life.idle', 'work.focus', 'work.deep-focus', 'life.sleep', 'life.wake']) {
      const samples = [0, 1500, 4700].map(at => artist.resolveArtwork(options(expressionId, {
        calmVisual: true, expressionElapsedMs: at, elapsedMs: at
      })));
      samples.forEach(sample => keys.add(sample.key));
      for (const sample of samples.slice(1)) {
        assert.deepEqual(sample.matrices, samples[0].matrices);
        assert.deepEqual(faceCalls(artist, sample), faceCalls(artist, samples[0]));
      }
    }
    assert.equal(keys.size, 1);
  } finally { artist.dispose(); }
});

test('sleep boundaries settle all root channels from the shown pose and restore exact live sampling at 240 ms', () => {
  const sampler = createSleepTransition();
  const idle = sampleInput(0, false), sleep = sampleInput(16, true);
  assert.deepEqual(sampler.step(idle), { offX: idle.offX, offY: idle.offY, bodyPose: idle.bodyPose });
  const entry = sampler.step(sleep);
  assert.deepEqual(entry, { offX: idle.offX, offY: idle.offY, bodyPose: idle.bodyPose });
  const half = sampler.step(sampleInput(136, true));
  close(half.offY, 42, 'half root y'); close(half.bodyPose.y, 1, 'half expression y');
  close(half.bodyPose.scaleY, .98, 'half expression scale');
  const live = sampleInput(256, true, { offY: 45 });
  assert.strictEqual(sampler.step(live).bodyPose, live.bodyPose, 'settled pose is not continuously damped');
  assert.equal(sampler.step(sampleInput(272, true, { offY: 43 })).offY, 43, 'steady breathing remains exact');
  const wake = sampler.step(sampleInput(288, false));
  assert.equal(wake.offY, 43); assert.equal(wake.bodyPose.scaleY, .96);
  assert.strictEqual(sampler.step(sampleInput(528, false)).bodyPose.scaleY, 1);
});

test('sleep reversal and repetition continue from the displayed pose without carrying a stale target', () => {
  const sampler = createSleepTransition();
  sampler.step(sampleInput(0, false)); sampler.step(sampleInput(16, true));
  const partial = sampler.step(sampleInput(96, true));
  const reversal = sampler.step(sampleInput(112, false));
  assert.deepEqual(reversal, partial);
  const returned = sampler.step(sampleInput(192, false));
  assert.ok(returned.offY < partial.offY);
  const repeated = sampler.step(sampleInput(208, true));
  assert.deepEqual(repeated, returned);
  const final = sampler.step(sampleInput(448, true));
  assert.equal(final.offY, 44); assert.equal(final.bodyPose.scaleY, .96);
});

test('missing pose channels have finite identity defaults and same-frame reversal preserves displayed position', () => {
  const sampler = createSleepTransition();
  sampler.step(sampleInput(0, false, { bodyPose: null }));
  const entry = sampler.step(sampleInput(16, true, { bodyPose: { scaleY: .96 } }));
  assert.deepEqual(entry.bodyPose, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });
  const reversal = sampler.step(sampleInput(16, false, { bodyPose: null }));
  assert.deepEqual(reversal, entry);
  const again = sampler.step(sampleInput(16, true, { bodyPose: { scaleY: .96 } }));
  assert.deepEqual(again, entry);
  for (const now of [20, 60, 120, 180, 255]) {
    const shown = sampler.step(sampleInput(now, true, { bodyPose: { scaleY: .96 } }));
    assert.ok([shown.offX, shown.offY, ...Object.values(shown.bodyPose)].every(Number.isFinite));
  }
});

test('calm, drag, active actions, other forms, identity changes, stale gaps and resets discard sleep blending', () => {
  for (const override of [{ calmVisual: true }, { state: 'dragged' }, { action: { id: 'chase-laser' } },
    { formId: 'usagi' }, { skinId: 'forest' }, { view: 'front' }, { now: 1000 }, { now: -1 }]) {
    const sampler = createSleepTransition();
    sampler.step(sampleInput(0, false)); sampler.step(sampleInput(16, true));
    const input = sampleInput(96, true, override), output = sampler.step(input);
    assert.equal(output.offY, input.offY); assert.strictEqual(output.bodyPose, input.bodyPose);
  }
  const sampler = createSleepTransition();
  sampler.step(sampleInput(0, false)); sampler.step(sampleInput(16, true)); sampler.reset();
  assert.equal(sampler.step(sampleInput(32, true)).offY, 44);
  const other = createSleepTransition();
  assert.equal(other.step(sampleInput(32, true)).offY, 44, 'independent renderer never inherits prior channel');
});

const canvasPackage = process.env.DANGO_CANVAS_PACKAGE;
test('actual 30/60 fps renderer bounds sleep settling below 96 CSS pixels per second and keeps scarf attached',
  { skip: !canvasPackage && 'Set DANGO_CANVAS_PACKAGE for actual Skia state-transition evidence' }, async () => {
    const { pathToFileURL } = require('node:url');
    const path = require('node:path');
    const backend = require(canvasPackage);
    const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
    const { loadSource } = await import('../tools/usagi-gallery/runtime-harness.mjs');
    const { createStateCycleDriver } = await import('../tools/dango-state-cycle-preview/driver.mjs');
    const { traceFrame, makeFrameMetrics } = await import('../tools/dango-state-cycle-preview/metrics.mjs');
    installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
    globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
    globalThis.window = { devicePixelRatio: 2 };
    const source = await loadSource(pathToFileURL(path.resolve(__dirname, '..')).href);
    try {
      for (const fps of [30, 60]) for (const calm of [false, true]) {
        const driver = createStateCycleDriver(source, { view: 'three-quarter', outfit: ['milestone.scarf'], blink: false, calm });
        const measure = makeFrameMetrics();
        try {
          for (const boundary of [15000, 23400]) {
            let firstStatic = null;
            for (let frame = -2; frame <= Math.ceil(.6 * fps); frame++) {
              const at = boundary + frame * 1000 / fps;
              const trace = traceFrame(driver, at), record = measure(driver, trace, at);
              assert.ok(record.occupied > 0); assert.equal(record.edge, 0);
              assert.equal(record.scarfLayers, 2); assert.equal(record.maxScarfBodyMatrixDifference, 0);
              if (!calm && frame === 0) close(record.bodyCenterStepCss, 0, 'sleep boundary no root pop');
              if (!calm && frame > 0) assert.ok(record.bodyCenterStepCss <= 96 / fps, `${fps}fps at ${at}: ${record.bodyCenterStepCss}px`);
              if (calm && frame >= 0) {
                firstStatic ||= record.hash;
                assert.equal(record.hash, firstStatic, 'calm mode jumps immediately to one complete static pose');
              }
            }
          }
        } finally { driver.dispose(); }
      }
    } finally { delete globalThis.Path2D; delete globalThis.document; delete globalThis.window; delete globalThis.Image; }
  });
