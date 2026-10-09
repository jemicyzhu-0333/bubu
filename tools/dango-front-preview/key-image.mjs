import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { createFrontReviewDriver, OUTFITS } from './driver.mjs';
import { paintKeyImage, registerFont } from './painter.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-front-review'));
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 }; registerFont(backend);
const source = await loadSource(pathToFileURL(root).href), drivers = [];
for (const outfit of OUTFITS) {
  const driver = createFrontReviewDriver(source, { view: 'front', outfit: outfit.itemIds });
  for (let frame = 0; frame <= 15; frame++) driver.draw(frame / 30 * 1000);
  drivers.push(driver);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'dango-front-key.png'), paintKeyImage(backend, drivers.map(d => d.body), OUTFITS).toBuffer('image/png'));
for (const driver of drivers) driver.dispose();
console.log(path.join(out, 'dango-front-key.png'));
