'use strict';
import { DANGO_EYE_INK_BOUNDS, DANGO_EYE_RELATIVE_SCALE } from '../../../content/companion/dango-eye-footprints.mjs';

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

function relativeScale(key, index) { return DANGO_EYE_RELATIVE_SCALE[key]?.[index] || [1, 1]; }

function projectOpenEye(data, key, sprite, index, scale = relativeScale(key, index)) {
  const reference = data?.face?.eyes?.neutral?.[index];
  if (!isOpenEye(key) || !reference) return null;
  const [nx, ny, nw, nh] = eyeInkRect(reference);
  const [sx, sy, sw, sh] = eyeInkRect(sprite);
  // The current view's neutral pupil owns position and perspective; the glyph's
  // own authored size relative to the front neutral (generated from the PNGs)
  // is kept, so wide/surprised eyes stay larger or smaller as drawn. Centred on
  // the neutral pupil so size differences never shift the gaze.
  const [rw, rh] = scale;
  const width = nw * rw, height = nh * rh, x = nx + (nw - width) / 2, y = ny + (nh - height) / 2;
  const scaleX = width / sw, scaleY = height / sh;
  return Object.freeze({ matrix: Object.freeze([scaleX, 0, 0, scaleY,
    x - sx * scaleX, y - sy * scaleY]), rect: Object.freeze([x, y, width, height]) });
}

// Presentation-only continuity, advanced by the caller's existing frame clock.
// No timer, expression choice, persisted state, or second animation scheduler.
// Eases the lid aperture and each eye's relative glyph size together, so a
// phrase alternating wide/curious grows or shrinks the pupil smoothly instead
// of snapping, while the authored size difference is still reached.
function createEyeApertureSampler() {
  const channels = new Map();
  function targetFor(face) {
    const key = face?.eyes;
    return [apertureFor(face), ...relativeScale(key, 0), ...relativeScale(key, 1)];
  }
  function shape(value) { return Object.freeze({ aperture: value[0],
    scale: Object.freeze([Object.freeze([value[1], value[2]]), Object.freeze([value[3], value[4]])]) }); }
  function sampleEyes(face, { channel = 'pet', view = 'front', elapsedMs, expressionId,
    calmVisual = false, reducedMotion = false } = {}) {
    const target = targetFor(face);
    if (!Number.isFinite(elapsedMs)) return shape(target); // Stateless portraits cannot disturb the pet.
    const previous = channels.get(channel), dt = previous ? elapsedMs - previous.time : 0;
    const reset = calmVisual || reducedMotion || !isOpenEye(face?.eyes)
      || (face?.openness ?? 1) <= .15 || !previous || previous.view !== view
      || previous.expressionId !== expressionId || dt < 0 || dt > 500;
    let value = target;
    if (!reset && dt > 0) {
      const follow = 1 - Math.exp(-dt / 70), limit = dt * .002;
      value = target.map((goal, i) => {
        const delta = (goal - previous.value[i]) * follow;
        return previous.value[i] + Math.max(-limit, Math.min(limit, delta));
      });
    } else if (!reset && dt === 0) value = previous.value;
    channels.delete(channel);
    // A new winning semantic ID is immediate; only its internal phrase/action
    // aperture and size are eased. Closed/quiet states release continuity.
    if (!calmVisual && !reducedMotion && isOpenEye(face?.eyes) && (face?.openness ?? 1) > .15) {
      channels.set(channel, { view, expressionId, time: elapsedMs, value });
      while (channels.size > 32) channels.delete(channels.keys().next().value);
    }
    return shape(value);
  }
  return Object.freeze({ sampleEyes, sample: (face, options) => sampleEyes(face, options).aperture,
    dispose: () => channels.clear() });
}

export { relativeScale, eyeInkRect, OPEN_EYE_GLYPHS, isOpenEye, apertureFor, projectOpenEye, createEyeApertureSampler };
