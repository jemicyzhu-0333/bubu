// Actual production alpha/contour evidence at fixed character-reference scales.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const { pixels } = await import('../usagi-gallery/pixels.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = await loadSource(pathToFileURL(path.resolve(arg('baseline'))).href);
const current = await loadSource(pathToFileURL(root).href);
const skin = arg('form') === 'dango' ? 'pink' : 'usagi', action = arg('action') || 'chase-butterfly';
const options = { skin, view: arg('view') || 'three-quarter', dpr: 2, blink: false,
  outfit: arg('outfit-ids')?.split(',') || false, level: 25 };
const probe = createRenderHarness(before, { ...options, calm: true });
probe.select('expression', 'life.idle'); probe.draw(0);
const bounds = pixels(probe.body).bounds;
probe.dispose();
const height = bounds.bottom - bounds.top + 1, anchor = [(bounds.left + bounds.right + 1) / 2, bounds.bottom + 1];
const progress = skin === 'pink' ? [0, .275, .55, .825] : [0, .2, .4, .6, .8, .998], records = [];
const cellWidth = skin === 'pink' ? 360 : 240;
const output = path.resolve(arg('out')); fs.mkdirSync(output, { recursive: true });
for (const theme of ['light', 'dark']) {
  const canvas = backend.createCanvas(1440, 930), ctx = canvas.getContext('2d');
  ctx.fillStyle = theme === 'light' ? '#f5f2eb' : '#282934'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme === 'light' ? '#342d29' : '#eee5d9'; ctx.font = '18px sans-serif';
  ctx.fillText(`${skin.toUpperCase()} / ${action} / fixed99px &198px character-reference height`, 18, 28);
  ctx.font = '12px sans-serif'; ctx.fillText('Exact production layers / shared clock / unmodified camera scale across BEFORE and AFTER / offscreen Canvas evidence', 18, 51);
  for (const [sizeIndex, size] of [99, 198].entries()) for (const [version, source] of [['BEFORE', before], ['AFTER', current]].entries()) {
    const [label, selectedSource] = source, row = sizeIndex * 2 + version, y = row < 2 ? 80 + row * 170 : 425 + (row - 2) * 250;
    const scale = size / height, baselineY = y + (sizeIndex ? 208 : 123);
    ctx.fillStyle = theme === 'light' ? '#564d46' : '#cbc6be'; ctx.font = '13px sans-serif'; ctx.fillText(`${label} · ${size}px neutral reference`, 18, y);
    const harness = createRenderHarness(selectedSource, options), selection = harness.select('action', action);
    for (const [i, p] of progress.entries()) {
      const time = selection.duration * p;
      // Advance continuously to each labelled keyframe so particles and transitions settle naturally.
      const previous = i ? selection.duration * progress[i - 1] : 0;
      for (let at = previous; at < time; at += 1000 / 60) harness.draw(at);
      harness.draw(time);
      ctx.save(); ctx.imageSmoothingEnabled = skin === 'usagi';
      const x = i * cellWidth + cellWidth / 2 - anchor[0] * scale;
      ctx.drawImage(harness.body, x, baselineY - anchor[1] * scale, harness.body.width * scale, harness.body.height * scale);
      ctx.restore();
      ctx.font = '10px sans-serif'; ctx.fillText(`${(time / 1000).toFixed(2)}s`, i * cellWidth + 15, y + (sizeIndex ? 219 : 138));
      if (theme === 'light') records.push({ label, size, timeMs: time, pixelHash: pixels(harness.body).hash, referenceScale: scale });
    }
    harness.dispose();
  }
  const file = path.join(output, `comparison-${theme}.png`); fs.writeFileSync(file, canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ renderer: 'production createPetRenderer via offscreen Canvas',
  baselineRef: arg('baseline-ref') || 'unversioned-local-source', skin, action, options, referenceBounds: bounds, referenceHeight: height,
  referenceAnchor: anchor, records, sourceClock: 'continuous60fps between labelled samples',
  note: '99/198 describes the neutral reference foreground height; action extension and equipment retain the same scale instead of per-frame normalization.' }, null, 2));
