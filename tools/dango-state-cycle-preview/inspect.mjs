import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { traceProductionDraw } from '../dango-scarf-preview/audit.mjs';
import { pixels, difference } from '../usagi-gallery/pixels.mjs';
import { createStateCycleDriver, CYCLE_DURATION_MS, phaseAt } from './driver.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-state-cycle-review'));
fs.mkdirSync(out, { recursive: true });
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
const driver = createStateCycleDriver(source, { view: 'three-quarter', outfit: ['milestone.scarf'] });
let previous = null;
const records = [], sheets = new Map();
for (let frame = 0; frame <= CYCLE_DURATION_MS / 1000 * 30; frame++) {
  const at = frame * 1000 / 30, trace = traceProductionDraw(driver, at), sample = pixels(driver.body);
  const change = difference(previous?.image, sample.image);
  const bodyCall = trace.calls.find(call => !call.src);
  const bounds = sample.bounds;
  const record = { at, expression: driver.state.currentExprId, phase: phaseAt(at).label,
    bounds, change, body: bodyCall, scarf: trace.scarf, eyeMask: driver.state.currentRenderedEyeMask,
    maxBoundStep: previous ? Math.max(...Object.keys(bounds).map(k => Math.abs(bounds[k] - previous.bounds[k]))) / 2 : 0 };
  records.push(record);
  for (const switchAt of [5200, 11200, 15000, 23400]) {
    const delta = Math.round(at - switchAt);
    if (![-67,-33,0,33,67,100,200,400].includes(delta)) continue;
    if (!sheets.has(switchAt)) {
      const sheet = backend.createCanvas(1760, 440), ctx = sheet.getContext('2d');
      ctx.fillStyle = '#eef2ed'; ctx.fillRect(0, 0, 1760, 440);
      sheets.set(switchAt, { sheet, ctx, column: 0 });
    }
    const entry = sheets.get(switchAt), x = entry.column++ * 220;
    entry.ctx.drawImage(driver.body, x, 24, 438, 438);
    entry.ctx.fillStyle = '#263a3a'; entry.ctx.font = '15px sans-serif';
    entry.ctx.fillText(`${(at / 1000).toFixed(3)}s / ${record.eyeMask}`, x + 8, 22);
  }
  previous = sample;
}
for (const [at, value] of sheets) fs.writeFileSync(path.join(out, `raw-transition-${at}.png`), value.sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out, 'raw-transition-metrics.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify(records.filter((r, i) => i && r.expression !== records[i - 1].expression), null, 2));
driver.dispose();
