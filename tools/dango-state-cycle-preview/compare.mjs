import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { createStateCycleDriver } from './driver.mjs';
import { traceFrame, makeFrameMetrics } from './metrics.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package') || !arg('baseline-root')) throw Error('Pass existing canvas and frozen baseline paths');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const root = process.cwd(), baseline = path.resolve(arg('baseline-root'));
const out = path.resolve(arg('out') || 'dist/dango-state-cycle-review');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const sheet = backend.createCanvas(1200, 1468), c = sheet.getContext('2d');
const eyes = backend.createCanvas(1100, 718), e = eyes.getContext('2d');
for (const canvas of [sheet, eyes]) {
  const context = canvas.getContext('2d'); context.fillStyle = '#eef2ed'; context.fillRect(0, 0, canvas.width, canvas.height);
}
function text(context, value, x, y, size = 14) {
  context.fillStyle = '#263a3a'; context.font = `${size}px sans-serif`; context.fillText(value, x, y);
}
text(c, 'SLEEP / WAKE SETTLING · ACTUAL PRODUCTION BEFORE / AFTER', 22, 30, 23);
text(c, '2x enlargement · one continuous retained renderer per version · scarf follows exactly the same body transform', 22, 54);
text(e, 'FOCUS + WAKE · MEASURED FAR-EYE HEIGHT CORRECTION', 22, 30, 23);
text(e, 'Existing glyph, width, center and near eye retained · same actual production painter and timeline', 22, 54);
const boundaryFrames = [[449, 450, 454, 458], [701, 702, 706, 710]];
const metrics = [], changes = [];
for (const [version, sourceRoot] of [baseline, root].entries()) {
  const source = await loadSource(pathToFileURL(sourceRoot).href);
  const driver = createStateCycleDriver(source, { view: 'three-quarter', outfit: ['milestone.scarf'] });
  const measure = makeFrameMetrics();
  for (let frame = 0; frame < 840; frame++) {
    const at = frame / 30 * 1000, trace = traceFrame(driver, at), record = measure(driver, trace, at);
    metrics.push({ version, ...record });
    for (const [phaseIndex, frameIds] of boundaryFrames.entries()) {
      const col = frameIds.indexOf(frame); if (col < 0) continue;
      const x = col * 300, top = 80 + (phaseIndex * 2 + version) * 340;
      c.fillStyle = '#fff'; c.fillRect(x + 6, top, 288, 332);
      text(c, `${version ? 'AFTER' : 'BEFORE'} / ${phaseIndex ? 'Wake' : 'Sleep entry'}`, x + 15, top + 22);
      text(c, `${(at / 1000).toFixed(3)}s`, x + 15, top + 43, 12);
      c.drawImage(driver.body, x - 69, top + 8, 438, 438);
    }
    if ([237, 756].includes(frame)) {
      const row = frame === 237 ? 0 : 1, x = version * 550, top = 80 + row * 304;
      e.fillStyle = '#fff'; e.fillRect(x + 8, top, 534, 294);
      text(e, `${version ? 'AFTER' : 'BEFORE'} / ${row ? 'Wake' : 'Focus'}`, x + 23, top + 26, 18);
      text(e, '99 CSS px body', x + 23, top + 51, 12);
      text(e, '2x / 198 px body', x + 300, top + 51, 12);
      e.drawImage(driver.body, x - 14, top + 96, 219, 219);
      e.drawImage(driver.body, x + 154, top - 50, 438, 438);
    }
  }
  driver.dispose();
}
const old = metrics.filter(record => !record.version), current = metrics.filter(record => record.version);
for (let i = 0; i < old.length; i++) {
  if ((current[i].at >= 15000 && current[i].at < 15240) || (current[i].at >= 23400 && current[i].at < 23640)) continue;
  if (JSON.stringify(old[i].bodyMatrix) !== JSON.stringify(current[i].bodyMatrix)) changes.push(current[i].at);
}
const boundaries = [450, 702].map(frame => ({ at: current[frame].at,
  beforeCenterStepCss: old[frame].bodyCenterStepCss, afterCenterStepCss: current[frame].bodyCenterStepCss }));
if (changes.length || boundaries.some(value => value.afterCenterStepCss !== 0)) throw Error('Root regression failed');
fs.writeFileSync(path.join(out, 'sleep-wake-before-after.png'), sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out, 'focus-wake-eye-before-after.png'), eyes.toBuffer('image/png'));
fs.writeFileSync(path.join(out, 'before-after-evidence.json'), JSON.stringify({ baseline, current: root,
  samples: metrics.length, bodyMatrixDifferencesOutside240ms: changes, boundaries,
  note: 'Production actual painter comparisons; face assets intentionally change only in targeted open-eye cases' }, null, 2));
console.log(JSON.stringify({ samples: metrics.length, bodyMatrixDifferencesOutside240ms: changes, boundaries }, null, 2));
