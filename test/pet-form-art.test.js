'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_FORMS, resolveFormMotion } = require('../src/capabilities/companion/form-registry.mjs');
const art = require('../src/capabilities/companion/presentation/form-art.mjs');
const petArt = require('../src/core/pet-art.mjs');
const { projectAppearance } = require('../src/core/pet-appearance.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { createCompanionPortraitPainter } = require('../src/surfaces/popover/features/companion-portrait.mjs');
const { RasterBrowserImage } = require('../test-support/raster-browser-image.js');
const dangoArtist = require('../src/capabilities/companion/presentation/dango-raster-production.mjs').default;
globalThis.Image = RasterBrowserImage;
test.before(() => dangoArtist.ready({ all: true }));

function surface() {
  const calls = [];
  const context = {
    calls, canvas: null, globalAlpha: 1, imageSmoothingEnabled: false,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    transform(...args) { calls.push(['transform', ...args]); },
    setTransform(...args) { calls.push(['setTransform', ...args]); },
    translate(...args) { calls.push(['translate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    beginPath() { calls.push(['beginPath']); }, closePath() { calls.push(['closePath']); },
    arc(...args) { calls.push(['arc', ...args]); },
    rect(...args) { calls.push(['rect', ...args]); }, clip() { calls.push(['clip']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
    quadraticCurveTo(...args) { calls.push(['quadraticCurveTo', ...args]); },
    bezierCurveTo(...args) { calls.push(['bezierCurveTo', ...args]); },
    fill(...args) { calls.push(['fill', ...args]); }, stroke(...args) { calls.push(['stroke', ...args]); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    fillText(...args) { calls.push(['fillText', ...args]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set lineCap(value) { calls.push(['lineCap', value]); },
    set lineJoin(value) { calls.push(['lineJoin', value]); },
    set font(value) { calls.push(['font', value]); }
  };
  return { width: 0, height: 0, style: {}, getContext: () => context, context };
}

const artist = require('../src/capabilities/companion/presentation/usagi-art.mjs').default;
globalThis.Path2D = class { constructor(d) { this.d = d; } };
test.after(() => { delete globalThis.Path2D; delete globalThis.Image; });

const dango = PET_FORMS.dango;
const usagi = PET_FORMS.usagi;
const stage = resolvePetStage({ devicePixelRatio: 2 });

test('dango preserves its palette and draws approved raster layers with a versioned cache', () => {
  const canvas = surface();
  const palette = art.paletteForSkin('pink', dango);
  assert.equal(palette, petArt.PALETTES.pink);
  const artwork = art.resolveArtwork(dango, { view: 'profile' });
  assert.equal(artwork.view, 'three-quarter', 'legacy profile is capped at the approved two-eye turn');
  assert.equal(artwork.ready, true);
  assert.match(art.bodySpriteKey(dango, 'pink', 'normal', 'three-quarter', false, artwork), /dango-raster:/);
  art.paintBodySprite(canvas, { form: dango, palette, tone: 'normal', stage, view: 'three-quarter', artwork });
  assert.ok(canvas.context.calls.some(([kind, image]) => kind === 'drawImage' && image.src.includes('/raster/')));
  assert.ok(!canvas.context.calls.some(([kind]) => kind === 'fill' || kind === 'fillRect'), 'no retired path or pixel body is used');
});

test('cached Dango body composes exactly once and applies the live floor outside the cached image', () => {
  const canvas = surface(), sprite = surface(), bounds = art.spriteBounds(dango, stage);
  const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
  const action = PET_ACTIONS['pit-fall'];
  const artwork = art.resolveArtwork(dango, { action, motion: action.motion, progress: .5 });
  art.drawBodySprite(canvas.context, sprite, { form: dango, stage, bounds, offX: 40, offY: 60, artwork,
    palette: art.paletteForSkin('pink', dango) });
  assert.equal(canvas.context.calls.filter(call => call[0] === 'drawImage' && call[1] === sprite).length, 1,
    'live attachment repair must not duplicate the cached torso');
  assert.equal(canvas.context.calls.filter(call => call[0] === 'clip').length, 1);
  assert.deepEqual(canvas.context.calls.find(call => call[0] === 'translate'), ['translate', 40, 60]);
});

test('vector form paints individual bodies and faces for each view with no pixel-grid resampling', () => {
  const palette = art.paletteForSkin('usagi', usagi);
  for (const view of ['front', 'three-quarter', 'profile', 'back']) {
    const canvas = surface();
    art.paintBodySprite(canvas, { form: usagi, palette, tone: 'normal', stage, view });
    assert.ok(canvas.context.calls.some(([kind]) => kind === 'fill'), view);
    assert.ok(!canvas.context.calls.some(([kind]) => kind === 'fillRect'), view);
    assert.deepEqual(art.spriteBounds(usagi, stage), usagi.artBounds);
    const face = surface();
    const mask = art.paintFaceSprite(face, {
      form: usagi, palette, face: { eyes: 'neutral', mouth: 'smile' }, blinking: false, stage, view
    });
    assert.equal(mask, view === 'back' ? 'back' : 'neutral');
  }
});

test('legacy sprite input never restores the retired artwork', () => {
  const canvas = surface();
  const artwork = { kind: 'sprite-sheet', frame: 'wave', image: {} };
  art.paintBodySprite(canvas, { form: usagi, palette: art.paletteForSkin('usagi', usagi), stage, view: 'front', artwork });
  assert.ok(canvas.context.calls.some(([kind, path]) => kind === 'fill' && path?.d));
  assert.ok(!canvas.context.calls.some(([kind]) => kind === 'drawImage'));
});

test('portrait fit applies the same bounds to body, live face and the form-specific wardrobe', () => {
  const portrait = resolvePetStage({ devicePixelRatio: 2, cssPerArtPixel: 1.5, bleed: 12 });
  const palette = art.paletteForSkin('usagi', usagi);
  const body = surface();
  const face = surface();
  art.paintBodySprite(body, { form: usagi, palette, tone: 'normal', stage: portrait, fit: true });
  art.paintFaceSprite(face, {
    form: usagi, palette, stage: portrait, fit: true, blinking: false,
    face: { eyes: 'neutral', mouth: 'smile' }
  });
  const appearance = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25, view: 'front' });
  const painter = surface();
  assert.equal(art.drawAppearanceLayer(painter.context, appearance, palette,
    { form: usagi, stage: portrait, fit: true, layer: 'back', offX: 0, offY: 0 }), false);
  assert.equal(art.drawAppearanceLayer(painter.context, appearance, palette,
    { form: usagi, stage: portrait, fit: true, layer: 'front', offX: 0, offY: 0 }), true);
  for (const calls of [body.context.calls, face.context.calls, painter.context.calls]) {
    assert.ok(calls.some(([kind, x, y]) => kind === 'scale' && x > 0 && x < 1 && x === y));
  }
});

test('both native vector portraits use CSS-size times DPR', () => {
  const document = { createElement: () => surface() };
  const hero = surface();
  const painter = createCompanionPortraitPainter({ document, window: { devicePixelRatio: 1 }, canvas: hero });
  const vector = surface();
  painter.drawPetPreview(vector, { skinId: 'usagi', itemIds: [], size: 'preview' });
  assert.deepEqual({ width: vector.width, height: vector.height }, { width: 135, height: 135 });
  assert.deepEqual({ width: vector.style.width, height: vector.style.height },
    { width: '135px', height: '135px' });
  assert.equal(vector.style.imageRendering, 'auto');

  const pixel = surface();
  painter.drawPetPreview(pixel, { skinId: 'pink', itemIds: [], size: 'preview' });
  assert.deepEqual({ width: pixel.width, height: pixel.height }, { width: 135, height: 135 });
  assert.equal(pixel.style.imageRendering, 'auto');

  const fractionalHero = surface();
  const fractional = createCompanionPortraitPainter({
    document, window: { devicePixelRatio: 1.25 }, canvas: fractionalHero
  });
  fractional.drawHero({ skinId: 'usagi', now: 0, calmVisual: true });
  assert.deepEqual({ width: fractionalHero.width, height: fractionalHero.height },
    { width: 185, height: 185 });
  fractional.drawHero({ skinId: 'pink', now: 0, calmVisual: true });
  assert.deepEqual({ width: fractionalHero.width, height: fractionalHero.height },
    { width: 185, height: 185 });
});

test('popover portraits recreate vector rasters when a window crosses displays of different DPR', () => {
  const display = { devicePixelRatio: 1 };
  const document = { createElement: () => surface() };
  const hero = surface();
  const painter = createCompanionPortraitPainter({ document, window: display, canvas: hero });
  const preview = surface();
  painter.drawPetPreview(preview, { skinId: 'usagi', itemIds: [], size: 'preview' });
  painter.drawHero({ skinId: 'usagi', now: 0, calmVisual: true });
  assert.equal(preview.width, 135);
  assert.equal(hero.width, 148);

  display.devicePixelRatio = 2;
  painter.drawPetPreview(preview, { skinId: 'usagi', itemIds: [], size: 'preview' });
  painter.drawHero({ skinId: 'usagi', now: 0, calmVisual: true });
  assert.equal(preview.width, 270);
  assert.equal(hero.width, 296);
  assert.equal(preview.style.width, '135px', 'the CSS footprint must remain stable');
  painter.dispose();
});

test('vector gestures and decorations use only their own artist and own anchors', () => {
  const painter = surface();
  const palette = art.paletteForSkin('usagi', usagi);
  const accessory = projectAppearance({
    skin: 'usagi', formId: 'usagi', level: 25, view: 'profile',
    itemIds: ['usagi.ear-bow'], includeLocked: true
  });
  assert.equal(art.drawAppearanceLayer(painter.context, accessory, palette,
    { form: usagi, stage, layer: 'front', view: 'profile', offX: 40, offY: 40 }), true);
  const earAnchor = artist.resolveArtwork({ view: 'profile' }).rig.views.profile.anchors['usagi.earwear'];
  assert.ok(painter.context.calls.some(([kind, x, y]) => kind === 'translate'
    && x === earAnchor.x && y === earAnchor.y));
  assert.equal(art.drawActionLayer(painter.context, {
    form: usagi, action: { motion: 'read' }, motion: resolveFormMotion(usagi, { motion: 'read' }),
    progress: 0.5, palette, artwork: artist.resolveArtwork({ view: 'front', motion: 'read', progress: 0.5 }), layer: 'front', offX: 40, offY: 40, view: 'front', stage, calmVisual: false
  }), true);
  assert.ok(painter.context.calls.some(([kind, path]) => kind === 'fill' && path?.d), 'the book is part of the rig');
  assert.equal(art.drawActionLayer(painter.context, { form: usagi, action: null }), false);
  assert.throws(() => art.paletteForSkin('usagi', { id: 'unregistered', renderer: 'vector' }), /unregistered/);
});

test('back-view accessories leave the supplied fluffy tail uncovered', () => {
  const palette = art.paletteForSkin('usagi', usagi);
  for (const itemId of ['usagi.star-collar', 'usagi.travel-cape']) {
    const appearance = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25,
      view: 'back', itemIds: [itemId], includeLocked: true });
    const painter = surface();
    assert.equal(art.drawAppearanceLayer(painter.context, appearance, palette, {
      form: usagi, stage, layer: 'front', view: 'back', offX: 40, offY: 40
    }), true, `${itemId} uses a dedicated rear-facing outline`);
    const curves = painter.context.calls.filter(([kind]) => kind === 'quadraticCurveTo');
    assert.ok(curves.every(call => call[call.length - 1] <= 12), 'hem ends above the tail center');
  }
});


test('both companions use native hand-mirror reflections without a duplicate full-body overlay', () => {
  const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
  const options = { stage, petCanvas: surface(), calmVisual: false };
  const current = surface(), original = surface();
  art.drawActionOverlay(current.context, usagi, PET_ACTIONS['mirror-meet'], .5, options);
  assert.equal(current.context.calls.filter(call => call[0] === 'drawImage').length, 0);
  art.drawActionOverlay(original.context, dango, PET_ACTIONS['mirror-meet'], .5, options);
  assert.equal(original.context.calls.filter(call => call[0] === 'drawImage').length, 0);
  art.drawActionOverlay(current.context, usagi, PET_ACTIONS.hiccup, 0, options);
  assert.ok(current.context.calls.some(call => call[0] === 'fillText' && call[1] === 'hic!'));
});
