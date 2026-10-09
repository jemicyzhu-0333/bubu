import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url), { createCanvas, loadImage } = require(process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas');
const fragment = process.argv.find(arg => arg.startsWith('--fragment='))?.slice(11);
const output = path.resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || path.join(root, 'dist/dango-raster-body'));
const manifest = fragment ? JSON.parse(fs.readFileSync(fragment, 'utf8'))
  : structuredClone((await import('../../assets/companion/dango/raster/dango.raster.mjs')).DANGO_RASTER);
manifest.baseUrl ||= pathToFileURL(path.join(root, 'assets/companion/dango/raster/')).href;
manifest.tools ||= {}; manifest.effects ||= {}; manifest.appearance ||= {};
const wardrobe = process.argv.find(arg => arg.startsWith('--wardrobe='))?.slice(11);
if (wardrobe) manifest.appearance = JSON.parse(fs.readFileSync(wardrobe, 'utf8')).appearance;
const keys = (process.argv.find(arg => arg.startsWith('--outfit='))?.slice(9) || '').split(',').filter(Boolean);
const items = PET_APPEARANCE_ITEMS.filter(item => keys.includes(item.renderKey) && (item.formId || 'dango') === 'dango');
const artist = createDangoRasterArtist({ manifest, loadImage: src => loadImage(fileURLToPath(src)), createSurface: createCanvas });
await artist.ready({ all: true });
fs.mkdirSync(output, { recursive: true });
const samples = ['front', 'three-quarter-right', 'three-quarter-left', 'back'].flatMap(view => [
  { view, motion: 'idle', progress: 0, elapsedMs: 0, calmVisual: true, label: `${view} exact rest` },
  { view, motion: 'idle', progress: .3, elapsedMs: 1600, label: `${view} ear motion` },
  { view, motion: 'dash', progress: .275, label: `${view} stride A` },
  { view, motion: 'dash', progress: .325, label: `${view} stride B` }
]);
const sheet = createCanvas(4 * 340, 4 * 285), context = sheet.getContext('2d');
context.fillStyle = '#ece9e3'; context.fillRect(0, 0, sheet.width, sheet.height);
const results = [];
for (const [i, options] of samples.entries()) {
  const appearance = { view: options.view, items };
  const artwork = artist.resolveArtwork({ ...options, appearance }), column = i % 4, row = Math.floor(i / 4);
  context.save(); context.translate(column * 340 + 60, row * 285 + 42); context.scale(3, 3);
  if (process.argv.includes('--body-transform')) artist.applyMotionTransform(context, options.motion, options.progress, {
    calmVisual: options.calmVisual, action: { motion: options.motion }, bodySize: 66, size: 66,
    translate: (x, y) => context.translate(Math.round(x * 3) / 3, Math.round(y * 3) / 3) });
  artist.action(context, { artwork, palette: PALETTES.pink, layer: 'back' });
  for (const item of items) artist.appearance(context, { artwork, palette: PALETTES.pink, layer: 'back', appearance, item });
  artist.body(context, PALETTES.pink, options.view, artwork);
  artist.face(context, PALETTES.pink, { eyes: 'neutral', mouth: 'neutral' }, false, options.view, null, artwork);
  for (const item of items) artist.appearance(context, { artwork, palette: PALETTES.pink, layer: 'front', appearance, item });
  artist.action(context, { artwork, palette: PALETTES.pink, layer: 'front' });
  context.restore(); context.fillStyle = '#292333'; context.font = '16px sans-serif';
  context.fillText(options.label, column * 340 + 12, row * 285 + 268);
  results.push({ label: options.label, ready: artwork.ready, drawnView: artwork.drawnView });
}
fs.writeFileSync(path.join(output, 'body-motion-sheet.png'), sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(output, 'body-motion-checks.json'), JSON.stringify({ samples: results, cache: artist.cacheStats(),
  backend: 'Skia production artist; not native Electron verification' }, null, 2));
console.log(JSON.stringify({ output, ready: results.every(sample => sample.ready), cache: artist.cacheStats() }, null, 2));
artist.dispose();
