'use strict';

import { createRasterSource } from './raster/source.mjs';
import { createRasterPainter } from './raster/paint.mjs';
import { validateRasterSprite } from './raster/schema.mjs';
import { multiply } from './rig/pose.mjs';
import { projectFootwear, headwearTransform, paintFootwear } from './usagi-wardrobe-projection.mjs';

const VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);
const BONES = new Set(['root', 'ear_l', 'ear_r', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'hand_l', 'hand_r']);
const layersFor = (entry, view) => entry?.views?.[view] || null;
const spritesFor = selected => [...(selected?.back || []), ...(selected?.front || [])];

function validateUsagiWardrobe(manifest) {
  if (!manifest || typeof manifest.id !== 'string' || !Number.isInteger(manifest.version)
    || manifest.version < 1 || typeof manifest.baseUrl !== 'string') throw new TypeError('invalid Usagi wardrobe manifest');
  if (!['file:', 'http:', 'https:'].includes(new URL(manifest.baseUrl).protocol)) throw new TypeError('invalid Usagi wardrobe base');
  const sprites = [];
  for (const [key, entry] of Object.entries(manifest.appearance || {})) {
    if (!key.startsWith('usagi-') || !entry.itemId?.startsWith('usagi.')
      || !entry.slot?.startsWith('usagi.') || !Array.isArray(entry.allowedViews)) throw new TypeError(`invalid Usagi garment: ${key}`);
    if (entry.renderMode !== undefined && !['raster', 'vector'].includes(entry.renderMode)) throw new TypeError(`invalid garment renderer: ${key}`);
    if (entry.wrapsBody !== undefined && typeof entry.wrapsBody !== 'boolean') throw new TypeError(`invalid garment depth: ${key}`);
    for (const view of entry.allowedViews) {
      const selected = layersFor(entry, view);
      if (!VIEWS.includes(view) || !selected || !Array.isArray(selected.back) || !Array.isArray(selected.front)) {
        throw new TypeError(`invalid Usagi garment view: ${key}/${view}`);
      }
      const assets = spritesFor(selected);
      if (!assets.length && !entry.hiddenViews?.includes(view)) throw new TypeError(`empty Usagi garment view: ${key}/${view}`);
      for (const sprite of assets) {
        validateRasterSprite(sprite, `${key}/${view}`);
        if (!BONES.has(sprite.bone)) throw new TypeError(`invalid Usagi garment bone: ${sprite.bone}`);
        if (entry.renderMode !== 'vector') sprites.push(sprite);
      }
      if (entry.slot === 'usagi.footwear' && ['leg_l', 'leg_r'].some(bone => !assets.some(sprite => sprite.bone === bone))) {
        throw new TypeError(`Usagi footwear needs both legs: ${key}/${view}`);
      }
    }
  }
  if (sprites.length > 256) throw new TypeError('Usagi wardrobe sprite budget exceeded');
  return Object.freeze(sprites);
}

// Generated garments use the authored rig's art space and moving bones. The
// canonical vector body and expressive face remain the character's identity.
function createUsagiRasterWardrobe({ manifest, loadImage, createSurface } = {}) {
  const sprites = validateUsagiWardrobe(manifest);
  const source = createRasterSource({ baseUrl: manifest.baseUrl, versionKey: `${manifest.id}@${manifest.version}`,
    loadImage, maxEntries: 256, maxBytes: 48 * 1024 * 1024 });
  const painter = createRasterPainter({ source, createSurface, imageSmoothing: true });

  function resolve(artwork, outfit, requestedView) {
    const view = artwork.drawnView || requestedView || artwork.view || 'front';
    const states = [], missing = [], rasterKeys = [], replacingBones = new Set();
    let wrapsBody = false;
    for (const item of outfit?.items || []) {
      const entry = manifest.appearance?.[item.renderKey];
      if (!entry || entry.renderMode === 'vector') continue;
      rasterKeys.push(item.renderKey);
      wrapsBody ||= entry.wrapsBody === true;
      const selected = layersFor(entry, view);
      if (!selected) { missing.push(`appearance:${item.renderKey}@${view}`); continue; }
      const selectedSprites = spritesFor(selected);
      states.push(...selectedSprites.map(sprite => source.state(sprite)));
      if (entry.slot === 'usagi.footwear') for (const bone of ['leg_l', 'leg_r']) replacingBones.add(bone);
    }
    const ready = !missing.length && states.every(state => state === 'ready');
    wrapsBody &&= ready;
    const deferPortraitForeground = ready && (outfit?.items || []).some(item => {
      const entry = manifest.appearance?.[item.renderKey];
      return entry && entry.renderMode !== 'vector'
        ? Boolean(layersFor(entry, view)?.front.length) : item.parts?.includes('front');
    });
    const hiddenRigBones = ready ? [...replacingBones] : [];
    return Object.freeze({ ...artwork,
      key: `${artwork.key}|wardrobe:${manifest.version}|hide:${hiddenRigBones.join(',')}|wrap:${Number(wrapsBody)}|portrait-front:${Number(deferPortraitForeground)}`,
      ready, pending: states.includes('loading'), missingAssets: Object.freeze(missing),
      deferPortraitForeground,
      hiddenRigBones: Object.freeze(hiddenRigBones),
      wardrobe: Object.freeze({ ready, wrapsBody, pending: states.includes('loading'), missing: Object.freeze(missing),
        failed: states.includes('failed'), rasterKeys: Object.freeze(rasterKeys) }) });
  }

  function owns(item) {
    const entry = manifest.appearance?.[item?.renderKey];
    return Boolean(entry && entry.renderMode !== 'vector');
  }
  function appearance(context, { item, layer = 'front', view = 'front', artwork } = {}) {
    if (!owns(item) || !artwork?.wardrobe?.ready || !artwork.wardrobe.rasterKeys.includes(item.renderKey)) return false;
    const drawnView = artwork.drawnView || view;
    const entry = manifest.appearance[item.renderKey];
    const selected = layersFor(entry, drawnView);
    if (!selected) return false;
    let painted = false;
    const candidates = entry.slot === 'usagi.footwear' ? spritesFor(selected) : selected[layer] || [];
    for (const original of candidates) {
      const sprite = projectFootwear(original, item.renderKey, drawnView, artwork);
      const matrix = artwork.pose?.world?.[sprite.bone];
      if (sprite.wear) painted = paintFootwear(context, { sprite, layer, matrix, painter }) || painted;
      else {
        const seat = headwearTransform(item.renderKey, drawnView);
        painted = painter.paint(context, sprite, {}, matrix ? multiply(matrix, seat) : seat) || painted;
      }
    }
    return painted;
  }
  function appearanceLayers(item, view) {
    const entry = manifest.appearance?.[item.renderKey];
    const selected = entry?.renderMode === 'vector' ? null : layersFor(entry, view);
    if (selected && entry.slot === 'usagi.footwear') return ['back', 'front'];
    return selected ? ['back', 'front'].filter(layer => selected[layer]?.length) : item.parts;
  }
  function portraitBounds(outfit, base) {
    let left = base.x, top = base.y, right = left + base.width, bottom = top + base.height;
    for (const item of outfit?.items || []) {
      const entry = manifest.appearance?.[item.renderKey];
      const selected = entry?.renderMode === 'vector' ? null : layersFor(entry, outfit.view || 'front');
      for (const sprite of spritesFor(selected)) {
        const [x, y, width, height] = sprite.rect;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + width); bottom = Math.max(bottom, y + height);
      }
      if (!selected) {
        left = Math.min(left, -(item.bleed?.left || 0)); top = Math.min(top, -(item.bleed?.top || 0));
        right = Math.max(right, 66 + (item.bleed?.right || 0)); bottom = Math.max(bottom, 66 + (item.bleed?.bottom || 0));
      }
    }
    return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return Object.freeze({ resolve, owns, appearance, appearanceLayers, portraitBounds,
    ready: () => source.ready(sprites), subscribe: source.subscribe,
    cacheStats: source.stats, dispose() { painter.dispose(); source.dispose(); } });
}

export { createUsagiRasterWardrobe, validateUsagiWardrobe };
