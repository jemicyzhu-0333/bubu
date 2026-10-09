'use strict';

import { LOCAL_EFFECTS } from '../../../core/pet-action-particles.mjs';
import { pivotFor } from './dango-raster-pose.mjs';
const RASTER_PARTICLE_TYPES = Object.freeze(['heart', 'sweat', 'flash', 'bubble', 'note', 'star', 'sparkle', 'spark', 'ring', 'petal',
  'leaf', 'rainbow', 'z', 'letter', 'puff', 'crumb', 'thread', 'trail']);
const TYPES = new Set(RASTER_PARTICLE_TYPES);

// Physics, lifetime and emission stay with the existing surface. This port
// changes only the image drawn at that already-sampled particle location.
function createRasterParticlePainter({ manifest, painter }) {
  return function particle(context, value) {
    if (!TYPES.has(value.type)) return false;
    if (LOCAL_EFFECTS[value.actionId] === value.effect && value.effect) return true;
    const sprite = manifest.effects?.[`particle-${value.type}`];
    if (!sprite) return true;
    const life = Math.max(0, Math.min(1, value.life / (value.baseLife || 40)));
    if (!life) return true;
    const pivot = pivotFor(sprite);
    const nominal = Math.max(sprite.rect[2], sprite.rect[3]);
    const size = value.type === 'bubble' && value.actionId === 'hiccup' ? 3 : value.type === 'ring' ? 4 + (1 - life) * 10 : Math.max(3, Math.min(12, (value.size || 3) * 2));
    const scale = size / nominal;
    painter.paint(context, sprite, {}, [scale, 0, 0, scale, value.x - pivot[0] * scale, value.y - pivot[1] * scale], life);
    return true;
  };
}

export { createRasterParticlePainter, RASTER_PARTICLE_TYPES };
