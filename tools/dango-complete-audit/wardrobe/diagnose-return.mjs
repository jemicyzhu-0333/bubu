// An explicitly labelled omit-layer diagnostic, never a production substitute.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../../usagi-gallery/runtime-harness.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href), view = arg('view') || 'back', itemId = arg('item') || 'milestone.satchel';
const omit = arg('omit') || 'satchel-back-hidden-return.png', dir = path.join(root, 'dist/dango-complete-audit/wardrobe/diagnostics');
fs.mkdirSync(dir, { recursive: true });
const sheet = backend.createCanvas(920, 540), ctx = sheet.getContext('2d');
ctx.fillStyle = '#eef2ed'; ctx.fillRect(0, 0, 920, 540); ctx.fillStyle = '#29413f'; ctx.font = '16px sans-serif';
ctx.fillText(`${itemId} / ${view} / layer isolation`, 15, 25);
const images = [];
for (const [index, omitLayer] of [false, true].entries()) {
  const h = createRenderHarness(source, { skin: 'pink', outfit: [itemId], view, dpr: 2, blink: false });
  h.select('expression', 'life.idle');
  const context = h.body.getContext('2d'), original = context.drawImage;
  if (omitLayer) context.drawImage = function(image, ...args) {
    if (typeof image.src === 'string' && image.src.split('?')[0].endsWith(omit)) return;
    return original.call(this, image, ...args);
  };
  h.draw(0); h.draw(1000); h.draw(1600);
  ctx.drawImage(h.body, index * 460, 45, 438, 438);
  ctx.fillStyle = '#29413f'; ctx.fillText(omitLayer ? `Diagnostic only: omit ${omit}` : 'Actual production', index * 460 + 12, 515);
  images.push(context.getImageData(0, 0, 438, 438).data); context.drawImage = original; h.dispose();
}
const changed = [];
for (let i = 0; i < images[0].length; i += 4) {
  if (Math.max(...[0, 1, 2, 3].map(c => Math.abs(images[0][i + c] - images[1][i + c]))) > 16) changed.push([i / 4 % 438, Math.floor(i / 4 / 438)]);
}
const bounds = changed.length ? [Math.min(...changed.map(p => p[0])), Math.min(...changed.map(p => p[1])),
  Math.max(...changed.map(p => p[0])), Math.max(...changed.map(p => p[1]))] : null;
const file = `${itemId}-${view}-${omit.replace('.png', '')}`;
fs.writeFileSync(path.join(dir, `${file}.png`), sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify({ itemId, view, omittedDiagnosticLayer: omit,
  changedPixels: changed.length, bounds, note: 'Right panel is an omit-layer diagnosis, not proposed or shipped artwork' }, null, 2));
console.log(JSON.stringify({ file, changedPixels: changed.length, bounds }));
