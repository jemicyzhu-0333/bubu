// Finite real renderer coverage; successful drawing does not certify beauty.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = createRequire(import.meta.url)(path.join(root, 'node_modules/@napi-rs/canvas'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const { source, previewSource, prepare } = await import('./source.mjs');
const { createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const { USAGI_OUTFIT_SETS } = await import('../../src/content/companion/usagi-wardrobe.mjs');
await prepare();
const cases = [], failures = [];
async function check({ skin, kind = 'action', id = 'paper-return', outfit = [], view = 'auto' }) {
  const h = createRenderHarness(previewSource, { skin, outfit, view, dpr: 1, blink: false });
  try {
    const selected = h.select(kind, id);
    for (const p of [0, .5, .98]) {
      h.draw(selected.duration * p);
      const pixels = h.body.getContext('2d').getImageData(0, 0, h.body.width, h.body.height).data;
      let alpha = 0; for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
      if (!alpha) throw Error('Empty production frame');
    }
    cases.push({ skin, kind, id, outfit, view, frames: 3 });
  } catch (error) { failures.push({ skin, kind, id, outfit, view, error: error.message }); }
  finally { h.dispose(); }
  if (cases.length % 10 === 0) await new Promise(resolve => setImmediate(resolve));
}
for (const skin of ['pink', 'usagi']) {
  for (const id of Object.keys(source.behaviors.PET_ACTIONS)) await check({ skin, id });
  for (const id of Object.keys(previewSource.sessions.SESSION_ACTIVITIES)) await check({ skin, kind: 'session', id });
  for (const item of source.expressions.EXPRESSIONS) await check({ skin, kind: 'expression', id: item.id });
}
for (const item of source.wardrobe.PET_APPEARANCE_ITEMS) {
  for (const view of ['front', 'three-quarter', 'profile', 'back']) await check({ skin: item.skin || (item.formId === 'usagi' ? 'usagi' : 'pink'), outfit: [item.id], view });
}
for (const look of USAGI_OUTFIT_SETS) for (const id of Object.keys(source.behaviors.PET_ACTIONS)) await check({ skin: 'usagi', outfit: look.itemIds, id });
const result = { surface: 'production Node Canvas', cases: cases.length, frames: cases.length * 3, failures, coverage: cases, limitations: ['Three samples per case, not exhaustive temporal or aesthetic review', 'Browser interaction and native windows not covered', 'All arbitrary wardrobe Cartesian combinations not enumerated'] };
const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || path.join(root, 'dist/pet-workbench-catalog.json');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ cases: result.cases, frames: result.frames, failures })); if (failures.length) process.exitCode = 1;
