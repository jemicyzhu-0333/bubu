'use strict';

// Applies the resolver's `cut: 'hands'` fallback without a hard clip edge.
// The garment is painted normally everywhere except small device-space tiles
// around each held paw; inside a tile it is re-painted into a tile-sized
// scratch surface, a feathered paw-shaped ellipse is erased (destination-out
// radial alpha), and the tile is composited back. Tiles are fully opaque-
// equivalent at their border, so the seam is invisible, and the cost scales
// with paw area instead of the whole canvas.
let scratch = null;
function surface(width, height) {
  if (!scratch || scratch.width < width || scratch.height < height) {
    const w = Math.max(width, scratch?.width || 0), h = Math.max(height, scratch?.height || 0);
    if (typeof OffscreenCanvas === 'function') scratch = new OffscreenCanvas(w, h);
    else if (typeof document !== 'undefined' && document.createElement) {
      scratch = document.createElement('canvas'); scratch.width = w; scratch.height = h;
    } else return null;
  }
  return scratch;
}

function tileFor(t, { x, y, rx }) {
  const sx = Math.hypot(t.a, t.b), sy = Math.hypot(t.c, t.d), r = rx * Math.max(sx, sy) + 2;
  const cx = t.a * x + t.c * y + t.e, cy = t.b * x + t.d * y + t.f;
  const left = Math.floor(cx - r), top = Math.floor(cy - r), size = Math.ceil(r * 2);
  return { left, top, width: size, height: size };
}

// paws: [{ x, y, rx, ry, angle? }] in the caller's current (form) space.
function paintWithPawCutout(context, paws, paint) {
  if (!paws?.length || typeof context.getTransform !== 'function') return paint(context);
  const t = context.getTransform();
  const tiles = paws.map(paw => ({ paw, ...tileFor(t, paw) }));
  // 1. Everything outside the tiles, painted directly.
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath();
  context.rect(-1e5, -1e5, 2e5, 2e5);
  for (const tile of tiles) context.rect(tile.left, tile.top + tile.height, tile.width, -tile.height);
  context.clip('evenodd');
  context.setTransform(t);
  const painted = paint(context);
  context.restore();
  if (!painted) return painted;
  // 2. Each tile, via scratch with a feathered erase.
  for (const tile of tiles) {
    const s = surface(tile.width, tile.height), off = s?.getContext?.('2d');
    if (!off) continue;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.globalCompositeOperation = 'source-over';
    off.clearRect(0, 0, tile.width, tile.height);
    off.setTransform(t.a, t.b, t.c, t.d, t.e - tile.left, t.f - tile.top);
    paint(off);
    off.globalCompositeOperation = 'destination-out';
    const { x, y, rx, ry, angle = 0 } = tile.paw;
    off.save();
    off.translate(x, y); off.rotate(angle); off.scale(1, ry / rx);
    const gradient = off.createRadialGradient(0, 0, rx * .55, 0, 0, rx);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    off.fillStyle = gradient;
    off.beginPath(); off.arc(0, 0, rx, 0, Math.PI * 2); off.fill();
    off.restore();
    off.globalCompositeOperation = 'source-over';
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.beginPath(); context.rect(tile.left, tile.top, tile.width, tile.height); context.clip();
    context.drawImage(s, 0, 0, tile.width, tile.height, tile.left, tile.top, tile.width, tile.height);
    context.restore();
  }
  return painted;
}

export { paintWithPawCutout };
