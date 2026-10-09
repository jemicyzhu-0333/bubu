'use strict';

import { contactWeight } from './usagi-contact.mjs';

const FLOOR = 67;
function sampleUsagiFall(progress, calmVisual = false) {
  return 39 * contactWeight(calmVisual ? .52 : progress, .12, .43, .6, .92);
}

function withUsagiGround(artwork, action, progress, calmVisual) {
  if (action?.prop !== 'hole') return artwork;
  return Object.freeze({ ...artwork, groundClipY: FLOOR - (calmVisual ? 0 : sampleUsagiFall(progress)),
    pose: Object.freeze({ ...artwork.pose, sample: Object.freeze({ ...artwork.pose.sample,
      props: Object.freeze(artwork.pose.sample.props.filter(id => id !== 'hole')) }) }) });
}

function withUsagiGroundClip(context, artwork, paint, scale = 1) {
  if (!Number.isFinite(artwork?.groundClipY)) return paint();
  context.save(); context.beginPath();
  context.rect(-256, -256, 512, 256 + artwork.groundClipY * scale); context.clip();
  try { return paint(); } finally { context.restore(); }
}

function paintUsagiHole(context, artwork, layer) {
  if (!Number.isFinite(artwork?.groundClipY)) return false;
  const y = artwork.groundClipY;
  context.save();
  if (layer === 'front') {
    context.beginPath(); context.rect(-5, y, 76, 10); context.clip();
  }
  context.beginPath(); context.ellipse(33, y, 36, 7, 0, 0, Math.PI * 2);
  context.fillStyle = '#b59b83'; context.fill();
  context.strokeStyle = '#725441'; context.lineWidth = 1.2; context.stroke();
  context.beginPath(); context.ellipse(33, y - .7, 30, 4.3, 0, 0, Math.PI * 2);
  context.fillStyle = '#695044'; context.fill(); context.restore();
  return true;
}

export { FLOOR, sampleUsagiFall, withUsagiGround, withUsagiGroundClip, paintUsagiHole };
