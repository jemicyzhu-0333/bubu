'use strict';

const VIEW_NAMES = Object.freeze(['front', 'three-quarter', 'three-quarter-left', 'three-quarter-right', 'back']);
const PART_NAMES = Object.freeze(['ear-left', 'ear-right', 'foot-left', 'foot-right', 'hand-left', 'hand-right']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => Array.isArray(value) && value.length === 2 && value.every(finite);
const rect = value => Array.isArray(value) && value.length === 4 && value.every(finite)
  && value[2] > 0 && value[3] > 0 && value.every(n => Math.abs(n) <= 256);

function validateRasterSprite(sprite, name = 'sprite') {
  if (!sprite || typeof sprite !== 'object' || typeof sprite.src !== 'string'
    || !/^[a-zA-Z0-9_./-]+\.png$/.test(sprite.src) || sprite.src.startsWith('/')
    || sprite.src.split('/').some(part => !part || part === '..') || !rect(sprite.rect)) {
    throw new TypeError(`invalid raster sprite: ${name}`);
  }
  if (sprite.pivot !== undefined && !point(sprite.pivot)) throw new TypeError(`invalid pivot: ${name}`);
  if (sprite.anchors && Object.values(sprite.anchors).some(value => !point(value))) throw new TypeError(`invalid contact anchors: ${name}`);
  if (sprite.tint !== undefined && !['body', 'eye', 'none'].includes(sprite.tint)) throw new TypeError(`invalid tint: ${name}`);
  return sprite;
}

function collectRasterSprites(manifest) {
  const out = [], visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.src === 'string') { out.push(value); return; }
    for (const child of Object.values(value)) visit(child);
  };
  visit(manifest.views); visit(manifest.tools); visit(manifest.appearance); visit(manifest.effects);
  visit(manifest.scenes); visit(manifest.sessionScenes); visit(manifest.sceneParticles);
  return out;
}

function validateRasterManifest(manifest) {
  if (!manifest || !/^[a-z0-9-]{1,60}$/.test(manifest.id) || !Number.isInteger(manifest.version)
    || manifest.version < 1 || typeof manifest.baseUrl !== 'string') throw new TypeError('invalid raster manifest');
  const base = new URL(manifest.baseUrl);
  if (!['file:', 'http:', 'https:'].includes(base.protocol)) throw new TypeError('invalid raster asset base');
  if (!manifest.views?.front || !manifest.views.back
    || !(manifest.views['three-quarter'] || manifest.views['three-quarter-right'])) throw new TypeError('missing raster views');
  for (const [view, data] of Object.entries(manifest.views)) {
    if (!VIEW_NAMES.includes(view)) throw new TypeError(`unapproved raster view: ${view}`);
    validateRasterSprite(data.neutral, `${view}/neutral`);
    validateRasterSprite(data.body, `${view}/body`);
    for (const name of PART_NAMES) validateRasterSprite(data.parts?.[name], `${view}/${name}`);
    for (const name of ['shoulder-left', 'shoulder-right', 'foot-left', 'foot-right']) {
      const anchor = data.anchors?.[name];
      if (!anchor || !finite(anchor.x) || !finite(anchor.y)) throw new TypeError(`missing raster anchor: ${view}/${name}`);
    }
    if (view === 'back') {
      if (data.face && Object.keys(data.face.eyes || {}).length) throw new TypeError('back raster cannot have eyes');
    } else {
      for (const state of ['neutral', 'closed']) {
        if (!Array.isArray(data.face?.eyes?.[state]) || data.face.eyes[state].length !== 2) throw new TypeError(`missing paired eyes: ${view}/${state}`);
      }
      validateRasterSprite(data.face?.mouth?.neutral, `${view}/mouth`);
    }
  }
  const sprites = collectRasterSprites(manifest);
  if (sprites.length > 1024) throw new TypeError('raster sprite budget exceeded');
  sprites.forEach((sprite, i) => validateRasterSprite(sprite, String(i)));
  return Object.freeze({ sprites: sprites.length, sources: new Set(sprites.map(sprite => sprite.src)).size });
}

function rasterView(manifest, requested) {
  const capped = requested === 'profile' ? 'three-quarter' : requested;
  const key = capped === 'three-quarter' && !manifest.views[capped] ? 'three-quarter-right' : capped;
  return { key: manifest.views[key] ? key : 'front', data: manifest.views[key] || manifest.views.front };
}

export { VIEW_NAMES, PART_NAMES, validateRasterSprite, validateRasterManifest, collectRasterSprites, rasterView };
