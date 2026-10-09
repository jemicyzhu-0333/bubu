'use strict';

import { multiply, localMatrix } from './rig/pose.mjs';

const HEADWEAR_KEYS = Object.freeze({ 'milestone.sunhat': 'sunhat', 'milestone.sprout': 'sprout' });

function isScarfHeadwearCombination(items = []) {
  if (items.length !== 2 || items.some(item => (item.formId || 'dango') !== 'dango')) return false;
  return items.some(item => item.id === 'milestone.scarf' && item.renderKey === 'scarf')
    && items.some(item => Object.hasOwn(HEADWEAR_KEYS, item.id) && HEADWEAR_KEYS[item.id] === item.renderKey);
}

function garmentView(entry, view) {
  const key = ['profile', 'three-quarter-right'].includes(view) ? 'three-quarter' : view;
  return entry?.views?.[key] || (key === 'three-quarter' ? entry?.views?.['three-quarter-right'] : null) || null;
}

function createRasterWardrobe({ manifest, painter, source }) {
  function resolveOutfit(outfit, view, suppressedSlots = []) {
    const active = (outfit?.items || []).filter(item => (item.formId || 'dango') === 'dango'
      && !suppressedSlots.includes(item.exclusiveGroup));
    const states = [], missing = [], replaces = new Set();
    for (const item of active) {
      const entry = manifest.appearance?.[item.renderKey], selected = garmentView(entry, view);
      const layers = [...(selected?.back || []), ...(selected?.front || [])];
      if (!layers.length) { missing.push(`appearance:${item.renderKey}@${view}`); continue; }
      states.push(...layers.map(sprite => source?.state(sprite)));
      if (item.renderKey === 'sunhat') { replaces.add('ear-left'); replaces.add('ear-right'); }
      for (const part of entry.replaces || (item.exclusiveGroup === 'footwear' ? ['foot-left', 'foot-right'] : [])) replaces.add(part);
    }
    const ready = !missing.length && states.every(state => state === 'ready');
    return Object.freeze({ ready, states: Object.freeze(states), missing: Object.freeze(missing),
      keys: Object.freeze(active.map(item => `${item.id || ''}|${item.renderKey}`)),
      hiddenParts: Object.freeze(ready ? [...replaces] : []) });
  }
  function appearance(context, { item, layer = 'front', palette, view = 'front', artwork, appearance: outfit } = {}) {
    if (!item || (item.formId || 'dango') !== 'dango') return false;
    if (artwork?.suppressedAppearanceSlots?.includes(item.exclusiveGroup)) return false;
    const entry = manifest.appearance?.[item.renderKey], selected = garmentView(entry, artwork?.view || view);
    if (!selected) return false;
    // One selected outfit and its body replacements share a readiness snapshot.
    // A failed boot must not leave one shoe or hide both original feet. Explicit
    // action headwear suppression removes those inactive layers from the group.
    const signature = `${item.id || ''}|${item.renderKey}`;
    const readiness = artwork?.wardrobe?.keys.includes(signature) ? artwork.wardrobe
      : resolveOutfit(outfit || { items: [item] }, artwork?.view || view, artwork?.suppressedAppearanceSlots);
    if (!readiness.ready) return false;
    const lift = item.exclusiveGroup === 'head-aura' && outfit?.items?.some(candidate => candidate.exclusiveGroup === 'headwear')
      ? entry.auraLift || 0 : 0;
    context.save(); context.translate(0, -lift);
    let painted = false;
    // The same attached boot is gradually tucked behind the torso as the
    // foot sinks below the shared floor; cuffs cannot float above the rim.
    const support = artwork?.actionReady && artwork?.contact?.hands.some(hand => hand.pawSprite === 'support-paw')
      && item.exclusiveGroup === 'footwear';
    if (item.renderKey === 'sunhat' && layer === 'back' && artwork?.layeredReady !== false) {
      for (const key of ['ear-left', 'ear-right']) {
        const sprite = artwork?.data?.parts?.[key];
        if (sprite) painted = painter.paint(context, sprite, palette, [1, 0, 0, 1, 0, 0]) || painted;
      }
    }
    const sinking = item.exclusiveGroup === 'footwear' && Number.isFinite(artwork?.groundClipY);
    const sink = sinking ? Math.max(0, 63 - artwork.groundClipY) : 0;
    const depth = Math.min(1, sink / 7);
    const layers = support ? layer === 'back' ? [...(selected.back || []), ...(selected.front || [])] : []
      : sinking && layer === 'back' ? [...(selected.back || []), ...(selected.front || [])] : selected[layer] || [];
    if (sinking && layer === 'front') context.globalAlpha *= 1 - depth * depth * (3 - 2 * depth);
    for (const sprite of layers) {
      let matrix = artwork?.layeredReady !== false && sprite.attachment
        && (artwork?.attachmentMatrices || artwork?.matrices)?.[sprite.attachment];
      if (item.renderKey === 'boots' && sprite.attachment?.startsWith('foot-')) {
        const sole = sprite.rect[1] + sprite.rect[3];
        matrix = multiply(matrix || [1, 0, 0, 1, 0, 0], localMatrix([sprite.pivot?.[0] ?? sprite.rect[0] + sprite.rect[2] / 2, sole], { sx: .8, sy: .8 }));
      }
      painted = painter.paint(context, sprite, palette, matrix) || painted;
    }
    context.restore(); return painted;
  }
  function portraitBounds(outfit) {
    const base = manifest.artBounds || { x: -4, y: -2, width: 75, height: 68 };
    let left = base.x, top = base.y, right = left + base.width, bottom = top + base.height;
    const wearsHat = outfit?.items?.some(item => item.exclusiveGroup === 'headwear');
    for (const item of outfit?.items || []) {
      const entry = manifest.appearance?.[item.renderKey], selected = garmentView(entry, outfit.view || 'front');
      if (!selected) continue;
      const lift = wearsHat && item.exclusiveGroup === 'head-aura' ? entry.auraLift || 0 : 0;
      for (const sprite of [...(selected.back || []), ...(selected.front || [])]) {
        const [x, y, width, height] = sprite.rect;
        left = Math.min(left, x); top = Math.min(top, y - lift);
        right = Math.max(right, x + width); bottom = Math.max(bottom, y + height - lift);
      }
    }
    return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
  }
  function appearanceLayers(item, view) {
    const selected = garmentView(manifest.appearance?.[item.renderKey], view);
    if (item.exclusiveGroup === 'footwear') return ['back', 'front'];
    return ['back', 'front'].filter(layer => selected?.[layer]?.length);
  }
  return Object.freeze({ appearance, appearanceLayers, portraitBounds, resolveOutfit });
}

export { garmentView, createRasterWardrobe, isScarfHeadwearCombination };
