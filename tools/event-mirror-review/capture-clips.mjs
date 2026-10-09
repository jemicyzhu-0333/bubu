// Whole-cycle playback clips from simulated category events, not OS hooks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';
import { createSessionActivityController } from '../../src/core/session-activity.mjs';
import { activityControllerContent, activityModeFor } from '../../src/surfaces/pet/activity-mirror.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/event-mirror-clips'));
const backend = createRequire(import.meta.url)(arg('canvas-package') || process.env.USAGI_CANVAS_PACKAGE);
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
fs.mkdirSync(out, { recursive: true });
const results = { origin: 'Simulated categories, real production renderer and existing activity controller',
  sourceSeal: arg('source-seal') || null,
  coverage: 'One complete category loop, entry, repeated category refresh, loop seam, null exit; 12 fps; DPR2 dressed',
  limits: ['Not native desktop, real audio or AI connector', 'No private contents or BPM', 'No memory/stress evidence'], clips: [] };
for (const skin of ['pink', 'usagi']) for (const category of ['music', 'ai']) {
  let now = 0;
  const controller = createSessionActivityController({ ...activityControllerContent(source.sessions), clock: { now: () => now } });
  const outfit = skin === 'pink' ? ['milestone.scarf', 'milestone.sunhat', 'milestone.boots']
    : USAGI_OUTFIT_SETS.find(value => value.id === 'rain-walk').itemIds;
  const harness = createRenderHarness(source, { skin, dpr: 2, outfit, facing: 1, blink: true,
    sessionActivityController: controller, expressionFor: () => controller.current(now)?.expression || 'life.idle' });
  harness.select('expression', 'life.idle'); harness.updateState({ devPreview: null });
  const duration = source.sessions.MIRROR_ACTIVITIES[`mirror-${category}`].durationMs;
  const name = `${skin}-${category}`, folder = path.join(out, name);
  fs.mkdirSync(folder, { recursive: true });
  const canvas = backend.createCanvas(438, 438), ctx = canvas.getContext('2d');
  const trace = [], fps = 12, end = duration + 3000;
  let began = false, stopped = false, repeated = false;
  try {
    for (let i = 0; i <= Math.ceil(end / 1000 * fps); i++) {
      now = i / fps * 1000;
      if (!began && now >= 500) { began = true; controller.setMode(activityModeFor('idle', category), now); }
      if (!repeated && now >= 12000) { repeated = true; controller.setMode(activityModeFor('idle', category), now); }
      if (!stopped && now >= duration + 1500) { stopped = true; controller.setMode('idle', now); }
      const frame = harness.draw(now), sampled = pixels(harness.body);
      if (!sampled.occupied || sampled.edge) throw new Error(`${name}/${i}: blank or edge clipping`);
      ctx.fillStyle = '#edf1ed'; ctx.fillRect(0, 0, 438, 438); ctx.drawImage(harness.body, 0, 0);
      ctx.fillStyle = '#33483d'; ctx.font = '13px sans-serif';
      ctx.fillText(`${name} | simulated category | ${frame.mirrorPlayback?.phase || 'idle'}`, 8, 22);
      fs.writeFileSync(path.join(folder, `${String(i).padStart(5, '0')}.png`), canvas.toBuffer('image/png'));
      trace.push({ frame: i, at: now, activity: controller.current(now)?.id || null,
        mirrorPlayback: frame.mirrorPlayback, pixelHash: sampled.hash, bounds: sampled.bounds });
    }
    const video = path.join(out, `${name}.mp4`);
    const encoding = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(folder, '%05d.png'),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { encoding: 'utf8' });
    if (encoding.status !== 0) throw new Error(encoding.stderr);
    fs.writeFileSync(path.join(out, `${name}-trace.json`), JSON.stringify(trace, null, 2));
    results.clips.push({ name, video, frames: trace.length, durationMs: end, fps, skin, category, outfit });
  } finally { harness.dispose(); }
}
fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.clips));
