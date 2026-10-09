// Bounded production-renderer evidence for the three activity mirrors.
// Uses local decoded images only; no native-window/GPU acceptance is implied.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';
import { resolveActionPlayback } from '../../src/surfaces/pet/action-playback.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/mirror-art-review'));
const canvasPackage = arg('canvas-package') || process.env.USAGI_CANVAS_PACKAGE;
if (!canvasPackage) throw Error('Pass the path to an installed Canvas backend');
const backend = createRequire(import.meta.url)(canvasPackage);
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
// The historical gallery selector only lists ordinary sessions. The diagnostic
// catalog includes mirrors exactly as the production activity controller does.
const diagnostic = { ...source, sessions: { ...source.sessions,
  SESSION_ACTIVITIES: { ...source.sessions.SESSION_ACTIVITIES, ...source.sessions.MIRROR_ACTIVITIES } } };
const { USAGI_OUTFIT_SETS } = await import('../../src/content/companion/usagi-wardrobe.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pinned = [
  'src/content/session-activities.mjs', 'src/content/companion/dango-action-views.mjs',
  'src/core/pet-action-contact.mjs', 'src/core/pet-action-vector.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'src/capabilities/companion/presentation/dango-raster-paws.mjs',
  'src/capabilities/companion/presentation/dango-raster-browse.mjs',
  'src/capabilities/companion/presentation/rig/props.mjs',
  'src/capabilities/companion/presentation/usagi-contact-limbs.mjs',
  'src/capabilities/companion/presentation/usagi-art.mjs',
  'src/capabilities/companion/presentation/form-art.mjs',
  'src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/action-playback.mjs',
  'assets/companion/dango/raster/dango.raster.mjs', 'assets/companion/usagi/rig/usagi.rig.mjs',
  'tools/mirror-art-review/capture.mjs', 'tools/usagi-gallery/runtime-harness.mjs'
];
const sourceHashes = Object.fromEntries(pinned.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
const phases = [0, .125, .375, .625, .875, .999, 1.001];
const report = { sourceHashes, renderer: 'createPetRenderer via retained local-image gallery harness',
  dimensions: '219 CSS px stage, 99 CSS px body design width; transparent source files at exact DPR1/2',
  limitations: ['Bounded frame sampling, not continuous human playback', 'Gallery catalog is augmented with the unchanged mirror records',
    'Body canvas includes native props/wardrobe but excludes independent scene and overlay canvases',
    'No native Electron window, browser input, OS DPI, GPU or memory acceptance'], cases: [], sheets: [] };
fs.mkdirSync(out, { recursive: true });
const write = (name, bytes) => {
  fs.writeFileSync(path.join(out, name), bytes);
  return { file: name, sha256: sha(bytes), bytes: bytes.length };
};
for (const skin of ['pink', 'usagi']) for (const dpr of [1, 2]) for (const equipped of [false, true]) {
  const outfit = !equipped ? [] : skin === 'pink' ? ['milestone.scarf', 'milestone.sunhat', 'milestone.boots']
    : USAGI_OUTFIT_SETS.find(set => set.id === 'sun-garden').itemIds;
  const group = `${skin}-${dpr}x-${equipped ? 'outfit' : 'bare'}`;
  const cell = 219, rowHeight = cell + 35, sheet = backend.createCanvas(cell * 8, 42 + rowHeight * 6);
  const context = sheet.getContext('2d');
  context.fillStyle = '#e9efec'; context.fillRect(0, 0, sheet.width, sheet.height);
  context.fillStyle = '#203433'; context.font = '16px sans-serif';
  context.fillText(`${group} | native CSS size | 0 / 12.5 / 37.5 / 62.5 / 87.5 / 99.9 / 100.1% / calm`, 10, 26);
  let row = 0;
  for (const action of Object.values(source.sessions.MIRROR_ACTIVITIES)) for (const facing of [1, -1]) {
    const view = facing === 1 ? 'front' : 'three-quarter';
    const h = createRenderHarness(diagnostic, { skin, dpr, view, facing, outfit, blink: false });
    h.select('session', action.id);
    const effectiveView = source.formArt.resolveView(h.form, view, { action, state: action.state });
    const entry = { group, id: action.id, semanticProp: action.prop, durationMs: action.durationMs,
      skin, dpr, outfit, requestedView: view, effectiveView, facing, frames: [] };
    try {
      for (const [column, phase] of phases.entries()) {
        const at = action.durationMs * phase, frame = h.draw(at);
        const playback = resolveActionPlayback({ content: diagnostic.sessions, form: h.form,
          preview: frame.state.devPreview, sessionSnapshot: { activity: action, progress: phase }, now: at });
        assert.equal(playback.actionConfig.id, action.id);
        assert.equal(playback.actionConfig.prop, action.prop);
        assert.equal(frame.state.currentActionProgress, playback.actionT);
        const sampled = pixels(h.body);
        assert.ok(sampled.occupied > 0); assert.equal(sampled.edge, 0, `${group}/${action.id}/${phase} clips stage`);
        const bytes = h.body.toBuffer('image/png');
        const asset = write(`${group}-${action.id}-${facing}-${column}.png`, bytes);
        entry.frames.push({ ...asset, phase, at, actualProgress: frame.state.currentActionProgress,
          occupied: sampled.occupied, edge: sampled.edge, bounds: sampled.bounds, pixelHash: sampled.hash });
        context.fillStyle = row % 2 ? '#f6f8f7' : '#e5ede8';
        context.fillRect(column * cell, 42 + row * rowHeight, cell, rowHeight);
        context.drawImage(await backend.loadImage(bytes), column * cell, 42 + row * rowHeight + 27, cell, cell);
        context.fillStyle = '#203433'; context.font = '11px sans-serif';
        context.fillText(`${action.id} ${effectiveView} ${facing < 0 ? 'left' : 'right'}`, column * cell + 5, 42 + row * rowHeight + 17);
      }
      const calm = createRenderHarness(diagnostic, { skin, dpr, view, facing, outfit, calm: true, blink: false });
      calm.select('session', action.id);
      try {
        calm.draw(action.durationMs * .1); const a = pixels(calm.body);
        calm.draw(action.durationMs * .9); const b = pixels(calm.body);
        assert.equal(a.hash, b.hash, 'calm output must be independent of progress');
        assert.ok(b.occupied > 0); assert.equal(b.edge, 0);
        const bytes = calm.body.toBuffer('image/png');
        entry.calm = { ...write(`${group}-${action.id}-${facing}-calm.png`, bytes), occupied: b.occupied, edge: b.edge,
          bounds: b.bounds, stable: a.hash === b.hash };
        context.drawImage(await backend.loadImage(bytes), 7 * cell, 42 + row * rowHeight + 27, cell, cell);
      } finally { calm.dispose(); }
    } finally { h.dispose(); }
    report.cases.push(entry); row++;
  }
  report.sheets.push(write(`${group}-sheet.png`, sheet.toBuffer('image/png')));
  sheet.width = 1; sheet.height = 1;
}
for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(fs.readFileSync(path.join(root, file))), hash, `source changed: ${file}`);
report.summary = { cases: report.cases.length, sampledFrames: report.cases.length * (phases.length + 2),
  savedFrames: report.cases.length * (phases.length + 1), blankFrames: 0, edgeTouchFrames: 0,
  calmStableCases: report.cases.filter(item => item.calm.stable).length, sheets: report.sheets.length };
write('evidence.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
console.log(JSON.stringify({ out, ...report.summary }));
