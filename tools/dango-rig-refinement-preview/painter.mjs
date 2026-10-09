// Compose the actual production artist. Only the factory's lift timing differs.
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

export const ACTION = Object.freeze({ id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' });
export const VIEW = 'three-quarter';
export const FACE = Object.freeze({ eyes: 'neutral', mouth: 'neutral', openness: 1, eyeOffsetX: 0, eyeOffsetY: 0 });
export const CSS_PER_UNIT = 1.5;

export async function makePainter(backend, { refined = false } = {}) {
  const imageSources = new WeakMap();
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, runClip: null,
    ...(refined ? { runFootTiming: 'forward-recovery' } : {}),
    loadImage: async src => {
      const image = await backend.loadImage(await fs.readFile(fileURLToPath(src)));
      const canonical = new URL(src); canonical.search = '';
      imageSources.set(image, canonical.href); return image;
    },
    createSurface: (width, height) => backend.createCanvas(width, height) });
  await artist.ready({ all: true });
  function sample(elapsedMs, overrides = {}) {
    return artist.resolveArtwork({ action: ACTION, motion: ACTION.motion, progress: elapsedMs / ACTION.duration,
      elapsedMs, view: VIEW, face: FACE, appearance: { items: [] }, state: 'idle', ...overrides });
  }
  function compose(context, elapsedMs, { choreography = true, effects = true, blinking = false, inspect } = {}) {
    const artwork = sample(elapsedMs), progress = elapsedMs / ACTION.duration;
    context.save();
    // Always pass actual artwork: both columns retain the production lean,
    // squash/stretch and vertical breathing, including the phase proof.
    artist.applyMotionTransform(context, ACTION.motion, progress,
      { artwork, action: ACTION, size: 146, bodySize: 66, facing: 1 });
    const offset = choreography ? artist.motionOffset(ACTION.motion, progress, false, { action: ACTION }) : { x: 0, y: 0 };
    context.translate(40 + offset.x, 40 + offset.y);
    inspect?.(context, artwork);
    artist.action(context, { artwork: effects ? artwork : { ...artwork, contact: null },
      action: ACTION, palette: PALETTES.pink, layer: 'back' });
    artist.body(context, PALETTES.pink, VIEW, artwork);
    artist.face(context, PALETTES.pink, FACE, blinking, VIEW, null, artwork);
    artist.bodyForeground(context, PALETTES.pink, artwork);
    if (effects) artist.action(context, { artwork, action: ACTION, palette: PALETTES.pink, layer: 'front' });
    context.restore(); return artwork;
  }
  const first = sample(1500);
  if (!first.ready || first.clip || first.runFootTiming !== (refined ? 'forward-recovery' : null)) {
    throw Error('Wrong production painter selection or source readiness');
  }
  return { artist, sample, compose, imageSources, dispose: () => artist.dispose() };
}
