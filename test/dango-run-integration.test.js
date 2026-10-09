'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RUN } = require('../assets/companion/dango/clips/run/dango-run.mjs');
const { rasterFixture, recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const ACTION = Object.freeze({ id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' });
const identity = [1, 0, 0, 1, 0, 0];
const wait = () => new Promise(resolve => setImmediate(resolve));
const loadImage = async src => ({ src, width: 256, height: 256 });
const intent = overrides => ({ action: ACTION, motion: 'dash', progress: .255, view: 'three-quarter', ...overrides });
function make(options = {}) {
  return createDangoRasterArtist({ manifest: rasterFixture(), runClip: DANGO_RUN, loadImage, ...options });
}
function bodyCalls(artist, artwork) {
  const context = recordingContext();
  artist.body(context, PALETTES.pink, artwork.view, artwork);
  return context.calls;
}

test('run clip composes one authored physical frame with the independent production face', async () => {
  const artist = make(); await artist.ready({ all: true });
  const artwork = artist.resolveArtwork(intent());
  assert.equal(artwork.ready, true); assert.ok(artwork.clip);
  const body = bodyCalls(artist, artwork);
  assert.equal(body.length, 1); assert.deepEqual(body[0].rect, DANGO_RUN.spriteRect);
  const sprite = DANGO_RUN.manifest.resourceGroups[0].assets.find(asset => asset.id === artwork.clip.frame);
  assert.equal(new URL(body[0].image.src).pathname, new URL(sprite.src, DANGO_RUN.baseUrl).pathname);
  const context = recordingContext();
  artist.face(context, PALETTES.pink, {}, false, artwork.view, null, artwork);
  assert.equal(context.calls.length, 3, 'two live eyes and one live mouth are separate draws');
  assert.ok(context.calls.every(call => call.image.src.startsWith('file:///fixture/')));
  assert.ok(context.calls.every(call => call.matrix.every(Number.isFinite)));
  assert.deepEqual(context.calls.at(-1).matrix, artwork.clip.faceTransform);
  const actions = recordingContext();
  artist.action(actions, { artwork, action: ACTION, palette: PALETTES.pink, layer: 'back' });
  artist.action(actions, { artwork, action: ACTION, palette: PALETTES.pink, layer: 'front' });
  const parts = Object.values(artwork.data.parts).map(part => new URL(part.src, 'file:///fixture/').pathname);
  assert.ok(actions.calls.every(call => !parts.includes(new URL(call.image.src).pathname)), 'procedural arms are suppressed too');
  assert.equal(artist.bodyForeground(recordingContext(), PALETTES.pink, artwork), false);
  artist.dispose();
});

test('loading and failed run resources fail closed to the existing rig', async () => {
  const target = new URL(DANGO_RUN.manifest.resourceGroups[0].assets.at(-1).src, DANGO_RUN.baseUrl).pathname;
  let release;
  const artist = make({ loadImage: src => new URL(src).pathname === target ? new Promise(resolve => { release = () => resolve({ src, width: 256, height: 256 }); }) : loadImage(src) });
  const ready = artist.ready({ all: true }); await wait();
  const before = artist.resolveArtwork(intent());
  assert.equal(before.clip, null); assert.equal(before.clipStatus, 'resource-loading'); assert.equal(before.layeredReady, true);
  assert.ok(bodyCalls(artist, before)[0].image.src.startsWith('file:///fixture/'));
  release(); await ready;
  assert.ok(artist.resolveArtwork(intent()).clip); artist.dispose();
  const failed = make({ loadImage: async src => { if (new URL(src).pathname === target) throw Error('intentional test failure'); return loadImage(src); } });
  await failed.ready({ all: true });
  const fallback = failed.resolveArtwork(intent());
  assert.equal(fallback.clip, null); assert.equal(fallback.clipStatus, 'resource-failed'); assert.equal(fallback.ready, true);
  assert.equal(failed.cacheStats().source.failed, 1);
  assert.ok(bodyCalls(failed, fallback)[0].image.src.startsWith('file:///fixture/')); failed.dispose();
});

test('run sample stays scoped to the naked chase-laser action, matching view and full motion', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const change of [
    { action: { ...ACTION, id: 'chase-butterfly' } }, { motion: 'walk' },
    { view: 'front' }, { view: 'back' }, { view: 'three-quarter-left' }, { view: 'three-quarter-right' }, { action: { ...ACTION, prop: 'book' } },
    { appearance: { items: [{ id: 'boots', renderKey: 'boots' }] } },
    { appearance: { items: [{ renderKey: 'boots' }] } },
    { calmVisual: true }, { reducedMotion: true }, { state: 'dragged' }
  ]) assert.equal(artist.resolveArtwork(intent(change)).clip, null, JSON.stringify(change));
  assert.ok(artist.resolveArtwork(intent({ view: 'profile' })).clip, 'approved profile compatibility alias resolves to the two-eye view');
  assert.ok(artist.resolveArtwork(intent({ appearance: { items: [] } })).clip);
  artist.dispose();
});

test('24 authored poses wrap continuously at the 950ms seam on the existing action clock', async () => {
  const artist = make(); await artist.ready({ all: true });
  const frames = new Set(), poses = new Set(), strideMs = DANGO_RUN.manifest.durationMs;
  assert.equal(strideMs, 950);
  for (let i = 0; i < 24; i++) {
    const artwork = artist.resolveArtwork(intent({ progress: ((i + .25) / 24 * strideMs) / ACTION.duration }));
    assert.ok(artwork.clip); frames.add(artwork.clip.frame); poses.add(artwork.clip.poseId);
  }
  assert.equal(frames.size, 24); assert.equal(poses.size, 24);
  const at = ms => artist.resolveArtwork(intent({ progress: ms / ACTION.duration })).clip;
  assert.equal(at(0).frame, at(strideMs).frame);
  assert.equal(at(0).frame, at(ACTION.duration).frame);
  assert.notEqual(at(strideMs - .01).frame, at(strideMs).frame);
  assert.deepEqual(at(0).semanticAnchors, at(strideMs).semanticAnchors);
  assert.deepEqual(at(0).faceTransform, at(strideMs).faceTransform);
  artist.dispose();
});

test('legacy root lean and squash are suppressed only when a run frame is actually selected', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const active of [true, false]) {
    const options = intent(active ? {} : { action: { ...ACTION, id: 'chase-butterfly' } });
    const artwork = artist.resolveArtwork(options), context = recordingContext();
    artist.applyMotionTransform(context, 'dash', options.progress, { action: options.action, artwork, size: 146, bodySize: 66 });
    context.drawImage({}, 0, 0);
    if (active) assert.deepEqual(context.calls[0].matrix, identity);
    else assert.notDeepEqual(context.calls[0].matrix, identity);
    const offset = artist.motionOffset('dash', options.progress, false, { action: ACTION });
    assert.equal(offset.y, 0, 'authored lift is not doubled by legacy motionOffset');
  }
  artist.dispose();
});

test('run option preserves the artist protocol and face attachment is finite through every pose', async () => {
  const artist = make(), baseline = make({ runClip: null });
  assert.deepEqual(Object.keys(artist).sort(), Object.keys(baseline).sort());
  await artist.ready({ all: true });
  for (let i = 0; i < 24; i++) {
    const artwork = artist.resolveArtwork(intent({ progress: (i + .25) / 240 }));
    const point = applyPoint(artwork.clip.faceTransform, 33, 33);
    assert.ok(point.every(Number.isFinite));
  }
  artist.dispose(); baseline.dispose();
});

test('live expression and blink select separate face sprites without changing the authored body', async () => {
  const artist = make(); await artist.ready({ all: true });
  const normal = artist.resolveArtwork(intent({ face: { eyes: 'neutral', mouth: 'neutral' } }));
  const expressive = artist.resolveArtwork(intent({ action: { ...ACTION, expression: 'play.chase' }, face: { eyes: 'surprised', mouth: 'open', eyeOffsetX: 1, eyeOffsetY: -.5 }, expressionId: 'react.startled' }));
  assert.equal(normal.clip.frame, expressive.clip.frame);
  assert.equal(normal.key, expressive.key, 'changing expression does not create another body frame');
  const collect = (artwork, blinking) => {
    const context = recordingContext(); artist.face(context, PALETTES.pink, {}, blinking, artwork.view, null, artwork); return context.calls;
  };
  const ordinary = collect(normal, false), blinking = collect(normal, true), changed = collect(expressive, false);
  assert.notEqual(blinking[0].image.src, ordinary[0].image.src);
  assert.notEqual(blinking[1].image.src, ordinary[1].image.src);
  assert.equal(blinking[2].image.src, ordinary[2].image.src, 'blink affects eyes only');
  assert.notEqual(changed[0].image.src, ordinary[0].image.src);
  assert.notEqual(changed[2].image.src, ordinary[2].image.src);
  assert.deepEqual(changed.at(-1).matrix, expressive.clip.faceTransform);
  const anchor = expressive.data.face.eyes.surprised[0].pivot;
  const expected = applyPoint(expressive.clip.faceTransform, anchor[0] + 1, anchor[1] - .5);
  const actual = applyPoint(changed[0].matrix, ...anchor);
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-9);
  artist.dispose();
});

test('wrong decoded clip dimensions and missing base layers never replace the ready fallback', async () => {
  const target = new URL(DANGO_RUN.manifest.resourceGroups[0].assets[0].src, DANGO_RUN.baseUrl).pathname;
  const wrong = make({ loadImage: async src => ({ src, width: new URL(src).pathname === target ? 128 : 256, height: 256 }) });
  await wrong.ready({ all: true });
  const invalid = wrong.resolveArtwork(intent());
  assert.equal(invalid.clip, null); assert.equal(invalid.clipStatus, 'invalid-resource-dimensions');
  assert.equal(invalid.ready, true); wrong.dispose();
  const manifest = rasterFixture(), failedBase = new URL(manifest.views['three-quarter'].body.src, manifest.baseUrl).pathname;
  const failed = make({ manifest, loadImage: async src => { if (new URL(src).pathname === failedBase) throw Error('base fixture failure'); return loadImage(src); } });
  await failed.ready({ all: true });
  const artwork = failed.resolveArtwork(intent());
  assert.equal(artwork.clip, null); assert.equal(artwork.clipStatus, 'base-art-not-ready');
  assert.equal(artwork.layeredReady, false);
  assert.ok(new URL(bodyCalls(failed, artwork)[0].image.src).pathname.endsWith(manifest.views['three-quarter'].neutral.src));
  failed.dispose();
});

test('object-shaped production palettes recolor the clip without changing the artist protocol', async () => {
  const createSurface = (width, height) => ({ width, height, getContext: () => ({
    drawImage() {}, clearRect() {}, putImageData() {},
    getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) })
  }) });
  const artist = make({ createSurface }); await artist.ready({ all: true });
  const artwork = artist.resolveArtwork(intent()), context = recordingContext();
  assert.equal(Array.isArray(PALETTES.forest), false);
  assert.equal(artist.body(context, PALETTES.forest, artwork.view, artwork), true);
  assert.equal(context.calls.length, 1); assert.equal(artist.cacheStats().runSample.entries, 1);
  artist.dispose();
});
