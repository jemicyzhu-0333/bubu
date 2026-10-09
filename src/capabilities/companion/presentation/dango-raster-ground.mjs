'use strict';

// Falling has one fixed floor in world space. Body, face, paws and garments
// share this cut so the pet can sink into the generated opening coherently.
function withRasterGroundClip(context, artwork, paint, scale = 1) {
  if (!Number.isFinite(artwork?.groundClipY)) return paint();
  context.save(); context.beginPath();
  context.rect(-256, -256, 512, 256 + artwork.groundClipY * scale); context.clip();
  try { return paint(); } finally { context.restore(); }
}

function paintRasterHole(context, sprite, detail, palette, painter, front = false) {
  const sx = 74 / sprite.rect[2], sy = 14 / sprite.rect[3];
  const pivot = sprite.pivot || [0, 0], [x, y] = detail.at;
  context.save();
  if (front) {
    context.beginPath(); context.rect(x - 38, y, 76, 9); context.clip();
  }
  const painted = painter.paint(context, sprite, palette,
    [sx, 0, 0, sy, x - pivot[0] * sx, y - pivot[1] * sy]);
  context.restore(); return painted;
}

export { withRasterGroundClip, paintRasterHole };
