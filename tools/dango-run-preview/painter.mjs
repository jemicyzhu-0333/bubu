// Diagnostic composition of the actual production artist. This file owns no art.
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { DANGO_RUN } from '../../assets/companion/dango/clips/run/dango-run.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

export const ACTION = Object.freeze({ id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' });
export const VIEW = 'three-quarter';
export const FACE = Object.freeze({ eyes: 'neutral', mouth: 'neutral', openness: 1, eyeOffsetX: 0, eyeOffsetY: 0 });
export const CSS_PER_UNIT = 1.5;

export async function makePainter(backend, { authored = true } = {}) {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, runClip: authored ? DANGO_RUN : null,
    loadImage: async src => backend.loadImage(await fs.readFile(fileURLToPath(src))),
    createSurface: (width, height) => backend.createCanvas(width, height) });
  await artist.ready({ all: true });
  function sample(elapsedMs, overrides = {}) {
    return artist.resolveArtwork({ action: ACTION, motion: ACTION.motion, progress: elapsedMs / ACTION.duration,
      elapsedMs, view: VIEW, face: FACE, appearance: { items: [] }, state: 'idle', ...overrides });
  }
  function compose(context, elapsedMs, { root = true, effects = true, face = true, blinking = false, colors = PALETTES.pink, intent = {} } = {}) {
    const artwork = sample(elapsedMs, intent), progress = elapsedMs / ACTION.duration;
    context.save();
    // Match the 146-unit stage used by the production form. Physical art starts
    // at (40,40). The comparison keeps the existing x-only chase choreography.
    if (root) artist.applyMotionTransform(context, ACTION.motion, progress,
      { artwork, action: ACTION, size: 146, bodySize: 66, facing: 1 });
    const offset = root ? artist.motionOffset(ACTION.motion, progress, false, { action: ACTION }) : { x: 0, y: 0 };
    context.translate(40 + offset.x, 40 + offset.y);
    if (effects) artist.action(context, { artwork, action: ACTION, palette: colors, layer: 'back' });
    else if (!artwork.clip) artist.action(context, { artwork: { ...artwork, contact: null }, palette: colors, layer: 'back' });
    artist.body(context, colors, VIEW, artwork);
    if (face) artist.face(context, colors, FACE, blinking, VIEW, null, artwork);
    artist.bodyForeground(context, colors, artwork);
    if (effects) artist.action(context, { artwork, action: ACTION, palette: colors, layer: 'front' });
    context.restore(); return artwork;
  }
  const first = sample(0);
  if (!first.ready || authored && !first.clip) throw Error(`Painter not ready: ${first.clipStatus}, ${JSON.stringify(artist.cacheStats().source)}`);
  return { artist, sample, compose, dispose: () => artist.dispose() };
}
