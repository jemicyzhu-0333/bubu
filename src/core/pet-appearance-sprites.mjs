'use strict';

import { DANGO_APPEARANCE } from '../content/companion/dango-appearance.mjs';

// PET_VISUAL「配饰分层」: the four silhouettes are authored in SVG and compiled
// into two-art-unit scanlines. Runtime only selects a view, material and layer.
const APPEARANCE_COLORS = Object.freeze(Object.fromEntries(Object.entries(DANGO_APPEARANCE)
  .map(([key, { colors }]) => [key, Object.freeze({ accent: colors.accent,
    accentDark: colors.accentDark, highlight: colors.highlight })])));

function drawSprite(context, key, colors, { view = 'front', part = 'front', footwearTransforms } = {}) {
  const layers = DANGO_APPEARANCE[key]?.views[view];
  const components = layers?.[part] || [];
  for (const component of components) {
    context.save();
    const matrix = component.attachment && footwearTransforms?.[component.attachment];
    if (Array.isArray(matrix) && matrix.length === 6 && matrix.every(Number.isFinite)) context.transform(...matrix);
    for (const [x, y, width, color] of component.runs) {
      context.fillStyle = colors[color] || color;
      context.fillRect(x, y, width, 2);
    }
    context.restore();
  }
  return components.length > 0;
}

const APPEARANCE_SPRITES = Object.freeze(Object.fromEntries(Object.keys(DANGO_APPEARANCE)
  .map(key => [key, (context, colors, options) => drawSprite(context, key, colors, options)])));

function appearanceEffectAnchors(key, view = 'front') {
  return DANGO_APPEARANCE[key]?.views[view]?.effects || [];
}

export { APPEARANCE_COLORS, APPEARANCE_SPRITES, appearanceEffectAnchors };
export default Object.freeze({ APPEARANCE_COLORS, APPEARANCE_SPRITES, appearanceEffectAnchors });
