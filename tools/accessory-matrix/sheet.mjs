// Contact sheet: one outfit (or item) across every action/session at 3 frames.
// node tools/accessory-matrix/sheet.mjs --item=a,b --label=x --view=auto --out=dir [--app-root=.]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const arg = (n, f) => process.argv.find(v => v.startsWith(`--${n}=`))?.slice(n.length + 3) || f;
const root = path.resolve(arg('app-root', path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')));
const out = path.resolve(arg('out', 'dist/accessory-sheets')); fs.mkdirSync(out, { recursive: true });
const backend = createRequire(root + '/')('@napi-rs/canvas');
const { installOffscreenImages } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/offscreen-images.mjs'))); installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D; globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/runtime-harness.mjs')));
const source = await loadSource(pathToFileURL(root).href);
const { PET_ACTIONS } = await import(pathToFileURL(path.join(root, 'src/content/behaviors.mjs')));
const { SESSION_ACTIVITIES } = await import(pathToFileURL(path.join(root, 'src/content/session-activities.mjs')));
const items = arg('item', '').split(',').filter(Boolean), skin = arg('skin', items[0]?.startsWith('usagi') ? 'usagi' : 'pink');
const view = arg('view', 'auto'), frames = arg('frames', '.25,.5,.75').split(',').map(Number), label = arg('label', items.join('+'));
const targets = [...Object.keys(PET_ACTIONS).map(id => ['action', id]), ...Object.keys(SESSION_ACTIVITIES).map(id => ['session', id])];
const cols = 4, cell = 150, per = frames.length, rows = Math.ceil(targets.length / cols);
const c = backend.createCanvas(cols * per * cell, rows * (cell + 16) + 30), x = c.getContext('2d');
x.fillStyle = '#f6f7f3'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#222'; x.font = 'bold 18px sans-serif'; x.fillText(`${label} · ${skin} · view=${view}`, 8, 22);
const h = createRenderHarness(source, { skin, view, dpr: 2, blink: false, outfit: items.length ? items : false });
for (const [i, [kind, id]] of targets.entries()) {
  const d = h.select(kind, id).duration, cx = (i % cols) * per * cell, cy = 30 + Math.floor(i / cols) * (cell + 16);
  for (const [k, f] of frames.entries()) { h.draw(f * d); x.drawImage(h.body, 40, 0, 358, 358, cx + k * cell, cy, cell, cell); }
  x.fillStyle = '#333'; x.font = '12px sans-serif'; x.fillText(`${id}`, cx + 4, cy + cell + 12);
  x.strokeStyle = '#ccc'; x.strokeRect(cx, cy, per * cell, cell + 16);
}
h.dispose(); fs.writeFileSync(path.join(out, `${label}-${view}.png`), c.toBuffer('image/png')); console.log(path.join(out, `${label}-${view}.png`));
