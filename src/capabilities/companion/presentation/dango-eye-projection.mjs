'use strict';
import { DANGO_EYE_INK_BOUNDS } from '../../../content/companion/dango-eye-footprints.mjs';

// PET_VISUAL「舞台与坐标契约」: the approved neutral pair owns the open-eye
// footprint and perspective. Authored eyelids/closed smiles keep their shape.
const OPEN_EYE_GLYPHS = Object.freeze(['neutral', 'curious', 'focused', 'wide',
  'sparkle', 'surprised', 'determined', 'pleading']);
const isOpenEye = key => OPEN_EYE_GLYPHS.includes(key);
const apertureFor = face => Math.max(.25, Math.min(1, Number.isFinite(face?.openness) ? face.openness : 1));

function eyeInkRect(sprite) {
  const bounds = DANGO_EYE_INK_BOUNDS[sprite?.src];
  if (!bounds) return sprite.rect;
  const [iw, ih, x, y, w, h] = bounds, [left, top, width, height] = sprite.rect;
  return [left + x / iw * width, top + y / ih * height, w / iw * width, h / ih * height];
}

function projectOpenEye(data, key, sprite, index) {
  const reference = data?.face?.eyes?.neutral?.[index];
  if (!isOpenEye(key) || !reference) return null;
  const rect = eyeInkRect(reference);
  const [x, y, width, height] = rect;
  const [sx, sy, sw, sh] = eyeInkRect(sprite);
  // Match the real pupil, not the PNG's pink margin. The canonical neutral
  // sprite stays identity; all eye centres retain its visual anchor.
  // Do not use the limb transform's scale clamp.
  const scaleX = width / sw, scaleY = height / sh;
  return Object.freeze({ matrix: Object.freeze([scaleX, 0, 0, scaleY,
    x - sx * scaleX, y - sy * scaleY]), rect: Object.freeze(rect) });
}

// Presentation-only continuity, advanced by the caller's existing frame clock.
// No timer, expression choice, persisted state, or second animation scheduler.
function createEyeApertureSampler() {
  const channels = new Map();
  function sample(face, { channel = 'pet', view = 'front', elapsedMs, expressionId,
    calmVisual = false, reducedMotion = false } = {}) {
    const target = apertureFor(face);
    if (!Number.isFinite(elapsedMs)) return target; // Stateless portraits cannot disturb the pet.
    const previous = channels.get(channel), dt = previous ? elapsedMs - previous.time : 0;
    const reset = calmVisual || reducedMotion || !isOpenEye(face?.eyes)
      || (face?.openness ?? 1) <= .15 || !previous || previous.view !== view
      || previous.expressionId !== expressionId || dt < 0 || dt > 500;
    let value = target;
    if (!reset && dt > 0) {
      const delta = (target - previous.value) * (1 - Math.exp(-dt / 70));
      const limit = dt * .002;
      value = previous.value + Math.max(-limit, Math.min(limit, delta));
    } else if (!reset && dt === 0) value = previous.value;
    channels.delete(channel);
    // A new winning semantic ID is immediate; only its internal phrase/action
    // aperture is eased. Never let a superseded expression obscure feedback.
    // Closed/quiet states release continuity rather than animating a stale lid
    // on exit. First frame after a hidden/stale clock takes the current state.
    if (!calmVisual && !reducedMotion && isOpenEye(face?.eyes) && (face?.openness ?? 1) > .15) {
      channels.set(channel, { view, expressionId, time: elapsedMs, value });
      while (channels.size > 32) channels.delete(channels.keys().next().value);
    }
    return value;
  }
  return Object.freeze({ sample, dispose: () => channels.clear() });
}

export { eyeInkRect, OPEN_EYE_GLYPHS, isOpenEye, apertureFor, projectOpenEye, createEyeApertureSampler };
