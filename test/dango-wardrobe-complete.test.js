'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { classifiedWardrobeCalls, expectedHiddenParts, assertSamePhysicalCache } = require('../test-support/dango-wardrobe-draw-assertions.mjs');
const items = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango');
const views = ['front', 'three-quarter', 'back'];
const image = async src => ({ src, width: 8, height: 8 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const sprites = (item, view) => Object.values(DANGO_RASTER.appearance[item.renderKey].views[view]).flat();
function paint(artist, artwork, items) {
  const context = recordingContext(), appearance = { items };
  for (const layer of ['back', 'front']) for (const item of items) {
    artist.appearance(context, { item, layer, artwork, appearance, palette: PALETTES.pink });
  }
  return classifiedWardrobeCalls(context.calls, artwork, items);
}

test('every Dango garment is complete or absent for each pending or failed source layer', async () => {
  for (const item of items) for (const view of views) for (const held of sprites(item, view)) {
    for (const failed of [false, true]) {
      let release;
      const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: src => {
        if (!new URL(src).pathname.endsWith(`/${held.src}`)) return image(src);
        return failed ? Promise.reject(new Error('missing garment layer')) : new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); });
      } });
      const ready = artist.ready({ all: true }); await tick();
      const input = { view, appearance: { items: [item] } }, artwork = artist.resolveArtwork(input);
      try {
        assert.equal(paint(artist, artwork, [item]).length, 0, `${item.id}/${view}/${held.src}/${failed}: no garment fragment`);
        assert.deepEqual(artwork.hiddenParts, [], 'missing footwear retains both original feet');
        if (!failed) {
          release(); await ready;
          const loaded = artist.resolveArtwork(input);
          assert.equal(paint(artist, loaded, [item]).length, sprites(item, view).length);
        }
      } finally { release?.(); await ready; artist.dispose(); }
    }
  }
});

test('whole-outfit fallback preserves original feet when boots are ready before another garment', async () => {
  const boots = items.find(item => item.renderKey === 'boots');
  for (const other of items.filter(item => item !== boots)) {
    const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: src => src.includes(`/wardrobe/${other.renderKey}-`)
      ? Promise.reject(new Error('other garment unavailable')) : image(src) });
    await artist.ready({ all: true });
    try {
      const outfit = [boots, other], artwork = artist.resolveArtwork({ view: 'front', appearance: { items: outfit } });
      assert.equal(paint(artist, artwork, outfit).length, 0, other.id);
      assert.deepEqual(artwork.hiddenParts, [], `${other.id}: both bare feet remain during atomic fallback`);
    } finally { artist.dispose(); }
  }
});

test('all 99 cross-slot pairs use one readiness decision and only complete outfits replace body parts', async () => {
  const pairs = items.flatMap((a, index) => items.slice(index + 1).filter(b => a.exclusiveGroup !== b.exclusiveGroup).map(b => [a, b]));
  assert.equal(pairs.length, 99);
  for (const pair of pairs) for (const view of views) {
    const held = sprites(pair[1], view)[0];
    let release;
    const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: src => new URL(src).pathname.endsWith(`/${held.src}`)
      ? new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); }) : image(src) });
    const complete = artist.ready({ all: true }); await tick();
    try {
      const input = { view, appearance: { items: pair } }, pending = artist.resolveArtwork(input);
      assert.equal(paint(artist, pending, pair).length, 0, `${pair.map(item => item.id)}/${view}`);
      assert.deepEqual(pending.hiddenParts, []);
      release(); await complete;
      const ready = artist.resolveArtwork(input), expected = pair.flatMap(item => sprites(item, view)).length;
      assert.equal(paint(artist, ready, pair).length, expected);
      assert.deepEqual(ready.hiddenParts, expectedHiddenParts(pair));
    } finally { release?.(); await complete; artist.dispose(); }
  }
});

test('late unrelated garment completion does not repaint a newer bare or complete outfit selection', async () => {
  for (const old of items) {
    const other = items.find(item => item.id !== old.id && item.exclusiveGroup !== old.exclusiveGroup);
    const pending = new Map();
    const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: src => src.includes(`/wardrobe/${old.renderKey}-`)
      ? new Promise(resolve => pending.set(src, () => resolve({ src, width: 8, height: 8 }))) : image(src) });
    await artist.ready();
    const original = artist.resolveArtwork({ view: 'front', appearance: { items: [old] } }); await tick();
    assert.equal(original.ready, false);
    const nextInput = { view: 'front', appearance: { items: [other] } };
    artist.resolveArtwork(nextInput); await tick();
    const next = artist.resolveArtwork(nextInput), before = paint(artist, next, [other]);
    pending.forEach(release => release()); await tick();
    const after = artist.resolveArtwork(nextInput);
    assert.deepEqual(paint(artist, after, [other]), before);
    assert.equal(after.key, next.key);
    assert.deepEqual(paint(artist, artist.resolveArtwork({ view: 'front' }), []), []);
    artist.dispose();
  }
});
