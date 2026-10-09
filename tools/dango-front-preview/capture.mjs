// Isolated offscreen batches, actual retained renderer; no production edits.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { createStateCycleDriver, CYCLE_DURATION_MS, CYCLE_PHASES } from '../dango-state-cycle-preview/driver.mjs';
import { traceFrame, sha256 } from '../dango-state-cycle-preview/metrics.mjs';
import { createFrontReviewDriver, FRONT_DURATION_MS, FRONT_PHASES, OUTFITS } from './driver.mjs';
import { paintVideo, registerFont, label } from './painter.mjs';
import { makeFrontAudit, summarize } from './audit.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const canvasPackage = arg('canvas-package');
if (!canvasPackage) throw Error('Pass the existing Skia package path');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-front-review'));
fs.mkdirSync(out, { recursive: true });
const part = arg('part');
const pinned = [
  'src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/frame-context.mjs', 'src/surfaces/pet/sleep-transition.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'src/capabilities/companion/presentation/dango-raster-appearance.mjs',
  'src/capabilities/companion/presentation/dango-raster-production.mjs',
  'src/capabilities/companion/presentation/dango-raster-pose.mjs',
  'src/capabilities/companion/presentation/dango-raster-face.mjs',
  'src/capabilities/companion/presentation/dango-face.mjs',
  'src/content/expressions.mjs', 'src/content/appearance.mjs', 'src/core/dango-view-policy.mjs',
  'src/capabilities/companion/presentation/expression-phrases.mjs',
  'assets/companion/dango/raster/dango.raster.mjs', 'tools/usagi-gallery/runtime-harness.mjs',
  'tools/dango-state-cycle-preview/driver.mjs', 'tools/dango-front-preview/driver.mjs',
  'tools/dango-front-preview/capture.mjs', 'tools/dango-front-preview/audit.mjs', 'tools/dango-front-preview/painter.mjs'
];
if (!part) {
  const reports = [];
  for (const outfit of OUTFITS) for (const mode of ['video', 'audit']) {
    const batch = `${outfit.key}_${mode}`;
    const result = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2), `--part=${batch}`], { stdio: 'inherit' });
    if (result.status !== 0) throw Error(`Capture failed: ${batch}: ${result.status ?? result.signal}`);
    reports.push(JSON.parse(fs.readFileSync(path.join(out, `evidence-${batch}.json`))));
  }
  if (reports.some(report => JSON.stringify(report.sourceHashes) !== JSON.stringify(reports[0].sourceHashes))) throw Error('Sources changed across batches');
  const list = path.join(out, 'concat.txt');
  fs.writeFileSync(list, OUTFITS.map(o => `file '${o.key}_video.mp4'`).join('\n'));
  const video = path.join(out, 'dango-front-normal-speed.mp4');
  const result = spawnSync('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-c', 'copy', '-movflags', '+faststart', video], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
  const bytes = fs.statSync(video).size;
  if (bytes > 8 * 1024 * 1024) throw Error('Video exceeds 8 MiB');
  const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', video], { encoding: 'utf8' });
  if (probe.status) throw Error('ffprobe failed');
  const evidence = { renderer: 'Actual createPetRenderer using retained production gallery harness',
    video: { file: path.basename(video), bytes, sha256: sha256(fs.readFileSync(video)), ffprobe: JSON.parse(probe.stdout) },
    scale: { bodyDesignWidthCssPx: 99, enlargedBodyDesignWidthPx: 198, stageCssPx: 219, rasterPx: 438, dpr: 2 },
    compactPhases: FRONT_PHASES, fullAuditPhases: CYCLE_PHASES, sourceHashes: reports[0].sourceHashes,
    reports: reports.map(({ rows, ...report }) => report),
    limitations: ['Pinned front expression preview; actual default view policy is unchanged',
      'Selected work.focus is a facial expression, not a focus-session tool activity',
      'Selected life.wake is not an implemented automatic night-to-morning event',
      'No new art, motion, garment, renderer or default-view edits',
      'Offscreen Skia evidence only; native window, GPU, memory and platform acceptance are not measured'] };
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ out, bytes, batches: reports.length, frames: reports.reduce((n, r) => n + r.rows.length, 0) }));
  process.exit(0);
}
const [key, mode] = part.split('_'), outfit = OUTFITS.find(item => item.key === key);
if (!outfit || !['video', 'audit'].includes(mode)) throw Error('Invalid batch');
const backend = createRequire(import.meta.url)(canvasPackage);
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 }; registerFont(backend);
const source = await loadSource(pathToFileURL(root).href);
const sourceHashes = pinned.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
const make = view => (mode === 'video' ? createFrontReviewDriver : createStateCycleDriver)(source, { view, outfit: outfit.itemIds });
const driver = make('front'), side = mode === 'video' ? make('three-quarter') : null;
const audit = makeFrontAudit(backend, outfit), sideAudit = side ? makeFrontAudit(backend, outfit) : null;
const fps = 30, durationMs = mode === 'video' ? FRONT_DURATION_MS : CYCLE_DURATION_MS;
const phases = mode === 'video' ? FRONT_PHASES : CYCLE_PHASES;
const frames = durationMs / 1000 * fps, rows = [], sideRows = [], assets = new Map();
const screen = backend.createCanvas(930, 600), proof = backend.createCanvas(1500, 570), pctx = proof.getContext('2d');
pctx.fillStyle = '#eef2ed'; pctx.fillRect(0, 0, 1500, 570);
label(pctx, `${outfit.label} / 正面完整周期关键帧`, 22, 30, 21, '#263a3a');
const snapshots = mode === 'audit' ? new Map([[15, 'idle'], [78, 'curious'], [237, 'focus'], [570, 'sleep'], [756, 'wake']]) : new Map();
const transitions = new Map();
let encoder, exited, error = '';
if (mode === 'video') {
  encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
    '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, `${part}.mp4`)], { stdio: ['pipe', 'ignore', 'pipe'] });
  encoder.stderr.on('data', chunk => { error += chunk; }); exited = once(encoder, 'exit');
}
for (let frame = 0; frame < frames; frame++) {
  const at = frame / fps * 1000, trace = traceFrame(driver, at);
  const boundary = phases.some(phase => Math.abs(at - phase.start) <= 300);
  const diagnostic = frame % 6 === 0 || boundary || snapshots.has(frame);
  const row = audit.measure(trace, driver, at, diagnostic); rows.push(row);
  for (const call of trace.calls) if (call.src && !assets.has(call.src)) assets.set(call.src,
    { file: path.relative(root, fileURLToPath(call.src)), sha256: sha256(fs.readFileSync(fileURLToPath(call.src))) });
  if (snapshots.has(frame)) {
    const col = [...snapshots.keys()].indexOf(frame), x = col * 300;
    pctx.fillStyle = 'white'; pctx.fillRect(x + 5, 52, 290, 486);
    label(pctx, `${snapshots.get(frame)} / ${(at / 1000).toFixed(2)} s`, x + 15, 81, 16, '#263a3a');
    label(pctx, row.eyeMask, x + 15, 106, 13);
    pctx.drawImage(driver.body, x - 69, 35, 438, 438);
    pctx.fillStyle = '#25302e'; pctx.fillRect(x + 22, 375, 256, 145);
    pctx.drawImage(driver.body, x + 40, 340, 219, 219);
    fs.writeFileSync(path.join(out, `${key}-front-${snapshots.get(frame)}.png`), driver.body.toBuffer('image/png'));
  }
  if (mode === 'audit') for (const phase of phases.slice(1)) {
    const delta = Math.round(at - phase.start);
    if (![-100, -33, 0, 33, 100, 200, 300, 500].includes(delta)) continue;
    if (!transitions.has(phase.start)) {
      const canvas = backend.createCanvas(1600, 320), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#eef2ed'; ctx.fillRect(0, 0, 1600, 320);
      transitions.set(phase.start, { canvas, ctx, col: 0 });
    }
    const sheet = transitions.get(phase.start), x = sheet.col++ * 200;
    label(sheet.ctx, `${delta} ms / ${row.eyeMask}`, x + 8, 25, 12, '#263a3a');
    sheet.ctx.drawImage(driver.body, x - 64.25, -21, 328.5, 328.5);
  }
  if (side) {
    const sideTrace = traceFrame(side, at);
    sideRows.push(sideAudit.measure(sideTrace, side, at, diagnostic));
    paintVideo(screen, driver.body, side.body, outfit, OUTFITS.indexOf(outfit), at);
    if (frame === 78) fs.writeFileSync(path.join(out, `${key}-video-frame.png`), screen.toBuffer('image/png'));
    if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
  }
}
if (encoder) { encoder.stdin.end(); const [code] = await exited; if (code) throw Error(error); }
if (mode === 'audit') {
  fs.writeFileSync(path.join(out, `${key}-front-audit.png`), proof.toBuffer('image/png'));
  for (const [at, sheet] of transitions) fs.writeFileSync(path.join(out, `${key}-transition-${at}.png`), sheet.canvas.toBuffer('image/png'));
}
const changedSources = sourceHashes.filter(item => sha256(fs.readFileSync(path.join(root, item.file))) !== item.sha256);
if (changedSources.length) throw Error('Production or preview source changed during capture');
const report = { part, key, mode, outfit: outfit.itemIds, requestedView: 'front', fps, durationMs, frames,
  sourceHashes, changedSources, assets: [...assets.values()], summary: summarize(rows),
  sideSummary: side ? summarize(sideRows) : null, transitions: driver.transitions, rows };
fs.writeFileSync(path.join(out, `evidence-${part}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ part, summary: report.summary }));
driver.dispose(); side?.dispose(); audit.dispose(); sideAudit?.dispose();
