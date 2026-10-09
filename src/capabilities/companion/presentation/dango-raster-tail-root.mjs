'use strict';

import { toolMatrix } from './dango-raster-actions.mjs';

function addContour(path, contour) {
  const [x, y, width, height] = contour.rect;
  for (const [row, start, end, rows = 1] of contour.runs) {
    path.rect(x + start * width / contour.width, y + row * height / contour.height,
      (end - start) * width / contour.width, rows * height / contour.height);
  }
}

// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: only real pink tail pixels
// overlapping the measured torso stroke replace that internal seam. The
// immutable body cache, exterior silhouette, feet and outfit remain intact.
function createRasterTailRootPainter({ manifest, painter }) {
  const paths = new Map();
  function clip(context, contour) {
    if (typeof Path2D === 'function' && typeof Path2D.prototype.rect === 'function') {
      let path = paths.get(contour);
      if (!path) { path = new Path2D(); addContour(path, contour); paths.set(contour, path); }
      context.clip(path);
    } else {
      context.beginPath(); addContour(context, contour); context.clip();
    }
  }
  function paint(context, artwork, palette) {
    if (!artwork?.layeredReady || !artwork.actionReady) return false;
    const tail = artwork.contact?.tools.find(item => item.key === 'tail');
    const sprite = manifest.tools?.tail, join = sprite?.rootJoin;
    const view = artwork.drawnView || artwork.view;
    if (!tail || !sprite || view === 'front' || tail.surfaceOpacity === 0) return false;
    const opacity = tail.surfaceOpacity ?? 1;
    // The rear-facing tail is on the visible back surface. This hook runs
    // after the cached torso but before front clothing, so a cape can cover it.
    if (tail.surface && view === 'back') {
      const matrix = toolMatrix(tail, sprite);
      const painted = painter.paint(context, { ...sprite, tint: 'body' }, palette, matrix, opacity);
      if (!painted || !join?.fill || !context.createLinearGradient) return painted;
      // The lateral raster's highlight rotates sideways in this projection.
      // Restore a small raised-volume cue only inside its measured pink fill;
      // the generated texture, open root, alpha and thick outline stay exact.
      context.save(); context.transform(...matrix); clip(context, join.fill);
      const light = context.createLinearGradient(0, 0, sprite.rect[2], 0);
      light.addColorStop(0, 'rgba(0,0,0,0)');
      light.addColorStop(.22, 'rgba(0,0,0,0.23)');
      light.addColorStop(.48, 'rgba(0,0,0,0.09)');
      light.addColorStop(.58, 'rgba(255,255,255,0)');
      light.addColorStop(.83, 'rgba(255,255,255,0.42)');
      light.addColorStop(1, 'rgba(255,255,255,0.16)');
      context.globalAlpha *= opacity; context.fillStyle = light;
      context.fillRect(...sprite.rect); context.restore();
      return painted;
    }
    const contour = join?.views[view];
    if (!contour || !join.fill) return false;
    context.save();
    clip(context, contour);
    context.transform(...toolMatrix(tail, sprite));
    clip(context, join.fill);
    const painted = painter.paint(context, { ...sprite, tint: 'body' }, palette, null, opacity);
    context.restore();
    return painted;
  }
  return Object.freeze({ paint, stats: () => Object.freeze({ contours: paths.size, surfaces: 0, bytes: 0 }),
    dispose() { paths.clear(); } });
}

export { createRasterTailRootPainter };
