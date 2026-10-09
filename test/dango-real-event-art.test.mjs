import test from 'node:test';
import assert from 'node:assert/strict';
import { DANGO_RASTER as manifest } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { sampleRasterMirror } from '../src/capabilities/companion/presentation/dango-raster-mirror.mjs';
import { MIRROR_ACTIVITIES } from '../src/content/session-activities.mjs';
import { PET_APPEARANCE_ITEMS } from '../src/content/appearance.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
import { applyPoint } from '../src/capabilities/companion/presentation/rig/pose.mjs';
import { recordingContext } from '../test-support/dango-reconstruction-fixture.mjs';
const make = (loadImage = async src => ({ src, width: 8, height: 8 })) => createDangoRasterArtist({ manifest, loadImage });
const outfit = { items: PET_APPEARANCE_ITEMS.filter(item => ['milestone.sunhat', 'milestone.scarf', 'milestone.boots'].includes(item.id)) };
const opts = (id, progress = .25, extra = {}) => ({ action: MIRROR_ACTIVITIES[id], motion: MIRROR_ACTIVITIES[id].motion,
  view: 'front', progress, appearance: outfit, ...extra });
const context = () => ({ ...recordingContext(), moveTo() {}, lineTo() {}, closePath() {} });
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('music equips bespoke rear-band/front-cup raster layers and one tiny rooted fin without changing clothes', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const view of ['front', 'three-quarter', 'profile', 'back']) {
    const options = opts('mirror-music', .25, { view }), art = artist.resolveArtwork(options);
    assert.equal(art.ready, true); assert.deepEqual(art.missingAssets, []);
    assert.deepEqual(art.suppressedAppearanceSlots, []);
    assert.equal(art.contact.tools.length, art.view === 'front' ? 2 : 3);
    assert.ok(art.contact.tools.every(tool => tool.key.startsWith('headphones-')));
    assert.deepEqual(art.contact.details, []); assert.equal(art.contact.hands.length, 1);
    const hand = art.contact.hands[0]; assert.equal(hand.pawSprite, 'small-fin');
    assert.equal(hand.connector, false); assert.equal(hand.attachedArm, false);
    applyPoint(hand.pawMatrix, ...manifest.tools['small-fin'].anchors.grip).forEach((value, axis) => close(value, hand.gripPoint[axis]));
    for (const foot of ['foot-left', 'foot-right']) art.footwearTransforms[foot].forEach((v, i) => close(v, art.matrices[foot][i]));
    const back = context(), bare = artist.resolveArtwork({ ...options, appearance: { items: [] } });
    artist.action(back, { artwork: bare, action: options.action, palette: PALETTES.pink, layer: 'back' });
    assert.match(back.calls[0].image.src, /headphones-.*-band\.png/);
    assert.ok(back.calls.slice(1).some(call => /ear-left\.png/.test(call.image.src)), 'band painted before ears');
    const front = context(); artist.action(front, { artwork: art, action: options.action, palette: PALETTES.pink, layer: 'front' });
    assert.ok(!front.calls.some(call => /music-note|\/arm\.png|\/hand-/.test(call.image.src)));
  }
  artist.dispose();
});

test('music and AI have bounded independent microgestures with continuous full-duration loop seams', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const id of ['mirror-music', 'mirror-ai']) {
    const keys = new Set(), variations = new Set();
    for (let n = 0; n <= 720; n++) {
      const art = artist.resolveArtwork(opts(id, n / 720));
      keys.add(art.key); variations.add(art.contact.hands.map(hand => hand.pawMatrix[5].toFixed(3)).join(','));
      assert.ok(Math.abs(art.mirror.nod) <= .45); assert.ok(Math.abs(art.mirror.tilt) <= .009);
      assert.ok(art.mirror.toe >= 0 && art.mirror.toe <= .55);
      assert.ok(Math.abs(art.mirror.tapLeft) <= .48 && Math.abs(art.mirror.tapRight) <= .48);
    }
    assert.equal(keys.size, 1, 'time never expands the physical-body cache'); assert.ok(variations.size > 10);
    const first = artist.resolveArtwork(opts(id, 0)), last = artist.resolveArtwork(opts(id, 1));
    for (const name of Object.keys(first.matrices)) first.matrices[name].forEach((v, i) => close(v, last.matrices[name][i]));
    for (const name of ['nod', 'tilt', 'toe', 'tapLeft', 'tapRight', 'buddyTilt']) close(first.mirror[name], last.mirror[name]);
  }
  artist.dispose();
});

test('low stimulation, reduced motion and static lifecycle metadata all freeze the same representative pose', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const id of ['mirror-music', 'mirror-ai']) for (const staticOption of [
    { calmVisual: true }, { reducedMotion: true },
    { action: { ...MIRROR_ACTIVITIES[id], mirrorPresentation: { static: true, loopProgress: .17 } } }
  ]) {
    const first = artist.resolveArtwork(opts(id, .03, staticOption)), last = artist.resolveArtwork(opts(id, .91, staticOption));
    assert.deepEqual(first.contact, last.contact); assert.deepEqual(first.matrices, last.matrices); assert.deepEqual(first.face, last.face);
    close(first.mirror.nod, 0); close(first.mirror.tilt, 0); close(first.mirror.toe, 0);
  }
  artist.dispose();
});

test('finite lifecycle eases the saved equipment and fin as one group without switching clothes or adding stages', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const id of ['mirror-music', 'mirror-ai']) for (const phase of ['enter', 'exit']) {
    for (const opacity of [0, .25, .5, .75, 1]) {
      const action = { ...MIRROR_ACTIVITIES[id], propOpacity: opacity,
        mirrorPresentation: { phase, progress: phase === 'enter' ? opacity : 1 - opacity, loopProgress: .07 } };
      const art = artist.resolveArtwork(opts(id, .07, { action }));
      assert.equal(art.ready, true); assert.deepEqual(art.suppressedAppearanceSlots, []);
      assert.ok(Math.abs(art.mirror.settle) <= 3);
      for (const hand of art.contact.hands) {
        close(hand.opacity, opacity);
        applyPoint(hand.pawMatrix, ...manifest.tools['small-fin'].anchors.grip).forEach((v, axis) => close(v, hand.gripPoint[axis]));
      }
      assert.deepEqual(art.contact.details, []);
      if (opacity === 0) { const ctx = context(); for (const layer of ['back', 'front']) artist.action(ctx, { artwork: art, action, palette: PALETTES.pink, layer });
        assert.ok(!ctx.calls.some(call => /headphones|laptop-reverse|small-fin|ai-robot-buddy/.test(call.image.src))); }
    }
  }
  artist.dispose();
});

test('a missing or cold headphone layer hides the entire equipment/paw group and recovers atomically', async () => {
  for (const key of ['headphones-front-band', 'headphones-front-cups', 'headphones-three-quarter-near', 'headphones-three-quarter-far']) for (const fail of [false, true]) {
    let settle; const artist = make(src => src.includes(`/${key}.png`) ? new Promise((resolve, reject) => {
      settle = () => fail ? reject(Error('fixture unavailable')) : resolve({ src, width: 8, height: 8 });
    }) : Promise.resolve({ src, width: 8, height: 8 }));
    const ready = artist.ready({ all: true }); await new Promise(resolve => setImmediate(resolve));
    const options = opts('mirror-music', .25, { view: key.includes('three-quarter') ? 'three-quarter' : 'front' });
    const check = () => { const art = artist.resolveArtwork(options); assert.equal(art.actionReady, false);
      const ctx = context(); for (const layer of ['back', 'front']) artist.action(ctx, { artwork: art, action: options.action, palette: PALETTES.pink, layer });
      assert.ok(!ctx.calls.some(call => /headphones|small-fin|\/arm\.png|\/hand-/.test(call.image.src))); };
    check(); settle(); await ready; if (fail) check(); else assert.equal(artist.resolveArtwork(options).ready, true);
    artist.dispose();
  }
});

test('mirror presentation does not reinterpret BPM, AI status, or higher-priority expressions', async () => {
  for (const id of ['mirror-music', 'mirror-ai']) {
    const action = MIRROR_ACTIVITIES[id];
    assert.deepEqual(sampleRasterMirror(action, .31), sampleRasterMirror({ ...action, bpm: 180, aiStage: 'answer' }, .31));
  }
  const artist = make(); await artist.ready({ all: true });
  const art = artist.resolveArtwork(opts('mirror-music', .31, { expressionId: 'system.restricted', face: { eyes: 'surprised', mouth: 'open' } }));
  assert.equal(art.face.eyes, 'surprised'); assert.equal(art.face.mouth, 'open'); artist.dispose();
});
