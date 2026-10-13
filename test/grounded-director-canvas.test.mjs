import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Real-canvas, real-director check: a grounded action played as a production
// egg (cue / interaction) stays on the floor exactly like the base preview;
// an essential interruption keeps its own body motion.
const pkg = process.env.USAGI_CANVAS_PACKAGE || process.env.PET_MOTION_CANVAS_PACKAGE;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function topRows(id, skin, director) {
  const backend = createRequire(import.meta.url)(pkg);
  const { installOffscreenImages } = await import(pathToFileURL(root + '/tools/usagi-gallery/offscreen-images.mjs').href); installOffscreenImages(backend);
  globalThis.Path2D ||= backend.Path2D; globalThis.document ||= { createElement: () => backend.createCanvas(1, 1) }; globalThis.window ||= { devicePixelRatio: 2 };
  const { loadSource, createRenderHarness } = await import(pathToFileURL(root + '/tools/usagi-gallery/runtime-harness.mjs').href);
  const module = await import(pathToFileURL(root + '/src/core/pet-presentation.mjs').href);
  const h = createRenderHarness(await loadSource(pathToFileURL(root).href), { skin, view: 'auto', dpr: 2, blink: false, outfit: false,
    director: director && { module, ...director } });
  const d = h.select('action', id).duration, out = [];
  for (let t = 0; t <= d; t += 1000 / 15) {
    h.draw(t); const w = h.body.width, im = h.body.getContext('2d').getImageData(0, 0, w, h.body.height).data;
    let top = -1; for (let i = 3; i < im.length && top < 0; i += 4) if (im[i] > 0) top = Math.floor((i >> 2) / w);
    out.push(top);
  }
  h.dispose?.(); return out;
}
for (const [id, skin] of [['moonwalk', 'usagi'], ['paper-return', 'usagi']]) {
  test(`${id}/${skin}: auto, manual egg == base preview floor; essential interruption differs`, { skip: !pkg && 'needs canvas package env' }, async () => {
    const base = await topRows(id, skin, null);
    assert.deepEqual(await topRows(id, skin, { source: 'cue' }), base, 'auto (cue)');
    assert.deepEqual(await topRows(id, skin, { source: 'interaction' }), base, 'manual (interaction)');
    assert.notDeepEqual(await topRows(id, skin, { source: 'cue', interrupt: true }), base, 'interrupted');
  });
}
