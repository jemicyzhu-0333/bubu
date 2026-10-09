'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const open = ['curious', 'focused', 'half', 'wide', 'droopy', 'sparkle', 'surprised', 'determined', 'pleading', 'shy', 'waiting'];
const preserved = ['neutral', 'closed', 'sleepy', 'smile', 'content'];
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function draw(artist, artwork, blink = false) {
  const context = recordingContext();
  artist.face(context, PALETTES.pink, artwork.face, blink, artwork.view, null, artwork);
  return context.calls;
}
test('all eleven open glyphs retain source identity, near eye and pivots while correcting far-eye height in all3q views', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true });
  try {
    for (const view of ['three-quarter', 'three-quarter-left', 'three-quarter-right']) for (const eyes of open) {
      for (const openness of [.25, .35, .7, 1, 1.15]) {
        const artwork = artist.resolveArtwork({ view, face: { eyes, mouth: 'neutral', openness }, expressionElapsedMs: 0 });
        const after = draw(artist, artwork), raw = draw(artist, { ...artwork, view: 'front' });
        const neutral = artwork.data.face.eyes.neutral;
        const far = neutral[0].rect[2] < neutral[1].rect[2] ? 0 : 1, closest = 1-far;
        assert.deepEqual(after[closest], raw[closest]); assert.deepEqual(after[2], raw[2]);
        assert.strictEqual(after[far].image, raw[far].image); assert.deepEqual(after[far].rect, raw[far].rect);
        for (const index of [0,1,2,4]) near(after[far].matrix[index],raw[far].matrix[index]);
        const h=after.slice(0,2).map(call=>call.rect[3]*call.matrix[3]);
        near(h[0]/h[1],neutral[0].rect[3]/neutral[1].rect[3]);
        const pivot=artwork.data.face.eyes[eyes][far].pivot;
        near(after[far].matrix[3]*pivot[1]+after[far].matrix[5],raw[far].matrix[3]*pivot[1]+raw[far].matrix[5]);
      }
    }
  } finally { artist.dispose(); }
});
test('approved canonical, closed/smile/content rhythm and every blink stay unchanged', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true });
  try {
    for (const eyes of [...open,...preserved]) for (const view of ['front','three-quarter']) {
      const artwork=artist.resolveArtwork({view,face:{eyes,mouth:'smile',openness:1}});
      assert.deepEqual(draw(artist,artwork,true),draw(artist,{...artwork,view:'front'},true));
      if(preserved.includes(eyes)||view==='front') assert.deepEqual(draw(artist,artwork),draw(artist,{...artwork,view:'front'}));
    }
  } finally { artist.dispose(); }
});
