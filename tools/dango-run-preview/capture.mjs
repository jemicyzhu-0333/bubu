// Run with an existing @napi-rs/canvas package; no install or desktop is needed.
// node tools/dango-run-preview/capture.mjs --canvas-package=/absolute/path/to/@napi-rs/canvas
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DANGO_RUN } from '../../assets/companion/dango/clips/run/dango-run.mjs';
import { ACTION, CSS_PER_UNIT, makePainter } from './painter.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const packagePath = arg('canvas-package');
if (!packagePath) throw Error('Pass --canvas-package=/absolute/path/to/existing/@napi-rs/canvas');
const backend = createRequire(import.meta.url)(packagePath);
const out = path.resolve(arg('out') || 'dist/dango-run-sample');
fs.mkdirSync(out, { recursive: true });
const before = await makePainter(backend, { authored: false }), after = await makePainter(backend);
const width = 1120, height = 760, fps = 60, frameCount = ACTION.duration / 1000 * fps;
const screen = backend.createCanvas(width, height), context = screen.getContext('2d');
const cell = 560, titleColor = '#27383e', textColor = '#516269';
const palettes = { paper: '#f1f3ef', panel: '#ffffff', line: '#b3c3bd' };
function label(text, x, y, size = 16, color = textColor) {
  context.fillStyle = color; context.font = `${size}px sans-serif`; context.fillText(text, x, y);
}
function stage(painter, at, x, y, scale) {
  context.save(); context.translate(x, y); context.scale(scale, scale);
  context.strokeStyle = palettes.line; context.lineWidth = .5;
  context.beginPath(); context.moveTo(17, 104); context.lineTo(129, 104); context.stroke();
  painter.compose(context, at); context.restore();
}
function render(at) {
  context.fillStyle = palettes.paper; context.fillRect(0, 0, width, height);
  label('DANGO / CHASE LASER', 30, 34, 23, titleColor);
  label(`NORMAL SPEED  |  950ms STRIDE  |  ${(at / 1000).toFixed(2)}s / 9.50s`, 625, 32, 15);
  for (const [i, painter] of [before, after].entries()) {
    context.fillStyle = palettes.panel; context.fillRect(i * cell + 16, 55, cell - 32, height - 110);
    label(i ? 'AUTHORED 24-POSE SAMPLE' : 'CURRENT PROCEDURAL RIG', i * cell + 36, 84, 19, titleColor);
    label('99 CSS px design width / 1x', i * cell + 36, 111, 14);
    stage(painter, at, i * cell + (cell - 219) / 2, 118, CSS_PER_UNIT);
    label('Same view / 2x enlargement', i * cell + 36, 359, 14);
    stage(painter, at, i * cell + (cell - 438) / 2, 295, CSS_PER_UNIT * 2);
  }
  label('Production artist / offscreen Skia | Separate live eyes + mouth | Same root x choreography', 28, 728, 14);
  label('99px is body design width. Native window / browser compositor / GPU and memory are not measured.', 28, 749, 12);
}
const video = path.join(out, 'dango-run-normal-speed-comparison.mp4');
const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
  '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
  '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', data => { errors += data; });
const exited = once(encoder, 'exit');
for (let i = 0; i < frameCount; i++) {
  render(i / fps * 1000);
  if (i === 90) fs.writeFileSync(path.join(out, 'dango-run-representative.png'), screen.toBuffer('image/png'));
  if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
}
encoder.stdin.end(); const [code] = await exited;
if (code) throw Error(`ffmpeg: ${errors}`);
const videoBytes = fs.statSync(video).size;
if (videoBytes > 8 * 1024 * 1024) throw Error(`Video exceeds 8MiB: ${videoBytes}`);

const sheet = backend.createCanvas(1584, 1180), sctx = sheet.getContext('2d');
sctx.fillStyle = palettes.paper; sctx.fillRect(0, 0, sheet.width, sheet.height);
sctx.fillStyle = titleColor; sctx.font = '22px sans-serif';
sctx.fillText('24 AUTHOR-DEFINED PHASES / PRODUCTION BODY + LIVE FACE / FIXED ROOT', 22, 30);
const metrics = [], group = DANGO_RUN.manifest.resourceGroups[0];
const sourceFace = after.sample(0).data.face;
const eye = sourceFace.eyes.neutral[0].pivot;
const transformPoint = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
for (let i = 0; i < 24; i++) {
  const at = (i + .25) / 24 * DANGO_RUN.manifest.durationMs;
  const col = i % 6, row = Math.floor(i / 6), x = col * 264, y = 48 + row * 280;
  sctx.save(); sctx.beginPath(); sctx.rect(x, y, 264, 280); sctx.clip();
  sctx.fillStyle = 'white'; sctx.fillRect(x + 5, y + 3, 254, 272);
  sctx.strokeStyle = palettes.line; sctx.beginPath(); sctx.moveTo(x + 10, y + 225); sctx.lineTo(x + 254, y + 225); sctx.stroke();
  sctx.save(); sctx.translate(x - 93, y - 87); sctx.scale(3, 3);
  const artwork = after.compose(sctx, at, { root: false, effects: false }); sctx.restore();
  sctx.fillStyle = textColor; sctx.font = '13px sans-serif';
  const contact = artwork.clip.contactPhase;
  sctx.fillText(`${String(i + 1).padStart(2, '0')} / ${(i / 24).toFixed(3)}  L:${contact.left} R:${contact.right}`, x + 14, y + 256);
  sctx.restore();
  const sample = backend.createCanvas(438, 438), sampleCtx = sample.getContext('2d');
  sampleCtx.scale(3, 3); after.compose(sampleCtx, at, { root: false, effects: false });
  const pixels = sampleCtx.getImageData(0, 0, 438, 438).data;
  let minX = 438, minY = 438, maxX = -1, maxY = -1;
  for (let py = 0; py < 438; py++) for (let px = 0; px < 438; px++) if (pixels[(py * 438 + px) * 4 + 3] > 10) {
    minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  }
  metrics.push({ phase: i / 24, poseId: artwork.clip.poseId, frame: artwork.clip.frame, contacts: contact,
    anchors: artwork.clip.semanticAnchors, faceTransform: artwork.clip.faceTransform,
    leftEyeAnchor: transformPoint(artwork.clip.faceTransform, eye),
    foregroundCssBounds: [(minX / 3 - 40) * 1.5, (minY / 3 - 40) * 1.5, (maxX - minX + 1) / 2, (maxY - minY + 1) / 2],
    stageClipped: minX === 0 || minY === 0 || maxX === 437 || maxY === 437 });
}
fs.writeFileSync(path.join(out, 'dango-run-24-phase-sheet.png'), sheet.toBuffer('image/png'));
const maxStep = key => Math.max(...metrics.map((pose, i) => Math.hypot(...pose[key].map((v, c) => v - metrics[(i + 1) % 24][key][c]))));
const supports = metrics.flatMap(pose => ['left', 'right'].filter(side => pose.contacts[side] === 'support').map(side => ({
  phase: pose.phase, side, anchor: pose.anchors[`foot-${side}`], yError: Math.abs(pose.anchors[`foot-${side}`][1] - DANGO_RUN.manifest.groundAnchor[1]) })));
const supportError = Math.max(...supports.map(s => s.yError));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video], { encoding: 'utf8' });
if (probe.status !== 0) throw Error('ffprobe failed');
const report = {
  renderer: 'Production createDangoRasterArtist painter; offscreen Skia; not native Electron or complete renderer scheduling',
  composition: ['applyMotionTransform', 'motionOffset', 'action(back)', 'body', 'face', 'bodyForeground', 'action(front)'],
  action: ACTION, view: 'three-quarter', skin: 'pink', outfit: [],
  timing: { strideMs: 950, durationMs: ACTION.duration, fps, frames: frameCount, authoredUniqueFrames: new Set(metrics.map(m => m.frame)).size },
  scale: { designUnits: 66, pixelsPerUnit: CSS_PER_UNIT, designWidthCssPx: 99, enlargedDesignWidthPx: 198 },
  assets: { contentVersion: DANGO_RUN.manifest.contentVersion, identityRefSha256: DANGO_RUN.identityRefSha256,
    frameCount: group.assets.length, assetBytes: group.assets.reduce((sum, asset) => sum + fs.statSync(new URL(asset.src, DANGO_RUN.baseUrl)).size, 0) },
  visual: { clippedPoses: metrics.filter(m => m.stageClipped).length,
    maxAuthoredSupportAnchorYErrorDesignUnits: supportError,
    maxAdjacentEyeAnchorStepCssPx: maxStep('leftEyeAnchor') * CSS_PER_UNIT,
    maxForegroundHeightCssPx: Math.max(...metrics.map(m => m.foregroundCssBounds[3])),
    minForegroundHeightCssPx: Math.min(...metrics.map(m => m.foregroundCssBounds[3])),
    supportMeaning: 'Authored local support labels and anchors are measured against the fixed local floor. This does not prove world-space non-slip under existing chase root x sway.',
    faceMeaning: 'Face pixels remain separate production eyes/mouth. The reported anchor movement includes intentional authored torso motion and is not a perceptual jitter score.',
    identityMeaning: 'Identity is tied to source reference hashes and reusable layers, not scored by an automatic identity classifier.' },
  video: { filename: path.basename(video), bytes: videoBytes, sha256: sha256(video), ffprobe: JSON.parse(probe.stdout) },
  cache: { current: before.artist.cacheStats(), sample: after.artist.cacheStats() },
  phases: metrics,
  limitations: ['No native desktop/compositor/GPU verification', 'No memory or renderer scheduler measurements', 'No wardrobe support claimed', 'No whole-character 99px-height claim']
};
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'preview-report.md'), `# Dango authored run preview\n\nProduction artist composition, offscreen Skia. Same three-quarter view, pink skin, no outfit. Existing x-only root choreography is retained in both video columns. The contact sheet uses fixed-root local poses.\n\n- Normal speed: 950ms stride; 9.5 seconds; 60fps / ${frameCount} frames\n- Normal body design width: 99 CSS px; same-view enlargement: 198px\n- Video: ${(videoBytes / 1024 / 1024).toFixed(2)} MiB (8 MiB limit)\n- Unique authored frames: ${report.timing.authoredUniqueFrames}\n- Stage-clipped poses: ${report.visual.clippedPoses}/24\n- Support-anchor floor error: ${supportError.toFixed(3)} design units\n- Largest adjacent left-eye anchor move: ${report.visual.maxAdjacentEyeAnchorStepCssPx.toFixed(3)} CSS px, including intended pose motion\n- Actual foreground height: ${report.visual.minForegroundHeightCssPx.toFixed(1)}–${report.visual.maxForegroundHeightCssPx.toFixed(1)} CSS px\n\nSeparate live eyes and mouth are painted by the production face module; no preview-specific character reconstruction is used. Identity is traceable to the asset reference hashes, not a numerical identity-quality claim.\n\nSupport labels and semantic anchors are local metadata checks. They do not establish world-space no-slip while the unchanged root x choreography moves. Native desktop behavior, GPU compositing, memory and full renderer scheduling are unverified.\n`);
before.dispose(); after.dispose();
console.log(JSON.stringify({ out, videoBytes, visual: report.visual, source: report.cache.sample.source }, null, 2));
