import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href), rows = [];
for (const view of ['front', 'three-quarter']) {
  const h = createRenderHarness(source, { skin: 'pink', outfit: false, view, dpr: 2, blink: false });
  const selected = h.select('action', arg('id') || 'carry-energy');
  const progressSamples = process.argv.includes('--dense') ? Array.from({ length: 121 }, (_, i) => i / 120) : [.02, .15, .32, .5, .68, .85, .98];
  for (const progress of progressSamples) {
    const masks = { eyes: backend.createCanvas(h.body.width, h.body.height), tool: backend.createCanvas(h.body.width, h.body.height) };
    const original = h.body.getContext('2d').drawImage;
    h.body.getContext('2d').drawImage = function (image, ...rect) {
      const src = typeof image.src === 'string' ? image.src : '';
      const key = /\/eye[^/]*\.png/.test(src) ? 'eyes' : src.includes(`/tools/${arg('tool') || 'energy'}.png`) ? 'tool' : null;
      if (key) {
        const c = masks[key].getContext('2d'), m = this.getTransform(); c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        c.globalAlpha = this.globalAlpha; c.imageSmoothingEnabled = this.imageSmoothingEnabled; c.drawImage(image, ...rect);
      }
      return original.call(this, image, ...rect);
    };
    h.draw(selected.duration * progress); h.body.getContext('2d').drawImage = original;
    const eyes = masks.eyes.getContext('2d').getImageData(0, 0, h.body.width, h.body.height).data;
    const tool = masks.tool.getContext('2d').getImageData(0, 0, h.body.width, h.body.height).data;
    let overlap = 0;
    for (let i = 3; i < eyes.length; i += 4) if (eyes[i] >= 16 && tool[i] >= 16) overlap++;
    rows.push({ view, progress, atMs: selected.duration * progress, eyeToolOverlapDevicePixels: overlap });
    Object.values(masks).forEach(canvas => { canvas.width = 1; canvas.height = 1; });
  }
  h.dispose();
}
const result = { id: arg('id') || 'carry-energy', tool: arg('tool') || 'energy', dpr: 2, rows };
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
