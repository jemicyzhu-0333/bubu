'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { createRasterSource } = require('../src/capabilities/companion/presentation/raster/source.mjs');
const { validateRasterManifest } = require('../src/capabilities/companion/presentation/raster/schema.mjs');
const { recolorRasterPixels } = require('../src/capabilities/companion/presentation/raster/palette.mjs');
const { rasterFixture, recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { applyPoint, multiply, localMatrix } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const loadImage = async src => ({ src, width: 8, height: 8 });
const wait = () => new Promise(resolve => setImmediate(resolve));

function manifestForHand(artwork, hand) {
  return hand.pawSprite === 'small-fin' ? [7.4, 3.6] : [6, 10.415094339622641];
}

function make(options = {}) { const manifest = rasterFixture(); return { manifest, artist: createDangoRasterArtist({ manifest, loadImage, ...options }) }; }

test('unknown semantic equipment fails readiness without hiding the approved neutral body', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  const artwork = artist.resolveArtwork({ action: { id: 'future-example', motion: 'idle', prop: 'unknown-future-equipment' }, motion: 'idle' });
  assert.equal(artwork.ready, false); assert.equal(artwork.actionReady, false);
  assert.equal(artwork.layeredReady, true);
  assert.deepEqual(artwork.missingAssets, ['unsupported-prop:unknown-future-equipment']);
  assert.equal(artist.body(recordingContext(), PALETTES.pink, 'front', artwork), true);
  artist.dispose();
});

test('loaded action headwear temporarily takes the hat slot and ordinary outfits return afterward', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  for (const action of [PET_ACTIONS.workout, PET_ACTIONS.yawn]) {
    const artwork = artist.resolveArtwork({ action, motion: action.motion, progress: .5 });
    assert.deepEqual(artwork.suppressedAppearanceSlots, ['headwear']);
  }
  assert.deepEqual(artist.resolveArtwork().suppressedAppearanceSlots, []);
  artist.dispose();
});

test('a cold action headband keeps the ordinary hat until the complete replacement loads', async () => {
  const manifest = rasterFixture(); manifest.appearance.hat = manifest.appearance.boots;
  let release;
  const artist = createDangoRasterArtist({ manifest, loadImage: src => new URL(src).pathname.endsWith(`/${manifest.effects.headband.src}`)
    ? new Promise(resolve => { release = () => resolve({ src, width: 8, height: 8 }); }) : loadImage(src) });
  const pending = artist.ready({ all: true }); await wait();
  const action = PET_ACTIONS.workout, item = { formId: 'dango', renderKey: 'hat', exclusiveGroup: 'headwear' };
  const sample = () => artist.resolveArtwork({ action, motion: action.motion, progress: .5 });
  const before = sample();
  assert.deepEqual(before.suppressedAppearanceSlots, []);
  assert.equal(artist.appearance(recordingContext(), { item, artwork: before, palette: PALETTES.pink }), true);
  release(); await pending;
  const after = sample();
  assert.deepEqual(after.suppressedAppearanceSlots, ['headwear']);
  assert.equal(artist.appearance(recordingContext(), { item, artwork: after, palette: PALETTES.pink }), false);
  assert.equal(artist.appearance(recordingContext(), { item, artwork: artist.resolveArtwork(), palette: PALETTES.pink }), true);
  artist.dispose();
});

test('falling clips physical layers at the fixed floor while the generated opening has a front rim', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  const action = PET_ACTIONS['pit-fall'];
  const keys = new Set();
  for (const progress of [.2, .5, .8]) {
    const artwork = artist.resolveArtwork({ action, motion: action.motion, progress });
    keys.add(artwork.key);
    const offset = artist.motionOffset(action.motion, progress, false, { action });
    assert.ok(Math.abs(artwork.groundClipY + offset.y - 63) < 1e-9);
    const context = recordingContext(); let clips = 0;
    context.clip = () => clips++;
    artist.body(context, PALETTES.pink, 'front', artwork);
    artist.action(context, { artwork, action, palette: PALETTES.pink, layer: 'front' });
    assert.equal(clips, 2, 'body floor and front rim are clipped independently');
    assert.equal(context.calls.length, 2, 'both sinking body and generated rim are drawn');
    clips = 0;
    artist.body(context, PALETTES.pink, 'front', artwork, { cache: true });
    assert.equal(clips, 0, 'cached torso must remain intact as floor height changes');
    artist.clipBody(context, artwork, () => context.drawImage({}, 0, 0, 66, 66));
    assert.equal(clips, 1, 'the cached surface gets its current floor cut only at composition');
  }
  assert.equal(keys.size, 1, 'floor height cannot create per-frame cache variants');
  artist.dispose();
});

test('raster manifest fails closed on remote sprites, traversal, one-eye views, invalid rects and back faces', () => {
  for (const mutate of [m => m.views.front.body.src = 'https://host/x.png', m => m.views.front.body.src = '../x.png',
    m => m.views.front.body.rect[2] = Infinity, m => m.views.front.face.eyes.neutral.pop(),
    m => m.views.back.face = m.views.front.face]) {
    const manifest = rasterFixture(); mutate(manifest); assert.throws(() => validateRasterManifest(manifest), TypeError);
  }
  assert.ok(validateRasterManifest(rasterFixture()).sources > 100);
});

test('loading settles into production raster layers and frame time does not enter the body cache key', async () => {
  const { artist } = make();
  const first = artist.resolveArtwork({ view: 'profile' });
  assert.equal(first.kind, 'dango-raster'); assert.equal(first.view, 'three-quarter'); assert.equal(first.ready, false);
  await artist.ready({ all: true });
  const one = artist.resolveArtwork({ elapsedMs: 150 }), two = artist.resolveArtwork({ elapsedMs: 600 });
  assert.equal(one.ready, true); assert.equal(one.key, two.key);
  const context = recordingContext(); artist.body(context, PALETTES.pink, 'front', one);
  artist.action(context, { artwork: one, palette: PALETTES.pink, layer: 'back' });
  artist.face(context, PALETTES.pink, { eyes: 'neutral', mouth: 'neutral' }, false, 'front', null, one);
  artist.action(context, { artwork: one, palette: PALETTES.pink, layer: 'front' });
  assert.equal(context.calls.length, 8, 'approved neutral: body, four appendages, three face features, no added paws');
  assert.ok(context.calls.every(call => call.image.src.startsWith('file:///fixture/')));
  artist.dispose();
});

test('every action keeps contact palm exactly on its sampled target, including cross-body reaches', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  let contacts = 0;
  for (const action of Object.values(PET_ACTIONS)) for (const view of ['front', 'three-quarter', 'back']) for (const progress of [.05, .2, .4, .65, .9]) {
    const artwork = artist.resolveArtwork({ action, motion: action.motion, view, progress, elapsedMs: progress * 9000 });
    assert.equal(artwork.ready, true); assert.deepEqual(artwork.missingAssets, [], action.id);
    for (const hand of artwork.contact?.hands || []) {
      const key = `hand-${hand.side}`, pivot = hand.pawSprite
        ? manifestForHand(artwork, hand) : artwork.data.parts[key].pivot;
      const actual = applyPoint(artwork.matrices[key], ...pivot), expected = hand.points.at(-1);
      assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-9, `${action.id}/${hand.side}`); contacts++;
    }
  }
  assert.ok(contacts > 500); artist.dispose();
});

test('reduced motion freezes requested action phase, eyes, ears, paws and boots across time', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  for (const action of Object.values(PET_ACTIONS)) {
    const sample = progress => artist.resolveArtwork({ action, motion: action.motion, progress, elapsedMs: progress * 20000, calmVisual: true });
    const first = sample(.1), last = sample(.9);
    for (const key of ['matrices', 'face', 'contact', 'footwearTransforms']) assert.deepEqual(first[key], last[key], `${action.id}/${key}`);
  }
  artist.dispose();
});

test('boots use the same live foot matrices and static portraits paint all physical parts once', async () => {
  const { artist, manifest } = make(); await artist.ready({ all: true });
  const artwork = artist.resolveArtwork({ motion: 'dash', progress: .275 });
  const context = recordingContext();
  artist.appearance(context, { item: { renderKey: 'boots', formId: 'dango' }, palette: PALETTES.pink, artwork, view: 'front' });
  assert.equal(context.calls.length, 2);
  const physical = recordingContext(); artist.action(physical, { artwork, palette: PALETTES.pink, layer: 'back' });
  for (const [index, foot] of ['foot-left', 'foot-right'].entries()) {
    const draw = physical.calls.find(call => new URL(call.image.src).pathname.endsWith('/' + artwork.data.parts[foot].src));
    assert.ok(draw, 'actual physical foot draw exists');
    const sprite = manifest.appearance.boots.views.front.front[index], sole = sprite.rect[1] + sprite.rect[3];
    const expected = multiply(draw.matrix, localMatrix([sprite.pivot?.[0] ?? sprite.rect[0] + sprite.rect[2] / 2, sole], { sx: .8, sy: .8 }));
    assert.deepEqual(context.calls[index].matrix, expected, 'boot scale stays attached to actual physical foot and sole');
  }
  context.calls.length = 0; artist.body(context, PALETTES.pink, 'front', artwork, { fit: true });
  assert.equal(context.calls.length, 5); assert.equal(context.calls.filter(call => new URL(call.image.src).pathname.endsWith(manifest.views.front.body.src)).length, 1);
  artist.dispose();
});

test('requested non-neutral face is not reported ready before its own images settle', async () => {
  const deferred = new Map(), manifest = rasterFixture();
  const held = new Set(manifest.views.front.face.eyes.sparkle.map(s => `/fixture/${s.src}`));
  const artist = createDangoRasterArtist({ manifest, loadImage: src => held.has(new URL(src).pathname)
    ? new Promise(resolve => deferred.set(src, resolve)) : loadImage(src) });
  await artist.ready();
  assert.equal(artist.resolveArtwork({ face: { eyes: 'sparkle', mouth: 'neutral' } }).ready, false);
  await wait(); for (const [src, resolve] of deferred) resolve({ src, width: 8, height: 8 }); await wait();
  assert.equal(artist.resolveArtwork({ face: { eyes: 'sparkle', mouth: 'neutral' } }).ready, true); artist.dispose();
});

test('failed layer retains approved full-image fallback and never overlays duplicate face or feet', async () => {
  const manifest = rasterFixture(), failed = manifest.views.front.body.src;
  const artist = createDangoRasterArtist({ manifest, loadImage: async src => { if (new URL(src).pathname.endsWith(`/${failed}`)) throw Error('fixture failure'); return loadImage(src); } });
  await artist.ready(); const artwork = artist.resolveArtwork({ view: 'front' }); assert.equal(artwork.ready, false);
  const context = recordingContext(); artist.body(context, PALETTES.pink, 'front', artwork);
  artist.action(context, { artwork, palette: PALETTES.pink, layer: 'back' });
  artist.face(context, PALETTES.pink, {}, false, 'front', null, artwork);
  assert.equal(context.calls.length, 1); assert.ok(new URL(context.calls[0].image.src).pathname.endsWith(`/${manifest.views.front.neutral.src}`));
  assert.equal(artist.cacheStats().source.failed, 1); artist.dispose();
});

test('source is bounded, evicted late loads are released, and dispose suppresses late notifications', async () => {
  const pending = new Map(), closed = [], source = createRasterSource({ baseUrl: 'file:///fixture/', maxEntries: 2,
    maxBytes: 1024, loadImage: src => new Promise(resolve => pending.set(src, resolve)) });
  let updates = 0; source.subscribe(() => updates++);
  source.get({ src: 'a.png' }); source.get({ src: 'b.png' }); source.get({ src: 'c.png' }); await wait();
  assert.equal(source.stats().entries, 2);
  pending.get('file:///fixture/a.png')({ width: 8, height: 8, close: () => closed.push('a') }); await wait();
  assert.deepEqual(closed, ['a']); assert.equal(updates, 0);
  source.dispose();
  pending.get('file:///fixture/b.png')({ width: 8, height: 8, close: () => closed.push('b') });
  pending.get('file:///fixture/c.png')({ width: 8, height: 8, close: () => closed.push('c') }); await wait();
  assert.equal(updates, 0); assert.equal(source.stats().bytes, 0); assert.deepEqual(closed, ['a', 'b', 'c']);
});

test('recolor preserves transparency and white glints while switching pink material and eye ink', () => {
  const pixels = new Uint8ClampedArray([247, 118, 142, 255, 255, 255, 255, 255, 26, 27, 38, 255, 255, 190, 210, 0]);
  const original = [...pixels]; recolorRasterPixels(pixels, PALETTES.forest);
  assert.ok(pixels[1] > pixels[0]); assert.deepEqual([...pixels.slice(4, 8)], original.slice(4, 8));
  assert.deepEqual([...pixels.slice(12)], original.slice(12));
  assert.deepEqual([...pixels.slice(8, 11)], [15, 26, 18]);
});

test('running variant hips and soles rebase boot attachments without changing physical foot transforms', async () => {
  const manifest = rasterFixture(), view = manifest.views.front;
  view.variants = { running: { anchors: { 'foot-left': { x: 25, y: 53 }, 'foot-right': { x: 42, y: 53 } },
    motion: { running: { strideX: 3.5, liftY: 4, rotation: .16 } } } };
  const artist = createDangoRasterArtist({ manifest, loadImage }); await artist.ready({ all: true });
  const artwork = artist.resolveArtwork({ motion: 'dash', progress: .275 });
  for (const foot of ['foot-left', 'foot-right']) {
    const rest = view.anchors[foot], current = artwork.data.anchors[foot];
    const restRect = view.parts[foot].rect, currentRect = artwork.data.parts[foot].rect;
    const attached = applyPoint(artwork.footwearTransforms[foot], rest.x, restRect[1] + restRect[3]);
    const physical = applyPoint(artwork.matrices[foot], current.x, currentRect[1] + currentRect[3]);
    assert.ok(Math.hypot(attached[0] - physical[0], attached[1] - physical[1]) < 1e-9);
  }
  assert.deepEqual(artwork.anchors['shoulder-left'], view.anchors['shoulder-left']);
  artist.dispose();
});

test('pending ready calls settle on disposal even when an injected loader cannot abort', async () => {
  const source = createRasterSource({ baseUrl: 'file:///fixture/', loadImage: () => new Promise(() => {}) });
  const pending = source.ready([{ src: 'wait.png' }]); source.dispose();
  assert.deepEqual(await pending, [null]);
});

test('optional face completion cannot create a new body cache variant or regress physical readiness', async () => {
  const manifest = rasterFixture(), delayed = new Map();
  const target = manifest.views.front.face.eyes.sparkle.map(sprite => `/fixture/${sprite.src}`);
  const artist = createDangoRasterArtist({ manifest, loadImage: src => target.includes(new URL(src).pathname)
    ? new Promise(resolve => delayed.set(src, resolve)) : loadImage(src) });
  await artist.ready();
  const neutral = artist.resolveArtwork(), pending = artist.resolveArtwork({ face: { eyes: 'sparkle' } });
  assert.equal(pending.ready, false); assert.equal(pending.layeredReady, true); assert.equal(pending.key, neutral.key);
  await wait(); for (const [src, resolve] of delayed) resolve({ src, width: 8, height: 8 }); await wait();
  assert.equal(artist.resolveArtwork({ face: { eyes: 'sparkle' } }).key, neutral.key); artist.dispose();
});

test('generated tool grips and cup rim override source-era metadata in the shared contact sample', async () => {
  const manifest = rasterFixture();
  manifest.tools.cup.anchors = { right: [17, 8], left: [2, 9], rim: [6, 2] };
  const artist = createDangoRasterArtist({ manifest, loadImage }); await artist.ready({ all: true });
  const action = PET_ACTIONS['sip-tea'], artwork = artist.resolveArtwork({ action, motion: action.motion, progress: .5 });
  const cup = artwork.contact.tools.find(item => item.key === 'cup');
  assert.ok(Math.abs(cup.x + 6 - artwork.muzzle.x) < 1e-9);
  assert.ok(Math.abs(cup.y + 2 - artwork.muzzle.y) < 1e-9);
  for (const hand of artwork.contact.hands) {
    const grip = manifest.tools.cup.anchors[hand.side];
    assert.deepEqual(hand.points.at(-1), [cup.x + grip[0], cup.y + grip[1]]);
  }
  artist.dispose();
});

test('equipped boots replace both bare feet only after both shoe images are ready', async () => {
  const manifest = rasterFixture(), sprites = manifest.appearance.boots.views.front.front;
  let finish;
  const artist = createDangoRasterArtist({ manifest, loadImage: src => new URL(src).pathname.endsWith(sprites[1].src)
    ? new Promise(resolve => finish = () => resolve({ src, width: 8, height: 8 })) : loadImage(src) });
  await artist.ready();
  const appearance = { view: 'front', items: [{ renderKey: 'boots', exclusiveGroup: 'footwear' }] };
  const bare = artist.resolveArtwork();
  assert.deepEqual(artist.resolveArtwork({ appearance }).hiddenParts, []);
  await wait(); assert.deepEqual(artist.resolveArtwork({ appearance }).hiddenParts, []);
  finish(); await wait();
  const loaded = artist.resolveArtwork({ appearance });
  assert.equal(loaded.ready, true); assert.deepEqual(loaded.hiddenParts, ['foot-left', 'foot-right']);
  assert.notEqual(loaded.key, bare.key, 'portrait cache differentiates replaced physical feet');
  const context = recordingContext(); artist.action(context, { artwork: loaded, palette: PALETTES.pink, layer: 'back' });
  assert.equal(context.calls.length, 2, 'ears remain; only the replaced barefoot silhouettes are suppressed');
  artist.dispose();
});

test('approved carry and umbrella hold open glossy eyes while higher-priority feedback still wins', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  for (const id of ['carry-energy', 'umbrella-dance']) {
    const action = PET_ACTIONS[id];
    for (const progress of [.1, .3, .5, .8]) {
      const artwork = artist.resolveArtwork({ action, motion: action.motion, progress, expressionId: action.expression });
      assert.equal(artwork.face.eyes, 'neutral'); assert.ok(artwork.face.openness >= .94);
    }
    const face = { eyes: 'surprised', mouth: 'open' };
    assert.deepEqual(artist.resolveArtwork({ action, motion: action.motion, face, expressionId: 'react.startled' }).face, face);
  }
  artist.dispose();
});

test('tea eyelids close only at physical rim contact and reopen on recovery', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  const action = PET_ACTIONS['sip-tea'];
  for (const [progress, eyes] of [[.05, 'neutral'], [.25, 'half'], [.5, 'closed'], [.75, 'half'], [.95, 'neutral']]) {
    const artwork = artist.resolveArtwork({ action, motion: 'sip', progress, expressionId: action.expression });
    assert.equal(artwork.face.eyes, eyes);
    const cup = artwork.contact.tools.find(tool => tool.key === 'cup');
    if (eyes === 'closed') assert.ok(Math.abs(cup.y + 1 - artwork.muzzle.y) < 1e-9);
    else if (eyes === 'neutral') assert.ok(cup.y + 1 > artwork.muzzle.y + 3);
  }
  const feedback = { eyes: 'surprised', mouth: 'open' };
  assert.deepEqual(artist.resolveArtwork({ action, motion: 'sip', progress: .5, expressionId: 'react.startled', face: feedback }).face, feedback);
  artist.dispose();
});

test('pushup support paws and feet stay planted while the torso presses down', async () => {
  const { artist } = make(); await artist.ready({ all: true });
  const action = PET_ACTIONS.workout;
  for (const progress of [.05, .15, .33, .57, .83]) {
    const artwork = artist.resolveArtwork({ action, motion: 'pushup', progress });
    const offset = artist.motionOffset('pushup', progress, false, { action });
    for (const hand of artwork.contact.hands) {
      assert.equal(hand.pawSprite, 'support-paw');
      const sole = applyPoint(hand.pawMatrix, ...manifestForHand(artwork, hand));
      assert.ok(Math.abs(sole[1] + offset.y - 64) < 1e-9, 'painted support source sole stays on floor');
    }
    for (const foot of ['foot-left', 'foot-right']) {
      const anchor = artwork.anchors[foot], at = applyPoint(artwork.matrices[foot], anchor.x, anchor.y);
      assert.ok(Math.abs(at[1] + offset.y - anchor.y) < 1e-9, 'intact rear foot source sole remains planted without contour cropping');
    }
  }
  artist.dispose();
});

test('steam emits at measured cup rim and pan bowl anchors without a sideways legacy offset', async () => {
  const manifest = rasterFixture(); manifest.tools.pan.anchors = { ...manifest.tools.pan.anchors, bowl: [14, 5.5] };
  const artist = createDangoRasterArtist({ manifest, loadImage }); await artist.ready({ all: true });
  for (const id of ['sip-tea', 'tiny-chef']) {
    const action = PET_ACTIONS[id], artwork = artist.resolveArtwork({ action, motion: action.motion, progress: .5 });
    const key = id === 'sip-tea' ? 'cup' : 'pan', port = key === 'cup' ? 'rim' : 'bowl';
    const tool = artwork.contact.tools.find(item => item.key === key), anchor = manifest.tools[key].anchors[port];
    const steam = artwork.contact.details.find(detail => detail.type === 'steam');
    assert.deepEqual(steam.at, [tool.x + anchor[0], tool.y + anchor[1]]);
  }
  artist.dispose();
});

test('raster thread spans its exact needle and yarn endpoints while preserving transverse thickness', () => {
  const { connectorMatrix } = require('../src/capabilities/companion/presentation/dango-raster-actions.mjs');
  const sprite = { rect: [-6, -1, 12, 2], anchors: { start: [-6, 0], end: [6, 0] } };
  const from = [30, 50], to = [52, 59], matrix = connectorMatrix(sprite, from, to);
  const a = applyPoint(matrix, ...sprite.anchors.start), b = applyPoint(matrix, ...sprite.anchors.end);
  assert.ok(Math.hypot(a[0] - from[0], a[1] - from[1]) < 1e-9);
  assert.ok(Math.hypot(b[0] - to[0], b[1] - to[1]) < 1e-9);
  const top = applyPoint(matrix, 0, -1), bottom = applyPoint(matrix, 0, 1);
  assert.ok(Math.abs(Math.hypot(top[0] - bottom[0], top[1] - bottom[1]) - 2) < 1e-9);
});

test('a requested expression accent participates in readiness without changing the body cache key', async () => {
  const manifest = rasterFixture(), target = manifest.effects['drowsy-zzz'].src;
  let finish;
  const artist = createDangoRasterArtist({ manifest, loadImage: src => new URL(src).pathname.endsWith(target)
    ? new Promise(resolve => finish = () => resolve({ src, width: 8, height: 8 })) : loadImage(src) });
  await artist.ready(); const normal = artist.resolveArtwork();
  const pending = artist.resolveArtwork({ accent: 'drowsy-zzz' });
  assert.equal(pending.ready, false); assert.equal(pending.layeredReady, true); assert.equal(pending.key, normal.key);
  await wait(); finish(); await wait();
  assert.equal(artist.resolveArtwork({ accent: 'drowsy-zzz' }).ready, true);
  assert.equal(artist.resolveArtwork({ accent: 'drowsy-zzz' }).key, normal.key);
  artist.dispose();
});

test('telescope small eyepiece meets the right eye and its hand shares the complete tool orientation', async () => {
  const manifest = rasterFixture();
  manifest.tools.telescope.anchors = { ...manifest.tools.telescope.anchors, eyepiece: [31.375, 8.875] };
  const artist = createDangoRasterArtist({ manifest, loadImage }); await artist.ready({ all: true });
  const action = PET_ACTIONS.telescope, artwork = artist.resolveArtwork({ action, motion: action.motion, view: 'auto', progress: .5 });
  const tool = artwork.contact.tools.find(item => item.key === 'telescope'), sprite = manifest.tools.telescope;
  assert.equal(tool.flip, true);
  const { toolMatrix } = require('../src/capabilities/companion/presentation/dango-raster-actions.mjs');
  const eye = artwork.data.face.eyes.neutral.at(-1).pivot;
  assert.deepEqual(applyPoint(toolMatrix(tool, sprite), ...sprite.anchors.eyepiece), eye);
  const grip = applyPoint(toolMatrix(tool, sprite), ...sprite.anchors.right);
  assert.deepEqual(artwork.contact.hands.find(hand => hand.side === 'right').points.at(-1), grip);
  artist.dispose();
});

test('a cold forearm connector keeps its whole hand/tool contact group pending until loaded', async () => {
  const manifest = rasterFixture(), arm = manifest.views.front.parts.arm.src;
  let finish;
  const artist = createDangoRasterArtist({ manifest, loadImage: src => new URL(src).pathname.endsWith(arm)
    ? new Promise(resolve => finish = () => resolve({ src, width: 8, height: 8 })) : loadImage(src) });
  await artist.ready(); const action = PET_ACTIONS.sneeze;
  const pending = artist.resolveArtwork({ action, motion: action.motion, calmVisual: true });
  assert.equal(pending.ready, false); assert.equal(pending.actionReady, false); assert.equal(pending.pending, true);
  const context = recordingContext(); artist.action(context, { artwork: pending, action, palette: PALETTES.pink, layer: 'front' });
  assert.equal(context.calls.length, 0);
  await wait(); finish(); await wait();
  const loaded = artist.resolveArtwork({ action, motion: action.motion, calmVisual: true });
  assert.equal(loaded.actionReady, true);
  artist.dispose();
});
