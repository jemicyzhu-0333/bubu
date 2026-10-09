import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createCanvas, loadImage } = createRequire(import.meta.url)(process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas');
const fragment = process.argv.find(arg => arg.startsWith('--fragment='))?.slice(11);
const manifest = fragment ? JSON.parse(fs.readFileSync(fragment, 'utf8'))
  : (await import('../../assets/companion/dango/raster/dango.raster.mjs')).DANGO_RASTER;
manifest.baseUrl ||= pathToFileURL(path.join(root, 'assets/companion/dango/raster/')).href;
const output = path.resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || path.join(root, 'dist/dango-raster-body'));
fs.mkdirSync(output, { recursive: true });
const artist = createDangoRasterArtist({ manifest, loadImage: src => loadImage(fileURLToPath(src)), createSurface: createCanvas });
await artist.ready({ all: true });
const results = [];
for (const view of ['front', 'three-quarter-right', 'three-quarter-left', 'back']) {
  if (!manifest.views[view]) continue;
  const actual = createCanvas(512, 512), expected = createCanvas(512, 512);
  const context = actual.getContext('2d'), reference = expected.getContext('2d');
  for (const target of [context, reference]) {
    target.setTransform(390 / 64, 0, 0, 390 / 64, 256 - 33 * 390 / 64, 448 - 64 * 390 / 64);
    target.imageSmoothingEnabled = false;
  }
  const artwork = artist.resolveArtwork({ view, calmVisual: true });
  artist.action(context, { artwork, palette: PALETTES.pink, layer: 'back' });
  artist.body(context, PALETTES.pink, view, artwork);
  artist.face(context, PALETTES.pink, {}, false, view, null, artwork);
  artist.action(context, { artwork, palette: PALETTES.pink, layer: 'front' });
  const sprite = manifest.views[view].neutral;
  reference.drawImage(await loadImage(fileURLToPath(new URL(sprite.src, manifest.baseUrl))), ...sprite.rect);
  const a = context.getImageData(0, 0, 512, 512).data, b = reference.getImageData(0, 0, 512, 512).data;
  let changedPixels = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a[i + c] - b[i + c]));
    if (delta) changedPixels += 1;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
  }
  results.push({ view, ready: artwork.ready, changedPixels, maxChannelDelta });
  fs.writeFileSync(path.join(output, `${view}-runtime.png`), actual.toBuffer('image/png'));
}
const pass = results.length >= 3 && results.every(result => result.ready && result.changedPixels === 0);
fs.writeFileSync(path.join(output, 'rest-runtime-identity.json'), JSON.stringify({ pass, results,
  backend: 'Skia production artist; not native Electron verification' }, null, 2));
artist.dispose();
console.log(JSON.stringify({ pass, results }, null, 2));
if (!pass) process.exitCode = 1;
