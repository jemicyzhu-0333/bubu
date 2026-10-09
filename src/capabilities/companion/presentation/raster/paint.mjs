'use strict';

import { recolorRasterPixels } from './palette.mjs';

function browserSurface(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined' && document.createElement) {
    const surface = document.createElement('canvas'); surface.width = width; surface.height = height; return surface;
  }
  return null;
}

function createRasterPainter({ source, createSurface = browserSurface, maxEntries = 96,
  maxBytes = 48 * 1024 * 1024, imageSmoothing = false } = {}) {
  const tinted = new Map();
  let bytes = 0;
  function imageFor(sprite, palette) {
    const image = source.get(sprite); if (!image) return null;
    if (!sprite.tint || sprite.tint === 'none' || palette?.[2] === '#f7768e' && palette?.[4] === '#1a1b26') return image;
    const key = `${sprite.src}|${sprite.tint}|${palette?.[1]}|${palette?.[2]}|${palette?.[3]}|${palette?.[4]}`;
    const found = tinted.get(key);
    if (found) { tinted.delete(key); tinted.set(key, found); return found.surface; }
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height, cost = width * height * 4;
    if (cost > maxBytes) return image;
    const surface = createSurface(width, height), context = surface?.getContext('2d');
    if (!context?.getImageData || !context?.putImageData) return image;
    context.drawImage(image, 0, 0);
    try {
      const pixels = context.getImageData(0, 0, width, height);
      recolorRasterPixels(pixels.data, palette, sprite.tint); context.putImageData(pixels, 0, 0);
    } catch { return image; }
    tinted.set(key, { surface, cost }); bytes += cost;
    while (tinted.size > maxEntries || bytes > maxBytes) {
      const oldest = tinted.keys().next().value, entry = tinted.get(oldest);
      tinted.delete(oldest); bytes -= entry.cost; entry.surface.close?.();
    }
    return surface;
  }
  function paint(context, sprite, palette, matrix = null, opacity = 1) {
    if (!sprite || !context || !(opacity > 0)) return false;
    const image = imageFor(sprite, palette); if (!image) return false;
    context.save();
    if (matrix) context.transform(...matrix);
    context.globalAlpha *= Math.min(1, opacity);
    context.imageSmoothingEnabled = Boolean(imageSmoothing);
    context.drawImage(image, ...sprite.rect);
    context.restore(); return true;
  }
  return Object.freeze({ paint, stats: () => Object.freeze({ entries: tinted.size, bytes }),
    dispose() { for (const { surface } of tinted.values()) surface.close?.(); tinted.clear(); bytes = 0; } });
}

export { browserSurface, createRasterPainter };
