// Existing Skia package only; no installation, native process or new renderer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { recordingContext } from '../../test-support/dango-raster-fixture.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { ACTION, CSS_PER_UNIT, makePainter } from './painter.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package')) throw Error('Pass --canvas-package=/absolute/path/to/existing/@napi-rs/canvas');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const out = path.resolve(arg('out') || 'dist/dango-rig-refinement-sample');
fs.mkdirSync(out, { recursive: true });
const original = await makePainter(backend), refined = await makePainter(backend, { refined: true });
const painters = [original, refined];
const width = 1120, height = 760, fps = 60, frames = 570;
const colors = { paper: '#f1f3ef', panel: '#ffffff', ink: '#27383e', text: '#516269', line: '#b3c3bd' };
const screen = backend.createCanvas(width, height), ctx = screen.getContext('2d');
function label(context, text, x, y, size = 16, color = colors.text) {
  context.fillStyle = color; context.font = `${size}px sans-serif`; context.fillText(text, x, y);
}
function stage(context, painter, at, x, y, scale, options = {}) {
  context.save(); context.translate(x, y); context.scale(scale, scale);
  context.strokeStyle = colors.line; context.lineWidth = .5;
  context.beginPath(); context.moveTo(17, 104); context.lineTo(129, 104); context.stroke();
  const artwork = painter.compose(context, at, options); context.restore(); return artwork;
}
function render(at) {
  ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, width, height);
  label(ctx, 'DANGO / PRESERVED RUN MOTION', 30, 34, 23, colors.ink);
  label(ctx, `NORMAL SPEED  |  950ms STRIDE  |  ${(at / 1000).toFixed(2)}s / 9.50s`, 625, 32, 15);
  for (const [i, painter] of painters.entries()) {
    const x = i * 560;
    ctx.fillStyle = colors.panel; ctx.fillRect(x + 16, 55, 528, 650);
    label(ctx, i ? 'SAME RIG / LIFT TIMING ONLY' : 'ORIGINAL PROCEDURAL RIG', x + 36, 84, 19, colors.ink);
    label(ctx, '99 CSS px body design width / 1x', x + 36, 111, 14);
    stage(ctx, painter, at, x + (560 - 219) / 2, 118, CSS_PER_UNIT);
    label(ctx, 'Same motion / 2x enlargement', x + 36, 359, 14);
    stage(ctx, painter, at, x + (560 - 438) / 2, 295, CSS_PER_UNIT * 2);
  }
  label(ctx, 'Both preserve horizontal stride, breathing, squash, lean and live face. Right changes lift phase only.', 28, 728, 14);
  label(ctx, 'Actual production painter / offscreen Skia. Contact lock and native desktop behavior are not established.', 28, 749, 12);
}
const video = path.join(out, 'dango-original-vs-lift-timing-normal-speed.mp4');
if (arg('reuse-video') !== 'true') {
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
  '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
  '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', data => { errors += data; });
const exited = once(encoder, 'exit');
for (let i = 0; i < frames; i++) {
  render(i / fps * 1000);
  if (i === 228) fs.writeFileSync(path.join(out, 'dango-original-vs-lift-timing-still.png'), screen.toBuffer('image/png'));
  if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited;
if (code) throw Error(`ffmpeg: ${errors}`);
}
const videoBytes = fs.statSync(video).size;
assert.ok(videoBytes <= 8 * 1024 * 1024, 'Video exceeds 8MiB');

// Compare actual painter draw calls and output, not an independently rendered rig.
const transform = context => { const m = context.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f]; };
const point = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const samples = [], strideStart = 3800, strideMs = 950, count = 120;
const surfaces = painters.map(() => backend.createCanvas(219, 219));
const upperRows = 120;
function drawCalls(painter, at) {
  const record = recordingContext(); record.scale(CSS_PER_UNIT, CSS_PER_UNIT);
  const artwork = painter.compose(record, at, { choreography: false });
  const excluded = ['foot-left', 'foot-right'].flatMap(key => [artwork.data.parts[key]?.src, artwork.data.rootJoins?.fills[key]?.src]).filter(Boolean);
  const footSources = new Set(excluded.map(src => new URL(src, DANGO_RASTER.baseUrl).href));
  return record.calls.filter(call => !footSources.has(painter.imageSources.get(call.image))).map(call => ({
    src: painter.imageSources.get(call.image), rect: call.rect, matrix: call.matrix, alpha: call.alpha
  }));
}
for (let i = 0; i < count; i++) {
  const at = strideStart + i / count * strideMs;
  const bodies = [], artworks = [], images = [];
  for (const [j, painter] of painters.entries()) {
    const context = surfaces[j].getContext('2d'); context.resetTransform(); context.clearRect(0, 0, 219, 219);
    context.scale(CSS_PER_UNIT, CSS_PER_UNIT);
    artworks.push(painter.compose(context, at, { choreography: false, inspect: context => bodies.push(transform(context)) }));
    images.push(context.getImageData(0, 0, 219, 219).data);
  }
  assert.deepEqual(bodies[0], bodies[1], 'Actual root/body render transforms changed');
  assert.deepEqual(drawCalls(original, at), drawCalls(refined, at), 'Non-foot actual draw calls changed');
  assert.deepEqual(artworks[0].face, artworks[1].face, 'Live expression changed');
  let changedPixels = 0, changedUpperPixels = 0, changedLowerPixels = 0;
  for (let p = 0; p < 219 * 219; p++) {
    if (![0, 1, 2, 3].some(c => images[0][p * 4 + c] !== images[1][p * 4 + c])) continue;
    changedPixels++; if (Math.floor(p / 219) < upperRows) changedUpperPixels++; else changedLowerPixels++;
  }
  assert.equal(changedUpperPixels, 0, 'Upper-body actual pixels changed');
  const feet = {};
  for (const side of ['foot-left', 'foot-right']) {
    const a = artworks[0].matrices[side], b = artworks[1].matrices[side];
    assert.deepEqual(a.slice(0, 5), b.slice(0, 5), 'Local foot horizontal/rotation matrix changed');
    const anchor = artworks[0].anchors[side], pivot = [anchor.x, anchor.y];
    feet[side] = { original: a, refined: b,
      originalLocalPivot: point(a, pivot), refinedLocalPivot: point(b, pivot),
      liftDifferenceCssPxBeforeRetainedBodyTransform: (b[5] - a[5]) * CSS_PER_UNIT };
  }
  const m = bodies[0];
  samples.push({ phase: i / count, elapsedMs: at, bodyMatrix: m,
    scaleX: Math.hypot(m[0], m[1]) / CSS_PER_UNIT, scaleY: Math.hypot(m[2], m[3]) / CSS_PER_UNIT,
    leanRadians: Math.atan2(m[1], m[0]), changedPixels, changedUpperPixels, changedLowerPixels, feet });
}
const differentFrames = samples.filter(s => s.changedPixels > 0).length;
// The sin/cos paths intentionally coincide at two phases; require a broad
// normal-scale difference instead of mislabeling the coincidences as failures.
assert.ok(differentFrames >= count * .9, 'Lift timing must change most actual normal-scale frames');
const extent = key => [Math.min(...samples.map(s => s[key])), Math.max(...samples.map(s => s[key]))];
const sheet = backend.createCanvas(1600, 692), sc = sheet.getContext('2d');
sc.fillStyle = colors.paper; sc.fillRect(0, 0, sheet.width, sheet.height);
label(sc, 'ONE STRIDE / ORIGINAL vs LIFT TIMING ONLY', 25, 34, 24, colors.ink);
label(sc, '99 CSS px body design width. Root x travel fixed for inspection; original body squash, breathing and lean remain active.', 25, 59, 16);
for (let i = 0; i < 8; i++) {
  const col = i % 4, row = Math.floor(i / 4), x = col * 400, y = 80 + row * 285;
  sc.fillStyle = colors.panel; sc.fillRect(x + 8, y + 4, 384, 272);
  label(sc, `PHASE ${(i / 8).toFixed(3)}`, x + 21, y + 31, 16, colors.ink);
  label(sc, 'Original', x + 55, y + 57, 14);
  label(sc, 'Lift timing only', x + 228, y + 57, 14);
  const at = strideStart + i / 8 * strideMs;
  for (const [j, painter] of painters.entries()) stage(sc, painter, at, x - 11 + j * 198, y + 51, CSS_PER_UNIT, { choreography: false });
  const m = samples[i * 15];
  label(sc, `Same body scale: ${m.scaleX.toFixed(3)} x ${m.scaleY.toFixed(3)}`, x + 21, y + 251, 14);
}
label(sc, 'Source art, live face and body render transforms match exactly. Lift timing is a review sample, not a foot-lock result.', 25, 676, 15);
const still = path.join(out, 'dango-original-vs-lift-timing-phase-proof.png');
fs.writeFileSync(still, sheet.toBuffer('image/png'));
const decoded = path.join(out, 'decoded-comparison-frame.png');
const decode = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-i', video, '-ss', '3.8', '-frames:v', '1', decoded], { encoding: 'utf8' });
assert.equal(decode.status, 0, decode.stderr);
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', video], { encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr);
const stream = JSON.parse(probe.stdout).streams[0];
assert.equal(Number(stream.nb_read_frames), 570); assert.equal(Number(stream.duration), 9.5); assert.equal(stream.r_frame_rate, '60/1');
assert.equal(stream.width, width); assert.equal(stream.height, height);
const report = {
  renderer: 'Actual createDangoRasterArtist with offscreen Skia, runClip:null on both sides',
  comparison: { left: 'factory default original procedural rig', right: "runFootTiming:'forward-recovery' only",
    sourceView: 'three-quarter', skin: 'pink', outfit: [], face: 'same production sampled live face', action: ACTION },
  video: { filename: path.basename(video), bytes: videoBytes, sha256: createHash('sha256').update(fs.readFileSync(video)).digest('hex'), decoded: stream },
  scale: { cssPixelsPerDesignUnit: CSS_PER_UNIT, normalDesignWidthCssPx: 99, enlargedDesignWidthPixels: 198 },
  measured: { strideSamples: count, strideMs, bodyTransformsExact: true, nonFootDrawCallsExact: true,
    localFootHorizontalAndRotationMatricesExact: true, liveFaceExact: true,
    upperRegion: { width: 219, height: upperRows, changedPixels: 0, meaning: 'Full actual composition, fixed x travel, including unchanged active body transform' },
    changedPixelsPerNormalFrame: extent('changedPixels'), differentNormalFrames: differentFrames,
    bodyScaleX: extent('scaleX'), bodyScaleY: extent('scaleY'), bodyLeanRadians: extent('leanRadians'),
    maxLiftDifferenceCssPxBeforeRetainedBodyTransform: Math.max(...samples.flatMap(s => Object.values(s.feet).map(f => Math.abs(f.liftDifferenceCssPxBeforeRetainedBodyTransform)))),
    interpretation: 'The existing body lean maps local vertical changes partly into final screen x. Local horizontal stride and roll are exact; screen-space foot x is not claimed identical.' },
  limitations: ['Lift phase only: no continuous support/contact-lock claim', 'No native Electron, GPU, compositor or memory test', 'No automatic perceptual-quality or user-approval claim'],
  samples
};
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'preview-report.txt'), [
  'Original procedural rig versus optional forward-recovery lift timing',
  'Both columns use the actual production artist with runClip:null and the same clock, action, source art and live face.',
  `Video: 950 ms stride; 9.5 seconds; 60 fps / 570 independently decoded frames; ${(videoBytes / 1048576).toFixed(2)} MiB.`,
  'Normal body design width is 99 CSS px; second row is a 2x enlargement.',
  `At 120 phases: exact body transforms, exact non-foot draw calls, exact live face, exact local foot x/rotation matrices.`,
  `Upper-body pixels: 0 differences. Changed lower-region pixels at normal scale: ${extent('changedPixels').join('–')} per frame.`,
  `Retained body scale ranges: x ${extent('scaleX').join('–')}; y ${extent('scaleY').join('–')}.`,
  `Maximum lift-phase difference: ${report.measured.maxLiftDifferenceCssPxBeforeRetainedBodyTransform.toFixed(3)} CSS px before the retained body transform.`,
  'This is a visual review sample. Foot contact lock, naturalness and native behavior are not established.'
].join('\n') + '\n');
for (const painter of painters) painter.dispose();
console.log(JSON.stringify({ out, video, still, videoBytes, measured: report.measured, decoded: stream }, null, 2));
