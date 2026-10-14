import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { SIP_CONTACT_KEYS, sipContactSpriteKeys } from '../src/capabilities/companion/presentation/dango-sip-contact-pose.mjs';
import { sipShortContactSpriteKeys } from '../src/capabilities/companion/presentation/dango-sip-short-contact-pose.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
const keys = sipContactSpriteKeys(), action = PET_ACTIONS['sip-tea'];
function legacy() { const m = structuredClone(DANGO_RASTER); for (const sprite of Object.values(m.tools)) if (sprite.sourceContactPose) sprite.sourceContactPose.runtimeReady = false; return m; }
function enabled() { const m = legacy(); for (const k of keys) m.tools[k].sourceContactPose.runtimeReady = true; return m; }
async function make(manifest, fail = false) {
  const artist = createDangoRasterArtist({ manifest, createSurface: createCanvas, loadImage: u => {
    if (fail && u.includes('sip-front-v2-right-root-back')) throw Error('injected one-layer failure');
    return loadImage(fileURLToPath(u));
  } });
  await artist.ready({ all: true }); return artist;
}
function render(artist, options, artwork = artist.resolveArtwork(options), dpr = 1) {
  const c = createCanvas(220 * dpr, 220 * dpr), x = c.getContext('2d');
  x.scale(1.5 * dpr, 1.5 * dpr); x.translate(40, 40);
  const o = { action: options.action, progress: options.progress, artwork, palette: PALETTES.pink, view: artwork.view };
  artist.action(x, { ...o, layer: 'back' }); artist.body(x, PALETTES.pink, artwork.view, artwork);
  artist.face(x, PALETTES.pink, artwork.face, false, artwork.view, null, artwork);
  artist.action(x, { ...o, layer: 'front' }); return Buffer.from(x.getImageData(0, 0, c.width, c.height).data);
}
test('actual sip selector and standard painter equal independent four-layer source composition for257 phases', async () => {
  const m = enabled(), a = await make(m), b = await make(legacy()), images = {};
  for (const k of keys) images[k] = await loadImage(fileURLToPath(new URL(m.tools[k].src, m.baseUrl)));
  try {
    let bodyKey = null;
    for (let i = 0; i <= 256; i++) {
      // Release native comparison surfaces and pixel buffers between sample batches.
      if (i % 10 === 0) await new Promise(resolve => setImmediate(resolve));
      const o = { action, motion: 'sip', view: 'front', progress: i / 256, elapsedMs: i / 256 * 9000, actionInstanceKey: 'all-phases' };
      const actual = a.resolveArtwork(o), original = b.resolveArtwork(o), cup = original.contact.tools[0];
      assert.equal(actual.sourceContactPose, 'sip-front-v2'); assert.equal(actual.limbPainter, null);
      assert.deepEqual(actual.contact.tools[0], cup); assert.deepEqual(actual.contact.details, original.contact.details);
      assert.deepEqual(actual.effectOrigins, original.effectOrigins); assert.deepEqual(actual.data.body, original.data.body);
      bodyKey ??= actual.key; assert.equal(actual.key, bodyKey, 'moving source limbs never invalidate the body cache');
      const reference = { ...original, contact: { ...original.contact, hands: original.contact.hands.map(h => ({ ...h, limb: true })) },
        limbPainter: { paint(ctx, { hand, layer, covered }) {
          if (!['back', 'front'].includes(layer) || covered) return false;
          const k = SIP_CONTACT_KEYS[hand.side][layer];
          ctx.save(); ctx.transform(1, 0, 0, 1, cup.x - 23, cup.y - 43);
          ctx.imageSmoothingEnabled = false; ctx.globalAlpha *= hand.opacity ?? 1;
          ctx.drawImage(images[k], 0, 0, 66, 72); ctx.restore(); return true;
        } } };
      for (const dpr of [1, 1.5]) assert.equal(Buffer.compare(render(a, o, actual, dpr), render(b, o, reference, dpr)), 0, `${i}/256 DPR${dpr}`);
    }
  } finally { a.dispose(); b.dispose(); }
});
test('other actions, unavailable quarter view and outfits preserve legacy contacts and pixels', async () => {
  const a = await make(enabled()), b = await make(legacy());
  try {
    for (const act of Object.values(PET_ACTIONS)) if (act.id !== 'sip-tea') for (const progress of [0, .5, 1]) {
      const o = { action: act, motion: act.motion, view: 'front', progress, elapsedMs: progress * act.duration };
      const x = a.resolveArtwork(o), y = b.resolveArtwork(o);
      assert.equal(x.sourceContactPose, undefined); assert.deepEqual(x.contact, y.contact);
    }
    // sip-tea now resolves every requested view to front (one hand style).
    for (const extra of [{ appearance: { items: [{ id: 'test.hat', renderKey: 'hat', formId: 'dango' }] } }]) {
      const o = { action, motion: 'sip', view: 'front', progress: .5, elapsedMs: 4500, ...extra };
      const x = a.resolveArtwork(o), y = b.resolveArtwork(o);
      assert.equal(x.sourceContactPose, undefined); assert.deepEqual(render(a, o, x), render(b, o, y));
    }
    assert.equal(a.resolveArtwork({ action, motion: 'sip', view: 'three-quarter', progress: .5, elapsedMs: 4500 }).view, 'front');
  } finally { a.dispose(); b.dispose(); }
});
test('one failed actual image falls back both roots/hands and reduced motion keeps the cup/source static', async () => {
  const a = await make(enabled()), b = await make(legacy()), failed = await make(enabled(), true);
  try {
    for (const progress of [0, .5, 1]) {
      const o = { action, motion: 'sip', view: 'front', progress, elapsedMs: progress * 9000 };
      assert.equal(failed.resolveArtwork(o).sourceContactPose, undefined); assert.deepEqual(render(failed, o), render(b, o));
    }
    for (const extra of [{ calmVisual: true }, { reducedMotion: true }, { calmVisual: true, reducedMotion: true }]) {
      let matrix;
      for (const progress of [0, .5, 1]) {
        const o = { action, motion: 'sip', view: 'front', progress, elapsedMs: progress * 9000, actionInstanceKey: JSON.stringify(extra), ...extra };
        const x = a.resolveArtwork(o); assert.equal(x.sourceContactPose, 'sip-front-v2');
        matrix ??= x.contact.hands.map(h => h.pawMatrix); assert.deepEqual(x.contact.hands.map(h => h.pawMatrix), matrix);
      }
    }
  } finally { a.dispose(); b.dispose(); failed.dispose(); }
});
test('actual asynchronous layers stay legacy for one instance and cannot be unlocked by another channel', async () => {
  const m = enabled(), releases = [];
  const a = createDangoRasterArtist({ manifest: m, createSurface: createCanvas,
    loadImage: u => u.includes('action-contact/sip-front-v2/') ? new Promise(resolve => releases.push(async () => resolve(await loadImage(fileURLToPath(u))))) : loadImage(fileURLToPath(u)) });
  const ready = a.ready({ all: true }); await new Promise(resolve => setImmediate(resolve));
  const o = { action, motion: 'sip', view: 'front', progress: .5, elapsedMs: 1000, channel: 'pet', actionInstanceKey: 'first' };
  try {
    assert.equal(a.resolveArtwork(o).sourceContactPose, undefined); assert.equal(releases.length, 4);
    await Promise.all(releases.map(release => release())); await ready;
    a.resolveArtwork({ channel: 'portrait', view: 'front', motion: 'idle' });
    assert.equal(a.resolveArtwork({ ...o, elapsedMs: 2000 }).sourceContactPose, undefined);
    assert.equal(a.resolveArtwork({ ...o, elapsedMs: 3000, actionInstanceKey: 'next' }).sourceContactPose, 'sip-front-v2');
    assert.equal(a.cacheStats().source.failed, 0);
  } finally { a.dispose(); }
  assert.equal(a.cacheStats().source.bytes, 0);
});
