// Diagnostic only: all art, transforms and live layer order come from production.
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';

export const ACTION = Object.freeze({ id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' });
export const SCARF = PET_APPEARANCE_ITEMS.find(item => item.id === 'milestone.scarf');
export const FACE = Object.freeze({ eyes: 'neutral', mouth: 'neutral', openness: 1, eyeOffsetX: 0, eyeOffsetY: 0 });
export const CSS_PER_UNIT = 1.5;
export const COMPOSITION = Object.freeze(['action-back', 'garment-back', 'body-and-roots', 'face', 'garment-front', 'action-front']);
export const intent = (at, { outfit = true, running = true, view = 'three-quarter', ...overrides } = {}) => ({
  action: running ? ACTION : null, motion: running ? 'dash' : 'idle', progress: at / ACTION.duration,
  elapsedMs: at, view, face: FACE, appearance: { items: outfit ? [SCARF] : [] }, state: 'idle', ...overrides
});

export async function makeRuntime(backend) {
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = await loadSource(pathToFileURL(root).href);
  const cases = [true, false].flatMap(running => [false, true].map(outfit => {
    const harness = createRenderHarness(source, { skin: 'pink', view: 'three-quarter', dpr: 2,
      calm: false, blink: false, outfit: outfit ? ['milestone.scarf'] : [] });
    harness.select(running ? 'action' : 'expression', running ? ACTION.id : 'life.idle');
    return { running, outfit, harness };
  }));
  return { source, cases, dispose() { for (const item of cases) item.harness.dispose(); } };
}

export async function makeIsolatedPainter(backend, { runFootTiming = 'forward-recovery' } = {}) {
  globalThis.Path2D = backend.Path2D;
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, runClip: null, runFootTiming,
    loadImage: async src => backend.loadImage(await fs.readFile(fileURLToPath(src))),
    createSurface: (width, height) => backend.createCanvas(width, height) });
  await artist.ready({ all: true });
  function compose(context, options, { selected = COMPOSITION, transform = true, inspect } = {}) {
    const artwork = artist.resolveArtwork(options), { action, motion, progress, appearance } = options;
    context.save();
    if (transform) artist.applyMotionTransform(context, motion, progress, {
      artwork, action, size: 146, bodySize: 66, facing: 1, calmVisual: options.calmVisual, state: options.state });
    const offset = transform ? artist.motionOffset(motion, progress, options.calmVisual, { action, state: options.state }) : { x: 0, y: 0 };
    context.translate(40 + offset.x, 40 + offset.y);
    for (const layer of COMPOSITION) {
      if (!selected.includes(layer)) continue;
      inspect?.(layer, context, artwork);
      if (layer.startsWith('action-')) artist.action(context, { artwork, action, palette: PALETTES.pink, layer: layer.slice(7) });
      else if (layer.startsWith('garment-')) for (const item of appearance.items) artist.appearance(context, {
        item, appearance, artwork, palette: PALETTES.pink, view: artwork.view, layer: layer.slice(8) });
      else if (layer === 'body-and-roots') artist.body(context, PALETTES.pink, artwork.view, artwork);
      else if (layer === 'face') artist.face(context, PALETTES.pink, options.face, false, artwork.view, null, artwork);
    }
    context.restore(); return artwork;
  }
  return { artist, compose, dispose: () => artist.dispose() };
}
