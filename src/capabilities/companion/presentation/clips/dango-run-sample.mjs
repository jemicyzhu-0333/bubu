'use strict';

import { validateClipManifest } from './clip-manifest.mjs';
import { sampleClip } from './clip-sampler.mjs';
import { browserSurface } from '../raster/paint.mjs';
import { recolorRasterPixels } from '../raster/palette.mjs';

// Companion presentation only; one opt-in sample, no state or clock owner.
// Assets live in the existing raster source lifecycle. Missing outfit rows fail closed.
function createDangoRunSample({ bundle, source, createSurface = browserSurface }) {
  const checked = validateClipManifest(bundle.manifest, {
    expectedIdentityRefSha256: bundle.identityRefSha256, expectedAssetHashes: bundle.expectedAssetHashes
  });
  if (!checked.ok) throw new TypeError(checked.errors.join('; '));
  const manifest = checked.manifest;
  const group = manifest.resourceGroups[0];
  const sprites = Object.fromEntries(group.assets.map(asset => [asset.id, {
    src: new URL(asset.src, bundle.baseUrl).href, rect: bundle.spriteRect
  }]));
  const tinted = new Map();
  const fallback = reason => Object.freeze({ clip: null, status: reason });
  function resolve(options, view, layeredReady) {
    if (options.action?.id !== manifest.actionId || options.motion !== 'dash'
      || options.calmVisual || options.reducedMotion || options.state === 'dragged'
      || view !== manifest.view || ![undefined, 'three-quarter', 'profile'].includes(options.view) || ![undefined, 'none', 'laser'].includes(options.action?.prop)) return fallback('incompatible-action-view-or-motion-policy');
    const wardrobeIds = (options.appearance?.items || []).map(item => item.id);
    if (wardrobeIds.length) return fallback('unsupported-outfit');
    const states = group.assets.map(asset => source.state(sprites[asset.id]));
    if (states.includes('failed')) return fallback('resource-failed');
    if (!states.every(state => state === 'ready')) return fallback('resource-loading');
    if (!layeredReady) return fallback('base-art-not-ready');
    if (group.assets.some(asset => {
      const image = source.get(sprites[asset.id]);
      return (image?.naturalWidth || image?.width) !== 256 || (image?.naturalHeight || image?.height) !== 256;
    })) return fallback('invalid-resource-dimensions');
    const sampled = sampleClip(manifest, {
      actionId: options.action.id, view, wardrobeIds,
      // Existing activity progress is the sole clock: chase-laser is ten strides.
      elapsedMs: options.progress * (options.action.duration || 9500),
      readyBundle: { characterId: manifest.characterId, clipId: manifest.clipId,
        contentVersion: manifest.contentVersion, resourceGroup: group.id,
        assetIds: group.assets.map(asset => asset.id) }
    });
    return sampled.ok ? Object.freeze({ status: 'ready', clip: Object.freeze({ ...sampled,
      faceTransform: bundle.faceTransforms[sampled.poseId] }) }) : fallback(sampled.reason);
  }
  function paint(context, clip, palette) {
    const sprite = sprites[clip.frame], maskSprite = sprites[clip.bodyRecolorMask];
    const image = source.get(sprite), mask = source.get(maskSprite);
    if (!image || !mask) return false;
    let output = image;
    if (palette?.[2] !== '#f7768e' || palette?.[4] !== '#1a1b26') {
      const key = `${clip.frame}|${[1, 2, 3, 4].map(index => palette?.[index]).join('|')}`;
      output = tinted.get(key);
      if (output) { tinted.delete(key); tinted.set(key, output); }
      else {
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        output = createSurface(width, height);
        const ctx = output?.getContext('2d');
        if (!ctx?.getImageData || !ctx?.putImageData) return false;
        ctx.drawImage(mask, 0, 0);
        const material = ctx.getImageData(0, 0, width, height).data;
        ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height), original = pixels.data.slice();
        recolorRasterPixels(pixels.data, palette, 'body');
        for (let i = 0; i < original.length; i += 4) {
          const weight = material[i + 3] / 255;
          for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(original[i + c] * (1 - weight) + pixels.data[i + c] * weight);
        }
        ctx.putImageData(pixels, 0, 0); tinted.set(key, output);
        // 24 poses x four recently used palettes; this is a byte-bound cache,
        // not a claim about native process memory or GPU allocation.
        while (tinted.size > 96) tinted.delete(tinted.keys().next().value);
      }
    }
    context.save(); context.imageSmoothingEnabled = false;
    context.drawImage(output, ...sprite.rect); context.restore(); return true;
  }
  return Object.freeze({ resolve, paint, manifest,
    ready: () => source.ready(Object.values(sprites)),
    stats: () => ({ entries: tinted.size, bytes: tinted.size * 256 * 256 * 4 }),
    dispose: () => tinted.clear() });
}

export { createDangoRunSample };
