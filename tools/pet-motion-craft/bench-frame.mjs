// Offline frame-cost benchmark: production renderer via the gallery harness,
// fixed 30fps clock, N frames per action. Reports mean / p95 ms per draw and
// heap growth. Offscreen Skia CPU numbers are relative, not native GPU timing.
// Usage: node --expose-gc tools/pet-motion-craft/bench-frame.mjs [--actions=a,b] [--frames=300] [--skins=pink,usagi]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const root = path.resolve(arg('app-root', path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')));
const backend = createRequire(import.meta.url)(path.join(root, 'node_modules/@napi-rs/canvas'));
const { installOffscreenImages } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/offscreen-images.mjs')));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/runtime-harness.mjs')));
const source = await loadSource(pathToFileURL(root).href);
const actions = arg('actions', 'paper-return,moonwalk,magic-trick,sip-tea,dance').split(',');
const frames = Number(arg('frames', '300')), skins = arg('skins', 'pink,usagi').split(',');
const outfit = arg('outfit', '').split(',').filter(Boolean);
const rows = [];
for (const skin of skins) for (const id of actions) {
  const h = createRenderHarness(source, { skin, view: 'auto', dpr: 2, blink: false, outfit });
  const sel = h.select('action', id);
  for (let n = 0; n < 30; n++) h.draw(n / 30 * 1000); // warm caches
  globalThis.gc?.(); const heap0 = process.memoryUsage().heapUsed; const times = [];
  for (let n = 0; n < frames; n++) { const at = (n / frames) * sel.duration; const t0 = performance.now(); h.draw(at); times.push(performance.now() - t0); }
  globalThis.gc?.(); const heap1 = process.memoryUsage().heapUsed;
  times.sort((a, b) => a - b);
  rows.push({ skin, action: id, mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p95: +times[Math.floor(times.length * .95)].toFixed(3), heapKB: Math.round((heap1 - heap0) / 1024) });
  h.dispose();
}
console.log(JSON.stringify(rows));
