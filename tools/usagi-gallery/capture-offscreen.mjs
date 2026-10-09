// Optional diagnostic runner. Uses the exact production renderer with a real
// Skia Canvas/Path2D backend; this is NOT a browser/Electron screenshot.
// Dependency is supplied explicitly, so no production dependency or lockfile changes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from './offscreen-images.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const packagePath = arg('canvas-package');
if (!packagePath) throw new Error('Pass --canvas-package=/path/to/node_modules/@napi-rs/canvas');
const require = createRequire(import.meta.url), backend = require(packagePath);
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement(tag) { if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
  return backend.createCanvas(1, 1); } };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource } = await import('./runtime-harness.mjs');
const { renderStrip } = await import('./capture-core.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselineRoot = path.resolve(arg('baseline') || root);
const baseline = await loadSource(pathToFileURL(baselineRoot).href), current = await loadSource(pathToFileURL(root).href);
const dango = arg('form') === 'dango', skin = arg('skin') || 'pink';
const variants = dango ? [
  { id: 'baseline', label: 'DANGO BEFORE', source: baseline, skin },
  { id: 'current', label: 'DANGO REDESIGN', source: current, skin }
] : [{ id: 'dango', label: 'DANGO BASELINE', source: baseline, skin: 'pink' },
  { id: 'baseline', label: 'USAGI BASELINE', source: baseline, skin: 'usagi' },
  { id: 'current', label: 'USAGI CURRENT', source: current, skin: 'usagi' }];
const catalog = { action: Object.values(current.behaviors.PET_ACTIONS), session: Object.values(current.sessions.SESSION_ACTIVITIES),
  expression: current.expressions.EXPRESSIONS, scene: Object.values(current.scenes.SCENES),
  appearance: current.wardrobe.PET_APPEARANCE_ITEMS.filter(item => (item.formId || 'dango') === (dango ? 'dango' : 'usagi')),
  status: [{ id: 'hungry' }, { id: 'coffee' }] };
const out = path.resolve(arg('out') || 'dist/usagi-gallery-offscreen'); fs.mkdirSync(out, { recursive: true });
const kinds = (arg('kinds') || 'action,session,expression,scene').split(',');
const filter = arg('ids')?.split(','), variantIds = (arg('variants') || (dango ? 'baseline,current' : 'dango,baseline,current')).split(',');
const entries = [], errors = [], start = Date.now();
for (const kind of kinds) for (const item of catalog[kind]) {
  if (filter && !filter.includes(item.id)) continue;
  const options = { variants: kind === 'appearance' ? ['current'] : variantIds,
    frames: Number(arg('frames') || 9), dense: process.argv.includes('--dense'),
    dpr: Number(arg('dpr') || 2), scene: arg('scene') || 'cozy-room', view: arg('view') || 'auto',
    outfit: arg('outfit-ids')?.split(',') || !process.argv.includes('--bare'),
    calm: process.argv.includes('--calm'), level: 25 };
  try {
    const result = renderStrip(variants, kind, item.id, options);
    for (const strip of result.strips) {
      const file = `${kind}/${item.id}-${strip.variant}.png`; fs.mkdirSync(path.join(out, kind), { recursive: true });
      fs.writeFileSync(path.join(out, file), Buffer.from(strip.dataUrl.split(',')[1], 'base64'));
    }
    entries.push(...result.metadata);
    console.log(`${kind} ${item.id}: ${result.metadata.map(m => `${m.variant} ${m.summary.uniqueFrames}/${m.summary.frames} body, ${m.face.uniqueFrames}/${m.face.frames} face`).join(' | ')}`);
  } catch (error) { errors.push({ kind, id: item.id, error: error.stack }); console.error(error.stack); }
  globalThis.gc?.();
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    renderer: 'Offscreen Skia Canvas / exact production createPetRenderer / real Path2D; browser page unverified',
    form: dango ? 'dango' : 'usagi', baselineCommit: arg('baseline-commit') || null,
    baselineRef: arg('baseline-ref') || (baselineRoot === root ? 'current-source' : 'unversioned-local-source'),
    backend: require(path.join(packagePath, 'package.json')).version,
    node: process.version, elapsedSeconds: (Date.now() - start) / 1000, entries, errors }, null, 2));
}
console.log(`Captured ${entries.length} sequences (${errors.length} errors) → ${out}`);
if (errors.length) process.exitCode = 1;
