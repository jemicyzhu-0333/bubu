'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pixels, difference, summarize } = require('./pixels.mjs');
const { createRenderHarness, loadSource } = require('./runtime-harness.mjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { galleryVariants, availableEntry, outfitForVariant } = require('./selection.mjs');

test('gallery compares current forms and skips only catalogue entries absent from an old version', () => {
  const current = { wardrobe: { PET_APPEARANCE_ITEMS: [{ id: 'usagi.new-item', formId: 'usagi' }] } };
  const baseline = { wardrobe: { PET_APPEARANCE_ITEMS: [] } };
  const variants = galleryVariants(current, baseline, 'usagi', true);
  assert.equal(variants[0].source, current);
  assert.equal(variants[1].source, baseline);
  assert.equal(availableEntry(variants[1], 'appearance', 'usagi.new-item'), false);
  assert.equal(availableEntry(variants[2], 'appearance', 'usagi.new-item'), true);
  assert.equal(availableEntry(variants[0], 'appearance', 'usagi.new-item'), false);
  const dango = galleryVariants(current, baseline, 'dango', true);
  assert.equal(dango[0].skin, 'pink'); assert.equal(dango[1].skin, 'pink');
  assert.equal(dango[0].source, baseline); assert.equal(dango[1].source, current);
});

test('a chosen Usagi outfit never strips Dango comparison clothing', () => {
  const looks = [{ id: 'garden', itemIds: ['usagi.garden-apron'] }];
  assert.deepEqual(outfitForVariant({ skin: 'usagi' }, true, 'garden', looks), looks[0].itemIds);
  assert.equal(outfitForVariant({ skin: 'pink' }, true, 'garden', looks), true);
  assert.equal(outfitForVariant({ skin: 'usagi' }, false, 'garden', looks), false);
});

function raster(width, height, data) {
  return { width, height, getContext: () => ({ getImageData: () => ({ width, height, data: Uint8ClampedArray.from(data) }) }) };
}
test('pixel evidence distinguishes transparent, frozen, moving and edge-touching frames', () => {
  const blank = pixels(raster(2, 2, Array(16).fill(0)));
  assert.equal(blank.occupied, 0);
  const visible = pixels(raster(2, 2, [255, 100, 0, 255, ...Array(12).fill(0)]));
  assert.equal(visible.occupied, 1); assert.equal(visible.edge, 1);
  const delta = difference(blank.image, visible.image);
  assert.equal(delta.changedPixels, 1); assert.equal(delta.changedOfActive, 1);
  assert.equal(summarize([visible, visible]).frozen, true);
  assert.equal(summarize([blank, visible]).uniqueFrames, 2);
  assert.equal(summarize([blank, visible]).blankFrames, 1);
});
test('dimension mismatch cannot be misreported as a zero-difference frame', () => {
  assert.equal(difference({ width: 1, height: 1 }, { width: 2, height: 1 }), null);
});
test('gallery exposes only loopback read-only preview and whitelisted source trees', async () => {
  const { startGalleryServer } = await import('./server.mjs');
  const server = await startGalleryServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/current/src/content/expressions.mjs')).status, 200);
    assert.equal((await fetch(base + '/current/AGENTS.md')).status, 404);
    assert.equal((await fetch(base + '/config.json', { method: 'POST' })).status, 405);
    const config = await (await fetch(base + '/config.json')).json(); assert.equal(config.baselineAvailable, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

const canvasPackage = process.env.USAGI_CANVAS_PACKAGE;
test('production renderer instances use independent channels, and their frame clocks start at zero', {
  skip: canvasPackage ? false : 'Optional real-Canvas backend not configured; use USAGI_CANVAS_PACKAGE for this diagnostic'
}, async () => {
  const backend = require(canvasPackage);
  const saved = { Path2D: globalThis.Path2D, document: globalThis.document, window: globalThis.window, Image: globalThis.Image };
  const { installOffscreenImages } = await import('./offscreen-images.mjs');
  installOffscreenImages(backend);
  globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const source = await loadSource(pathToFileURL(path.resolve(__dirname, '../..')).href);
    const a = createRenderHarness(source, { blink: false }), b = createRenderHarness(source, { blink: false });
    a.select('action', 'read-book'); b.select('action', 'wave');
    a.draw(0); b.draw(0);
    for (let t = 16; t <= 800; t += 16) { a.draw(t); b.draw(t); }
    const first = a.draw(816), second = b.draw(816);
    assert.notEqual(first.state.renderChannel, second.state.renderChannel);
    assert.equal(first.state.animNow, 816); assert.equal(second.state.animNow, 816);
    assert.notEqual(pixels(a.body).hash, pixels(b.body).hash);
    const isolated = createRenderHarness(source, { blink: false });
    isolated.select('action', 'read-book'); isolated.draw(0); isolated.draw(800); isolated.draw(816);
    assert.equal(pixels(a.body).hash, pixels(isolated.body).hash, 'interleaved read renderer matches a renderer played alone');
    a.dispose(); b.dispose(); isolated.dispose();
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete globalThis[key] : globalThis[key] = value;
  }
});
