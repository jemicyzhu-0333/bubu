// Output is kept outside the application. No production artist or asset changes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createSequencePlayer, sequenceTransform } from './player.mjs';
import { offlinePage } from './offline-page.mjs';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = path.resolve(arg('manifest') || 'manifest.json');
const out = path.resolve(arg('out') || path.join(path.dirname(input), 'comparison'));
const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
const require = createRequire(import.meta.url), backend = require(arg('canvas-package'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frameBytes = manifest.frames.map(frame => {
  const absolute = path.resolve(path.dirname(input), frame.src);
  if (path.relative(path.dirname(input), absolute).startsWith('..') || /[a-z]+:\/\//i.test(frame.src)) {
    throw new Error('Only frame files within the supplied local manifest directory are supported');
  }
  return fs.readFileSync(absolute);
});
if (new Set(frameBytes.map(hash)).size !== 8) throw new Error('Eight unique source PNGs are required; duplicated slots are not accepted');
if (manifest.frames.some((frame, index) => frame.sha256 && frame.sha256 !== hash(frameBytes[index]))) {
  throw new Error('Frame content does not match its supplied provenance hash');
}
const canonical = path.join(root, 'assets/companion/dango/raster/sources/canonical/three-quarter-right.png');
if (manifest.canonicalSha256 !== hash(fs.readFileSync(canonical))) throw new Error('Canonical source SHA does not match the approved local reference');
if (Math.abs(manifest.loopMs - 950) > .001) throw new Error('This comparison requires the production 950 ms stride period');
fs.mkdirSync(out, { recursive: true });
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href);
const { default: productionArtist } = await import(pathToFileURL(path.join(root, 'src/capabilities/companion/presentation/dango-raster-production.mjs')));
const harness = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: 'three-quarter', blink: false });
const selected = harness.select('action', 'chase-laser');
if (selected.duration / 10 !== manifest.loopMs) throw new Error('Production action duration changed; re-check its stride contract');
const player = createSequencePlayer(manifest, { loadImage: src => backend.loadImage(frameBytes[manifest.frames.findIndex(frame => frame.src === src)]) });
const ready = await player.prepare();
if (!ready.ready) throw new Error(JSON.stringify(ready));
const canonicalHeightCss = 96, groundY = 158.5;
const fixed = sequenceTransform(player.manifest, { x: 110, y: groundY, referenceHeight: canonicalHeightCss });
const rig = backend.createCanvas(440, 440), sequence = backend.createCanvas(440, 440);
const screen = backend.createCanvas(960, 820), context = screen.getContext('2d');
const fps = 40, durationMs = 5700, startMs = 1900, count = durationMs / 1000 * fps;
const videoPath = path.join(out, 'dango-sequence-vs-rig.mp4');
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
  '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
  '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', chunk => { errors += chunk; });
const exited = once(encoder, 'exit');
const timings = { productionFrame: [], sequencePaint: [] };
const now = () => Number(process.hrtime.bigint()) / 1e6;
for (let warmup = 0; warmup < startMs; warmup += 25) harness.draw(warmup);
function paintPanel(surface, at, pose, left) {
  const title = left ? 'CURRENT LAYERED RIG' : 'AUTHORED EIGHT-POSE SEQUENCE';
  const x = left ? 20 : 500;
  context.fillStyle = '#294956'; context.font = '19px sans-serif'; context.fillText(title, x, 62);
  context.drawImage(surface, x + 110, 73, 220, 220);
  context.drawImage(surface, x, 322, 440, 440);
  context.strokeStyle = '#c1d0d3'; context.lineWidth = 1;
  for (const [offset, y, width] of [[110, 73 + groundY, 220], [0, 322 + groundY * 2, 440]]) {
    context.beginPath(); context.moveTo(x + offset + 18, y); context.lineTo(x + offset + width - 18, y); context.stroke();
  }
  context.fillStyle = '#516d78'; context.font = '13px sans-serif';
  context.fillText(left ? 'Production createPetRenderer · original limb transforms' : `Independent full pose ${pose + 1} / 8 · common canvas + anchor`, x, 788);
}
for (let frame = 0; frame < count; frame++) {
  const relative = frame / fps * 1000, at = startMs + relative;
  let began = now(); harness.draw(at); timings.productionFrame.push(now() - began);
  const rigContext = rig.getContext('2d'); rigContext.resetTransform(); rigContext.clearRect(0, 0, 440, 440);
  rigContext.drawImage(harness.body, 1, 5, 438, 438);
  const p = at / selected.duration;
  const sharedX = Math.round(Math.sin(p * Math.PI * 6) * 9 * 3) / 3 * 1.5;
  const sequenceContext = sequence.getContext('2d'); sequenceContext.setTransform(2, 0, 0, 2, 0, 0);
  sequenceContext.clearRect(0, 0, 220, 220);
  began = now();
  const sample = player.draw(sequenceContext, relative, { ...fixed, x: fixed.x + sharedX });
  timings.sequencePaint.push(now() - began);
  context.fillStyle = '#eef3f3'; context.fillRect(0, 0, 960, 820);
  context.fillStyle = '#294956'; context.font = '20px sans-serif';
  context.fillText(`DANGO RUN  /  950 ms stride  /  ${(relative / 1000).toFixed(2)} s`, 20, 28);
  paintPanel(rig, at, sample.index, true); paintPanel(sequence, at, sample.index, false);
  context.fillStyle = '#69818a'; context.font = '12px sans-serif';
  context.fillText('1×: 99 CSS px body design scale · 2× below · fixed camera and scale; shared horizontal translation', 20, 305);
  context.fillText('Offscreen Skia production capture. Candidate artwork requires visual review; native desktop / GPU behavior unverified.', 20, 809);
  const png = screen.toBuffer('image/png');
  if (frame === 19) fs.writeFileSync(path.join(out, 'comparison-poster.png'), png);
  if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited; if (code) throw new Error(`FFmpeg failed: ${errors}`);
const summarize = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], samples: values.length };
};
const report = { schemaVersion: 1, canonicalSha256: manifest.canonicalSha256,
  renderer: 'Real production createPetRenderer through tools/usagi-gallery/runtime-harness.mjs, offscreen Skia',
  candidate: 'Eight independently image-authored full-pose PNGs; never baked from the rig',
  frames: manifest.frames.map((frame, index) => ({ ...frame, sha256: hash(frameBytes[index]), bytes: frameBytes[index].length })),
  timing: { strideMs: manifest.loopMs, poseHoldMs: manifest.frames.map(frame => frame.durationMs),
    comparisonFps: fps, durationMs, productionRangeMs: [startMs, startMs + durationMs], actionDurationMs: selected.duration },
  geometry: { frameWidth: manifest.width, frameHeight: manifest.height, anchor: manifest.anchor,
    referenceBounds: manifest.referenceBounds, fixedTransform: fixed, canonicalHeightCss, groundY,
    bodyDesignWidthCss: 99, canonicalNeutralWidthCss: 105.6,
    trajectory: 'The existing action lateral offset is shared; all authored compression and lift stay inside each common frame. Left retains production bob; right has a fixed vertical anchor.',
    camera: 'Fixed 220 CSS px square; displayed at 1x and 2x; no per-frame bbox normalization' },
  memory: { compressedSequenceBytes: frameBytes.reduce((sum, bytes) => sum + bytes.length, 0),
    decodedSequenceRgbaBytes: ready.decodedBytes, sequenceCapacity: ready.capacity,
    productionCachesAfterPreload: productionArtist.cacheStats(),
    limit: 'RGBA lower bound only, not process RSS/GPU memory. Baseline loads all production art for this diagnostic.' },
  runtime: { productionFullFrame: summarize(timings.productionFrame), sequenceOneBlit: summarize(timings.sequencePaint),
    limit: 'Different work scopes: production also handles scene, expression and effect logic. These measurements are diagnostic, not a like-for-like browser performance claim.' },
  limitations: ['Candidate run only, one view and one baked expression; no production integration',
    'Generated frames retain modest facial/volume identity drift; unique frames do not establish an artistic improvement',
    'Expressions, blink, outfits and major turns need extra authored clips or separately aligned layers',
    'Simple complete baking scales with actions × views × expressions × outfits × frames',
    'Smooth transitions and native Electron/GPU memory still require separate validation'] };
fs.writeFileSync(path.join(out, 'comparison-report.json'), JSON.stringify(report, null, 2));
const htmlManifest = { ...manifest, frames: manifest.frames.map((frame, index) => ({ ...frame, src: `data:image/png;base64,${frameBytes[index].toString('base64')}` })) };
fs.writeFileSync(path.join(out, 'index.html'), offlinePage({ playerSource: fs.readFileSync(new URL('./player.mjs', import.meta.url), 'utf8'),
  manifest: htmlManifest, videoBase64: fs.readFileSync(videoPath).toString('base64'),
  posterBase64: fs.readFileSync(path.join(out, 'comparison-poster.png')).toString('base64'), report }));
player.dispose(); harness.dispose();
for (const canvas of [rig, sequence, screen]) { canvas.width = 1; canvas.height = 1; }
console.log(JSON.stringify({ output: out, sequenceBytes: report.memory.compressedSequenceBytes,
  decodedBytes: report.memory.decodedSequenceRgbaBytes, runtime: report.runtime }, null, 2));
