import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(process.env.BUBU_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
const { PET_ACTIONS } = await imp('src/content/behaviors.mjs');
const { sampleRasterPose } = await imp('src/capabilities/companion/presentation/dango-raster-pose.mjs');
const { createSourceContactPoseSelector } = await imp('src/capabilities/companion/presentation/dango-source-contact-pose.mjs');
const { createDangoRasterArtist } = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const { WORKOUT_CONTACT_ID: ID, workoutContactSpriteKeys: keys } = await imp('src/capabilities/companion/presentation/dango-workout-contact-pose.mjs');
const b = createRequire(path.join(root, 'package.json'))('@napi-rs/canvas');
const options = (instance = 'one', p = .25, patch = {}) => ({ action: { ...PET_ACTIONS.workout }, motion: 'pushup', view: 'front',
  progress: p, elapsedMs: p * 8500, actionInstanceKey: instance, channel: 'pet', state: 'idle', ...patch });
const pose = o => sampleRasterPose(DANGO_RASTER.views.front, { ...o, toolSprites: Object.fromEntries(
  Object.entries(DANGO_RASTER.tools).map(([k, v]) => [k, { width: v.rect[2], height: v.rect[3], anchors: v.anchors }])) });
const image = u => { const x = new URL(u); x.search = ''; x.hash = ''; return b.loadImage(fileURLToPath(x)); };
const legacy = () => { const m = structuredClone(DANGO_RASTER); for (const key of keys()) delete m.tools[key]; return m; };

// No staging injector: these tests intentionally require the real integrated
// shared selector, manifest, artist and original PNG loaders.
test('both source images switch atomically at an episode boundary, never halfway through', () => {
  const states = new Map(keys().map(k => [DANGO_RASTER.tools[k].src, 'loading']));
  const selector = createSourceContactPoseSelector({ manifest: DANGO_RASTER, source: { state: s => states.get(s.src) || 'ready' } });
  const use = (id, p = .25, patch = {}) => { const o = options(id, p, patch); return selector.apply(pose(o), 'front', o); };
  assert.notEqual(use('one').sourceContactPose, ID);
  states.set(DANGO_RASTER.tools[keys()[0]].src, 'ready'); assert.notEqual(use('two').sourceContactPose, ID);
  states.set(DANGO_RASTER.tools[keys()[1]].src, 'ready'); assert.notEqual(use('two', .6).sourceContactPose, ID);
  assert.equal(use('three').sourceContactPose, ID);
  states.set(DANGO_RASTER.tools[keys()[0]].src, 'failed'); assert.notEqual(use('three', .6).sourceContactPose, ID);
  states.set(DANGO_RASTER.tools[keys()[0]].src, 'ready'); assert.notEqual(use('three', .7).sourceContactPose, ID);
  assert.equal(use('four').sourceContactPose, ID);
  assert.equal(use('four', .5, { action: { ...PET_ACTIONS.workout, propOpacity: 0 } }).sourceContactPose, ID);
  const foreign = { ...options('wave'), action: PET_ACTIONS.wave, motion: 'wave' };
  assert.notEqual(selector.apply(pose(foreign), 'front', foreign).sourceContactPose, ID);
  assert.equal(use('five').sourceContactPose, ID); selector.dispose();
});

test('actual production artist preserves original body, feet and headband across 257 phases', async () => {
  const { loadLimbSource } = await imp('tools/dango-limbs-qa.mjs'), limbs = await loadLimbSource();
  const a = createDangoRasterArtist({ manifest: DANGO_RASTER, limbs, loadImage: image, createSurface: b.createCanvas });
  const old = createDangoRasterArtist({ manifest: legacy(), limbs, loadImage: image, createSurface: b.createCanvas });
  try { await Promise.all([a.ready({ all: true }), old.ready({ all: true })]);
    for (let i = 0; i <= 256; i++) {
      const o = options('dense', i / 256), r = a.resolveArtwork(o), p = old.resolveArtwork(o);
      assert.equal(r.sourceContactPose, ID, `phase ${i}/256`); assert.ok(r.ready && r.actionReady);
      for (const field of ['data', 'face', 'matrices', 'footwearTransforms', 'attachmentMatrices']) assert.deepEqual(r[field], p[field]);
      assert.deepEqual(r.contact.tools.slice(0, -2), p.contact.tools); assert.deepEqual(r.contact.details, p.contact.details);
      assert.equal(r.contact.hands.length, 2);
      for (const h of r.contact.hands) {
        const oldHand = p.contact.hands.find(x => x.side === h.side), g = 64 - oldHand.points.at(-1)[1];
        const tool = r.contact.tools.find(t => t.coversPaw === h.side && keys().includes(t.key));
        assert.ok(Math.abs(tool.y + g) < 1e-8); assert.ok(Math.abs(h.gripPoint[1] + g - 64) < 1e-8);
        assert.equal(h.pawSprite, undefined); assert.equal(h.limb, false);
      }
    }
  } finally { a.dispose(); old.dispose(); }
  assert.equal(a.cacheStats().source.bytes, 0); assert.equal(a.cacheStats().palette.bytes, 0);
});

test('real delayed source retains both original hands until a fresh episode', async () => {
  let release; const gate = new Promise(r => release = r); let delayed = false;
  const suffix = '/' + DANGO_RASTER.tools[keys()[0]].src;
  const a = createDangoRasterArtist({ manifest: DANGO_RASTER, createSurface: b.createCanvas, loadImage: async u => {
    if (new URL(u).pathname.endsWith(suffix)) { delayed = true; await gate; } return image(u);
  } });
  const old = createDangoRasterArtist({ manifest: legacy(), loadImage: image, createSurface: b.createCanvas });
  try { await old.ready({ all: true }); const ready = a.ready({ all: true });
    const cold = a.resolveArtwork(options()); assert.notEqual(cold.sourceContactPose, ID);
    await new Promise(r => setImmediate(r)); assert.equal(delayed, true); release(); await ready;
    const same = a.resolveArtwork(options('one', .6)); assert.notEqual(same.sourceContactPose, ID);
    assert.deepEqual(same.contact, old.resolveArtwork(options('one', .6)).contact);
    assert.equal(a.resolveArtwork(options('next', 0)).sourceContactPose, ID);
  } finally { release(); a.dispose(); old.dispose(); }
});

test('each missing real PNG preserves complete fallback without a single new support arm', async () => {
  const old = createDangoRasterArtist({ manifest: legacy(), loadImage: image, createSurface: b.createCanvas });
  try { await old.ready({ all: true }); for (const key of keys()) {
    const suffix = '/' + DANGO_RASTER.tools[key].src;
    const a = createDangoRasterArtist({ manifest: DANGO_RASTER, createSurface: b.createCanvas,
      loadImage: u => new URL(u).pathname.endsWith(suffix) ? Promise.reject(Error('injected workout source failure')) : image(u) });
    try { await a.ready({ all: true }); for (const instance of ['failed', 'next']) {
      const o = options(instance, .3125), r = a.resolveArtwork(o), p = old.resolveArtwork(o);
      assert.notEqual(r.sourceContactPose, ID); assert.deepEqual(r.contact, p.contact);
      assert.ok(r.contact.hands.every(h => h.pawSprite === 'support-paw'));
    } } finally { a.dispose(); }
    assert.equal(a.cacheStats().source.entries, 0); assert.equal(a.cacheStats().palette.bytes, 0);
  } } finally { old.dispose(); }
});
