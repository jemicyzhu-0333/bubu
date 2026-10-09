// Continuous comparison clips from the same production renderer, encoded by
// locally installed FFmpeg. Browser/Electron compositor behavior is not claimed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from './offscreen-images.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const require = createRequire(import.meta.url), backend = require(arg('canvas-package'));
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D; globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('./runtime-harness.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = await loadSource(pathToFileURL(path.resolve(arg('baseline') || root)).href);
const current = await loadSource(pathToFileURL(root).href);
const dango = arg('form') === 'dango', skin = arg('skin') || 'pink';
const variants = (dango ? [
  { id: 'baseline', label: 'DANGO BEFORE', source: baseline, skin },
  { id: 'current', label: 'DANGO REDESIGN', source: current, skin }
] : [{ id: 'dango', label: 'DEFAULT DANGO', source: baseline, skin: 'pink' },
  { id: 'baseline', label: 'USAGI BEFORE', source: baseline, skin: 'usagi' },
  { id: 'current', label: 'USAGI CURRENT', source: current, skin: 'usagi' }]).filter(item => !arg('variants') || arg('variants').split(',').includes(item.id));
const kind = arg('kind') || 'session';
const ids = (arg('ids') || 'focus-type,focus-read,rest-plant,rest-tea').split(',');
const out = path.resolve(arg('out') || 'dist/usagi-gallery-video'); fs.mkdirSync(out, { recursive: true });
const fps = Math.max(6, Math.min(60, Number(arg('fps') || 15))), records = [];
for (const id of ids) {
  const stages = variants.map(v => { const harness = createRenderHarness(v.source, { skin: v.skin, dpr: 2,
    view: arg('view') || 'auto', scene: arg('scene') || 'cozy-room',
    outfit: arg('outfit-ids')?.split(',') || !process.argv.includes('--bare'), level: 25 });
    const selected = harness.select(kind, id); return { ...v, harness, selected }; });
  const duration = stages[0].selected.duration, frameCount = Math.ceil(duration / 1000 * fps);
  const file = path.join(out, `${kind}-${id}.mp4`), screen = backend.createCanvas(variants.length * 440, 540), context = screen.getContext('2d');
  const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
    '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = ''; encoder.stderr.on('data', data => { errors += data; });
  const exited = once(encoder, 'exit');
  for (let frame = 0; frame < frameCount; frame++) {
    const at = frame / fps * 1000; context.fillStyle = '#eef3f3'; context.fillRect(0, 0, screen.width, 540);
    context.fillStyle = '#274454'; context.font = '20px sans-serif'; context.fillText(`${kind} / ${id}  -  ${(at / 1000).toFixed(2)}s / ${duration / 1000}s`, 24, 29);
    for (const [i, stage] of stages.entries()) {
      stage.harness.draw(at); const composite = stage.harness.composite();
      context.drawImage(composite, i * 440, 42, 440, 440); composite.width = 1; composite.height = 1;
      context.fillStyle = '#36566a'; context.font = '17px sans-serif'; context.fillText(stage.label, i * 440 + 28, 492);
      const action = ['action', 'session'].includes(kind) ? stage.selected.item : null;
      const sampled = stage.source.formArt.sampleAction?.(stage.harness.form, action, at / duration) || { action };
      context.font = '13px sans-serif'; context.fillText(`${sampled.action?.motion || 'idle'} / ${sampled.action?.prop || 'none'}${sampled.phase ? ` / phase ${sampled.phase.index + 1}` : ''}`, i * 440 + 28, 514);
    }
    context.font = '8px sans-serif'; context.fillStyle = '#69818a';
    context.fillText('PRODUCTION CANVAS / OFFSCREEN SKIA / LOCAL EVIDENCE', 24, 526);
    context.fillText('Native desktop, browser compositor and GPU playback not verified', 24, 538);
    if (!encoder.stdin.write(screen.toBuffer('image/png'))) await once(encoder.stdin, 'drain');
  }
  encoder.stdin.end(); const [code] = await exited; if (code) throw new Error(`FFmpeg: ${errors}`);
  for (const stage of stages) stage.harness.dispose();
  screen.width = 1; screen.height = 1; globalThis.gc?.();
  records.push({ id, kind, file: path.basename(file), durationMs: duration, frames: frameCount, fps,
    baselineRef: arg('baseline-ref') || 'unversioned-local-source',
    renderer: 'Offscreen Skia Canvas / production createPetRenderer', scene: arg('scene') || 'session room' });
  console.log(`${id}: ${frameCount} sequential frames / ${duration / 1000}s → ${file}`);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(records, null, 2));
}
