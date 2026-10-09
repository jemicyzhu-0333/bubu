// Finite simulated-category visual evidence through the production renderer.
// This deliberately makes no native OS audio/helper or real AI hook claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';
import { createSessionActivityController } from '../../src/core/session-activity.mjs';
import { activityControllerContent, activityModeFor } from '../../src/surfaces/pet/activity-mirror.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/event-mirror-review'));
const backend = createRequire(import.meta.url)(arg('canvas-package') || process.env.USAGI_CANVAS_PACKAGE);
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
const sha = value => createHash('sha256').update(value).digest('hex');
const evidence = { version: 1, origin: 'Simulated category delivery into existing session controller and production renderer',
  sourceRoot: root, sourceSeal: arg('source-seal') || null,
  limitations: ['Not native OS probe or AI connector end-to-end', 'Offscreen Skia, not GPU/native desktop window',
    'Bounded authored rhythm, no BPM/content or true AI stage', 'No memory/stress test'], cases: [] };
fs.mkdirSync(out, { recursive: true });
const write = (file, data) => { fs.writeFileSync(path.join(out, file), data); return { file, bytes: data.length, sha256: sha(data) }; };
for (const skin of ['pink', 'usagi']) for (const category of ['music', 'ai'])
  for (const dpr of [1, 2]) for (const equipped of [false, true]) for (const facing of [1, -1]) {
    if (arg('skin') && skin !== arg('skin')) continue;
    if (arg('category') && category !== arg('category')) continue;
    let now = 0;
    const controller = createSessionActivityController({ ...activityControllerContent(source.sessions), clock: { now: () => now } });
    const outfit = !equipped ? [] : skin === 'pink'
      ? ['milestone.scarf', 'milestone.sunhat', 'milestone.boots']
      : USAGI_OUTFIT_SETS.find(value => value.id === 'rain-walk').itemIds;
    const name = `${skin}-${category}-${dpr}x-${equipped ? 'outfit' : 'bare'}-${facing}`;
    const harness = createRenderHarness(source, { skin, dpr, outfit, facing, blink: false,
      sessionActivityController: controller, expressionFor: () => controller.current(now)?.expression || 'life.idle' });
    harness.select('expression', 'life.idle'); harness.updateState({ devPreview: null, activityMirror: null });
    const activity = source.sessions.MIRROR_ACTIVITIES[`mirror-${category}`], duration = activity.durationMs;
    const entry = { name, skin, category, dpr, outfit, facing, durationMs: duration,
      view: 'production default (front); direction mirrored by facing', frames: [] };
    const times = [0, 100, 200, 400, 700, 1100, 1800, 3500, 6500, 10500, 15500, 20500,
      duration + 99, duration + 101, duration + 500, duration * 2 + 99, duration * 2 + 101,
      duration * 3 + 100, duration * 3 + 200, duration * 3 + 400, duration * 3 + 700, duration * 3 + 1100];
    const sheet = backend.createCanvas(219 * 6, 246 * 4), ctx = sheet.getContext('2d');
    ctx.fillStyle = '#edf1ed'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    try {
      for (const [i, time] of times.entries()) {
        now = time;
        if (i === 1) { controller.setMode(activityModeFor('idle', category), now); harness.updateState({ activityMirror: category }); }
        if (time === duration + 500) controller.setMode(activityModeFor('idle', category), now);
        if (time === duration * 3 + 100) { controller.setMode('idle', now); harness.updateState({ activityMirror: null }); }
        const frame = harness.draw(now), sampled = pixels(harness.body);
        assert.ok(sampled.occupied > 0, `${name}/${time} blank`);
        assert.equal(sampled.edge, 0, `${name}/${time} stage clipping`);
        const file = `${name}-${String(i).padStart(2, '0')}.png`, bytes = harness.body.toBuffer('image/png');
        entry.frames.push({ ...write(file, bytes), at: time, sourceActivity: controller.current(now)?.id || null,
          actionProgress: frame.state.currentActionProgress, mirrorPlayback: frame.mirrorPlayback,
          occupied: sampled.occupied, bounds: sampled.bounds, pixelHash: sampled.hash });
        const x = i % 6 * 219, y = Math.floor(i / 6) * 246;
        ctx.fillStyle = '#243831'; ctx.font = '11px sans-serif'; ctx.fillText(`${name} ${time}ms`, x + 4, y + 16);
        ctx.drawImage(await backend.loadImage(bytes), x, y + 25, 219, 219);
      }
      entry.sheet = write(`${name}-sheet.png`, sheet.toBuffer('image/png'));
      evidence.cases.push(entry);
    } finally { harness.dispose(); }
  }
write('evidence.json', Buffer.from(JSON.stringify(evidence, null, 2)));
console.log(JSON.stringify({ cases: evidence.cases.length, frames: evidence.cases.reduce((n, value) => n + value.frames.length, 0), out }));
