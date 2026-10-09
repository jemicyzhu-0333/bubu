import assert from 'node:assert/strict';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { garmentView } from '../src/capabilities/companion/presentation/dango-raster-appearance.mjs';
const matches = (call, sprite) => new URL(call.image.src).pathname.endsWith('/' + sprite.src);
export function classifiedWardrobeCalls(calls, artwork, items) {
  const active = items.filter(item => !artwork.suppressedAppearanceSlots.includes(item.exclusiveGroup));
  const sprites = active.flatMap(item => Object.values(garmentView(DANGO_RASTER.appearance[item.renderKey], artwork.view) || {}).flat());
  const earSprites = ['ear-left', 'ear-right'].map(key => artwork.data.parts[key]);
  const garments = calls.filter(call => sprites.some(sprite => matches(call, sprite)));
  const ears = calls.filter(call => earSprites.some(sprite => matches(call, sprite)));
  assert.equal(calls.length, garments.length + ears.length, 'no unclassified extra wardrobe draw');
  const hat = active.find(item => item.renderKey === 'sunhat');
  const expected = artwork.wardrobe.ready && artwork.layeredReady && hat ? 2 : 0;
  assert.equal(ears.length, expected, 'exactly two ready static ear supports only under a sunhat');
  if (expected) {
    for (const sprite of earSprites) assert.equal(ears.filter(call => matches(call, sprite)).length, 1);
    for (const ear of ears) assert.deepEqual(ear.matrix, [1, 0, 0, 1, 0, 0]);
    const hats = Object.values(garmentView(DANGO_RASTER.appearance.sunhat, artwork.view)).flat();
    const firstHat = calls.findIndex(call => hats.some(sprite => matches(call, sprite)));
    assert.ok(firstHat >= 2 && ears.every(ear => calls.indexOf(ear) < firstHat), 'ear support is under hat cloth');
  }
  return garments;
}
export function expectedHiddenParts(items) {
  return [...new Set(items.flatMap(item => item.renderKey === 'sunhat' ? ['ear-left', 'ear-right']
    : item.exclusiveGroup === 'footwear' ? ['foot-left', 'foot-right'] : []))];
}
export function assertSamePhysicalCache(dressed, bare) {
  assert.equal(dressed.key.split('|hide:')[0], bare.key.split('|hide:')[0], 'physical bitmap identity stays unchanged');
  assert.equal(dressed.key.split('|hide:')[1], dressed.hiddenParts.join(','));
  assert.equal(bare.key.split('|hide:')[1], bare.hiddenParts.join(','));
}
