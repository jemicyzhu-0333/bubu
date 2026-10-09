'use strict';

import { combinationAccessory, quietAccessorySample } from './combination-accessories.mjs';
import support from './usagi-support.mjs';
import { SKINS } from '../../../skins.mjs';
import { adaptFaceForView } from '../../../core/pet-appearance.mjs';
import { resolveUsagiView } from './usagi-view-policy.mjs';
import { sampleFaceChoreography } from './face-choreography.mjs';
import { createRigSource } from './rig/source.mjs';
import { createRigArtist } from './rig/rig-art.mjs';
import usagiRigDocument from '../../../../assets/companion/usagi/rig/usagi.rig.mjs';
import { withUsagiGround, withUsagiGroundClip, paintUsagiHole } from './usagi-ground.mjs';
import { drawUsagiActionDetails } from './usagi-action-details.mjs';
import { drawUsagiParticle } from './usagi-particles.mjs';
import { sampleUsagiFaceTiming } from './usagi-face-timing.mjs';
import { createUsagiRasterWardrobe } from './usagi-raster-wardrobe.mjs';
import { createUsagiAmbientArt } from './usagi-ambient-art.mjs';
import { USAGI_WARDROBE } from '../../../../assets/companion/usagi/wardrobe/usagi.wardrobe.mjs';
import { usagiPartLayer } from './usagi-garment-depth.mjs';
import { withUsagiEffectOrigins } from './usagi-effect-origins.mjs';
import { usagiProfileFaceRig } from './usagi-face-projection.mjs';
import { paintUsagiGestureUnderCloth } from './usagi-gesture-limbs.mjs';
import { sampleUsagiEventFace, paintUsagiEventHeadphones } from './usagi-event-actions.mjs';
import { paintUsagiEventLaptopBase } from './usagi-event-equipment.mjs';
import { paintUsagiEventRobot } from './usagi-event-robot.mjs';

// One identity, one rig. Unsupported rendering never substitutes an old rabbit.
const rigSource = createRigSource(usagiRigDocument, { form: 'usagi' });
const rigArtist = createRigArtist({ fallback: support, partLayer: usagiPartLayer });
const wardrobe = createUsagiRasterWardrobe({ manifest: USAGI_WARDROBE });
const ambient = createUsagiAmbientArt();

function resolveArtwork({ view, motion, face, calmVisual, progress, elapsedMs, channel, action,
  expressionId, expressionElapsedMs, appearance: outfit } = {}) {
  const rig = rigSource.get();
  const timing = { action, motion, progress, elapsedMs, calmVisual, expressionId, expressionElapsedMs };
  const animatedFace = sampleUsagiEventFace(face, timing)
    || sampleUsagiFaceTiming(sampleFaceChoreography(face, timing), face, timing);
  if (rig) {
    // The selected headwear owns the head. This gate does not depend on image
    // readiness and does not alter the equipped outfit or the action object.
    const prop = action?.id === 'yawn' && action.prop === 'sleep-cap'
      && outfit?.items?.some(item => item.exclusiveGroup === 'usagi.headwear') ? 'none' : undefined;
    const artwork = rigArtist.resolve(usagiProfileFaceRig(rig, action, view), { view, motion, face: animatedFace, calmVisual, progress, elapsedMs, channel, action, prop });
    // The hole remains at the floor while all character layers sink together.
    const dressedBase = wardrobe.resolve(withUsagiEffectOrigins(withUsagiGround(artwork, action, progress, calmVisual)), outfit, view);
    const accessories = Object.freeze({
      headphones: combinationAccessory(action, 'headphones'),
      robot: combinationAccessory(action, 'robot'),
      sample: quietAccessorySample(action)
    });
    const dressed = Object.freeze({ ...dressedBase, combinationAccessories: accessories });
    if (artwork.pose.sample.event?.category !== 'music' && !accessories.headphones) return dressed;
    const firstFront = outfit?.items?.find(item => (item.formId || 'dango') === 'usagi'
      && (wardrobe.appearanceLayers(item, artwork.drawnView) || item.parts || []).includes('front'));
    return Object.freeze({ ...dressed, headphoneFrontItemId: firstFront?.id || null });
  }
  return null;
}

function palette(skinId, mood = 'idle') {
  const colors = SKINS[skinId]?.palette?.[mood] || SKINS[skinId]?.palette?.idle || SKINS.pink.palette.idle;
  return Object.freeze({ ...colors, cheek: '#f2abb9' });
}
const faceForView = (face, view) => adaptFaceForView(face, view);
function resolveView(requested, options = {}) {
  return resolveUsagiView(requested, options);
}

function subscribeArtwork(listener) {
  const stopWardrobe = wardrobe.subscribe(listener), stopAmbient = ambient.subscribe(listener);
  return () => { stopWardrobe(); stopAmbient(); };
}

function body(context, palette, view, artwork, options = {}) {
  const resolved = artwork?.kind === 'rig' ? artwork : resolveArtwork({ view });
  return resolved ? rigArtist.body(context, palette, view, resolved, options) : false;
}

function face(context, palette, expression, blinking, view, faceRig, artwork) {
  const resolved = artwork?.kind === 'rig' ? artwork : resolveArtwork({ view, face: expression });
  return resolved ? withUsagiGroundClip(context, resolved,
    () => rigArtist.face(context, palette, resolved.face || expression, blinking, view, faceRig, resolved)) : (view === 'back' ? 'back' : null);
}

function action(context, options) {
  if (options.artwork?.kind === 'rig') {
    if (options.layer === 'back') paintUsagiHole(context, options.artwork, 'back');
    const painted = withUsagiGroundClip(context, options.artwork, () => {
      if (options.layer === 'back' || !options.artwork.headphoneFrontItemId) {
        paintUsagiEventHeadphones(context, options.artwork, options.layer);
      }
      if (options.layer === 'front') paintUsagiEventLaptopBase(context, options.artwork, options.palette);
      const result = rigArtist.action(context, options);
      drawUsagiActionDetails(context, options);
      paintUsagiEventRobot(context, options.artwork, options.layer);
      return result;
    });
    if (options.layer === 'front') paintUsagiHole(context, options.artwork, 'front');
    return painted;
  }
  return false;
}

// Usagi's native held mirror contains the reflection. Reusing the default
// full-body twin would layer a second oversized rabbit over the real one.
function actionOverlay(_context, action) { return action?.id === 'mirror-meet'; }

function appearance(context, options) {
  const artwork = options.artwork?.kind === 'rig' ? options.artwork
    : resolveArtwork({ view: options.view, appearance: options.appearance });
  return artwork ? withUsagiGroundClip(context, artwork, () => {
    const resolved = { ...options, artwork };
    if (!options.fit && options.layer === 'front' && options.item.id === artwork.headphoneFrontItemId) {
      paintUsagiEventHeadphones(context, artwork, 'front');
    }
    // Paint the complete near limb after body/face and before the first front
    // item. Actual cloth then covers its root; no cream correction covers cloth.
    const firstFront = options.appearance?.items?.find(item => (item.formId || 'dango') === 'usagi'
      && (wardrobe.appearanceLayers(item, artwork.drawnView) || item.parts || []).includes('front'));
    if (!options.fit && options.layer === 'front' && options.item === firstFront) {
      paintUsagiGestureUnderCloth(context, resolved);
    }
    const rasterReady = wardrobe.owns(options.item) && artwork.wardrobe?.ready
      && artwork.wardrobe.rasterKeys.includes(options.item.renderKey);
    return rasterReady ? wardrobe.appearance(context, resolved) : rigArtist.appearance(context, resolved);
  }) : false;
}

function appearanceForeground(context, options) {
  const artwork = options.artwork?.kind === 'rig' ? options.artwork
    : resolveArtwork({ view: options.view, appearance: options.appearance });
  if (!artwork) return false;
  // Finish the whole portrait outfit once. Repainting for every garment made
  // antialiased hand/tail outlines darker and restored far paws over cloth.
  return withUsagiGroundClip(context, artwork,
    () => rigArtist.portraitForeground(context, options.palette, options.view, artwork));
}

function describeRig() { return rigSource.describe(); }

export default Object.freeze({
  resolveArtwork, subscribeArtwork, palette, resolveView, faceForView, body, face, action, actionOverlay, appearance,
  appearanceForeground,
  clipBody: withUsagiGroundClip,
  particle: drawUsagiParticle,
  sceneBackdrop: ambient.sceneBackdrop,
  sceneParticle: ambient.sceneParticle,
  appearanceLayers: wardrobe.appearanceLayers,
  portraitBounds: outfit => wardrobe.portraitBounds(outfit, USAGI_WARDROBE.artBounds),
  ready: () => Promise.all([wardrobe.ready(), ambient.ready()]),
  cacheStats: () => Object.freeze({ wardrobe: wardrobe.cacheStats(), ambient: ambient.cacheStats() }),
  motionOffset: support.motionOffset,
  applyMotionTransform: support.applyMotionTransform,
  expressionAccent: support.expressionAccent,
  statusEffect: support.statusEffect,
  describeRig
});
