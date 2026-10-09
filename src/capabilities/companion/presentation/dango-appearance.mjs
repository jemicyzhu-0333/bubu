'use strict';

import { VECTOR_APPEARANCE, APPEARANCE_MATERIALS, APPEARANCE_BOUNDS } from '../../../content/companion/dango-vector-appearance.mjs';
import { paintVectorShapes, createVectorPathCache } from '../../../core/pet-vector-paint.mjs';

// Native wardrobe shares the body's art space and paired foot transforms.
// The SVG owns every contour, seam and weave stroke; this layer only composes.
// The native antenna ends at -14.75. A 14.5-unit lift leaves a 2.3-unit
// gap under this thinner ring and preserves clearance at the reach apex.
const HEAD_LIFT = 14.5;
const paths = createVectorPathCache();
const GLINT = Object.freeze([{ d: 'M-1 0L1 0M0-1L0 1', fill: 'none',
  stroke: '#fff4d7', width: .8, cap: 'round', join: 'round' }]);
const validMatrix = value => Array.isArray(value) && value.length === 6 && value.every(Number.isFinite);

function resolveDangoPortraitBounds(appearance, baseBounds = { x: -2, y: -2, width: 70, height: 70 }) {
  const view = appearance?.view || 'front', items = appearance?.items || [];
  const selected = items.filter(item => APPEARANCE_BOUNDS[item.renderKey]);
  if (!selected.length) return baseBounds;
  const wearsHat = selected.some(item => item.exclusiveGroup === 'headwear');
  let left = baseBounds.x, top = baseBounds.y;
  let right = left + baseBounds.width, bottom = top + baseBounds.height;
  for (const item of selected) {
    const bounds = APPEARANCE_BOUNDS[item.renderKey][view] || APPEARANCE_BOUNDS[item.renderKey].front;
    const anchor = item.anchor?.[view] || { x: 0, y: 0 };
    const x = bounds.x + (anchor.x || 0);
    const y = bounds.y + (anchor.y || 0) - (wearsHat && item.exclusiveGroup === 'head-aura' ? HEAD_LIFT : 0);
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + bounds.width); bottom = Math.max(bottom, y + bounds.height);
  }
  return Object.freeze({ x: left - 1, y: top - 1, width: right - left + 2, height: bottom - top + 2 });
}

function drawAccents(context, points, item, { elapsedMs = 0, calmVisual, artwork }) {
  const time = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const pulse = calmVisual ? 0 : Math.sin(time / 1700 * Math.PI * 2);
  context.save(); context.globalAlpha *= calmVisual ? .38 : .38 + pulse * .12;
  for (const [index, [x, y]] of points.entries()) {
    const matrix = item.renderKey === 'boots' && artwork?.footwearTransforms?.[index ? 'foot-right' : 'foot-left'];
    context.save(); if (validMatrix(matrix)) context.transform(...matrix);
    const size = .55 + (calmVisual ? 0 : .08 * pulse);
    context.transform(size, 0, 0, size, x, y);
    paintVectorShapes(context, GLINT, {}, { paths }); context.restore();
  }
  context.restore();
}

function drawDangoAppearance(context, { item, layer = 'front', palette, view = 'front', appearance,
  artwork, elapsedMs = 0, calmVisual = false } = {}) {
  if (!context || !item || (item.formId || 'dango') !== 'dango') return false;
  const selected = VECTOR_APPEARANCE[item.renderKey]?.views[view] || VECTOR_APPEARANCE[item.renderKey]?.views.front;
  const parts = selected?.[layer] || [];
  if (!parts.length) return false;
  const anchor = item.anchor?.[view] || { x: 0, y: 0 };
  const wearsHat = appearance?.items?.some(candidate => candidate.exclusiveGroup === 'headwear');
  const lift = wearsHat && item.exclusiveGroup === 'head-aura' ? HEAD_LIFT : 0;
  context.save(); context.translate(anchor.x || 0, (anchor.y || 0) - lift);
  for (const part of parts) {
    context.save();
    const matrix = part.attachment && artwork?.footwearTransforms?.[part.attachment];
    if (validMatrix(matrix)) context.transform(...matrix);
    paintVectorShapes(context, part.shapes, palette, { materials: APPEARANCE_MATERIALS, paths });
    context.restore();
  }
  if (item.effect && layer === item.layer) drawAccents(context, selected.effects, item, { elapsedMs, calmVisual, artwork });
  context.restore(); return true;
}
export { drawDangoAppearance, resolveDangoPortraitBounds, HEAD_LIFT };
export default drawDangoAppearance;
