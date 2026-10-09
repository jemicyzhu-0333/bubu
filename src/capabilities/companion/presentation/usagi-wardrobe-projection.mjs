'use strict';

import { IDENTITY } from './rig/pose.mjs';

// Reconstruction from the retained final projection tables. The original source
// hash remains in RECOVERY.md; this file is a candidate, not a byte-exact restore.
const FOOTWEAR = Object.freeze({
  'usagi-garden-clogs': { front: [11, 7.5], 'three-quarter': [11.6, 7.6], profile: [13, 7.4], back: [10.3, 7.5] },
  'usagi-rain-boots': { front: [10.8, 10], 'three-quarter': [12, 10], profile: [14, 9.8], back: [10.4, 10] },
  'usagi-moon-boots': { front: [10.8, 10.8], 'three-quarter': [12, 10.8], profile: [13.6, 10.6], back: [10.4, 10.8] }
});
const APERTURES = Object.freeze({
  'usagi-garden-clogs': { front: [.52, .135, .25, .059], 'three-quarter': [.39, .14, .23, .060],
    profile: [.33, .14, .22, .070], back: [.52, .20, .24, .094] },
  'usagi-rain-boots': { front: [.50, .115, .32, .050], 'three-quarter': [.38, .105, .25, .046],
    profile: [.30, .12, .23, .062], back: [.50, .115, .31, .052] },
  'usagi-moon-boots': { front: [.50, .085, .31, .036], 'three-quarter': [.37, .070, .26, .031],
    profile: [.31, .08, .24, .040], back: [.50, .08, .30, .035] }
});
const ANKLES = Object.freeze({ front: [21, 45], 'three-quarter': [27, 45], profile: [31, 45], back: [21, 45] });
const BERET_CONTACTS = Object.freeze({
  'usagi-garden-beret': { 'three-quarter': [[23, 5.4], [43.3, 2.4]], profile: [[28, 5.3], [45.7, .5]] },
  'usagi-moon-beret': { 'three-quarter': [[26, .5], [46.9, 5.2]], profile: [[31.3, .4], [49.1, 4.3]] }
});
const HEAD_CONTACTS = Object.freeze({
  'three-quarter': [[25.5, 1.2], [46.2, 2.4]], profile: [[29, 1.1], [47.2, 2.6]]
});

function projectFootwear(sprite, renderKey, view, artwork = {}) {
  const dimensions = FOOTWEAR[renderKey]?.[view];
  const aperture = APERTURES[renderKey]?.[view];
  if (!dimensions || !aperture || !['leg_l', 'leg_r'].includes(sprite.bone)) return sprite;
  const right = sprite.bone === 'leg_r';
  const far = !right && ['three-quarter', 'profile'].includes(view);
  const depth = far ? (view === 'profile' ? .85 : .89) : 1;
  const [width, height] = dimensions.map(value => value * depth);
  const anchorKey = right ? 'usagi.footwear-r' : 'usagi.footwear';
  const anchors = artwork.anchors || artwork.rig?.views?.[view]?.anchors;
  const ankle = anchors?.[anchorKey]?.x ?? ANKLES[view][right ? 1 : 0];
  const sole = 68.1 - (far ? 1.15 : 0);
  const [cx, cy, rx, ry] = aperture;
  const rect = Object.freeze([ankle - width * cx, sole - height, width, height]);
  return Object.freeze({ ...sprite, layer: 'back', rect,
    wear: Object.freeze({ kind: 'ankle-shell', far, ankle, sole,
      aperture: Object.freeze([ankle, rect[1] + height * cy, width * rx, height * ry]) }) });
}

function contactTransform(source, target) {
  const [[sx, sy], [ex, ey]] = source, [[tx, ty], [ux, uy]] = target;
  const dx = ex - sx, dy = ey - sy, length2 = dx * dx + dy * dy;
  if (!(length2 > 0)) return IDENTITY;
  const a = ((ux - tx) * dx + (uy - ty) * dy) / length2;
  const b = ((uy - ty) * dx - (ux - tx) * dy) / length2;
  return [a, b, -b, a, tx - a * sx + b * sy, ty - b * sx - a * sy];
}

function headwearTransform(renderKey, view) {
  const source = BERET_CONTACTS[renderKey]?.[view], target = HEAD_CONTACTS[view];
  return source && target ? contactTransform(source, target) : IDENTITY;
}

function clipNearShell(context, sprite) {
  const [left, top, width, height] = sprite.rect;
  const [x, y, rx, ry] = sprite.wear.aperture;
  const right = left + width, bottom = top + height;
  // The lower ellipse arc gives an open U. XOR against a full ellipse would
  // wrongly restore the ellipse's upper half above the clipping rectangle.
  context.beginPath();
  context.moveTo(left - 1, y);
  context.lineTo(x - rx, y);
  context.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);
  context.lineTo(right + 1, y);
  context.lineTo(right + 1, bottom + 1);
  context.lineTo(left - 1, bottom + 1);
  context.closePath();
  context.clip();
}

function paintFootwear(context, { sprite, layer, matrix = IDENTITY, painter }) {
  if (sprite.wear?.kind !== 'ankle-shell' || !['back', 'front'].includes(layer)) return false;
  if (layer === 'front' && sprite.wear.far) return false;
  context.save();
  try {
    context.transform(...matrix);
    if (layer === 'front') clipNearShell(context, sprite);
    const painted = painter.paint(context, sprite, {});
    if (painted && layer === 'back') {
      const [x, y, rx, ry] = sprite.wear.aperture;
      context.beginPath();
      context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      context.fillStyle = '#fff5de';
      context.fill();
    }
    return painted;
  } finally { context.restore(); }
}

export { FOOTWEAR, APERTURES, ANKLES, BERET_CONTACTS, HEAD_CONTACTS,
  projectFootwear, contactTransform, headwearTransform, clipNearShell, paintFootwear };
