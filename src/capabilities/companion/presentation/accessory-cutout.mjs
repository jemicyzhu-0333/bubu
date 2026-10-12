'use strict';

// Applies the resolver's `cut: 'hands'` fallback. The garment is painted into
// a scratch surface with the live transform, then each paw region is erased
// with a feathered (radial alpha) ellipse shaped like a paw, and the result is
// composited back. No hard clip edge, so no visible arc of cloth or cream.
let scratch = null;
function surfaceFor(context) {
  const { width, height } = context.canvas || {};
  if (!width || !height) return null;
  if (!scratch || scratch.width !== width || scratch.height !== height) {
    if (typeof OffscreenCanvas === 'function') scratch = new OffscreenCanvas(width, height);
    else if (typeof document !== 'undefined' && document.createElement) {
      scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
    } else return null;
  }
  return scratch;
}

// paws: [{ x, y, rx, ry, angle? }] in the caller's current (form) space.
function paintWithPawCutout(context, paws, paint) {
  if (!paws?.length || typeof context.getTransform !== 'function') return paint(context);
  const surface = surfaceFor(context), off = surface?.getContext?.('2d');
  if (!off) return paint(context);
  const transform = context.getTransform();
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.clearRect(0, 0, surface.width, surface.height);
  off.setTransform(transform);
  off.globalAlpha = 1;
  const painted = paint(off);
  if (painted) {
    off.globalCompositeOperation = 'destination-out';
    for (const { x, y, rx, ry, angle = 0 } of paws) {
      off.save();
      off.translate(x, y); off.rotate(angle); off.scale(1, ry / rx);
      const gradient = off.createRadialGradient(0, 0, rx * .55, 0, 0, rx);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      off.fillStyle = gradient;
      off.beginPath(); off.arc(0, 0, rx, 0, Math.PI * 2); off.fill();
      off.restore();
    }
    off.globalCompositeOperation = 'source-over';
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(surface, 0, 0);
    context.restore();
  }
  return painted;
}

export { paintWithPawCutout };
