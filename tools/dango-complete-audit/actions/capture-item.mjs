// One item per process bounds diagnostic resources. This runs the production
// createPetRenderer, not a second character painter or native-window test.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
import { catalog, proofTimes } from './catalog.mjs';
import { framePixels } from '../../dango-frequency-audit/audit.mjs';
import { sampleActivityStory } from '../../../src/capabilities/companion/presentation/activity-playback.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const relevantFiles = ['src/core/dango-view-policy.mjs', 'src/core/pet-action-vector.mjs', 'src/core/pet-action-contact.mjs',
  'src/core/pet-action-vector-poses.mjs', 'src/capabilities/companion/presentation/dango-raster-pose.mjs',
  'src/capabilities/companion/presentation/dango-raster-actions.mjs', 'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'src/capabilities/companion/presentation/dango-raster-appearance.mjs', 'src/capabilities/companion/presentation/dango-face.mjs',
  'src/capabilities/companion/presentation/activity-playback.mjs', 'src/content/companion/activity-stories.mjs',
  'src/content/companion/dango-action-views.mjs', 'src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/action-playback.mjs',
  'src/surfaces/pet/effect-origin.mjs',
  'src/capabilities/companion/presentation/dango-raster-face.mjs', 'src/capabilities/companion/presentation/face-choreography.mjs',
  'src/capabilities/companion/presentation/expression-phrases.mjs', 'src/capabilities/companion/presentation/dango-raster-production.mjs',
  'src/capabilities/companion/presentation/dango-raster-lookback.mjs', 'src/capabilities/companion/presentation/dango-raster-roots.mjs',
  'src/capabilities/companion/presentation/dango-raster-ground.mjs', 'src/capabilities/companion/presentation/dango-performance.mjs',
  'src/core/pet-running-pose.mjs', 'src/core/pet-session-motion.mjs', 'src/core/pet-action-art.mjs',
  'src/content/behaviors.mjs', 'src/content/session-activities.mjs', 'src/content/expressions.mjs',
  'assets/companion/dango/raster/dango.raster.mjs'];
const sourceHashes = () => Object.fromEntries(relevantFiles.map(file => [file,
  createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const hashes = sourceHashes();
const backend = createRequire(import.meta.url)(arg('canvas-package'));
backend.GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');
backend.GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'sans-serif');
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href);
const entry = catalog.find(value => value.kind === arg('kind') && value.id === arg('id'));
if (!entry) throw new Error('Select one catalog kind/id');
const out = path.resolve(arg('out') || `dist/dango-complete-audit/actions/${entry.kind}/${entry.id}`);
fs.mkdirSync(out, { recursive: true });
// An interrupted overwrite must not leave an old success record beside a
// partial video; resume trusts only a record written after encoder completion.
fs.rmSync(path.join(out, 'record.json'), { force: true });
const fps = Number(arg('fps') || 30), proof = proofTimes(entry), startMs = Number(arg('start-ms') || 0);
const endMs = Math.min(entry.durationMs, Number(arg('end-ms') || entry.durationMs));
const harness = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: arg('view') || 'auto', facing: Number(arg('facing') || 1) });
harness.select(entry.kind, entry.id);
const screen = backend.createCanvas(720, 510), ctx = screen.getContext('2d');
const composite = backend.createCanvas(440, 440);
const file = path.join(out, 'normal-speed.mp4');
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
  '-s', `${screen.width}x${screen.height}`, '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
  '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
let encodingErrors = ''; encoder.stderr.on('data', value => { encodingErrors += value; });
const exited = once(encoder, 'exit');
const frames = [], proofFrames = [], frameCount = Math.ceil((endMs - startMs) / 1000 * fps);
const keyIndices = new Map(proof.map((sample, index) => [Math.round(sample.atMs / 1000 * fps), { ...sample, index }]));
for (let index = 0; index < frameCount; index++) {
  const atMs = startMs + index / fps * 1000;
  const result = harness.draw(atMs); harness.composite(composite);
  ctx.fillStyle = '#e9edef'; ctx.fillRect(0, 0, screen.width, screen.height);
  ctx.fillStyle = '#263642'; ctx.font = '16px sans-serif';
  ctx.fillText(`${entry.kind} / ${entry.id}`, 15, 25);
  ctx.font = '12px sans-serif'; ctx.fillText(`${(atMs / 1000).toFixed(2)} / ${(entry.durationMs / 1000).toFixed(1)} sec · actual renderer · 1× speed`, 15, 45);
  ctx.drawImage(composite, 12, 145, 220, 220); ctx.drawImage(composite, 265, 60, 440, 440);
  ctx.fillText('99 CSS px body design width', 12, 392); ctx.fillText('2× inspection', 275, 490);
  const state = result.state;
  const actionSample = sampleActivityStory(entry.kind === 'expression' ? null : entry.item, atMs / entry.durationMs);
  const renderedAction = actionSample.action;
  {
    const pixels = framePixels(harness.body);
    frames.push({ atMs, hash: pixels.hash, occupied: pixels.occupied, edge: pixels.edge, bounds: pixels.bounds,
      motion: renderedAction?.motion || null, prop: renderedAction?.prop || null,
      phase: actionSample.phase, eye: state.currentRenderedEyeMask });
  }
  if (keyIndices.has(index)) {
    const sample = keyIndices.get(index), name = `frame-${String(sample.index).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(out, name), harness.body.toBuffer('image/png'));
    proofFrames.push({ ...sample, atMs, file: name, eye: state.currentRenderedEyeMask });
  }
  const rgba = ctx.getImageData(0, 0, screen.width, screen.height).data;
  if (!encoder.stdin.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited;
if (code) throw new Error(encodingErrors || `ffmpeg exited ${code}`);
harness.dispose();

// Authored contact/story phases across every supported effective view. Aliases
// and rejected requests are listed separately, never counted as new views.
const views = [...new Set(entry.views.map(value => value.effective))];
const phaseProofs = [];
for (const view of views) {
  const h = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view }); h.select(entry.kind, entry.id);
  const columns = entry.story ? 3 : 7, rows = Math.ceil(proof.length / columns);
  const sheet = backend.createCanvas(columns * 230, rows * 278 + 40), s = sheet.getContext('2d');
  s.fillStyle = '#eef0ef'; s.fillRect(0, 0, sheet.width, sheet.height);
  s.fillStyle = '#263642'; s.font = '15px sans-serif'; s.fillText(`${entry.kind}/${entry.id} · ${view} · 99 CSS px body`, 12, 24);
  let cursor = 0;
  for (const [i, sample] of proof.entries()) {
    while (cursor < sample.atMs) { h.draw(cursor); cursor += 1000 / fps; }
    const result = h.draw(sample.atMs), x = i % columns * 230, y = 40 + Math.floor(i / columns) * 278;
    s.drawImage(h.body, x + 5, y + 10, 219, 219);
    s.fillStyle = '#263642'; s.font = '11px sans-serif';
    s.fillText(`${(sample.atMs / 1000).toFixed(2)}s · ${entry.story ? `stage ${Math.floor(i / 3) + 1}` : 'action'}`, x + 6, y + 244);
    const sampled = sampleActivityStory(entry.kind === 'expression' ? null : entry.item, sample.atMs / entry.durationMs);
    s.fillText(`${sampled.action?.motion || result.state.currentRenderedEyeMask}`, x + 6, y + 263);
  }
  const name = `phases-${view}.png`; fs.writeFileSync(path.join(out, name), sheet.toBuffer('image/png'));
  phaseProofs.push({ view, file: name, samples: proof.length }); h.dispose(); sheet.width = 1; sheet.height = 1;
}
const requestProofs = [];
for (const { requested, effective } of entry.views) {
  const h = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: requested, blink: false });
  h.select(entry.kind, entry.id); h.draw(0); h.draw(entry.durationMs * .5);
  const pixels = framePixels(h.body);
  requestProofs.push({ requested, effective, hash: pixels.hash, occupied: pixels.occupied, edge: pixels.edge });
  h.dispose();
}
const endHashes = sourceHashes();
const record = { ...entry, renderer: 'Exact createPetRenderer with existing offscreen Skia; native desktop unverified',
  generatedAt: new Date().toISOString(), sourceHashes: hashes, fps, frameCount, clip: 'normal-speed.mp4',
  videoView: arg('view') || 'auto', videoFacing: Number(arg('facing') || 1),
  node: process.version, backendVersion: createRequire(import.meta.url)(path.join(arg('canvas-package'), 'package.json')).version,
  captureToolSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  sourcesChangedDuringCapture: relevantFiles.filter(file => hashes[file] !== endHashes[file]),
  bodyDesignWidthCssPx: 99, stageCssPx: 219, proofFrames, phaseProofs, requestProofs, frames,
  checks: { checkedFrames: frames.length, blankFrames: frames.filter(value => !value.occupied).length,
    edgeFrames: frames.filter(value => value.edge).length,
    requestFallbackMismatches: requestProofs.filter(value => value.hash !== requestProofs.find(other => other.requested === value.effective)?.hash).length },
  review: { status: 'rendered-awaiting-visual-review', findings: [] } };
fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ kind: entry.kind, id: entry.id, frameCount, views, ...record.checks, out }));
