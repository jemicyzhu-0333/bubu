import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { sampleActivityStory } from '../../src/capabilities/companion/presentation/activity-playback.mjs';
import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || path.join(root, 'dist/dango-raster-lookback'));
const { createCanvas, loadImage } = createRequire(import.meta.url)(process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas');
const artist = createDangoRasterArtist({ manifest: DANGO_RASTER,
  loadImage: src => loadImage(fileURLToPath(src)), createSurface: createCanvas });
await artist.ready({ all: true });
fs.mkdirSync(output, { recursive: true });
const phases = [0, .16, .28, .36, .48, .64, .80, 1];
const actions = [PET_ACTIONS['tail-wiggle'], SESSION_ACTIVITIES['rest-window']];
const checks = [];
const keys = (process.argv.find(arg => arg.startsWith('--outfit='))?.slice(9) || '').split(',').filter(Boolean);
const items = PET_APPEARANCE_ITEMS.filter(item => (item.formId || 'dango') === 'dango' && keys.includes(item.renderKey));
function render(context, action, t, scale, x, y) {
  const sample = sampleActivityStory(action, t);
  const appearance = { view: 'auto', items };
  const artwork = artist.resolveArtwork({ action: sample.action, motion: sample.action.motion, view: 'auto',
    progress: sample.progress, elapsedMs: t * 8000, appearance });
  context.save(); context.translate(x, y); context.scale(scale, scale); context.translate(40, 40);
  const options = { action: sample.action, artwork, palette: PALETTES.pink, view: artwork.view, progress: sample.progress };
  artist.action(context, { ...options, layer: 'back' });
  for (const item of items) artist.appearance(context, { ...options, item, appearance, layer: 'back' });
  artist.body(context, PALETTES.pink, artwork.view, artwork);
  artist.face(context, PALETTES.pink, {}, false, artwork.view, null, artwork);
  for (const item of items) artist.appearance(context, { ...options, item, appearance, layer: 'front' });
  artist.action(context, { ...options, layer: 'front' });
  context.restore(); return artwork;
}
for (const scale of [1.5, 3]) {
  const size = 146 * scale, sheet = createCanvas(size * 4, (size + 24) * 4), context = sheet.getContext('2d');
  context.fillStyle = '#ece9e3'; context.fillRect(0, 0, sheet.width, sheet.height);
  for (const [row, action] of actions.entries()) for (const [i, t] of phases.entries()) {
    const x = i % 4 * size, y = (row * 2 + Math.floor(i / 4)) * (size + 24);
    const artwork = render(context, action, t, scale, x, y);
    context.fillStyle = '#302838'; context.font = '14px sans-serif';
    context.fillText(`${action.id} ${t}`, x + 8, y + size + 17);
    checks.push({ action: action.id, phase: t, bodyPixels: 66 * scale, ready: artwork.ready, turn: artwork.lookback.turn });
  }
  fs.writeFileSync(path.join(output, `lookback-${66 * scale}px.png`), sheet.toBuffer('image/png'));
}
const frames = path.join(output, 'frames'); fs.mkdirSync(frames, { recursive: true });
for (let i = 0; i <= 192; i++) {
  const frame = createCanvas(876, 468), context = frame.getContext('2d');
  context.fillStyle = '#ece9e3'; context.fillRect(0, 0, frame.width, frame.height);
  actions.forEach((action, index) => {
    render(context, action, i / 192, 3, index * 438, 0);
    context.fillStyle = '#302838'; context.font = '16px sans-serif'; context.fillText(action.id, index * 438 + 14, 455);
  });
  fs.writeFileSync(path.join(frames, `frame-${String(i).padStart(4, '0')}.png`), frame.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, frames: 193, fps: 24,
  assetDigest: DANGO_RASTER.provenance.assetDigest, backend: 'production artist on Skia; not native Electron' }, null, 2));
artist.dispose();
console.log(JSON.stringify({ output, ready: checks.every(check => check.ready), frames: 193 }));
