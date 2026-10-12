'use strict';

import { sampleAccent } from './motion-core/accents.mjs';
import { motionCaps } from './motion-core/action-capabilities.mjs';
import { bodyFloor } from './motion-core/form-anchors.mjs';
import { resolveAccessories } from './motion-core/accessory-resolver.mjs';
import petArt from '../../../core/pet-art.mjs';
import petActionArt from '../../../core/pet-action-art.mjs';
import { drawActionParticle } from '../../../core/pet-action-particles.mjs';
import petAppearanceArt from '../../../core/pet-appearance-art.mjs';
import { SKINS } from '../../../skins.mjs';
import { PET_FORMS, formScale } from '../form-registry.mjs';
import usagiArt from './usagi-art.mjs';
import dangoArt from './dango-raster-production.mjs';
import { sampleActivityStory } from './activity-playback.mjs';
import { isFacingInteraction, sampleInteractionPresentation, drawInteractionLayer } from './interaction-presentation.mjs';
import { resolveDangoPerformance, paintTorsoSprite, drawFeet } from './dango-performance.mjs';

// The two forms share a compositing protocol, not a face or a body painter.
// Adding another artist extends this closed map; neither UI renderer needs
// another species-specific branch or a fork of the state/food/session system.
const NATIVE_ARTISTS = Object.freeze({ dango: dangoArt, usagi: usagiArt });
const ARTIST_METHODS = Object.freeze([
  'resolveArtwork', 'subscribeArtwork', 'palette', 'resolveView', 'faceForView',
  'body', 'face', 'action', 'actionOverlay', 'appearance', 'motionOffset',
  'applyMotionTransform', 'expressionAccent', 'statusEffect'
]);

function validatePetFormArtists(forms = PET_FORMS, artists = NATIVE_ARTISTS) {
  for (const form of Object.values(forms)) {
    if (form.renderer === 'pixel') continue;
    if (ARTIST_METHODS.some(method => typeof artists[form.id]?.[method] !== 'function')) {
      throw new TypeError(`pet form ${form.id} has no complete native painter`);
    }
  }
  for (const id of Object.keys(artists)) {
    if (!['vector', 'raster'].includes(forms[id]?.renderer)) throw new TypeError(`orphan native artist: ${id}`);
  }
  return Object.freeze({ artists: Object.keys(artists).length,
    vectorArtists: Object.keys(artists).filter(id => forms[id].renderer === 'vector').length,
    rasterArtists: Object.keys(artists).filter(id => forms[id].renderer === 'raster').length });
}

validatePetFormArtists();

function artistFor(form) {
  const artist = NATIVE_ARTISTS[form?.id];
  if (!artist) throw new TypeError(`unregistered pet form artist: ${form?.id}`);
  return artist;
}

function paletteForSkin(skinId, form, mood = 'idle') {
  if (form.renderer === 'pixel') return petArt.PALETTES[skinId] || petArt.PALETTES.pink;
  return artistFor(form).palette(skinId, mood);
}

function skinEffectForSkin(skinId, form) {
  const skin = SKINS[skinId];
  if (!skin || (skin.formId || 'dango') !== form.id) return null;
  return skin.petEffect || null;
}

function faceForView(form, face, view) {
  return artistFor(form).faceForView(face, view);
}

function resolveView(form, requested, options = {}) {
  if (form.id === 'usagi' && isFacingInteraction(options.action)) return 'front';
  return artistFor(form).resolveView(requested, options);
}

function sampleAction(form, action, progress, options = {}) {
  if (!form || !PET_FORMS[form.id]) throw new TypeError('registered pet form is required');
  return (form.id === 'usagi' && sampleInteractionPresentation(action, progress, options))
    || sampleActivityStory(action, progress, options);
}

function resolveArtwork(form, options = {}) {
  return form.renderer === 'pixel' ? resolveDangoPerformance(options) : artistFor(form).resolveArtwork(options);
}

function subscribeArtwork(form, listener) {
  return form.renderer === 'pixel' ? () => {} : artistFor(form).subscribeArtwork(listener);
}

function prepareArtwork(form, options = {}) {
  return form.renderer === 'pixel' ? Promise.resolve() : artistFor(form).ready?.(options) || Promise.resolve();
}

function spriteBounds(form, stage, fit = false) {
  if (fit || form.renderer === 'pixel') {
    return Object.freeze({ x: 0, y: 0, width: stage.bodySize, height: stage.bodySize });
  }
  const scale = formScale(form, stage.bodySize);
  const { x, y, width, height } = form.artBounds;
  const deviceScale = stage.deviceScale || 1;
  const left = Math.floor(x * scale * deviceScale), top = Math.floor(y * scale * deviceScale);
  const right = Math.ceil((x + width) * scale * deviceScale), bottom = Math.ceil((y + height) * scale * deviceScale);
  return Object.freeze({ x: left / deviceScale, y: top / deviceScale,
    width: (right - left) / deviceScale, height: (bottom - top) / deviceScale });
}

function resolvePortraitBounds(form, appearance) {
  const items = appearance?.items || [];
  if (!items.length) return form.artBounds;
  const native = form.renderer !== 'pixel' && artistFor(form).portraitBounds?.(appearance);
  if (native) return native;
  const base = form.artBounds;
  let x = base.x, y = base.y, right = x + base.width, bottom = y + base.height;
  for (const item of items) {
    x = Math.min(x, -(item.bleed?.left || 0)); y = Math.min(y, -(item.bleed?.top || 0));
    right = Math.max(right, form.bodySize + (item.bleed?.right || 0));
    bottom = Math.max(bottom, form.bodySize + (item.bleed?.bottom || 0));
  }
  return Object.freeze({ x: x - 1, y: y - 1, width: right - x + 2, height: bottom - y + 2 });
}

function bodySpriteKey(form, skinId, tone = 'normal', view = 'front', fit = false, artwork = null, fitBounds = null) {
  if (form.renderer === 'pixel') return petArt.bodySpriteKey(skinId, tone, view)
    + (artwork?.kind === 'pixel-performance' && !fit ? `|${artwork.key}|torso` : '');
  // A rig's body layer is static per view, so its id@version (not the pose)
  // is the key; rebuilding the rig with a new version invalidates the cache.
  return `${form.id}|${skinId}|${tone}|${view}|${fit ? 'fit' : 'full'}`
    + (artwork?.key ? `|${artwork.key}` : '')
    + (fit && fitBounds ? `|bounds:${fitBounds.x},${fitBounds.y},${fitBounds.width},${fitBounds.height}` : '');
}

// Portraits must fit the ear tips AND a possible cape into the existing panel
// box; desktop sprites use the native art coordinates and the full stage bleed.
function withFormSpace(context, form, stage, fit, draw, fitBounds = null) {
  context.save();
  if (fit) {
    const bounds = fitBounds || form.artBounds;
    const scale = Math.min(stage.bodySize / bounds.width, stage.bodySize / bounds.height);
    context.translate(
      (stage.bodySize - bounds.width * scale) / 2 - bounds.x * scale,
      (stage.bodySize - bounds.height * scale) / 2 - bounds.y * scale
    );
    context.scale(scale, scale);
  } else {
    const scale = formScale(form, stage.bodySize);
    if (scale !== 1) context.scale(scale, scale);
  }
  try { return draw(); } finally { context.restore(); }
}

function paintBodySprite(surface, { form, palette, tone, stage, view = 'front', fit = false, artwork = null, fitBounds = null }) {
  if (form.renderer === 'pixel') return artwork?.kind === 'pixel-performance' && !fit
    ? paintTorsoSprite(surface, palette, stage, view) : petArt.paintBodySprite(surface, palette, tone, stage, view);
  const bounds = spriteBounds(form, stage, fit);
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.save();
  if (!fit) context.translate(-bounds.x, -bounds.y);
  withFormSpace(context, form, stage, fit, () => artistFor(form).body(context, palette, view, artwork, { fit, cache: true }), fitBounds);
  context.restore();
}

function drawBodySprite(context, sprite, { form, stage, bounds, offX, offY, artwork, palette }) {
  context.save(); context.translate(offX, offY);
  const draw = () => {
    context.drawImage(sprite, bounds.x, bounds.y, bounds.width, bounds.height);
    if (form.renderer !== 'pixel' && artistFor(form).bodyForeground) {
      withFormSpace(context, form, stage, false,
        () => artistFor(form).bodyForeground(context, palette, artwork));
    }
  };
  if (form.renderer !== 'pixel' && artistFor(form).clipBody) {
    artistFor(form).clipBody(context, artwork, draw, formScale(form, stage.bodySize));
  } else draw();
  context.restore();
}

function paintFaceSprite(surface, { form, palette, face, blinking, stage, view = 'front', fit = false,
  artwork = null, fitBounds = null }) {
  if (form.renderer === 'pixel') return petArt.paintFaceSprite(surface, palette, artwork?.face || face, blinking, {
    stage, faceRig: form.faceRig, view
  });
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, stage.bodySize, stage.bodySize);
  return withFormSpace(context, form, stage, fit, () => artistFor(form).face(
    context, palette, face, blinking, view, form.faceRig, artwork
  ), fitBounds);
}

function drawFace(context, { form, palette, face, blinking, offX, offY, view, stage, drawPixelFace,
  artwork = null }) {
  if (form.renderer === 'pixel') return drawPixelFace(palette, artwork?.face || face, blinking, offX, offY, view);
  context.save();
  context.translate(offX, offY);
  const eyes = withFormSpace(context, form, stage, false,
    () => artistFor(form).face(context, palette, face, blinking, view, form.faceRig, artwork));
  context.restore();
  return eyes;
}

function drawAppearanceLayer(context, appearance, palette, { form, layer, offX, offY, stage, fit = false, fitBounds = null, ...options }) {
  if (form.renderer === 'pixel') return petAppearanceArt.drawAppearanceLayer(context, appearance, palette, {
    layer, offX, offY, ...options, footwearTransforms: options.artwork?.footwearTransforms
  });
  const artist = artistFor(form);
  const view = options.view || appearance?.view;
  const drawnView = options.artwork?.drawnView || options.artwork?.view || view;
  const authored = item => artist.appearanceLayers?.(item, drawnView) || item.parts || [];
  // Fit resolver (motion-core/accessory-resolver): per-frame visibility, pass
  // and offset. Portrait fits show the outfit as authored, with no action.
  const plan = resolveAccessories({ items: appearance?.items || [], formId: form.id, view: drawnView,
    action: fit ? null : options.action, phase: options.progress, reduced: Boolean(options.calmVisual) });
  const items = plan.itemsFor(layer, authored);
  // Per-view layer decomposition: posed parts the resolver slots into this
  // garment pass (usagi back-view paws: over neckwear, under a cape).
  const deco = !fit ? artist.layerDecomposition?.({ layer, artwork: options.artwork }) : null;
  let decoDone = !deco;
  const runDeco = (inSpace = false) => {
    if (decoDone) return; decoDone = true;
    if (inSpace) { deco.paint(context, palette); return; }
    context.save(); context.translate(offX, offY);
    try { withFormSpace(context, form, stage, false, () => deco.paint(context, palette)); } finally { context.restore(); }
  };
  const after = runDeco;
  if (!items.length) { after(); return false; }
  context.save();
  context.translate(offX, offY);
  const painted = withFormSpace(context, form, stage, fit, () => {
    let didPaint = false;
    for (const item of items) {
      const fitPlan = plan.get(item.id);
      if (!decoDone && fitPlan?.coversPaws) runDeco(true);
      let nudge = fitPlan?.offsetY || 0;
      // Canvas headroom budget: a floating item whose authored top would leave
      // the surface is lowered just enough to stay inside (never clipped).
      const room = fitPlan?.headroom;
      if (room && !fit) {
        const t = context.getTransform?.();
        const top = t ? t.f + t.d * (room.top + nudge) : Infinity;
        if (t?.d > 0 && top < room.px) nudge += (room.px - top) / t.d;
      }
      if (nudge) { context.save(); context.translate(0, nudge); }
      didPaint = artistFor(form).appearance(context, { item, layer, palette, form, appearance, fit,
        view, fitPlan, paintedItems: items, ...options }) || didPaint;
      if (nudge) context.restore();
    }
    if (didPaint && fit && layer === 'front') artist.appearanceForeground?.(context, {
      palette, form, appearance, fit, view: options.view || appearance.view, ...options
    });
    return didPaint;
  }, fitBounds);
  context.restore();
  runDeco();
  return painted;
}

function drawActionLayer(context, { form, action, motion, progress, palette, layer, offX, offY, view,
  stage, theme, calmVisual, backSurface, frontSurface, artwork = null, sprites = null }) {
  // Offline audit hook (tools/accessory-matrix): omit one action pass to
  // isolate held props and near paws. Never set by the app.
  if (globalThis.__petAuditOmitActionLayer === layer) return false;
  // A rig's limbs, ears and tail live in this layer even at rest, so it is
  // painted with or without a playing action.
  if (!action && !['rig', 'pixel-performance', 'dango-vector', 'dango-raster'].includes(artwork?.kind)) return false;
  if (form.renderer === 'pixel') {
    const feetPainted = drawFeet(context, { artwork, palette, stage, offX, offY, layer, sprites });
    if (!action) return feetPainted;
    const surface = layer === 'back' ? backSurface : frontSurface;
    const bounds = petActionArt.paintActionLayer(surface, action, progress, palette, {
      stage, layer, offX, offY, theme, view, calmVisual, footwearTransforms: artwork?.footwearTransforms
    });
    petActionArt.blitActionLayer(context, surface, bounds, stage);
    return Boolean(bounds) || feetPainted;
  }
  context.save();
  context.translate(offX, offY);
  const painted = withFormSpace(context, form, stage, false, () =>
    {
      const native = artistFor(form).action(context, { action, motion, progress, layer, form, palette, view, calmVisual, artwork });
      return (form.id === 'usagi' && drawInteractionLayer(context, action, progress, { layer, calmVisual })) || native;
    });
  context.restore();
  return painted;
}

function drawActionOverlay(context, form, action, progress, options = {}) {
  if (form.renderer !== 'pixel' && artistFor(form).actionOverlay(context, action, progress, options)) return;
  return petActionArt.drawActionOverlay(context, action, progress, options);
}

function motionOffset(form, action, motion, progress, options) {
  if (form.renderer === 'pixel') return petActionArt.bodyOffset(action, progress, options);
  const offset = artistFor(form).motionOffset(motion, progress, options.calmVisual, { ...options, action });
  const scale = formScale(form, options.bodySize);
  return Object.freeze({ x: offset.x * scale, y: offset.y * scale });
}

function applyMotionTransform(context, form, action, motion, progress, options) {
  if (form.renderer === 'pixel') petActionArt.applyBodyTransform(context, action, progress, options);
  else {
    artistFor(form).applyMotionTransform(context, motion, progress, { ...options, action });
    applyAccent(context, form, action, progress, options);
  }
}

// Shared accent layer (motion-core/accents.mjs): squash/stretch about the
// form's floor line, so soles stay planted. Story-owned body poses
// (capability `body`) already carry their own accents.
function applyAccent(context, form, action, progress, options) {
  if (options.calmVisual || options.reducedMotion || options.state === 'dragged' || motionCaps(action).body) return;
  const accent = sampleAccent(action, progress);
  // Below ~0.1 px at body size the scale is invisible; skip the resample.
  if (Math.abs(accent.s) < .0015) return;
  const size = Number(options.size) || 0, floor = bodyFloor(form.id, size);
  context.translate(size / 2, floor);
  context.scale(accent.sx, accent.sy);
  context.translate(-size / 2, -floor);
}

function drawBackDetails(context, form, palette, options) {
  if (form.renderer === 'pixel') return petArt.drawBackDetails(context, palette, options);
  return false;
}

function drawExpressionAccent(context, form, accent, elapsedMs, options) {
  if (form.renderer === 'pixel') return petArt.drawExpressionAccent(context, accent, elapsedMs, options);
  context.save();
  context.translate(options.offX, options.offY);
  withFormSpace(context, form, options.stage, options.fit === true,
    () => artistFor(form).expressionAccent(context, accent, { ...options, elapsedMs }), options.fitBounds);
  context.restore();
  return 0;
}

function drawParticle(context, form, particle) {
  if (form.renderer !== 'pixel' && artistFor(form).particle?.(context, particle)) return true;
  return drawActionParticle(context, particle, { soft: form.particleStyle === 'soft' });
}

function drawSceneBackdrop(context, form, options) {
  return form.renderer !== 'pixel' && Boolean(artistFor(form).sceneBackdrop?.(context, options));
}

function drawSceneParticle(context, form, particle) {
  return form.renderer !== 'pixel' && Boolean(artistFor(form).sceneParticle?.(context, particle));
}

function drawStatusEffect(context, form, status, offX, offY, stage, options = {}) {
  if (form.renderer === 'pixel') return false;
  context.save();
  context.translate(offX, offY);
  const painted = withFormSpace(context, form, stage, false, () => artistFor(form).statusEffect(context, status, options));
  context.restore();
  return Boolean(painted);
}

export {
  paletteForSkin, skinEffectForSkin, resolveView, faceForView, sampleAction, resolveArtwork, subscribeArtwork, prepareArtwork,
  spriteBounds, resolvePortraitBounds, bodySpriteKey, paintBodySprite, drawBodySprite, drawFace,
  paintFaceSprite,
  drawAppearanceLayer, drawActionLayer, drawActionOverlay, motionOffset, applyMotionTransform,
  drawBackDetails, drawExpressionAccent, drawStatusEffect, drawParticle, drawSceneBackdrop, drawSceneParticle, validatePetFormArtists
};
export default Object.freeze({
  paletteForSkin, skinEffectForSkin, resolveView, faceForView, sampleAction, resolveArtwork, subscribeArtwork, prepareArtwork,
  spriteBounds, resolvePortraitBounds, bodySpriteKey, paintBodySprite, drawBodySprite, drawFace,
  paintFaceSprite,
  drawAppearanceLayer, drawActionLayer, drawActionOverlay, motionOffset, applyMotionTransform,
  drawBackDetails, drawExpressionAccent, drawStatusEffect, drawParticle, drawSceneBackdrop, drawSceneParticle, validatePetFormArtists
});
