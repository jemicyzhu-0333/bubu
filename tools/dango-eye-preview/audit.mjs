// Offscreen evidence uses the real renderer and unchanged production art.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { traceProductionDraw } from '../dango-scarf-preview/audit.mjs';
import { pixels, difference } from '../usagi-gallery/pixels.mjs';

export const VIEW_CASES = Object.freeze([
  { label: 'FRONT', view: 'front', facing: 1 },
  { label: 'THREE-QUARTER RIGHT', view: 'three-quarter', facing: 1 },
  { label: 'THREE-QUARTER LEFT', view: 'three-quarter', facing: -1 },
  { label: 'BACK / NO FACE', view: 'back', facing: 1 }
]);
export const EXPRESSION_CASES = Object.freeze([
  { label: 'IDLE / NEUTRAL', id: 'life.idle', at: 0, changed: false },
  { label: 'IDLE / CURIOUS BEAT', id: 'life.idle', at: 2600, changed: true },
  { label: 'ATTENTIVE / FAR-EYE HEIGHT', id: 'life.attentive', at: 1800, changed: false, correctedOpen: true },
  { label: 'FOCUS / FAR-EYE HEIGHT', id: 'work.focus', at: 2600, changed: false, correctedFocus: true },
  { label: 'SLEEP / UNCHANGED', id: 'life.sleep', at: 2600, changed: false }
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const files = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(path.join(root, entry.name)).map(file => `${entry.name}/${file}`) : [entry.name]);
const faceCalls = trace => trace.calls.filter(call => /\/eye-(left|right)-|\/face\/eyes-/.test(call.src || ''));
const mouthCalls = trace => trace.calls.filter(call => /\/mouth-|\/face\/mouth-/.test(call.src || ''));
const withoutEyes = trace => trace.calls.filter(call => !faceCalls(trace).includes(call));

export async function makeComparison(backend, baselineRoot) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const sourceFiles = files(path.join(root, 'src'));
  const differences = sourceFiles.filter(file => !fs.existsSync(path.join(baselineRoot, 'src', file))
    || !fs.readFileSync(path.join(root, 'src', file)).equals(fs.readFileSync(path.join(baselineRoot, 'src', file))));
  // The frozen pre-idle source stays immutable. Current regression also includes
  // the separately reviewed focus/wake painter and sleep-boundary correction.
  const expectedDifferences = new Set(['capabilities/companion/presentation/dango-face.mjs',
    'capabilities/companion/presentation/dango-raster-face.mjs',
    'capabilities/companion/presentation/dango-raster-art.mjs',
    'capabilities/companion/presentation/dango-raster-appearance.mjs',
    'surfaces/pet/renderer.mjs', 'surfaces/pet/sleep-transition.mjs', 'surfaces/pet/effect-origin.mjs',
    'surfaces/pet/action-playback.mjs', 'capabilities/companion/presentation/face-choreography.mjs',
    'capabilities/companion/presentation/usagi-contact.mjs',
    'capabilities/companion/presentation/usagi-art.mjs',
    'capabilities/companion/presentation/usagi-effect-origins.mjs',
    'core/pet-action-contact.mjs', 'core/pet-action-vector-poses.mjs']);
  if (!differences.includes('capabilities/companion/presentation/dango-face.mjs')
    || differences.some(file => !expectedDifferences.has(file))) {
    throw Error(`Before renderer has unexpected production differences: ${JSON.stringify(differences)}`);
  }
  if (fs.realpathSync(path.join(baselineRoot, 'assets')) !== fs.realpathSync(path.join(root, 'assets'))) {
    throw Error('Before renderer must share the same actual production assets');
  }
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const sources = await Promise.all([baselineRoot, root].map(directory => loadSource(pathToFileURL(directory).href)));
  const harnesses = [];
  function pair({ view = 'three-quarter', facing = 1, outfit = false, blink = false, expression = 'life.idle' } = {}) {
    return sources.map(source => {
      const harness = createRenderHarness(source, { skin: 'pink', view, facing, dpr: 2, calm: false,
        blink, outfit: outfit ? ['milestone.scarf'] : [] });
      harness.select('expression', expression); harnesses.push(harness); return harness;
    });
  }
  return { backend, pair, sources, evidence: { sourceFilesCompared: sourceFiles.length, differences,
    baselineSamplerSha256: sha256(fs.readFileSync(path.join(baselineRoot, 'src/capabilities/companion/presentation/dango-face.mjs'))),
    correctedSamplerSha256: sha256(fs.readFileSync(path.join(root, 'src/capabilities/companion/presentation/dango-face.mjs'))), sameAssetTree: true },
    dispose() { for (const harness of harnesses) harness.dispose(); } };
}

export function auditRegression(comparison, { drawCell } = {}) {
  const records = [], failures = [];
  for (const [vi, view] of VIEW_CASES.entries()) for (const [ei, expression] of EXPRESSION_CASES.entries()) {
    for (const outfit of [false, true]) {
      const pair = comparison.pair({ ...view, outfit, expression: expression.id });
      pair.forEach(harness => harness.draw(0));
      const traces = pair.map(harness => traceProductionDraw(harness, expression.at));
      const samples = pair.map(harness => pixels(harness.body));
      const idleChanged = expression.changed && view.view !== 'back';
      const focusChanged = expression.correctedFocus && view.view === 'three-quarter';
      const openChanged = expression.correctedOpen && view.view === 'three-quarter';
      const changed = Boolean(idleChanged || focusChanged || openChanged);
      const change = difference(samples[0].image, samples[1].image);
      const sameNonEyeCalls = JSON.stringify(withoutEyes(traces[0])) === JSON.stringify(withoutEyes(traces[1]));
      const sameNearEye = !(focusChanged || openChanged) || JSON.stringify(faceCalls(traces[0])[0]) === JSON.stringify(faceCalls(traces[1])[0]);
      const noFace = view.view === 'back' && traces.every(trace => !faceCalls(trace).length && !mouthCalls(trace).length);
      const record = { view: view.label, expression: expression.id, at: expression.at, outfit, expectedChange: changed,
        changedPixels: change.changedPixels, hashBefore: samples[0].hash, hashAfter: samples[1].hash,
        changeReason: idleChanged ? 'idle-canonical' : focusChanged ? 'focus-far-height' : openChanged ? 'open-far-height' : null,
        sameNonEyeCalls, sameNearEye, noFace, edgePixels: samples.map(sample => sample.edge),
        eyeAssetsBefore: faceCalls(traces[0]).map(call => call.src), eyeAssetsAfter: faceCalls(traces[1]).map(call => call.src) };
      if (!sameNonEyeCalls || !sameNearEye || (changed ? !change.changedPixels : samples[0].hash !== samples[1].hash)
        || samples.some(sample => sample.edge || !sample.occupied) || (view.view === 'back' && !noFace)) failures.push(record);
      records.push(record);
      if (outfit) drawCell?.({ vi, ei, view, expression, pair, record });
      pair.forEach(harness => harness.dispose());
    }
  }
  return { records, failures, changedIdleCases: records.filter(record => record.changeReason === 'idle-canonical').length,
    changedFocusCases: records.filter(record => record.changeReason === 'focus-far-height').length,
    changedOpenCases: records.filter(record => record.changeReason === 'open-far-height').length,
    unchangedCases: records.filter(record => !record.expectedChange).length,
    noFaceBackCases: records.filter(record => record.noFace).length };
}

export async function measureEyes(backend) {
  const records = [];
  for (const view of ['front', 'three-quarter']) for (const state of ['neutral', 'curious']) {
    const eyes = [];
    for (const sprite of DANGO_RASTER.views[view].face.eyes[state]) {
      const bytes = fs.readFileSync(new URL(sprite.src, DANGO_RASTER.baseUrl)), image = await backend.loadImage(bytes);
      const canvas = backend.createCanvas(image.width, image.height), context = canvas.getContext('2d');
      context.drawImage(image, 0, 0); const sample = pixels(canvas);
      const w = (sample.bounds.right - sample.bounds.left + 1) / image.width * sprite.rect[2];
      const h = (sample.bounds.bottom - sample.bounds.top + 1) / image.height * sprite.rect[3];
      eyes.push({ src: sprite.src, sha256: sha256(bytes), rect: sprite.rect, pivot: sprite.pivot,
        occupiedArtWidth: w, occupiedArtHeight: h, aspect: w / h,
        occupiedArtArea: sample.occupied / image.width / image.height * sprite.rect[2] * sprite.rect[3] });
    }
    records.push({ view, state, eyes, heightRatio: eyes[0].occupiedArtHeight / eyes[1].occupiedArtHeight,
      areaRatio: eyes[0].occupiedArtArea / eyes[1].occupiedArtArea,
      widthRatio: eyes[0].occupiedArtWidth / eyes[1].occupiedArtWidth });
  }
  return records;
}

export { faceCalls, withoutEyes, sha256 };
