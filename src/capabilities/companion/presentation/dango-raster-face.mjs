'use strict';

import { EYE_FALLBACKS, MOUTH_FALLBACKS, requestedEyes } from './rig/face.mjs';
import { localMatrix, multiply } from './rig/pose.mjs';
import { pivotFor } from './dango-raster-pose.mjs';
const clamp = (n, low, high) => Math.max(low, Math.min(high, Number(n) || 0));

// Every authored open-eye glyph keeps the canonical pair’s vertical proportion. Width
// perspective must not also shrink the far eye's height. Keep the near glyph,
// widths and pivots; match only the canonical pair's vertical proportion.
function eyeHeightScales(artwork, eyes) {
  if (!['three-quarter', 'three-quarter-left', 'three-quarter-right'].includes(artwork.view)
    || !['curious', 'focused', 'half', 'wide', 'droopy', 'sparkle', 'surprised',
      'determined', 'pleading', 'shy', 'waiting'].includes(eyes?.key)) return [1, 1];
  const neutral = artwork.data.face?.eyes?.neutral;
  if (eyes.sprites.length !== 2 || neutral?.length !== 2) return [1, 1];
  const far = neutral[0].rect[2] < neutral[1].rect[2] ? 0 : 1, near = 1 - far;
  const scales = [1, 1];
  scales[far] = eyes.sprites[near].rect[3] / eyes.sprites[far].rect[3]
    * neutral[far].rect[3] / neutral[near].rect[3];
  return scales;
}

function pick(states, requested, table, source) {
  const chain = [...(table[requested] || [requested]), 'neutral'];
  for (const key of new Set(chain)) {
    const value = states?.[key]; if (!value) continue;
    const sprites = Array.isArray(value) ? value : [value];
    if (sprites.every(sprite => source.get(sprite))) return { key, sprites };
  }
  return null;
}

function drawRasterFace(context, artwork, expression, blinking, palette, { painter, source }) {
  if (artwork.view === 'back') return 'back';
  if (!artwork.layeredReady) return requestedEyes(expression, blinking);
  const face = artwork.face || expression || {}, data = artwork.data.face;
  const wanted = requestedEyes(face, artwork.calmVisual ? false : blinking);
  const eyes = pick(data.eyes, wanted, EYE_FALLBACKS, source);
  const mouth = pick(data.mouth, face.mouth || 'neutral', MOUTH_FALLBACKS, source);
  const closed = ['closed', 'sleepy', 'smile', 'content'].includes(eyes?.key);
  const x = artwork.calmVisual ? 0 : clamp(face.eyeOffsetX, -2, 2);
  const y = artwork.calmVisual ? 0 : clamp(face.eyeOffsetY, -2, 2);
  const inset = clamp(face.eyeInsetX, -1, 1.5);
  const heights = eyeHeightScales(artwork, eyes);
  for (const [i, sprite] of (eyes?.sprites || []).entries()) {
    const openness = closed ? 1 : Math.max(.25, Math.min(1.15, face.openness ?? 1));
    let matrix = localMatrix(pivotFor(sprite), {
      x: x + inset * (i ? -1 : 1), y, sy: openness
    });
    // Apply geometry normalization after the existing eyelid clamp. Clamping
    // the product independently made a narrow-eyed far pupil shrink again.
    if (heights[i] !== 1) {
      const [, py] = pivotFor(sprite);
      matrix = multiply(matrix, [1, 0, 0, heights[i], 0, py * (1 - heights[i])]);
    }
    if (artwork.lookback) matrix = multiply(artwork.lookback.matrices[i], matrix);
    painter.paint(context, sprite, palette, matrix);
  }
  if (mouth) painter.paint(context, mouth.sprites[0], palette, artwork.lookback?.matrices[2]);
  return wanted;
}

export { drawRasterFace };
