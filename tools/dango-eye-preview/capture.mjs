import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { makeComparison, auditRegression, measureEyes, faceCalls, withoutEyes, sha256 } from './audit.mjs';
import { traceProductionDraw } from '../dango-scarf-preview/audit.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package') || !arg('baseline-root')) throw Error('Pass existing --canvas-package and frozen --baseline-root');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const out = path.resolve(arg('out') || 'dist/dango-idle-eye-review'); fs.mkdirSync(out, { recursive: true });
const comparison = await makeComparison(backend, path.resolve(arg('baseline-root')));
const width = 1120, height = 888, fps = 30, durationMs = 10400, frameCount = durationMs / 1000 * fps;
const screen = backend.createCanvas(width, height), context = screen.getContext('2d');
const paper = '#eef2ed', ink = '#263a3a', muted = '#52645f';
const label = (value, x, y, size = 14, color = muted, ctx = context) => {
  ctx.fillStyle = color; ctx.font = `${size}px sans-serif`; ctx.fillText(value, x, y);
};
const pairs = [false, true].map(outfit => ({ outfit, pair: comparison.pair({ outfit, blink: true }) }));
const records = [], stills = [];
let blinkStill = false;
function render(at, frame) {
  context.fillStyle = paper; context.fillRect(0, 0, width, height);
  label('DANGO / IDLE EYE CORRECTION', 24, 32, 23, ink);
  label(`NORMAL SPEED / ${(at / 1000).toFixed(2)} s / natural blinking`, 658, 31, 15);
  for (const [row, entry] of pairs.entries()) {
    const traces = entry.pair.map(harness => traceProductionDraw(harness, at));
    if (JSON.stringify(withoutEyes(traces[0])) !== JSON.stringify(withoutEyes(traces[1]))) {
      throw Error(`Body, mouth, scarf or rig changed at ${at}`);
    }
    for (const [col, harness] of entry.pair.entries()) {
      const x = col * 560 + 12, y = row * 396 + 53;
      context.fillStyle = 'white'; context.fillRect(x, y, 536, 384);
      label(`${col ? 'CORRECTED' : 'ORIGINAL'} / ${entry.outfit ? 'EXISTING SCARF' : 'BARE BODY'}`, x + 20, y + 28, 18, ink);
      label('99 CSS px body width', x + 24, y + 61, 13);
      label('2x enlargement / 198 px', x + 286, y + 61, 13);
      const floor = y + 319;
      context.strokeStyle = '#c3d1c7'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(x + 18, floor); context.lineTo(x + 514, floor); context.stroke();
      context.drawImage(harness.body, x + 4, floor - 156, 219, 219);
      context.drawImage(harness.body, x + 153, floor - 312, 438, 438);
      const eyes = faceCalls(traces[col]), closed = eyes.some(call => call.src.includes('eyes-closed'));
      label(closed ? 'BLINK / existing closed-eye sprites' : col ? 'Canonical eye pair / original gaze, eyelids and mouth' : 'Original idle eye phrase', x + 20, y + 362, 12);
      const sample = pixels(harness.body);
      if (!sample.occupied || sample.edge) throw Error(`Blank or clipped frame at ${at}`);
      records.push({ at, corrected: Boolean(col), outfit: entry.outfit, closed, hash: sample.hash,
        eyeAssets: eyes.map(call => call.src), eyeMatrices: eyes.map(call => call.matrix), bounds: sample.bounds });
    }
  }
  label('Actual production renderer / three-quarter / unchanged body, scarf, rig, mouth and eye timing', 24, 861, 13);
  label('Offscreen Skia evidence. 99 px is body design width; native compositor, GPU and memory are not measured.', 24, 880, 12);
  const closed = records.at(-1).closed;
  if ([0, 78, 108].includes(frame) || (closed && !blinkStill && frame > 44)) {
    const filename = closed ? 'idle-normal-blink.png' : frame === 78 ? 'idle-eyes-before-after.png' : `frame-${frame}.png`;
    fs.writeFileSync(path.join(out, filename), screen.toBuffer('image/png')); stills.push(filename);
    if (closed) blinkStill = true;
  }
}
const video = path.join(out, 'dango-idle-eyes-before-after.mp4');
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
  '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', chunk => { errors += chunk; }); const exited = once(encoder, 'exit');
for (let frame = 0; frame < frameCount; frame++) {
  render(frame / fps * 1000, frame);
  if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited; if (code) throw Error(errors);
const videoBytes = fs.statSync(video).size;
if (videoBytes > 8 * 1024 * 1024) throw Error('Video exceeds 8 MiB');
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video], { encoding: 'utf8' });
if (probe.status) throw Error('ffprobe failed');
const sheet = backend.createCanvas(1280, 1120), sheetContext = sheet.getContext('2d');
sheetContext.fillStyle = paper; sheetContext.fillRect(0, 0, 1280, 1120);
label('EYE REGRESSION / SAME PRODUCTION RENDERER', 24, 32, 23, ink, sheetContext);
label('Each cell: original on left / corrected on right. 99 CSS px body width. Existing scarf.', 24, 58, 15, muted, sheetContext);
const regression = auditRegression(comparison, { drawCell({ vi, ei, view, expression, pair, record }) {
  const x = vi * 320 + 8, y = ei * 198 + 88;
  sheetContext.fillStyle = 'white'; sheetContext.fillRect(x, y, 304, 188);
  label(view.label, x + 10, y + 22, 13, ink, sheetContext);
  label(expression.label, x + 10, y + 43, 12, muted, sheetContext);
  for (const [i, harness] of pair.entries()) sheetContext.drawImage(harness.body, x - 29 + i * 140, y + 4, 219, 219);
  label(record.changeReason === 'idle-canonical' ? 'Idle eye pair corrected'
    : record.changeReason === 'focus-far-height' ? 'Focus far-eye height corrected'
    : record.changeReason === 'open-far-height' ? 'Open-glyph far-eye height corrected' : 'Pixel-identical', x + 10, y + 179, 12, muted, sheetContext);
} });
if (regression.failures.length) throw Error(JSON.stringify(regression.failures));
label('6 idle + 4 focus + 4 attentive eye corrections; 26 controls unchanged, including front and sleep.', 24, 1099, 13, muted, sheetContext);
fs.writeFileSync(path.join(out, 'idle-eye-regression.png'), sheet.toBuffer('image/png'));
const eyeMeasurements = await measureEyes(backend);
const blinking = pairs.map(entry => ({ outfit: entry.outfit,
  beforeFrames: records.filter(record => record.outfit === entry.outfit && !record.corrected && record.closed).length,
  afterFrames: records.filter(record => record.outfit === entry.outfit && record.corrected && record.closed).length }));
if (blinking.some(record => !record.beforeFrames || record.beforeFrames !== record.afterFrames)) throw Error('Normal blink coverage failed');
const report = { renderer: 'Actual createPetRenderer with real production artists, offscreen Skia',
  baseline: comparison.evidence, sourceArtChanged: false, timing: { durationMs, fps, frameCount },
  scale: { bodyDesignWidthCssPx: 99, enlargedBodyDesignWidthPx: 198, artUnits: 66 },
  scope: 'Idle video isolates canonical curious-beat correction. Current regression also expects 4 focus and 4 attentive far-eye corrections in three-quarter views; non-eye calls and near eye remain exact.',
  video: { filename: path.basename(video), bytes: videoBytes, sha256: sha256(fs.readFileSync(video)), ffprobe: JSON.parse(probe.stdout) },
  stills, blinking, eyeMeasurements, regression, records,
  limitations: ['Sleep and frontal geometry remain unchanged; open-glyph height correction is separately measured, without a blanket expression-quality claim',
    'Offscreen evidence does not establish native-window or browser-compositor acceptance', 'No GPU or memory claim'] };
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, videoBytes, blinking, changedIdleCases: regression.changedIdleCases,
  changedFocusCases: regression.changedFocusCases,
  unchangedCases: regression.unchangedCases, noFaceBackCases: regression.noFaceBackCases,
  eyeRatios: eyeMeasurements.map(({ view, state, heightRatio, areaRatio }) => ({ view, state, heightRatio, areaRatio })) }, null, 2));
comparison.dispose();
