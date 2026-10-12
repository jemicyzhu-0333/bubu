'use strict';

import { motionCaps } from './motion-core/action-capabilities.mjs';
import { paperReturnFace } from './paper-return-story.mjs';
import { secondarySwing } from './motion-core/secondary.mjs';
import { motionOffset as bodyOffset } from './usagi-body-motion.mjs';
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
import { applyPoint } from './rig/pose.mjs';
import { paintWithPawCutout } from './accessory-cutout.mjs';
import { paintLimbsUnderCloth } from './usagi-limbs.mjs';
import { sampleUsagiEventFace, paintUsagiEventHeadphones } from './usagi-event-actions.mjs';
import { paintUsagiEventLaptopBase } from './usagi-event-equipment.mjs';
import { paintUsagiEventRobot } from './usagi-event-robot.mjs';

// One identity, one rig. Unsupported rendering never substitutes an old rabbit.
const rigSource = createRigSource(usagiRigDocument, { form: 'usagi' });
const rigArtist = createRigArtist({ fallback: support, partLayer: usagiPartLayer });
const wardrobe = createUsagiRasterWardrobe({ manifest: USAGI_WARDROBE });
const ambient = createUsagiAmbientArt();

const NO_SECONDARY = Object.freeze({ earwear: 0 });
function resolveArtwork({ view, motion, face, calmVisual, progress, elapsedMs, channel, action,
  expressionId, expressionElapsedMs, appearance: outfit } = {}) {
  const rig = rigSource.get();
  const timing = { action, motion, progress, elapsedMs, calmVisual, expressionId, expressionElapsedMs };
  const animatedFace = paperReturnFace(face, timing) || sampleUsagiEventFace(face, timing)
    || sampleUsagiFaceTiming(sampleFaceChoreography(face, timing), face, timing);
  if (rig) {
    // The selected headwear owns the head. This gate does not depend on image
    // readiness and does not alter the equipped outfit or the action object.
    const prop = motionCaps(action).yieldPropToHeadwear && action.prop === motionCaps(action).yieldPropToHeadwear
      && outfit?.items?.some(item => item.exclusiveGroup === 'usagi.headwear') ? 'none' : undefined;
    const artwork = rigArtist.resolve(usagiProfileFaceRig(rig, action, view), { view, motion, face: animatedFace, calmVisual, progress, elapsedMs, channel, action, prop });
    // The hole remains at the floor while all character layers sink together.
    const dressedBase = wardrobe.resolve(withUsagiEffectOrigins(withUsagiGround(artwork, action, progress, calmVisual)), outfit, view);
    const accessories = Object.freeze({
      headphones: combinationAccessory(action, 'headphones'),
      robot: combinationAccessory(action, 'robot'),
      sample: quietAccessorySample(action)
    });
    // Secondary layer: ear accessories trail the body's lateral motion on a
    // spring (deterministic re-integration; off under calm/reduced motion).
    const durationMs = action?.duration || action?.durationMs || 8000;
    const signal = ms => bodyOffset(motion, ms / durationMs, false, { action }).x;
    // Only paid for when an ear accessory is actually worn.
    const wearsEar = outfit?.items?.some(item => item.exclusiveGroup === 'usagi.earwear');
    const secondary = wearsEar ? Object.freeze({ earwear: secondarySwing(signal, (Number(progress) || 0) * durationMs,
      { reducedMotion: calmVisual || !motion || motion === 'idle' }) }) : NO_SECONDARY;
    const dressed = Object.freeze({ ...dressedBase, combinationAccessories: accessories, secondary });
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
function actionOverlay(_context, action) { return Boolean(motionCaps(action).overlayForms?.includes('usagi')); }

function paintItem(context, resolved, options, artwork) {
  const rasterReady = wardrobe.owns(options.item) && artwork.wardrobe?.ready
    && artwork.wardrobe.rasterKeys.includes(options.item.renderKey);
  return rasterReady ? wardrobe.appearance(context, resolved) : rigArtist.appearance(context, resolved);
}

function holdsFrontProp(data, artwork, side) {
  return (artwork.pose?.sample?.props || []).some(id => {
    const prop = data.props?.[id];
    return prop && prop.layer !== 'back' && (prop.bone === `hand_${side}` || prop.bone === `arm_${side}`);
  });
}

// Paw regions in front of the torso, for the resolver's hand cut-out.
const PAW = Object.freeze({ rx: 6.2, ry: 5.2 });
function usagiPaws(artwork) {
  const data = artwork?.rig?.views?.[artwork.drawnView], world = artwork?.pose?.world;
  if (!data || !world) return [];
  const back = artwork.drawnView === 'back';
  const paws = [];
  for (const side of ['l', 'r']) {
    const bone = data.bones[`hand_${side}`];
    if (!bone || !world[`hand_${side}`]) continue;
    // Tucked (far) paws stay under the cloth; only front paws are uncovered.
    if (!back && usagiPartLayer({ bone: `hand_${side}`, layer: 'front' }, artwork) !== 'front') continue;
    // Only a paw that actually carries a front prop is uncovered; erasing
    // cloth over an empty paw position would just punch a hole in it.
    // Back view: both shoulder paws are front-pass parts; the resolver asks for
    // the cut only for neckwear that crosses them.
    if (!back && !holdsFrontProp(data, artwork, side)) continue;
    const [x, y] = applyPoint(world[`hand_${side}`], ...bone.pivot);
    if (back ? x > -12 && x < 78 && y > 6 && y < 70 : x > 8 && x < 58 && y > 30 && y < 66) paws.push({ x, y, ...PAW });
  }
  return paws;
}

function appearance(context, options) {
  const artwork = options.artwork?.kind === 'rig' ? options.artwork
    : resolveArtwork({ view: options.view, appearance: options.appearance });
  return artwork ? withUsagiGroundClip(context, artwork, () => {
    const resolved = { ...options, artwork };
    // The resolver's painted list (stowed/hidden items removed) decides which
    // front item opens the cloth pass; the raw outfit is the portrait fallback.
    const firstFront = options.paintedItems ? options.paintedItems[0]
      : options.appearance?.items?.find(item => (item.formId || 'dango') === 'usagi'
        && (wardrobe.appearanceLayers(item, artwork.drawnView) || item.parts || []).includes('front'));
    const opensFront = !options.fit && options.layer === 'front' && options.item === firstFront;
    if (opensFront && artwork.headphoneFrontItemId) paintUsagiEventHeadphones(context, artwork, 'front');
    // Paint the complete near limb after body/face and before the first front
    // item. Actual cloth then covers its root; no cream correction covers cloth.
    if (opensFront) {
      rigArtist.layerParts(context, options.palette, artwork.drawnView, artwork, 'under-cloth');
      paintLimbsUnderCloth(context, resolved);
    }
    // Held-prop fallback: torso cloth is cut around the paws instead of
    // swallowing them (and the prop they hold).
    if (options.fitPlan?.cut === 'hands' && options.layer === 'front') {
      return paintWithPawCutout(context, usagiPaws(artwork), target => paintItem(target, resolved, options, artwork));
    }
    return paintItem(context, resolved, options, artwork);
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
