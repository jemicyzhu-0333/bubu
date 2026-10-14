import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { SIP_SHORT_CONTACT_KEYS, sipShortContactSpriteKeys } from '../src/capabilities/companion/presentation/dango-sip-short-contact-pose.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';

const keys = sipShortContactSpriteKeys(), action = PET_ACTIONS['sip-tea'];
function enabled() { const m = structuredClone(DANGO_RASTER); for (const k of keys) m.tools[k].sourceContactPose.runtimeReady = true; return m; }
function legacy() { const m = structuredClone(DANGO_RASTER); for (const k of keys) m.tools[k].sourceContactPose.runtimeReady = false; return m; }
async function make(manifest, failSide = null) {
  const artist = createDangoRasterArtist({ manifest, createSurface: createCanvas, loadImage: u => {
    if (failSide && u.includes(`sip-front-v1/${failSide}-8x.png`)) throw Error('injected preferred source failure');
    return loadImage(fileURLToPath(u));
  } });
  await artist.ready({ all: true }); return artist;
}
function render(artist, options, artwork = artist.resolveArtwork(options), dpr = 1) {
  const c = createCanvas(Math.round(220 * dpr), Math.round(220 * dpr)), x = c.getContext('2d');
  x.scale(1.5 * dpr, 1.5 * dpr); x.translate(40, 40);
  const o = { action: options.action, progress: options.progress, artwork, palette: PALETTES.pink, view: artwork.view };
  artist.action(x, { ...o, layer: 'back' }); artist.body(x, PALETTES.pink, artwork.view, artwork);
  artist.face(x, PALETTES.pink, artwork.face, false, artwork.view, null, artwork);
  artist.action(x, { ...o, layer: 'front' }); return Buffer.from(x.getImageData(0, 0, c.width, c.height).data);
}
const smooth = value => { const p = Math.max(0, Math.min(1, value)); return p * p * (3 - 2 * p); };
function reference(original, images, gain) {
  const cup = original.contact.tools[0], fade = item => ({ ...item, opacity: (item.opacity ?? 1) * gain });
  return { ...original, contact: { ...original.contact, tools: original.contact.tools.map(fade),
    details: original.contact.details.map(fade), hands: original.contact.hands.map(h => ({ ...fade(h), limb: true })) },
  limbPainter: { paint(ctx, { hand, layer, covered }) {
    if (layer !== 'front' || covered) return false;
    ctx.save(); ctx.transform(1, 0, 0, 1, cup.x - 23, cup.y - 43);
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha *= hand.opacity ?? 1;
    ctx.drawImage(images[hand.side], 0, 0, 66, 72); ctx.restore(); return true;
  } } };
}

test('exact eightfold sources decode to every original logical pixel without resampling or source changes', async () => {
  for (const side of ['left', 'right']) {
    const full = await loadImage(fileURLToPath(new URL(`action-contact/sip-front-v1/${side}-8x.png`, DANGO_RASTER.baseUrl)));
    const logical = await loadImage(fileURLToPath(new URL(`action-contact/sip-front-v1/${side}-logical.png`, DANGO_RASTER.baseUrl)));
    assert.equal(full.width, 528); assert.equal(full.height, 576); assert.equal(logical.width, 66); assert.equal(logical.height, 72);
    const c = createCanvas(66, 72), x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(full, 0, 0, 66, 72); const actual = Buffer.from(x.getImageData(0, 0, 66, 72).data);
    x.clearRect(0, 0, 66, 72); x.drawImage(logical, 0, 0);
    assert.equal(Buffer.compare(actual, Buffer.from(x.getImageData(0, 0, 66, 72).data)), 0, side);
  }
});

test('actual short selector equals independent preferred-pixel composition through all257 ordinary phases at four DPRs', async () => {
  const m = enabled(), a = await make(m), b = await make(legacy()), images = {};
  for (const side of ['left', 'right']) images[side] = await loadImage(fileURLToPath(new URL(m.tools[SIP_SHORT_CONTACT_KEYS[side]].src, m.baseUrl)));
  try {
    let bodyKey;
    for (let i = 0; i <= 256; i++) {
      if (i % 8 === 0) await new Promise(resolve => setImmediate(resolve));
      const p = i / 256, o = { action, motion: 'sip', view: 'front', progress: p, elapsedMs: p * 9000, actionInstanceKey: 'ordinary' };
      const actual = a.resolveArtwork(o), original = b.resolveArtwork(o), cup = original.contact.tools[0];
      assert.equal(actual.sourceContactPose, 'sip-front-short-v1'); assert.equal(actual.limbPainter, null);
      assert.equal(actual.contact.tools.length, 1); assert.deepEqual(actual.effectOrigins, original.effectOrigins);
      assert.deepEqual(actual.data.body, original.data.body); assert.deepEqual(actual.matrices, original.matrices);
      assert.deepEqual(actual.attachmentMatrices, original.attachmentMatrices); assert.deepEqual(actual.face, original.face);
      bodyKey ??= actual.key; assert.equal(actual.key, bodyKey);
      const gain = smooth(p / .04) * smooth((1 - p) / .04);
      assert.deepEqual([actual.contact.tools[0].x, actual.contact.tools[0].y], [cup.x, cup.y]);
      for (const hand of actual.contact.hands) assert.deepEqual(hand.pawMatrix, [1, 0, 0, 1, cup.x - 23, cup.y - 43]);
      if (p >= .04 && p <= .96) {
        assert.deepEqual(actual.contact.tools, original.contact.tools); assert.deepEqual(actual.contact.details, original.contact.details);
        assert.deepEqual(actual.contact.hands.map(h => h.opacity), original.contact.hands.map(h => h.opacity));
      }
      const expected = reference(original, images, gain);
      for (const dpr of [1, 1.25, 1.5, 2]) assert.equal(Buffer.compare(render(a, o, actual, dpr), render(b, o, expected, dpr)), 0, `${i}/256 DPR ${dpr}`);
    }
  } finally { a.dispose(); b.dispose(); }
});

test('actual front recovery retains source through cup lowering, canonical hand fade and prop invisibility', async () => {
  const m = enabled(), a = await make(m), b = await make(legacy()), images = {};
  for (const side of ['left', 'right']) images[side] = await loadImage(fileURLToPath(new URL(m.tools[SIP_SHORT_CONTACT_KEYS[side]].src, m.baseUrl)));
  try {
    for (let i = 0; i <= 256; i++) {
      if (i % 8 === 0) await new Promise(resolve => setImmediate(resolve));
      const recovery = i / 256, progress = .8 + .2 * recovery;
      const o = { action: { ...action, handoffRecovery: recovery, propOpacity: 1 - smooth(recovery / .6) },
        motion: 'sip', view: 'front', progress, elapsedMs: progress * 9000, channel: 'pet', actionInstanceKey: 'recovery' };
      const actual = a.resolveArtwork(o), original = b.resolveArtwork(o), cup = original.contact.tools[0];
      assert.equal(actual.sourceContactPose, 'sip-front-short-v1'); assert.deepEqual(actual.contact.tools, original.contact.tools);
      assert.deepEqual(actual.contact.details, original.contact.details);
      assert.deepEqual(actual.contact.hands.map(h => h.opacity), original.contact.hands.map(h => h.opacity));
      for (const hand of actual.contact.hands) assert.deepEqual(hand.pawMatrix, [1, 0, 0, 1, cup.x - 23, cup.y - 43]);
      if (i === 256) { assert.equal(cup.y, 48); assert.ok(actual.contact.hands.every(h => h.opacity === 0)); }
      for (const dpr of [1, 1.5]) assert.equal(Buffer.compare(render(a, o, actual, dpr), render(b, o, reference(original, images, 1), dpr)), 0, `recovery ${i}/256 DPR ${dpr}`);
    }
  } finally { a.dispose(); b.dispose(); }
});

test('other actions keep legacy; quarter requests resolve to the front short pair; outfits keep it; single-source failure is legacy', async () => {
  const a = await make(enabled()), b = await make(legacy()), failed = await make(enabled(), 'right');
  try {
    for (const act of Object.values(PET_ACTIONS)) if (act.id !== 'sip-tea') for (const progress of [0, .5, 1]) {
      const o = { action: act, motion: act.motion, view: 'front', progress, elapsedMs: progress * act.duration };
      const x = a.resolveArtwork(o), y = b.resolveArtwork(o);
      assert.equal(x.sourceContactPose, undefined); assert.deepEqual(x.contact, y.contact);
    }
    for (const view of ['three-quarter', 'three-quarter-left', 'three-quarter-right', 'back', 'profile']) {
      const o = { action, motion: 'sip', view, progress: .5, elapsedMs: 4500, actionInstanceKey: `v-${view}` };
      const x = a.resolveArtwork(o);
      assert.equal(x.view, 'front'); assert.equal(x.sourceContactPose, 'sip-front-short-v1');
    }
    {
      const o = { action, motion: 'sip', view: 'front', progress: .5, elapsedMs: 4500, actionInstanceKey: 'hat',
        appearance: { items: [{ id: 'test.hat', renderKey: 'hat', formId: 'dango' }] } };
      assert.equal(a.resolveArtwork(o).sourceContactPose, 'sip-front-short-v1');
    }
    for (const progress of [0, .5, 1]) {
      const o = { action, motion: 'sip', view: 'front', progress, elapsedMs: progress * 9000 };
      assert.equal(failed.resolveArtwork(o).sourceContactPose, undefined); assert.deepEqual(render(failed, o), render(b, o));
    }
  } finally { a.dispose(); b.dispose(); failed.dispose(); }
});

test('calm and reduced-motion source envelope follows the same static phase as the production pose', async () => {
  const a = await make(enabled());
  try {
    for (const extra of [{ calmVisual: true }, { reducedMotion: true }, { calmVisual: true, reducedMotion: true }]) {
      let matrix, pixels;
      for (const progress of [0, .5, 1]) {
        const o = { action, motion: 'sip', view: 'front', progress, elapsedMs: progress * 9000,
          actionInstanceKey: JSON.stringify(extra), ...extra };
        const x = a.resolveArtwork(o); assert.equal(x.sourceContactPose, 'sip-front-short-v1');
        matrix ??= x.contact.hands.map(h => h.pawMatrix); assert.deepEqual(x.contact.hands.map(h => h.pawMatrix), matrix);
        assert.equal(x.contact.tools[0].opacity ?? 1, 1); assert.ok(x.contact.hands.every(h => (h.opacity ?? 1) === 1));
        pixels ??= render(a, o, x); assert.deepEqual(render(a, o, x), pixels);
      }
    }
  } finally { a.dispose(); }
});

test('actual cold loading remains legacy across portrait interleaving until the next explicit instance', async () => {
  const m = enabled(), releases = [];
  const a = createDangoRasterArtist({ manifest: m, createSurface: createCanvas,
    loadImage: u => u.includes('action-contact/sip-front-v1/') ? new Promise(resolve => releases.push(async () => resolve(await loadImage(fileURLToPath(u))))) : loadImage(fileURLToPath(u)) });
  const ready = a.ready({ all: true }); await new Promise(resolve => setImmediate(resolve));
  const o = { action, motion: 'sip', view: 'front', progress: .5, elapsedMs: 1000, channel: 'pet', actionInstanceKey: 'first' };
  try {
    assert.equal(a.resolveArtwork(o).sourceContactPose, undefined); assert.equal(releases.length, 2);
    await Promise.all(releases.map(release => release())); await ready;
    a.resolveArtwork({ channel: 'portrait', view: 'front', motion: 'idle' });
    assert.equal(a.resolveArtwork({ ...o, elapsedMs: 2000 }).sourceContactPose, undefined);
    assert.equal(a.resolveArtwork({ ...o, elapsedMs: 3000, actionInstanceKey: 'next' }).sourceContactPose, 'sip-front-short-v1');
    assert.equal(a.cacheStats().source.failed, 0);
  } finally { a.dispose(); }
  assert.equal(a.cacheStats().source.bytes, 0);
});
