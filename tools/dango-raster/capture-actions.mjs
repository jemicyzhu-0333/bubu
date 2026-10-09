import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createCanvas, loadImage } = createRequire(import.meta.url)(process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
let manifest;
if (arg('body')) {
  manifest = JSON.parse(fs.readFileSync(arg('body'), 'utf8'));
  for (const kind of ['tools', 'effects', 'wardrobe']) if (arg(kind)) Object.assign(manifest, JSON.parse(fs.readFileSync(arg(kind), 'utf8')));
  manifest.baseUrl = pathToFileURL(`${root}/assets/companion/dango/raster/`).href;
} else manifest = (await import('../../assets/companion/dango/raster/dango.raster.mjs')).DANGO_RASTER;
const output = path.resolve(arg('out') || path.join(root, 'dist/dango-raster-actions'));
fs.mkdirSync(output, { recursive: true });
const artist = createDangoRasterArtist({ manifest, loadImage: src => loadImage(fileURLToPath(src)), createSurface: createCanvas });
await artist.ready({ all: true });
const actions = (arg('actions') || 'carry-energy,sip-tea,read-book,type-keyboard,take-note,umbrella-dance,plant-water,tiny-chef,dig-treasure,high-five').split(',');
const phases = [.05, .25, .5, .75, .95], records = [];
const keys = (arg('outfit') || '').split(',').filter(Boolean);
const items = PET_APPEARANCE_ITEMS.filter(item => (item.formId || 'dango') === 'dango' && keys.includes(item.renderKey));
const calmVisual = process.argv.includes('--calm');
for (let page = 0; page * 5 < actions.length; page++) {
  const group = actions.slice(page * 5, page * 5 + 5), canvas = createCanvas(1095, group.length * 239), context = canvas.getContext('2d');
  context.fillStyle = '#ece9e3'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [row, id] of group.entries()) for (const [column, progress] of phases.entries()) {
    const action = PET_ACTIONS[id]; if (!action) throw new Error(`unknown action: ${id}`);
    const appearance = { view: 'auto', items };
    const artwork = artist.resolveArtwork({ view: 'auto', action, motion: action.motion, progress, elapsedMs: progress * (action.duration || 8000), appearance, calmVisual });
    context.save(); context.translate(column * 219, row * 239); context.scale(1.5, 1.5);
    artist.applyMotionTransform(context, action.motion, progress, { action, bodySize: 66, size: 146, calmVisual,
      translate: (x, y) => context.translate(Math.round(x * 1.5) / 1.5, Math.round(y * 1.5) / 1.5) });
    const offset = artist.motionOffset(action.motion, progress, calmVisual, { action, bodySize: 66 });
    context.translate(40 + offset.x, 40 + offset.y);
    const options = { action, artwork, palette: PALETTES.pink, view: artwork.view, progress, calmVisual };
    artist.action(context, { ...options, layer: 'back' });
    for (const item of items) artist.appearance(context, { ...options, item, appearance, layer: 'back' });
    artist.body(context, PALETTES.pink, artwork.view, artwork);
    artist.face(context, PALETTES.pink, {}, false, artwork.view, null, artwork);
    for (const item of items) artist.appearance(context, { ...options, item, appearance, layer: 'front' });
    artist.action(context, { ...options, layer: 'front' });
    context.restore(); context.fillStyle = '#302838'; context.font = '12px sans-serif';
    context.fillText(`${id} ${progress} ${artwork.view}`, column * 219 + 6, row * 239 + 224);
    records.push({ id, progress, view: artwork.view, ready: artwork.ready, missing: artwork.missingAssets });
  }
  fs.writeFileSync(path.join(output, `actions-${page + 1}.png`), canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ records, cache: artist.cacheStats(),
  backend: 'Skia actual production artist; not native Electron verification' }, null, 2));
console.log(JSON.stringify({ output, frames: records.length, ready: records.every(row => row.ready), cache: artist.cacheStats() }, null, 2));
artist.dispose();
