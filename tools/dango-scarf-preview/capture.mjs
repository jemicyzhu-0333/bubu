// Existing local Skia dependency only. No browser, native window or new art.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { ACTION, SCARF, CSS_PER_UNIT, COMPOSITION, makeRuntime, makeIsolatedPainter, intent } from './painter.mjs';
import { auditDepth, traceProductionDraw, renderLayers } from './audit.mjs';
import { pixels, summarize } from '../usagi-gallery/pixels.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package')) throw Error('Pass --canvas-package=/absolute/path/to/existing/@napi-rs/canvas');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const out = path.resolve(arg('out') || 'dist/dango-scarf-review'); fs.mkdirSync(out, { recursive: true });
const runtime = await makeRuntime(backend), isolated = await makeIsolatedPainter(backend);
const initial = isolated.artist.resolveArtwork(intent(1500));
if (!initial.ready || initial.clip || initial.runFootTiming !== 'forward-recovery') throw Error('Scarf production timing is not ready');
const depth = auditDepth(backend, isolated);
if (depth.maxClothFaceOverlap || depth.edgeTouchFrames || depth.minIdleTorsoOcclusionFraction !== 1) throw Error('Scarf depth failed');
const width = 1120, height = 888, fps = 60, frames = 570;
const screen = backend.createCanvas(width, height), context = screen.getContext('2d');
const title = '#263a3a', text = '#52645f', paper = '#eef2ed';
function label(value, x, y, size = 14, color = text) {
  context.fillStyle = color; context.font = `${size}px sans-serif`; context.fillText(value, x, y);
}
const records = runtime.cases.map(item => ({ running: item.running, outfit: item.outfit, frames: [], transforms: [] }));
function render(at, frame) {
  context.fillStyle = paper; context.fillRect(0, 0, width, height);
  label('DANGO / EXISTING SCARF', 24, 32, 23, title);
  label(`NORMAL SPEED / 950 ms stride / ${(at / 1000).toFixed(2)} s`, 665, 30, 15);
  for (const [i, item] of runtime.cases.entries()) {
    const col = i % 2, row = Math.floor(i / 2), x = col * 560 + 12, y = row * 396 + 53;
    context.fillStyle = 'white'; context.fillRect(x, y, 536, 384);
    label(`${item.running ? 'RUNNING' : 'IDLE'} / ${item.outfit ? 'EXISTING SCARF' : 'BARE BODY'}`, x + 20, y + 28, 18, title);
    label('99 CSS px body width', x + 24, y + 61, 13);
    label('2x enlargement / 198 px', x + 286, y + 61, 13);
    if (frame % 30 === 0) records[i].transforms.push(traceProductionDraw(item.harness, at));
    else item.harness.draw(at);
    const sample = pixels(item.harness.body);
    if (153 + sample.bounds.right >= 536 || 153 + sample.bounds.left < 0) throw Error('Enlarged preview exceeds its panel');
    records[i].frames.push({ at, hash: sample.hash, occupied: sample.occupied,
      edge: sample.edge, bounds: sample.bounds });
    // One fixed runtime design scale throughout. No alpha-height normalisation.
    const floor = y + 319;
    context.strokeStyle = '#c3d1c7'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(x + 18, floor); context.lineTo(x + 514, floor); context.stroke();
    context.drawImage(item.harness.body, x + 4, floor - 156, 219, 219);
    context.drawImage(item.harness.body, x + 153, floor - 312, 438, 438);
    label(item.running ? 'Shared body breathing, lean, step and root movement' : 'Production idle expression and shared whole-body motion', x + 20, y + 362, 12);
  }
  label('Actual production renderer / offscreen Skia / separate body, face and scarf front + back layers', 24, 861, 13);
  label('99 px is body design width; native window, browser compositor, GPU and memory are not measured.', 24, 880, 12);
}
const video = path.join(out, 'dango-scarf-run-idle.mp4');
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
  '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', chunk => { errors += chunk; }); const exited = once(encoder, 'exit');
for (let frame = 0; frame < frames; frame++) {
  render(frame / fps * 1000, frame);
  if ([90, 129, 150, 180, 270, 480].includes(frame)) fs.writeFileSync(path.join(out, `frame-${String(frame).padStart(3, '0')}.png`), screen.toBuffer('image/png'));
  if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited; if (code) throw Error(errors);
const videoBytes = fs.statSync(video).size; if (videoBytes > 8 * 1024 * 1024) throw Error('Video exceeds 8 MiB');
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video], { encoding: 'utf8' });
if (probe.status) throw Error('ffprobe failed');
const sheet = backend.createCanvas(1120, 500), sheetCtx = sheet.getContext('2d');
sheetCtx.fillStyle = paper; sheetCtx.fillRect(0, 0, 1120, 500); sheetCtx.fillStyle = title; sheetCtx.font = '21px sans-serif';
sheetCtx.fillText('EXISTING SCARF / LAYER ISOLATION / THREE-QUARTER RUN', 22, 32);
for (const [i, selected] of [['garment-back'], ['body-and-roots'], ['garment-front'], COMPOSITION].entries()) {
  const { canvas } = renderLayers(backend, isolated, intent(2350), selected);
  sheetCtx.drawImage(canvas, i * 280 - 78, 40, 438, 438);
  sheetCtx.font = '13px sans-serif'; sheetCtx.fillText(['Hidden return cloth', 'Original body + moving roots', 'Visible collar + hanging end', 'Actual ordered composition'][i], i * 280 + 14, 461);
}
fs.writeFileSync(path.join(out, 'scarf-depth-layers.png'), sheet.toBuffer('image/png'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const assets = Object.entries(DANGO_RASTER.appearance.scarf.views).flatMap(([view, layers]) => Object.entries(layers).flatMap(([layer, sprites]) => sprites.map(sprite => ({ view, layer, src: sprite.src, rect: sprite.rect,
  sha256: sha256(fs.readFileSync(new URL(sprite.src, DANGO_RASTER.baseUrl))) }))));
const summary = records.map(record => {
  const { maxAdjacentChange, ...measured } = summarize(record.frames);
  return { running: record.running, outfit: record.outfit, ...measured };
});
const report = { renderer: 'Actual createPetRenderer, normal production Dango artist, offscreen Skia',
  composition: COMPOSITION, action: ACTION, item: { id: SCARF.id, renderKey: SCARF.renderKey },
  artChanges: false, clip: null, timing: { runFootTiming: initial.runFootTiming, strideMs: 950, durationMs: 9500, fps, frames },
  scale: { designUnits: 66, cssPerUnit: CSS_PER_UNIT, bodyWidthCssPx: 99, enlargedBodyWidthPx: 198 },
  supportedViews: ['front', 'three-quarter', 'back'], fallback: 'Profile aliases three-quarter; back chase-laser requests use semantic three-quarter fallback; left-facing uses the existing runtime mirror. The accepted foot timing is three-quarter only.',
  depth, summary, assets, video: { filename: path.basename(video), bytes: videoBytes, sha256: sha256(fs.readFileSync(video)), ffprobe: JSON.parse(probe.stdout) },
  records, limitations: ['Offscreen evidence does not establish native-window or browser-compositor acceptance', 'No GPU or memory claim', 'No whole-character 99px-height claim', 'No new scarf art or independent cloth sway'] };
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, videoBytes, depth: { ...depth, records: undefined }, summary }, null, 2));
runtime.dispose(); isolated.dispose();
