import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';

const [before, after, output, raw] = process.argv.slice(2), item = JSON.parse(raw);
const backend = createRequire(import.meta.url)(process.env.USAGI_CANVAS_PACKAGE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement() { return backend.createCanvas(1, 1); } };
globalThis.window = { devicePixelRatio: 2 };
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const pair = [], sourceHashes = [];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const baseline = JSON.parse(fs.readFileSync(new URL('r1-baseline-hashes.json', import.meta.url)));
for (const root of [before, after]) {
  const source = await loadSource(pathToFileURL(root).href, {
    interactions: await load(root, 'src/content/interactions.js'), interactionPlayback: await load(root, 'src/surfaces/pet/interaction-playback.mjs')
  });
  const { USAGI_OUTFIT_SETS } = await load(root, 'src/content/companion/usagi-wardrobe.mjs');
  const h = createRenderHarness(source, { skin: 'usagi', dpr: 2, view: item.view || 'front', facing: item.facing || 1,
    outfit: !item.outfit || item.outfit === 'bare' ? false : USAGI_OUTFIT_SETS.find(set => set.id === item.outfit).itemIds });
  h.select(item.kind || 'action', item.id); pair.push(h);
  sourceHashes.push(Object.fromEntries(Object.keys(baseline).filter(p => /^(src|assets)\//.test(p))
    .map(p => [p, sha(fs.readFileSync(path.join(root, p)))])));
}
fs.mkdirSync(path.dirname(output), { recursive: true });
const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
  '-framerate', '30', '-i', '-', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', output],
{ stdio: ['pipe', 'ignore', 'pipe'] });
let encoderError = ''; encoder.stderr.on('data', bytes => { encoderError += bytes; });
const exited = once(encoder, 'exit');
const target = backend.createCanvas(900, 508), ctx = target.getContext('2d');
const composite = pair.map(() => backend.createCanvas(440, 440));
const duration = pair[1].current.duration, startMs = item.startMs || 0, endMs = item.endMs || duration;
for (let at = 0; at < startMs; at += 1000 / 30) pair.forEach(h => h.draw(at));
const frames = Math.ceil((endMs - startMs) / 1000 * 30) + 1;
const evidence = [];
for (let index = 0; index < frames; index++) {
  const at = startMs + index * 1000 / 30;
  ctx.fillStyle = '#e8eeee'; ctx.fillRect(0, 0, 900, 508);
  ctx.fillStyle = '#18323c'; ctx.font = '18px sans-serif';
  ctx.fillText(`R1 baseline · ${item.id}`, 10, 25); ctx.fillText('Expansion candidate', 460, 25);
  ctx.font = '14px sans-serif'; ctx.fillText(`${item.view || 'front'} · ${item.outfit || 'bare'} · ${(at / 1000).toFixed(2)}s · body + scene + effects`, 10, 50);
  const views = [];
  for (const [side, h] of pair.entries()) {
    const frame = h.draw(at);
    const effectiveView = h.source.formArt.resolveView(h.form, item.view || 'front',
      { action: frame.state.currentRenderedAction, state: frame.state.state });
    views.push(effectiveView);
    h.composite(composite[side]);
    ctx.drawImage(composite[side], side * 450 + 5, 63);
  }
  const png = target.toBuffer('image/png');
  if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
  if (index % 15 === 0 || index === frames - 1) evidence.push({ index, at, requestedView: item.view || 'front', effectiveViews: views });
}
encoder.stdin.end();
const [code] = await exited;
if (code !== 0) throw new Error(`Encoder failed ${code}: ${encoderError}`);
pair.forEach(h => h.dispose());
for (const [index, root] of [before, after].entries()) for (const [file, hash] of Object.entries(sourceHashes[index])) {
  if (sha(fs.readFileSync(path.join(root, file))) !== hash) throw new Error('Source changed during clip: ' + file);
}
fs.writeFileSync(output + '.json', JSON.stringify({ item, before, after, frames, fps: 30, sourceSeals: sourceHashes.map(h => sha(JSON.stringify(h))),
  sha256: sha(fs.readFileSync(output)), scope: 'Continuous production cached-body renderer; body, scene and effects. Offscreen Skia, not native desktop acceptance.', evidence }, null, 2) + '\n');
console.log(JSON.stringify({ output, frames, sourceSeals: sourceHashes.map(h => sha(JSON.stringify(h))) }));
