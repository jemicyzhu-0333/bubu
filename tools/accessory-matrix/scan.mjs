// Accessory fit matrix scanner (offline, production renderer via gallery harness).
// For one appearance item: renders every catalogue action + session activity at
// key frames with and without the item, derives the item's pixel mask, and
// flags fit problems. Output: <out>/<item>.json (+ PNG crops of flagged frames).
// node tools/accessory-matrix/scan.mjs --item=usagi.sunhat --out=dir [--app-root=.] [--frames=...] [--views=auto]
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
import { analyseMask, silhouette, dilate, erode } from './analyse.mjs';
const arg = (n, f) => process.argv.find(v => v.startsWith(`--${n}=`))?.slice(n.length + 3) || f;
const root = path.resolve(arg('app-root', path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')));
const out = path.resolve(arg('out', path.join(root, 'dist/accessory-matrix'))); fs.mkdirSync(out, { recursive: true });
const backend = createRequire(root + '/')('@napi-rs/canvas');
const { installOffscreenImages } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/offscreen-images.mjs'))); installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D; globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/runtime-harness.mjs')));
const source = await loadSource(pathToFileURL(root).href);
const { PET_ACTIONS } = await import(pathToFileURL(path.join(root, 'src/content/behaviors.mjs')));
const { SESSION_ACTIVITIES } = await import(pathToFileURL(path.join(root, 'src/content/session-activities.mjs')));
const { PET_APPEARANCE_ITEMS } = await import(pathToFileURL(path.join(root, 'src/content/appearance.mjs')));
const itemIds = arg('item', '').split(',').filter(Boolean);
const items = itemIds.map(id => PET_APPEARANCE_ITEMS.find(i => i.id === id) || (() => { throw Error('unknown item ' + id); })());
const formId = items[0].formId || 'dango', skin = arg('skin', formId === 'usagi' ? 'usagi' : 'pink');
const frames = arg('frames', '.08,.25,.42,.58,.75,.92').split(',').map(Number);
const views = arg('views', 'auto').split(',');
const label = arg('label', itemIds.join('+'));
const floats = items.every(i => /aura|halo/.test(i.exclusiveGroup) || /halo|constellation/.test(i.renderKey));
const targets = [...Object.keys(PET_ACTIONS).map(id => ['action', id]), ...Object.keys(SESSION_ACTIVITIES).map(id => ['session', id]), ['expression', 'life.idle']];
const read = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
const records = [];
for (const view of views) {
  const base = createRenderHarness(source, { skin, view, dpr: 2, blink: false, outfit: false });
  const worn = createRenderHarness(source, { skin, view, dpr: 2, blink: false, outfit: itemIds });
  for (const [kind, id] of targets) {
    let d0, d1; try { d0 = base.select(kind, id).duration; d1 = worn.select(kind, id).duration; } catch (e) { records.push({ kind, id, view, error: String(e.message) }); continue; }
    const rows = [];
    for (const f of (kind === 'expression' ? [.5] : frames)) {
      const at = f * d0; base.draw(at); worn.draw(at);
      const a = read(base.body), b = read(worn.body);
      const m = analyseMask(a, b, { floats });
      rows.push({ f, ...m.metrics });
      if (m.flags.length) {
        // Save a crop pair for review.
        const name = `${label}__${kind}-${id}__${view}__${f}.png`.replace(/[^\w.+-]/g, '_');
        const c = backend.createCanvas(a.width * 2, a.height), x = c.getContext('2d');
        x.fillStyle = '#f1f3ee'; x.fillRect(0, 0, c.width, c.height); x.drawImage(base.body, 0, 0); x.drawImage(worn.body, a.width, 0);
        x.fillStyle = 'rgba(255,0,80,.55)'; for (const [px, py] of m.flagPixels) x.fillRect(a.width + px, py, 1, 1);
        x.fillStyle = '#b00020'; x.font = '13px sans-serif'; x.fillText(`${kind}:${id} ${view} p=${f} ${m.flags.join(',')}`, 6, 14);
        fs.mkdirSync(path.join(out, 'flags'), { recursive: true }); fs.writeFileSync(path.join(out, 'flags', name), c.toBuffer('image/png'));
        rows.at(-1).png = 'flags/' + name; rows.at(-1).flags = m.flags;
      }
    }
    const areas = rows.map(r => r.area).filter(v => v >= 0).sort((p, q) => p - q), median = areas[Math.floor(areas.length / 2)] || 0;
    const popping = median > 40 && rows.some(r => r.area < median * .3);
    records.push({ kind, id, view, median, popping, rows });
  }
  base.dispose(); worn.dispose();
}
fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify({ items: itemIds, formId, skin, floats, frames, records }));
console.log(label, records.length);
