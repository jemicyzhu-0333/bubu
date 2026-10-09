'use strict';
import { BODY_VIEWS, BODY_ANCHORS, FACE_LAYOUTS, MATERIALS, VECTOR_VERSION } from '../../../content/companion/dango-vector.mjs';
import { PALETTES } from '../../../core/pet-art.mjs';
import { paintVectorShapes } from '../../../core/pet-vector-paint.mjs';
import { resolveDangoView } from '../../../core/dango-view-policy.mjs';
import petActionArt from '../../../core/pet-action-art.mjs';
import { drawVectorAction } from '../../../core/pet-action-vector.mjs';
import { drawDangoFace, sampleDangoFace } from './dango-face.mjs';
import * as wardrobe from './dango-appearance.mjs';
import { sampleFeet } from './dango-performance.mjs';
import { sampleRunningFeet, applyRunningTransform } from '../../../core/pet-running-pose.mjs';

const key = `dango-vector@${VECTOR_VERSION}`;
const resolveView = (requested, options) => resolveDangoView(requested, options);
const palette = skinId => PALETTES[skinId] || PALETTES.pink;
const faceForView = face => face;
function resolveArtwork({ view = 'front', motion = 'idle', face, action, progress = 0, elapsedMs = 0,
  calmVisual = false, state, expressionId, expressionElapsedMs } = {}) {
  const resolvedView = resolveView(view, { action, state });
  const anchors = BODY_ANCHORS[resolvedView], walking = !action && state === 'walking';
  const carrying = action?.id === 'carry-energy';
  const runningFrozen = motion === 'dash' && state === 'dragged';
  const running = motion === 'dash' && !calmVisual && !runningFrozen;
  return Object.freeze({ kind: 'dango-vector', key: running ? `${key}|running` : key, view: resolvedView, anchors, running,
    muzzle: FACE_LAYOUTS[resolvedView].mouth, progress, calmVisual: calmVisual || runningFrozen,
    footGlints: action?.prop === 'sparkle-shoes',
    face: sampleDangoFace(face, { action, motion, progress, elapsedMs, calmVisual: calmVisual || runningFrozen, expressionId, expressionElapsedMs }),
    footwearTransforms: motion === 'dash' ? sampleRunningFeet(anchors, progress, { calmVisual: calmVisual || state === 'dragged' })
      : sampleFeet(walking || carrying ? 'walk' : motion, walking ? (elapsedMs % 760) / 760 : progress,
        resolvedView, calmVisual || state === 'dragged', anchors) });
}
function drawFeet(context, palette, artwork) {
  const parts = BODY_VIEWS[artwork.view] || BODY_VIEWS.front;
  for (const side of ['foot-left', 'foot-right']) {
    context.save(); context.transform(...artwork.footwearTransforms[side]);
    paintVectorShapes(context, parts.feet[side], palette, { materials: MATERIALS }); context.restore();
  }
}
function body(context, palette, view, artwork, { fit = false } = {}) {
  const resolved = artwork?.kind === 'dango-vector' ? artwork : resolveArtwork({ view });
  if (fit) drawFeet(context, palette, resolved);
  const parts = BODY_VIEWS[resolved.view];
  const shapes = !fit && resolved.running && parts.runningTorso || parts.torso;
  return paintVectorShapes(context, shapes, palette, { materials: MATERIALS }) > 0;
}
function face(context, palette, expression, blinking, view, _faceRig, artwork) {
  return drawDangoFace(context, palette, artwork?.face || expression, blinking, artwork?.view || view);
}
function drawFootGlints(context, artwork) {
  if (!artwork.footGlints) return false;
  const opacity = artwork.calmVisual ? .75 : .65 + .3 * Math.sin(artwork.progress * Math.PI * 6) ** 2;
  for (const side of ['foot-left', 'foot-right']) {
    const { x, y } = artwork.anchors[side];
    context.save(); context.transform(...artwork.footwearTransforms[side]);
    paintVectorShapes(context, [{ d: `M${x-2} ${y+3}h4M${x} ${y+1}v4`, fill: 'none', stroke: '#fff1b6', width: .65, opacity }], {});
    context.restore();
  }
  return true;
}
function action(context, options) {
  const artwork = options.artwork?.kind === 'dango-vector' ? options.artwork : resolveArtwork(options);
  if (options.layer === 'back') drawFeet(context, options.palette, artwork);
  if (options.layer === 'front') drawFootGlints(context, artwork);
  return drawVectorAction(context, { ...options, artwork, view: artwork.view, calmVisual: artwork.calmVisual }) || options.layer === 'back';
}
function appearance(context, options) {
  return wardrobe.drawDangoAppearance(context, options);
}
function portraitBounds(appearance) { return wardrobe.resolveDangoPortraitBounds?.(appearance) || null; }
function motionOffset(_motion, progress, calmVisual, options = {}) {
  if (_motion === 'dash' && options.state === 'dragged') return Object.freeze({ x: 0, y: 0 });
  return petActionArt.bodyOffset(options.action, progress, { ...options, calmVisual, bodySize: 66 });
}
function applyMotionTransform(context, motion, progress, options = {}) {
  if (motion === 'dash') return applyRunningTransform(context, progress,
    { ...options, calmVisual: options.calmVisual || options.state === 'dragged' });
  return petActionArt.applyBodyTransform(context, options.action, progress, options);
}
function expressionAccent(context, accent, { elapsedMs = 0, calmVisual = false } = {}) {
  if (!['sleep-zzz', 'drowsy-zzz'].includes(accent)) return 0;
  const drift = calmVisual ? 0 : Math.sin(elapsedMs / 1500 * Math.PI * 2);
  context.save(); context.strokeStyle = '#9c85bc'; context.lineWidth = 1.25; context.lineCap = 'round'; context.lineJoin = 'round';
  for (let i = 0; i < (accent === 'sleep-zzz' ? 2 : 1); i++) {
    const x = 57 + i * 7, y = -9 - i * 8 - drift * 2, size = 3.5 + i;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + size, y); context.lineTo(x, y + size); context.lineTo(x + size, y + size); context.stroke();
  }
  context.restore(); return 1;
}
function statusEffect() { return false; }
function actionOverlay(_context, action) { return action?.id === 'mirror-meet'; }
function subscribeArtwork() { return () => {}; }
export default Object.freeze({ resolveArtwork, resolveView, faceForView, subscribeArtwork, palette, body, face,
  action, actionOverlay, appearance, portraitBounds, motionOffset, applyMotionTransform, expressionAccent, statusEffect });
