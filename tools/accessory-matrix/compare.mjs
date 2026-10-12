// Before/after magnified crops: one row per spec, one column per app root.
// node tools/accessory-matrix/compare.mjs out.png "items|kind|id|phase[|view]@x,y,w,h" ...
// ROOTS=/path/before,/path/after (default: ../bubu-before and this checkout)
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = createRequire(here + '/')('@napi-rs/canvas');
const { installOffscreenImages } = await import(pathToFileURL(path.join(here, 'tools/usagi-gallery/offscreen-images.mjs'))); installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D; globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const [, , out, ...specs] = process.argv;
const roots = (process.env.ROOTS || `${path.resolve(here, '../bubu-before')},${here}`).split(',');
const W = 400, H = 260, c = backend.createCanvas(W * roots.length, H * specs.length), x = c.getContext('2d');
x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
for (const [k, root] of roots.entries()) {
  const { loadSource, createRenderHarness } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/runtime-harness.mjs')));
  const source = await loadSource(pathToFileURL(root).href);
  for (const [i, full] of specs.entries()) {
    const [s, box = '0,0,438,438'] = full.split('@'); const [bx, by, bw, bh] = box.split(',').map(Number);
    const [items, kind, id, f, view = 'auto'] = s.split('|'); const list = items ? items.split(',') : false;
    const h = createRenderHarness(source, { skin: (items || '').startsWith('usagi') ? 'usagi' : 'pink', view, dpr: 2, blink: false, outfit: list });
    const d = h.select(kind, id).duration; h.draw(Number(f) * d);
    const sc = Math.min(W / bw, (H - 16) / bh);
    x.fillStyle = '#e7ebe3'; x.fillRect(k * W, i * H + 16, W, H - 16);
    x.drawImage(h.body, bx, by, bw, bh, k * W, i * H + 16, bw * sc, bh * sc); h.dispose();
    x.fillStyle = '#b00020'; x.font = '12px sans-serif'; x.fillText(`${k ? 'AFTER' : 'BEFORE'}  ${s}`, k * W + 4, i * H + 12);
  }
}
fs.writeFileSync(out, c.toBuffer('image/png'));
