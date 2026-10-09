// Optional production-painter pixel audit. Supply a native canvas backend;
// this does not claim browser/Electron window or GPU acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package')) throw new Error('Pass --canvas-package=/path/to/@napi-rs/canvas');
const { createCanvas, loadImage } = createRequire(import.meta.url)(arg('canvas-package'));
const output = path.resolve(arg('out') || 'dist/dango-raster-roots');
fs.mkdirSync(output, { recursive: true });
const artist = createDangoRasterArtist({ manifest: DANGO_RASTER,
  loadImage: src => loadImage(fileURLToPath(src)), createSurface: createCanvas });
await artist.ready({ all: true });

function physical(context, artwork, palette) {
  artist.action(context, { artwork, palette, layer: 'back' });
  artist.body(context, palette, artwork.view, artwork);
}

// Classify the actual pink interior, excluding contour and transparency. Both
// foot interiors must reach the main torso component; touching black outlines
// alone (the old closed-bean defect) cannot satisfy this observation.
function looseFootInterior(pixels, width) {
  const count = pixels.length / 4;
  const mask = new Uint8Array(count), labels = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    mask[i] = pixels[i * 4 + 3] > 200 && pixels[i * 4] > 128
      && pixels[i * 4] > pixels[i * 4 + 1] * 1.5 ? 1 : 0;
  }
  const queue = new Int32Array(count), sizes = [];
  let label = 0;
  for (let i = 0; i < count; i++) {
    if (!mask[i] || labels[i]) continue;
    label++; let end = 1;
    queue[0] = i; labels[i] = label;
    for (let begin = 0; begin < end; begin++) {
      const at = queue[begin];
      const adjacent = [at - width, at + width,
        at % width ? at - 1 : -1, at % width < width - 1 ? at + 1 : -1];
      for (const next of adjacent) {
        if (next < 0 || next >= count || !mask[next] || labels[next]) continue;
        labels[next] = label; queue[end++] = next;
      }
    }
    sizes[label] = end;
  }
  const main = sizes.indexOf(Math.max(...sizes.filter(Number.isFinite)));
  let loose = 0;
  // The audit canvas has 8 art units of padding and six pixels/art unit.
  // This region covers the complete two-foot interior below art y=52.
  for (let y = 60 * 6; y < 73 * 6; y++) for (let x = 12 * 6; x < 64 * 6; x++) {
    if (mask[y * width + x] && labels[y * width + x] !== main) loose++;
  }
  return loose;
}

const surface = createCanvas(492, 492), context = surface.getContext('2d');
const failures = [], cacheKeys = new Set();
let samples = 0;
for (const view of ['front', 'three-quarter-right', 'three-quarter-left', 'back']) {
  for (let frame = 0; frame <= 120; frame++) {
    const progress = frame / 120;
    const artwork = artist.resolveArtwork({ view, motion: 'dash', progress });
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, 492, 492);
    context.setTransform(6, 0, 0, 6, 48, 48);
    physical(context, artwork, PALETTES.pink); samples++;
    cacheKeys.add(`${view}|${artwork.key}`);
    const loose = looseFootInterior(context.getImageData(0, 0, 492, 492).data, 492);
    // Ignore isolated subpixel antialias fragments, not a visible toe or root.
    if (!artwork.ready || loose > 12) failures.push({ view, progress, loose, ready: artwork.ready });
  }
}

const skins = Object.keys(PALETTES).filter(name => name !== 'usagi');
const sheet = createCanvas(skins.length * 220, 480), sheetContext = sheet.getContext('2d');
sheetContext.fillStyle = '#eeeae4'; sheetContext.fillRect(0, 0, sheet.width, sheet.height);
for (const [column, skin] of skins.entries()) for (const [row, progress] of [.275, .325].entries()) {
  const artwork = artist.resolveArtwork({ view: 'three-quarter', motion: 'dash', progress });
  sheetContext.save(); sheetContext.translate(column * 220 + 45, row * 230 + 38); sheetContext.scale(2, 2);
  physical(sheetContext, artwork, PALETTES[skin]);
  artist.face(sheetContext, PALETTES[skin], {}, false, artwork.view, null, artwork);
  sheetContext.restore(); sheetContext.fillStyle = '#222'; sheetContext.font = '16px sans-serif';
  sheetContext.fillText(`${skin} ${progress}`, column * 220 + 8, row * 230 + 20);
}
fs.writeFileSync(path.join(output, 'skin-extremes.png'), sheet.toBuffer('image/png'));
const report = { backend: 'Production raster painter / offscreen Skia; native desktop unverified',
  manifestVersion: DANGO_RASTER.version, samples, failures, cacheKeys: cacheKeys.size,
  note: 'Checks connected pink interiors in bare running art. Ten-skin sheet is visual evidence, not an automated color-fidelity score.',
  cache: artist.cacheStats() };
fs.writeFileSync(path.join(output, 'pixel-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
artist.dispose();
if (failures.length) process.exitCode = 1;
