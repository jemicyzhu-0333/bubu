import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { createStateCycleDriver, CYCLE_PHASES, CYCLE_DURATION_MS, phaseAt } from './driver.mjs';
import { traceFrame, makeOverlapMeasure, makeFrameMetrics, summarizeCase, sha256 } from './metrics.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package')) throw Error('Pass an already installed @napi-rs/canvas path');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-state-cycle-review'));
fs.mkdirSync(out, { recursive: true });
const part = arg('part');
// Each visual batch has its own process lifetime. This is capture-tool resource
// containment, not evidence of native application memory behavior.
if (!part) {
  const reports = [];
  for (const selected of ['main', 'front', 'mirrored', 'auto']) {
    const result = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2), `--part=${selected}`], { stdio: 'inherit' });
    if (result.status !== 0) throw Error(`Visual batch ${selected} failed: ${result.status ?? result.signal}`);
    reports.push(JSON.parse(fs.readFileSync(path.join(out, `evidence-${selected}.json`))));
  }
  if (reports.some(report => JSON.stringify(report.sourceHashes) !== JSON.stringify(reports[0].sourceHashes))) {
    throw Error('Sources changed between visual batches');
  }
  const cases = reports.flatMap(report => report.cases);
  const evidence = { ...reports[0], cases, samples: cases.reduce((sum, value) => sum + value.frames, 0),
    captureBatches: ['main', 'front', 'mirrored', 'auto'],
    summary: { blankFrames: cases.reduce((sum, value) => sum + value.blankFrames, 0),
      clippedFrames: cases.reduce((sum, value) => sum + value.clippedFrames, 0),
      maxScarfBodyMatrixDifference: Math.max(...cases.map(value => value.maxScarfBodyMatrixDifference)),
      maxFaceClothOverlap: Math.max(...cases.map(value => value.maxFaceClothOverlap)) },
    assets: [...new Map(reports.flatMap(report => report.assets).map(asset => [asset.file, asset])).values()] };
  const combined = backend.createCanvas(1200, 916), context = combined.getContext('2d');
  context.drawImage(await backend.loadImage(path.join(out, 'front-view-check.png')), 0, 0);
  context.drawImage(await backend.loadImage(path.join(out, 'mirrored-view-check.png')), 0, 484, 1200, 400, 0, 484, 1200, 400);
  fs.writeFileSync(path.join(out, 'front-mirrored-view-check.png'), combined.toBuffer('image/png'));
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ out, videoBytes: evidence.video.bytes, samples: evidence.samples, summary: evidence.summary }, null, 2));
  process.exit(0);
}
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
const fps = 30, frames = CYCLE_DURATION_MS / 1000 * fps;
const width = 1000, height = 784, paper = '#eef2ed', ink = '#263a3a', muted = '#52645f';
const screen = backend.createCanvas(width, height), ctx = screen.getContext('2d');
const phases = [3000, 7900, 12400, 19000, 25200];
const proof = backend.createCanvas(1400, 1448), proofCtx = proof.getContext('2d');
const supplemental = backend.createCanvas(1200, 916), supplementalCtx = supplemental.getContext('2d');
for (const [c, w, h] of [[proofCtx, 1400, 1448], [supplementalCtx, 1200, 916]]) {
  c.fillStyle = paper; c.fillRect(0, 0, w, h);
}
function label(c, text, x, y, size = 14, color = muted) {
  c.fillStyle = color; c.font = `${size}px sans-serif`; c.fillText(text, x, y);
}
label(proofCtx, 'CONTINUOUS PRODUCTION PAINTER / KEYFRAMES', 22, 32, 23, ink);
label(proofCtx, 'One retained renderer, blink scheduler, springs, cache and channel per outfit / selected semantic expressions', 22, 58);
label(supplementalCtx, 'VIEW CHECK / FRONT + MIRRORED THREE-QUARTER', 22, 32, 23, ink);
label(supplementalCtx, 'Existing single scarf / full 28-second cycle sampled at 30 fps / selected focus, sleep, wake keyframes', 22, 58);
const pinnedSources = [
  'src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/frame-context.mjs', 'src/surfaces/pet/sleep-transition.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'src/capabilities/companion/presentation/dango-raster-pose.mjs',
  'src/capabilities/companion/presentation/dango-raster-face.mjs',
  'src/capabilities/companion/presentation/dango-face.mjs',
  'src/content/expressions.mjs', 'src/capabilities/companion/presentation/expression-phrases.mjs',
  'tools/usagi-gallery/runtime-harness.mjs', 'assets/companion/dango/raster/dango.raster.mjs',
  'tools/dango-state-cycle-preview/driver.mjs', 'tools/dango-state-cycle-preview/capture.mjs',
  'tools/dango-state-cycle-preview/metrics.mjs'
];
const sourceHashes = pinnedSources.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
const cases = [], assets = new Map();
const make = (view, facing, scarf) => ({ key: `${view}-${facing === -1 ? 'left' : 'right'}-${scarf ? 'scarf' : 'bare'}`,
  view, facing, scarf, driver: createStateCycleDriver(source, { view, facing, outfit: scarf ? ['milestone.scarf'] : [] }),
  measure: makeFrameMetrics(), overlap: makeOverlapMeasure(backend, 438, 438), records: [], diagnostic: [] });
const entries = part === 'main' ? [make('three-quarter', 1, false), make('three-quarter', 1, true)] : [];
function sample(entry, at, frame) {
  const trace = traceFrame(entry.driver, at), record = entry.measure(entry.driver, trace, at);
  const boundary = CYCLE_PHASES.some(phase => Math.abs(at - phase.start) <= 240);
  if (frame % 15 === 0 || boundary) entry.diagnostic.push({ at, phase: record.phase, ...entry.overlap.sample(trace.calls) });
  for (const call of trace.calls) if (call.src && !assets.has(call.src)) assets.set(call.src,
    { file: path.relative(root, fileURLToPath(call.src)), sha256: sha256(fs.readFileSync(fileURLToPath(call.src))) });
  entry.records.push(record);
  if (!record.occupied || record.edge) throw Error(`Blank or clipped frame: ${entry.key} at ${at}`);
  if (record.scarfLayers !== (entry.scarf ? 2 : 0) || record.maxScarfBodyMatrixDifference > .00001) {
    throw Error(`Scarf layer or attachment discontinuity: ${entry.key} at ${at}`);
  }
  return record;
}
function paintVideo(at) {
  ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height);
  label(ctx, 'DANGO / IDLE → FOCUS → IDLE → SLEEP → WAKE', 24, 32, 23, ink);
  label(ctx, 'NORMAL SPEED / selected existing expressions / continuous production painter', 24, 57);
  label(ctx, `${(at / 1000).toFixed(2)}s · ${phaseAt(at).label}`, 752, 57, 16, ink);
  for (const [index, entry] of entries.entries()) {
    const top = 80 + index * 298;
    ctx.fillStyle = 'white'; ctx.fillRect(16, top, width - 32, 286);
    label(ctx, entry.scarf ? 'EXISTING SINGLE SCARF' : 'BARE BODY', 34, top + 29, 17, ink);
    label(ctx, '99 CSS px body design width', 108, top + 57, 13);
    label(ctx, '2× / 198 px body design width', 466, top + 29, 13);
    ctx.strokeStyle = '#d0d9d1'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(34, top + 254); ctx.lineTo(962, top + 254); ctx.stroke();
    ctx.drawImage(entry.driver.body, 113, top + 88, 219, 219);
    ctx.drawImage(entry.driver.body, 477, top - 68, 438, 438);
    label(ctx, `${entry.records.at(-1).expression} / ${entry.records.at(-1).eyeMask} eyes`, 34, top + 277, 12);
  }
  const y = 706, total = 944;
  for (const phase of CYCLE_PHASES) {
    const x = 28 + phase.start / CYCLE_DURATION_MS * total, w = (phase.end - phase.start) / CYCLE_DURATION_MS * total;
    ctx.fillStyle = phase === phaseAt(at) ? '#648779' : '#c9d6ce'; ctx.fillRect(x, y, w - 3, 8);
    label(ctx, phase.label, x, y + 26, 12);
  }
  label(ctx, 'Offscreen Skia · live face + seeded blink · fixed camera and scale · no invented automatic wake workflow', 24, 758, 12);
  label(ctx, '240 ms sleep entry/exit settling · body, live face and scarf share the root · native window, GPU and memory not measured.', 24, 777, 11);
}
function paintProof(entry, at) {
  const col = phases.indexOf(Math.round(at)); if (col < 0) return;
  const x = col * 280, group = entry.scarf ? 1 : 0;
  for (const scale of [1, 2]) {
    const top = 80 + (group * 2 + scale - 1) * 340;
    proofCtx.fillStyle = '#ffffff'; proofCtx.fillRect(x + 6, top, 268, 332);
    label(proofCtx, `${phaseAt(at).label} / ${(at / 1000).toFixed(2)}s`, x + 16, top + 22, 14, ink);
    label(proofCtx, `${entry.scarf ? 'Scarf' : 'Bare'} / ${scale === 1 ? '99 CSS px body' : '2x / 198 px body'}`, x + 16, top + 43, 12);
    proofCtx.drawImage(entry.driver.body, x + (scale === 1 ? 30 : -79), top + (scale === 1 ? 48 : 8), 219 * scale, 219 * scale);
  }
}
const video = path.join(out, 'dango-continuous-state-cycle.mp4');
if (part === 'main') {
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
  '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let error = ''; encoder.stderr.on('data', chunk => { error += chunk; }); const exited = once(encoder, 'exit');
for (let frame = 0; frame < frames; frame++) {
  const at = frame / fps * 1000;
  for (const entry of entries) { sample(entry, at, frame); paintProof(entry, at); }
  paintVideo(at);
  if (phases.includes(Math.round(at))) fs.writeFileSync(path.join(out, `cycle-${phaseAt(at).expression.replace('.', '-')}.png`), screen.toBuffer('image/png'));
  if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited; if (code) throw Error(error);
}
function finish(entry) {
  cases.push(summarizeCase(entry.key, entry.records, entry.driver.transitions, entry.diagnostic));
  fs.writeFileSync(path.join(out, `${entry.key}-frames.json`), JSON.stringify(entry.records));
  entry.driver.dispose(); entry.overlap.dispose();
}
for (const entry of entries) finish(entry);
const viewCases = part === 'front' ? [['front', 1]] : part === 'mirrored' ? [['three-quarter', -1]] : part === 'auto' ? [['auto', 1]] : [];
for (const [view, facing] of viewCases) {
  for (const scarf of [false, true]) {
    const entry = make(view, facing, scarf);
    for (let frame = 0; frame < frames; frame++) {
      const at = frame / fps * 1000; sample(entry, at, frame);
      const col = [7900, 19000, 25200].indexOf(Math.round(at));
      if (scarf && view !== 'auto' && col >= 0) {
        const x = col * 400, top = 84 + (view === 'front' ? 0 : 1) * 400;
        supplementalCtx.fillStyle = view === 'front' ? '#fff' : '#202b2a';
        supplementalCtx.fillRect(x + 8, top, 384, 384);
        label(supplementalCtx, `${view === 'front' ? 'FRONT' : 'MIRRORED 3/4'} / ${phaseAt(at).label}`, x + 23, top + 25, 16,
          view === 'front' ? ink : '#eff5ef');
        label(supplementalCtx, '99 CSS px body', x + 23, top + 48, 12, view === 'front' ? muted : '#cedbd0');
        label(supplementalCtx, '2x', x + 304, top + 48, 12, view === 'front' ? muted : '#cedbd0');
        supplementalCtx.drawImage(entry.driver.body, x - 31, top + 113, 219, 219);
        supplementalCtx.drawImage(entry.driver.body, x + 52, top + 37, 438, 438);
      }
    }
    finish(entry);
  }
}
if (part === 'main') fs.writeFileSync(path.join(out, 'continuous-cycle-keyframes.png'), proof.toBuffer('image/png'));
if (part === 'front' || part === 'mirrored') fs.writeFileSync(path.join(out, `${part}-view-check.png`), supplemental.toBuffer('image/png'));
const videoBytes = fs.statSync(video).size;
if (videoBytes > 8 * 1024 * 1024) throw Error('Video exceeds 8 MiB');
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video], { encoding: 'utf8' });
if (probe.status) throw Error('ffprobe failed');
const changedSources = sourceHashes.filter(item => sha256(fs.readFileSync(path.join(root, item.file))) !== item.sha256);
if (changedSources.length) throw Error(`Production sources changed during capture: ${JSON.stringify(changedSources)}`);
const evidence = { renderer: 'Actual createPetRenderer; shared gallery harness selects once per instance; retained state/current/channel',
  driver: 'Selected existing semantic expressions; pinned-view previews plus auto-view updatePresentation input. No Director, IPC or automatic wake claim.',
  timing: { durationMs: CYCLE_DURATION_MS, fps, frames }, phases: CYCLE_PHASES,
  scale: { bodyDesignWidthCssPx: 99, enlargedBodyDesignWidthPx: 198, stageCssPx: 219, rasterPx: 438, dpr: 2 },
  video: { filename: path.basename(video), bytes: videoBytes, sha256: sha256(fs.readFileSync(video)), ffprobe: JSON.parse(probe.stdout) },
  samples: cases.reduce((sum, value) => sum + value.frames, 0), sourceHashes, changedSources, assets: [...assets.values()], cases,
  summary: { blankFrames: cases.reduce((sum, value) => sum + value.blankFrames, 0),
    clippedFrames: cases.reduce((sum, value) => sum + value.clippedFrames, 0),
    maxScarfBodyMatrixDifference: Math.max(...cases.map(value => value.maxScarfBodyMatrixDifference)),
    maxFaceClothOverlap: Math.max(...cases.map(value => value.maxFaceClothOverlap)) },
  limitations: ['Selected wake is existing expression, not natural night-to-morning scheduling',
    'Sleep/wake settling is performed by the production renderer; no video interpolation or playback speed changes',
    'No native-window, browser compositor, GPU, memory or full-wardrobe acceptance claim',
    'Pixel change counts describe continuity but do not establish aesthetic approval'] };
fs.writeFileSync(path.join(out, `evidence-${part}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ out, videoBytes, samples: evidence.samples, summary: evidence.summary, changedSources }, null, 2));
