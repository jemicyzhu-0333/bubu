'use strict';
import { PET_VISUAL_CENTER_OFFSET } from '../../core/pet-stage.mjs';

// Project an authored tool point through the exact same final body transform,
// then from the pet raster canvas into the existing overlay's CSS coordinates.
function projectEffectOrigins(origins, matrix, { stage, offX, offY, formScale = 1 } = {}) {
  if (!origins || !matrix || !stage) return Object.freeze({});
  const values = Array.isArray(matrix) ? matrix : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  if (values.length !== 6 || values.some(value => !Number.isFinite(value))) return Object.freeze({});
  const [a,b,c,d,e,f] = values, result = {};
  const pixelToCss = stage.cssWidth / stage.rasterWidth;
  const frameOffsetX = (stage.frameCssSize - stage.cssWidth) / 2 + PET_VISUAL_CENTER_OFFSET.x;
  const frameOffsetY = (stage.frameCssSize - stage.cssHeight) / 2 + PET_VISUAL_CENTER_OFFSET.y;
  for (const [key, point] of Object.entries(origins)) {
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))) continue;
    const x = offX + point[0] * formScale, y = offY + point[1] * formScale;
    result[key] = Object.freeze({ x: (a*x+c*y+e)*pixelToCss+frameOffsetX,
      y: (b*x+d*y+f)*pixelToCss+frameOffsetY, direction: a < 0 ? -1 : 1 });
  }
  return Object.freeze(result);
}
export { projectEffectOrigins };
