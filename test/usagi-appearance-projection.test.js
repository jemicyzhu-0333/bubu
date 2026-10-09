'use strict';
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
// Fresh recovery behavior checks. Old validation totals are not reused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { appearance } = require('../src/capabilities/companion/presentation/usagi-appearance.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { USAGI_FORM: form } = require('../src/content/companion/usagi-form.mjs');
const { default: rig } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const support = require('../src/capabilities/companion/presentation/usagi-support.mjs').default;

function context() {
  return { calls: [], save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, closePath() {}, fill() {}, stroke() {},
    transform(...v) { this.calls.push(['transform', ...v]); },
    translate(...v) { this.calls.push(['translate', ...v]); }, scale(...v) { this.calls.push(['scale', ...v]); } };
}
const hats = PET_APPEARANCE_ITEMS.filter(item => ['usagi.sunhat', 'usagi.tiny-crown'].includes(item.id));

test('classic profile hats are seated at the canonical skull midpoint', () => {
  assert.equal(hats.length, 2);
  for (const item of hats) {
    const ctx = context();
    assert.equal(appearance(ctx, { item, layer: 'front', form, view: 'profile' }), true);
    const translations = ctx.calls.filter(call => call[0] === 'translate');
    assert.equal(translations[0][1] + translations[1][1], (26 + 44) / 2);
    assert.equal(translations[1][2], 0);
  }
});

test('classic front, three-quarter and back headwear keep their original placement', () => {
  for (const item of hats) for (const view of ['front', 'three-quarter', 'back']) {
    const ctx = context(); appearance(ctx, { item, layer: 'front', form, view });
    assert.deepEqual(ctx.calls.filter(call => call[0] === 'translate')[1], ['translate', -8, 0]);
  }
});

test('near ear clasps keep their moving-ear attachment and later order than hats', () => {
  const clips = PET_APPEARANCE_ITEMS.filter(item => item.exclusiveGroup === 'usagi.earwear');
  for (const clip of clips) for (const view of ['front', 'three-quarter', 'profile', 'back']) {
    const ctx = context(); appearance(ctx, { item: clip, layer: 'front', form, view });
    assert.deepEqual(ctx.calls.filter(call => call[0] === 'translate')[1], ['translate', view === 'three-quarter' ? 5 : 4, 0]);
    assert.equal(rig.views[view].anchors['usagi.earwear'].bone, 'ear_r');
    for (const hat of hats) assert.ok(clip.z > hat.z);
  }
});

test('classic hats retain the unchanged moving root matrix during hop and meditation', () => {
  const artist = createRigArtist({ fallback: support, paths: { get: d => ({ d }) } });
  for (const id of ['happy-hop', 'meditate']) for (const progress of [0, .2, .5, .8]) {
    const action = PET_ACTIONS[id], motion = action.motion;
    const artwork = artist.resolve(rig, { action, motion, view: 'profile', progress });
    assert.equal(artwork.pose.sample.motion, motion, `${id}: real catalogue motion, not an idle fallback`);
    const before = JSON.stringify(artwork.pose.world);
    for (const item of hats) {
      const ctx = context();
      assert.equal(artist.appearance(ctx, { item, layer: 'front', form, view: 'profile', artwork }), true);
      assert.deepEqual(ctx.calls.find(call => call[0] === 'transform').slice(1), artwork.pose.world.root);
    }
    assert.equal(JSON.stringify(artwork.pose.world), before);
  }
});
