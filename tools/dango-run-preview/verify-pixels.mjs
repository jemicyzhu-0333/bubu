// Supplemental production-painter evidence for live expression and body-only tint.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { DANGO_RUN } from '../../assets/companion/dango/clips/run/dango-run.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { recordingContext } from '../../test-support/dango-raster-fixture.mjs';
import { ACTION, makePainter } from './painter.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const out = path.resolve(arg('out') || 'dist/dango-run-sample');
const painter = await makePainter(backend), at = 1500;
const screen = backend.createCanvas(1280, 350), context = screen.getContext('2d');
context.fillStyle = '#f1f3ef'; context.fillRect(0, 0, 1280, 350);
const variants = [{ label: 'Pink / running face', colors: PALETTES.pink },
  { label: 'Forest / same body mask', colors: PALETTES.forest },
  { label: 'Pink / live blink', colors: PALETTES.pink, blinking: true },
  { label: 'Forest / feedback expression', colors: PALETTES.forest,
    intent: { action: { ...ACTION, expression: 'play.chase' }, expressionId: 'react.startled',
      face: { eyes: 'surprised', mouth: 'open', openness: 1 } } }];
for (const [i, variant] of variants.entries()) {
  const x = i * 320;
  context.fillStyle = 'white'; context.fillRect(x + 8, 12, 304, 317);
  context.fillStyle = '#27383e'; context.font = '17px sans-serif'; context.fillText(variant.label, x + 18, 37);
  context.save(); context.translate(x - 59, -47); context.scale(3, 3);
  painter.compose(context, at, { root: false, effects: false, ...variant }); context.restore();
  context.fillStyle = '#516269'; context.font = '12px sans-serif';
  context.fillText('Same run pose / separate production face', x + 18, 315);
}
fs.writeFileSync(path.join(out, 'dango-run-live-face-and-palette.png'), screen.toBuffer('image/png'));
function imagePixels(image) {
  const canvas = backend.createCanvas(256, 256), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 256, 256).data;
}
const artwork = painter.sample(at);
function paintedBody(colors) {
  const record = recordingContext(); painter.artist.body(record, colors, artwork.view, artwork);
  if (record.calls.length !== 1) throw Error('Expected one physical frame');
  return imagePixels(record.calls[0].image);
}
const pink = paintedBody(PALETTES.pink), forest = paintedBody(PALETTES.forest);
const maskAsset = DANGO_RUN.manifest.resourceGroups[0].assets.find(asset => asset.id === artwork.clip.bodyRecolorMask);
const mask = imagePixels(await backend.loadImage(fs.readFileSync(new URL(maskAsset.src, DANGO_RUN.baseUrl))));
let changed = 0, changedOutsideMask = 0, alphaChanges = 0;
for (let i = 0; i < pink.length; i += 4) {
  if (pink[i + 3] !== forest[i + 3]) alphaChanges++;
  if ([0, 1, 2].some(c => pink[i + c] !== forest[i + c])) { changed++; if (!mask[i + 3]) changedOutsideMask++; }
}
if (!changed || changedOutsideMask || alphaChanges) throw Error('Body-only palette mask invariant failed');
const decoded = path.join(out, 'decoded-video-frame.png');
const video = path.join(out, 'dango-run-normal-speed-comparison.mp4');
const ffmpeg = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-i', video, '-ss', '1.5', '-frames:v', '1', decoded], { encoding: 'utf8' });
if (ffmpeg.status !== 0) throw Error(ffmpeg.stderr);
const image = await backend.loadImage(decoded);
if (image.width !== 1120 || image.height !== 760) throw Error('Decoded MP4 frame geometry mismatch');
const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', video], { encoding: 'utf8' });
if (probe.status !== 0) throw Error(probe.stderr);
const stream = JSON.parse(probe.stdout).streams[0];
if (Number(stream.nb_read_frames) !== 570 || Number(stream.duration) !== 9.5 || stream.r_frame_rate !== '60/1') throw Error('Decoded MP4 timing mismatch');
const reportPath = path.join(out, 'evidence.json'), report = JSON.parse(fs.readFileSync(reportPath));
report.pixelVerification = { palette: 'forest', changedBodyPixels: changed, changedOutsideBodyMask: changedOutsideMask,
  alphaChanges, faceProof: 'Visible neutral, blink and high-priority surprised/open overlays; integration tests assert source sprite and matrix changes independently from the body',
  decodedVideo: stream };
report.visual.authoredRootTravelPerStrideDesignUnits = DANGO_RUN.manifest.rootTravelPerLoop;
report.visual.max24HoldQuantizationCssPx = DANGO_RUN.manifest.rootTravelPerLoop / 24 * 1.5;
report.visual.quantizationMeaning = 'At authored keyframes a matching linear root can cancel stance motion. A held pose under continuous root travel can slip by up to one 24th-stride step; this is not a continuous <=1 CSS px non-slip result.';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'preview-report.md'), `\n## Supplemental pixel and video verification\n\n- Forest palette: ${changed} body pixels changed; ${changedOutsideMask} changes outside body-only mask; ${alphaChanges} alpha changes\n- Independent live blink and surprised/open expression shown in supplemental still; body frame unchanged\n- Independent MP4 decode: ${stream.nb_read_frames} frames, ${stream.duration}s, ${stream.r_frame_rate} fps, ${stream.width} × ${stream.height}\n- 24-hold stepping under matching continuous root travel has a ${(report.visual.max24HoldQuantizationCssPx).toFixed(3)} CSS px upper-bound quantization step. Keyframe support is exact; continuous <=1px world no-slip is not established.\n`);
painter.dispose(); console.log(JSON.stringify(report.pixelVerification, null, 2));
