'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUsagiRasterWardrobe, validateUsagiWardrobe } = require('../src/capabilities/companion/presentation/usagi-raster-wardrobe.mjs');
const { createRasterPainter } = require('../src/capabilities/companion/presentation/raster/paint.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { usagiPartLayer } = require('../src/capabilities/companion/presentation/usagi-garment-depth.mjs');
const rig = require('../assets/companion/usagi/rig/usagi.rig.mjs').default;

const wait = () => new Promise(resolve => setImmediate(resolve));
const image = async src => ({ src, width: 10, height: 12 });
const item = { id: 'usagi.moon-boots', formId: 'usagi', renderKey: 'usagi-moon-boots',
  exclusiveGroup: 'usagi.footwear', parts: ['front'] };
const artwork = view => ({ kind: 'rig', key: 'usagi@1', view, drawnView: view,
  pose: { world: { root: [1, 0, 0, 1, 0, 0], leg_l: [1, 0, 0, 1, 2, -3], leg_r: [1, 0, 0, 1, -1, 4] } } });
function fixture() {
  const parts = view => ({ back: [], front: ['l', 'r'].map(side => ({ src: `${view}-${side}.png`,
    bone: `leg_${side}`, rect: [side === 'l' ? 15 : 39, 59, 11, 9] })) });
  return { id: 'usagi-outfit-test', version: 1, baseUrl: 'file:///test-assets/',
    appearance: { 'usagi-moon-boots': { itemId: item.id, slot: item.exclusiveGroup,
      allowedViews: ['front', 'profile'], views: { front: parts('front'), profile: parts('profile') } } } };
}
function context() {
  return { globalAlpha: 1, imageSmoothingEnabled: false, calls: [],
    beginPath() {}, moveTo() {}, lineTo() {}, ellipse() {}, closePath() {}, clip() {}, fill() {},
    save() {}, restore() {}, transform(...matrix) { this.calls.push(['matrix', matrix]); },
    drawImage(value, ...rect) { this.calls.push(['image', value.src, rect, this.imageSmoothingEnabled]); } };
}

test('both boot images must load before original feet are hidden or either replacement is painted', async () => {
  let release;
  const wardrobe = createUsagiRasterWardrobe({ manifest: fixture(), loadImage: src => src.includes('front-r.png')
    ? new Promise(resolve => { release = () => resolve({ src, width: 10, height: 12 }); }) : image(src) });
  const outfit = { items: [item] }, pending = wardrobe.ready();
  await wait();
  const cold = wardrobe.resolve(artwork('front'), outfit);
  assert.equal(cold.ready, false);
  assert.equal(cold.pending, true);
  assert.equal(cold.wardrobe.ready, false);
  assert.deepEqual(cold.hiddenRigBones, []);
  assert.equal(wardrobe.appearance(context(), { item, artwork: cold }), false);
  release(); await pending;
  const loaded = wardrobe.resolve(artwork('front'), outfit);
  assert.equal(loaded.ready, true);
  assert.equal(loaded.pending, false);
  assert.deepEqual(loaded.hiddenRigBones, ['leg_l', 'leg_r']);
  const ctx = context(); wardrobe.appearance(ctx, { item, artwork: loaded });
  assert.equal(ctx.calls.filter(call => call[0] === 'image').length, 2);
  assert.deepEqual(ctx.calls.filter(call => call[0] === 'matrix').map(call => call[1]),
    [loaded.pose.world.leg_l, loaded.pose.world.leg_r]);
  assert.ok(ctx.calls.filter(call => call[0] === 'image').every(call => call[3] === true));
  const bare = wardrobe.resolve(artwork('front'), { items: [] });
  assert.deepEqual(bare.hiddenRigBones, []);
  assert.notEqual(bare.key, loaded.key);
  wardrobe.dispose();
});

test('Usagi retains its authored profile and reports unsupported garment views', async () => {
  const wardrobe = createUsagiRasterWardrobe({ manifest: fixture(), loadImage: image });
  await wardrobe.ready();
  const profile = wardrobe.resolve(artwork('profile'), { items: [item] });
  const ctx = context(); wardrobe.appearance(ctx, { item, artwork: profile });
  assert.ok(ctx.calls.filter(call => call[0] === 'image').every(call => call[1].includes('profile-')));
  const unsupported = wardrobe.resolve(artwork('back'), { items: [item] });
  assert.equal(unsupported.wardrobe.ready, false);
  assert.deepEqual(unsupported.wardrobe.missing, ['appearance:usagi-moon-boots@back']);
  assert.deepEqual(unsupported.hiddenRigBones, []);
  wardrobe.dispose();
});

test('failed replacement loading leaves the original rig feet available', async () => {
  const wardrobe = createUsagiRasterWardrobe({ manifest: fixture(), loadImage: async () => { throw new Error('decode failed'); } });
  await wardrobe.ready();
  const resolved = wardrobe.resolve(artwork('front'), { items: [item] });
  assert.equal(resolved.wardrobe.failed, true);
  assert.equal(resolved.wardrobe.pending, false);
  assert.deepEqual(resolved.hiddenRigBones, []);
  wardrobe.dispose();
});

test('a static garment does not change the body cache key for facial or loading revisions', async () => {
  const wardrobe = createUsagiRasterWardrobe({ manifest: fixture(), loadImage: image });
  const bare = wardrobe.resolve(artwork('front'), { items: [] });
  await wardrobe.ready();
  const later = wardrobe.resolve({ ...artwork('front'), face: { eyes: 'surprised' } }, { items: [] });
  assert.equal(bare.key, later.key);
  assert.equal(wardrobe.cacheStats().entries, 4);
  wardrobe.dispose(); assert.equal(wardrobe.cacheStats().entries, 0);
});

test('garment descriptors reject escaped paths, unknown bones and one-legged footwear', () => {
  const manifest = fixture();
  manifest.appearance[item.renderKey].views.front.front[0].src = '../outside.png';
  assert.throws(() => validateUsagiWardrobe(manifest), /invalid raster sprite/);
  const unknown = fixture(); unknown.appearance[item.renderKey].views.front.front[0].bone = 'invented';
  assert.throws(() => validateUsagiWardrobe(unknown), /invalid Usagi garment bone/);
  const missing = fixture(); missing.appearance[item.renderKey].views.front.front.pop();
  assert.throws(() => validateUsagiWardrobe(missing), /needs both legs/);
});

test('smooth clothing is opt-in and preserves Dango nearest-pixel painting by default', () => {
  const sprite = { src: 'sample.png', rect: [0, 0, 10, 10] }, source = { get: () => ({ src: sprite.src }) };
  for (const smooth of [false, true]) {
    const painter = createRasterPainter({ source, ...(smooth ? { imageSmoothing: true } : {}) });
    const ctx = context(); painter.paint(ctx, sprite, {});
    assert.equal(ctx.calls[0][3], smooth); painter.dispose();
  }
});

test('wrapped three-quarter portraits put the far paw behind the body and only repaint the near paw above cloth', () => {
  const artist = createRigArtist({ fallback: { action: () => false }, partLayer: usagiPartLayer,
    paths: { get: d => ({ d }) } });
  const resolved = artist.resolve(rig, { view: 'three-quarter', calmVisual: true });
  const wrapped = { ...resolved, wardrobe: { wrapsBody: true } };
  const painted = [], ctx = { save() {}, restore() {}, transform() {}, fill: path => painted.push(path.d), stroke() {} };
  const data = rig.views['three-quarter'];
  const pathFor = bone => data.parts.find(part => part.bone === bone).shapes[0].d;
  const far = pathFor('hand_l'), near = pathFor('hand_r'), body = pathFor('root');
  artist.body(ctx, {}, 'three-quarter', wrapped, { fit: true });
  assert.ok(painted.indexOf(far) < painted.indexOf(body), 'far paw is occluded by the opaque torso');
  assert.ok(painted.indexOf(near) > painted.indexOf(body), 'near paw remains in front');
  painted.length = 0;
  artist.body(ctx, {}, 'three-quarter', { ...wrapped, deferPortraitForeground: true }, { fit: true });
  assert.equal(painted.includes(near), false, 'foreground paw is not baked beneath the clothes as a duplicate');
  assert.ok(painted.includes(far));
  painted.length = 0;
  artist.portraitForeground(ctx, {}, 'three-quarter', wrapped);
  assert.ok(painted.includes(near)); assert.equal(painted.includes(far), false, 'portrait does not resurrect the far paw');
  painted.length = 0;
  artist.portraitForeground(ctx, {}, 'three-quarter', resolved);
  assert.ok(painted.includes(near) && painted.includes(far), 'bare canonical keeps its existing rest pixels');
});

test('a wrapped back view hides both paws behind the body while frontal contact paws remain visible', () => {
  const artist = createRigArtist({ fallback: { action: () => false }, partLayer: usagiPartLayer,
    paths: { get: d => ({ d }) } });
  for (const view of ['front', 'back']) {
    const resolved = { ...artist.resolve(rig, { view, calmVisual: true }), wardrobe: { wrapsBody: true } };
    const painted = [], ctx = { save() {}, restore() {}, transform() {}, fill: path => painted.push(path.d), stroke() {} };
    artist.portraitForeground(ctx, {}, view, resolved);
    for (const bone of ['hand_l', 'hand_r']) {
      const paw = rig.views[view].parts.find(part => part.bone === bone).shapes[0].d;
      assert.equal(painted.includes(paw), view === 'front');
    }
  }
});

test('depth-changing wardrobe readiness has a bounded distinct body key', async () => {
  const manifest = fixture(); manifest.appearance[item.renderKey].wrapsBody = true;
  const wardrobe = createUsagiRasterWardrobe({ manifest, loadImage: image });
  const cold = wardrobe.resolve(artwork('front'), { items: [item] });
  assert.equal(cold.wardrobe.wrapsBody, false);
  await wardrobe.ready();
  const worn = wardrobe.resolve(artwork('front'), { items: [item] });
  assert.equal(worn.wardrobe.wrapsBody, true);
  assert.notEqual(cold.key, worn.key);
  for (let phase = 0; phase < 50; phase++) assert.equal(wardrobe.resolve({ ...artwork('front'), progress: phase / 50 }, { items: [item] }).key, worn.key);
  wardrobe.dispose();
});
