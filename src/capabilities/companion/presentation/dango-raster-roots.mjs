'use strict';

// These rectangles are the exact occupied runs of the saved raster contour
// mask, not a redrawn character silhouette. Clip static source limb pixels
// directly: copying a modified scratch canvas into Skia each frame retained
// native snapshots even after its JS wrapper and declared cache were released.
function addContour(target, contour) {
  const [x, y, width, height] = contour.rect;
  const unitX = width / contour.width, unitY = height / contour.height;
  for (const [row, start, end, rows = 1] of contour.runs) {
    target.rect(x + start * unitX, y + row * unitY, (end - start) * unitX, rows * unitY);
  }
}

function createRasterRootPainter({ painter } = {}) {
  const paths = new Map();
  function paint(context, artwork, palette) {
    const joins = artwork?.data.rootJoins;
    if (!artwork?.layeredReady || !joins?.contour) return false;
    const visible = [];
    for (const side of ['foot-left', 'foot-right']) {
      if (!artwork.hiddenParts.includes(side)) visible.push({ name: side, opacity: 1 });
    }
    if (artwork.actionReady) for (const hand of artwork.contact?.hands || []) {
      if (hand.integrated) visible.push({ name: `hand-${hand.side}`, opacity: hand.opacity ?? 1 });
    }
    if (!visible.length) return false;
    context.save();
    if (typeof Path2D === 'function' && typeof Path2D.prototype.rect === 'function') {
      let path = paths.get(joins);
      if (!path) { path = new Path2D(); addContour(path, joins.contour); paths.set(joins, path); }
      context.clip(path);
    } else {
      // Narrow recording-context fallback for behavior tests and older hosts.
      context.beginPath(); addContour(context, joins.contour); context.clip();
    }
    for (const { name, opacity } of visible) painter.paint(context, joins.fills[name], palette, artwork.matrices[name], opacity);
    context.restore(); return true;
  }
  return Object.freeze({ paint,
    stats: () => Object.freeze({ contours: paths.size, surfaces: 0, bytes: 0 }),
    dispose() { paths.clear(); }
  });
}

export { createRasterRootPainter };
