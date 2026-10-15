import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDangoLimbSource } from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { rasterFixture } from '../test-support/dango-raster-fixture.mjs';
const baseUrl = new URL('../assets/companion/dango/raster/', import.meta.url).href;
const loadJson = async url => JSON.parse(fs.readFileSync(new URL(url)));
const px = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
const make = options => createDangoLimbSource({ baseUrl, loadJson, acceptContract: 2,
  loadImage: async () => ({ width: 1, height: 1 }), readPixels: px, ...options });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('null or malformed pixel reads fail the whole group without exposing manifest or pixels', async () => {
  for (const value of [null, {}, { width: 1, height: 1, data: [0, 0, 0, 0] }, { width: 1, height: 1, data: new Uint8ClampedArray(3) }]) {
    const source = make({ readPixels: () => value });
    assert.equal(await source.start(), 'failed');
    assert.equal(source.manifest(), null);
    assert.match(source.errors().join(), /pixels/);
  }
});

test('artist disposal cancels pending limb loads and late images cannot resurrect ready', async () => {
  const held = [], signals = []; let closed = 0;
  const source = make({ loadImage: (_url, { signal } = {}) => {
    signals.push(signal); return new Promise(resolve => held.push(resolve));
  } });
  const artist = createDangoRasterArtist({ manifest: rasterFixture(), limbs: source,
    loadImage: async () => ({ width: 1, height: 1 }) });
  const pending = artist.ready(); await tick(); assert.ok(held.length);
  artist.dispose();
  assert.equal(source.state(), 'disposed');
  assert.ok(signals.every(signal => signal?.aborted));
  await pending;
  for (const resolve of held) resolve({ width: 1, height: 1, close() { closed++; } });
  await tick();
  assert.equal(closed, held.length); assert.equal(source.state(), 'disposed');
  assert.equal(source.manifest(), null); assert.equal(await source.start(), 'disposed');
});

test('ready source disposal clears pixel ownership and decode images are released exactly once', async () => {
  let closed = 0, count = 0;
  const source = make({ loadImage: async () => { count++; return { width: 1, height: 1, close() { closed++; } }; } });
  await source.start();
  const key = source.manifest().sockets[0].src;
  assert.ok(source.pixels(key)); assert.equal(closed, count);
  source.dispose(); source.dispose();
  assert.equal(source.pixels(key), null); assert.equal(source.manifest(), null); assert.equal(closed, count);
});

test('disposal during JSON loading settles promptly and never starts images', async () => {
  let resolveJson, images = 0;
  const source = make({ loadJson: () => new Promise(resolve => { resolveJson = resolve; }),
    loadImage: async () => { images++; return {}; } });
  const pending = source.start(); await tick(); source.dispose();
  assert.equal(await pending, 'disposed'); resolveJson({}); await tick();
  assert.equal(images, 0); assert.equal(source.state(), 'disposed');
});

test('a single decode failure aborts siblings and closes late results without partial readiness', async () => {
  const held = []; let fail, closed = 0, first = true;
  const source = make({ loadImage: () => first ? (first = false, new Promise((_resolve, reject) => { fail = reject; }))
    : new Promise(resolve => held.push(resolve)) });
  const pending = source.start(); await tick(); fail(new Error('decode failed'));
  assert.equal(await pending, 'failed'); assert.equal(source.manifest(), null);
  for (const resolve of held) resolve({ width: 1, height: 1, close() { closed++; } });
  await tick(); assert.equal(closed, held.length); assert.equal(source.state(), 'failed');
});

test('raster disposal releases a decoded image at every pre-commit microtask boundary', async () => {
  const { createRasterSource } = await import('../src/capabilities/companion/presentation/raster/source.mjs');
  for (let steps = 0; steps < 8; steps++) {
    let closed = 0;
    const source = createRasterSource({ baseUrl: 'file:///raster-lifecycle/',
      loadImage: () => ({ width: 1, height: 1, close() { closed++; } }) });
    const pending = source.ready([{ src: 'image.png' }]);
    for (let i = 0; i < steps; i++) await Promise.resolve();
    source.dispose(); await pending; await Promise.resolve();
    assert.equal(closed, 1, `decoded resource ownership at microtask ${steps}`);
  }
});
