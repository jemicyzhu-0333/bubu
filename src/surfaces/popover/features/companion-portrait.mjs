'use strict';

import petArt from '../../../core/pet-art.mjs';
import petExpression from '../../../core/pet-expression.mjs';
import petAppearance from '../../../core/pet-appearance.mjs';
import { EXPRESSIONS } from '../../../content/expressions.mjs';
import { PET_APPEARANCE_ITEMS } from '../../../content/appearance.mjs';
import { forms, formArt } from '../../../capabilities/companion/index.mjs';

const PORTRAIT_EXPRESSIONS = Object.freeze({
  idle: 'life.idle', focus: 'work.focus', break: 'work.rest',
  paused: 'work.pause', celebrate: 'react.celebrate'
});
const PREVIEW_TIERS = Object.freeze({
  thumb: Object.freeze({ cssPerArtPixel: 0.5, bleed: 6 }),
  preview: Object.freeze({ cssPerArtPixel: 1.5, bleed: 12 })
});

// All three popover canvases share the desktop's companion-owned painter.
// Vector portraits fit the declared ear/cape bounds into the original body
// area; the established dango pixel path keeps its previous size and raster.
function createCompanionPortraitPainter({ document, window, canvas } = {}) {
  if (!document?.createElement || !window || !canvas?.getContext) {
    throw new TypeError('companion portrait requires its own canvas and document');
  }
  const registry = petExpression.createExpressionRegistry(EXPRESSIONS);
  // The same popover can move between Retina and non-Retina displays without
  // being recreated. Read DPR for each paint, not once at construction.
  const devicePixelRatio = () => window.devicePixelRatio || 1;
  const heroGeometry = Object.freeze({ bleed: 4, cssPerArtPixel: 2 });
  let heroStage = forms.resolveFormStage('pink', devicePixelRatio(), heroGeometry);
  const heroContext = canvas.getContext('2d');
  const bodySurface = document.createElement('canvas');
  const faceSurface = document.createElement('canvas');

  let bodyKey = '';
  let blinkUntil = 0;
  let nextBlinkAt = 0;
  const pendingPreviews = new Map();
  let lastHeroRequest = null;
  const artworkSubscriptions = new Map();

  function waitForArtwork(form, artwork) {
    if (form.renderer === 'pixel' || artworkSubscriptions.has(form.id)) return;
    artworkSubscriptions.set(form.id, formArt.subscribeArtwork(form, () => {
      const previews = [...pendingPreviews];
      pendingPreviews.clear();
      for (const [target, options] of previews) drawPetPreview(target, options);
      if (lastHeroRequest) drawHero(lastHeroRequest);
    }));
  }

  function sizeSurfaces(stage, target, body, face) {
    const bodyPixels = Math.round(stage.bodySize * stage.deviceScale);
    for (const surface of [body, face]) {
      if (surface.width !== bodyPixels) surface.width = bodyPixels;
      if (surface.height !== bodyPixels) surface.height = bodyPixels;
    }
    if (target.width !== stage.rasterWidth) target.width = stage.rasterWidth;
    if (target.height !== stage.rasterHeight) target.height = stage.rasterHeight;
    target.style.width = `${stage.cssWidth}px`;
    target.style.height = `${stage.cssHeight}px`;
  }

  function configureHeroStage(skinId) {
    const next = forms.resolveFormStage(skinId, devicePixelRatio(), heroGeometry);
    if (next.deviceScale !== heroStage.deviceScale) bodyKey = '';
    heroStage = next;
    sizeSurfaces(heroStage, canvas, bodySurface, faceSurface);
    const overhang = (heroStage.cssWidth - heroStage.bodyCssSize) / 2;
    canvas.style.left = `${-overhang}px`;
    canvas.style.top = `${-overhang}px`;
  }
  configureHeroStage('pink');

  function blinking(config, now, calmVisual) {
    if (calmVisual) { blinkUntil = 0; return false; }
    const blink = config?.blink || { minMs: 3600, maxMs: 7200 };
    if (now >= blinkUntil && now >= nextBlinkAt) {
      blinkUntil = now + 140;
      nextBlinkAt = blinkUntil + blink.minMs + Math.random() * Math.max(0, blink.maxMs - blink.minMs);
    }
    return now < blinkUntil;
  }

  function staticFace(config) {
    const face = config?.static?.face;
    return {
      eyes: face?.eyes || 'neutral', mouth: face?.mouth || 'neutral',
      eyeOffsetX: config?.face?.eyeOffsetX || 0,
      eyeOffsetY: config?.face?.eyeOffsetY || 0,
      eyeInsetX: config?.face?.eyeInsetX || 0,
      openness: config?.face?.openness ?? 1
    };
  }

  function appearanceFor(skinId, form, itemIds) {
    return Array.isArray(itemIds)
      ? petAppearance.projectAppearance({
        skin: skinId, formId: form.id, view: 'front', items: PET_APPEARANCE_ITEMS,
        itemIds, includeLocked: true
      })
      : null;
  }

  function drawHero({ skinId = 'pink', mood = 'idle', elapsedMs = 0, now, calmVisual = false,
    itemIds = [] } = {}) {
    configureHeroStage(skinId);
    const form = forms.resolvePetForm(skinId);
    const fit = form.renderer !== 'pixel';
    const palette = formArt.paletteForSkin(skinId, form);
    const expressionId = PORTRAIT_EXPRESSIONS[mood] || 'life.idle';
    const config = registry.get(expressionId) || registry.get('life.idle');
    const pose = calmVisual ? null : petExpression.sampleExpressionPose(registry, expressionId, elapsedMs);
    const face = pose?.face || staticFace(config);
    const appearance = fit ? appearanceFor(skinId, form, itemIds) : null;
    const artwork = formArt.resolveArtwork(form, { view: 'front', face, calmVisual, appearance, accent: config?.accent });
    lastHeroRequest = fit ? { skinId, mood, elapsedMs, now, calmVisual, itemIds } : null;
    waitForArtwork(form, artwork);
    const bodyPose = pose?.body || config?.static?.body || null;
    const tone = bodyPose?.tone || 'normal';
    const origin = heroStage.bodyOrigin;
    const size = heroStage.bodySize;
    // Fit only the actual selected outfit; an empty wardrobe keeps the body
    // large, while hats and halos receive their measured extra headroom.
    const fitBounds = formArt.resolvePortraitBounds(form, appearance);

    heroContext.imageSmoothingEnabled = fit;
    canvas.style.imageRendering = 'auto';
    heroContext.setTransform(heroStage.deviceScale, 0, 0, heroStage.deviceScale, 0, 0);
    heroContext.clearRect(0, 0, heroStage.artWidth, heroStage.artHeight);
    heroContext.save();
    petArt.applyBodyPose(heroContext, bodyPose, heroStage.artWidth);
    if (appearance) formArt.drawAppearanceLayer(heroContext, appearance, palette, {
      form, stage: heroStage, fit, fitBounds, layer: 'back', offX: origin.x, offY: origin.y,
      view: 'front', calmVisual, elapsedMs, artwork
    });
    const key = formArt.bodySpriteKey(form, skinId, tone, 'front', fit, artwork, fitBounds);
    if (bodyKey !== key) {
      formArt.paintBodySprite(bodySurface, { form, palette, tone, stage: heroStage, fit, fitBounds, artwork });
      bodyKey = key;
    }
    heroContext.drawImage(bodySurface, origin.x, origin.y, size, size);
    formArt.paintFaceSprite(faceSurface, {
      form, palette, face, blinking: blinking(config, now, calmVisual), stage: heroStage, fit, fitBounds,
      artwork
    });
    heroContext.drawImage(faceSurface, origin.x, origin.y, size, size);
    if (appearance) formArt.drawAppearanceLayer(heroContext, appearance, palette, {
      form, stage: heroStage, fit, fitBounds, layer: 'front', offX: origin.x, offY: origin.y,
      view: 'front', calmVisual, elapsedMs, artwork
    });
    heroContext.restore();
    formArt.drawExpressionAccent(heroContext, form, config?.accent || 'none', elapsedMs, {
      offX: fit ? origin.x : -18, offY: fit ? origin.y : 4,
      stage: heroStage, fit, fitBounds, calmVisual, color: '#bb9af7'
    });
  }

  function createStillPainter({ cssPerArtPixel, bleed }) {
    const body = document.createElement('canvas');
    const face = document.createElement('canvas');
    return function paintStill(target, skinId, appearance) {
      const form = forms.resolvePetForm(skinId);
      const stage = forms.resolveFormStage(skinId, devicePixelRatio(), { cssPerArtPixel, bleed });
      sizeSurfaces(stage, target, body, face);
      const fit = form.renderer !== 'pixel';
      const fitBounds = formArt.resolvePortraitBounds(form, appearance);
      const palette = formArt.paletteForSkin(skinId, form);
      const artwork = formArt.resolveArtwork(form, { view: 'front',
        face: staticFace(registry.get('life.idle')), calmVisual: true, appearance });
      const origin = stage.bodyOrigin;
      target.style.imageRendering = 'auto';
      const context = target.getContext('2d');
      context.imageSmoothingEnabled = fit;
      context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
      context.clearRect(0, 0, stage.artWidth, stage.artHeight);
      if (appearance) formArt.drawAppearanceLayer(context, appearance, palette, {
        form, stage, fit, fitBounds, layer: 'back', offX: origin.x, offY: origin.y, view: 'front', calmVisual: true, artwork
      });
      formArt.paintBodySprite(body, { form, palette, tone: 'normal', stage, fit, fitBounds, artwork });
      context.drawImage(body, origin.x, origin.y, stage.bodySize, stage.bodySize);
      formArt.paintFaceSprite(face, { form, palette, face: staticFace(registry.get('life.idle')),
        blinking: false, stage, fit, fitBounds, artwork });
      context.drawImage(face, origin.x, origin.y, stage.bodySize, stage.bodySize);
      if (appearance) formArt.drawAppearanceLayer(context, appearance, palette, {
        form, stage, fit, fitBounds, layer: 'front', offX: origin.x, offY: origin.y, view: 'front', calmVisual: true, artwork
      });
      return artwork;
    };
  }

  const stillPainters = new Map(Object.entries(PREVIEW_TIERS)
    .map(([tier, geometry]) => [tier, createStillPainter(geometry)]));

  function drawPetPreview(target, { skinId = 'pink', itemIds = null, size = 'preview' } = {}) {
    const painter = stillPainters.get(size) || stillPainters.get('preview');
    const form = forms.resolvePetForm(skinId);
    const artwork = painter(target, skinId, appearanceFor(skinId, form, itemIds));
    if (form.renderer !== 'pixel' && (!artwork || artwork.ready === false || artwork.kind === 'dango-raster')) {
      pendingPreviews.set(target, { skinId, itemIds, size });
      if (pendingPreviews.size > 96) pendingPreviews.delete(pendingPreviews.keys().next().value);
      waitForArtwork(form, artwork);
    } else pendingPreviews.delete(target);
  }

  function dispose() {
    for (const unsubscribe of artworkSubscriptions.values()) unsubscribe();
    artworkSubscriptions.clear();
    pendingPreviews.clear();
    lastHeroRequest = null;
  }

  return Object.freeze({ drawHero, drawPetPreview, heroContext,
    dispose,
    get heroStage() { return heroStage; } });
}

export { createCompanionPortraitPainter };
