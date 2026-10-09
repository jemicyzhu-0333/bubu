import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';

const [root, output, rawCases] = process.argv.slice(2);
const cases = JSON.parse(rawCases);
const require = createRequire(import.meta.url);
const backend = require(process.env.USAGI_CANVAS_PACKAGE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement(tag) { if (tag !== 'canvas') throw new Error(tag); return backend.createCanvas(1, 1); } };
globalThis.window = { devicePixelRatio: 2 };
const load = file => import(pathToFileURL(path.join(root, file)).href);
const source = await loadSource(pathToFileURL(root).href, {
  interactions: await load('src/content/interactions.js'),
  interactionPlayback: await load('src/surfaces/pet/interaction-playback.mjs')
});
const playback = await load('src/surfaces/pet/action-playback.mjs');
const { USAGI_OUTFIT_SETS } = await load('src/content/companion/usagi-wardrobe.mjs');
const content = { ...source.behaviors, ...source.sessions };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = JSON.parse(fs.readFileSync(new URL('r1-baseline-hashes.json', import.meta.url)));
const sourceHashes = Object.fromEntries(Object.keys(files).filter(file => /^(src|assets)\//.test(file))
  .map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
const seal = sha(JSON.stringify(sourceHashes));
fs.mkdirSync(output, { recursive: true });
const evidence = [];
for (const [caseIndex, item] of cases.entries()) {
  const { kind = 'action', id, view = 'front', outfit = 'bare', facing = 1, calm = false, dpr = 2,
    phases = [.12, .5, .88] } = item;
  const h = createRenderHarness(source, { skin: 'usagi', view, dpr, facing, calm,
    outfit: outfit === 'bare' ? false : USAGI_OUTFIT_SETS.find(set => set.id === outfit).itemIds });
  h.select(kind, id);
  const cell = h.body.width, columns = Math.min(4, phases.length), rowHeight = cell + 32;
  const sheet = backend.createCanvas(cell * columns, Math.ceil(phases.length / columns) * rowHeight + 32);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e8eeee'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = '#18323c'; ctx.font = '17px sans-serif';
  ctx.fillText(`${id} · ${outfit} · request ${view} · mirror ${facing === -1} · ${dpr}×`, 8, 22);
  const frames = [];
  let previousAt = 0;
  if (item.warmFps) h.draw(0);
  for (const [index, phase] of phases.entries()) {
    const at = h.current.duration * phase;
    if (item.warmFps) {
      const step = 1000 / item.warmFps;
      for (let cursor = Math.floor(previousAt / step) + 1; cursor * step < at; cursor++) h.draw(cursor * step);
    }
    const frame = h.draw(at); previousAt = at;
    const actual = playback.resolveActionPlayback({ content, preview: frame.state.devPreview,
      egg: frame.state.currentEgg, sessionSnapshot: kind === 'session' ? { activity: h.current.item, progress: phase } : null,
      now: at, calmVisual: calm, form: h.form });
    const effectiveView = source.formArt.resolveView(h.form, kind === 'interaction' ? 'auto' : view,
      { action: actual.actionConfig, state: frame.state.state });
    const file = `${caseIndex}-${id}-${outfit}-${view}-${facing}-${dpr}x-${index}.png`;
    const frozenPng = h.body.toBuffer('image/png');
    fs.writeFileSync(path.join(output, file), frozenPng);
    // Skia may defer drawImage(Canvas); decode immutable bytes so later frames
    // cannot replace an earlier contact-sheet cell.
    const frozenImage = await backend.loadImage(frozenPng);
    const x = index % columns * cell, y = Math.floor(index / columns) * rowHeight + 32;
    ctx.drawImage(frozenImage, x, y + 32);
    ctx.fillText(`${(at / 1000).toFixed(2)}s / ${effectiveView}`, x + 8, y + 20);
    frames.push({ file, at, phase, requestedView: view, effectiveView, motion: actual.actionConfig?.motion, localProgress: actual.actionT, rendererProgress: frame.state.currentActionProgress,
      prop: actual.actionConfig?.prop, stage: actual.phase, sha256: sha(fs.readFileSync(path.join(output, file))) });
  }
  const sheetFile = `${caseIndex}-${id}-${outfit}-${view}-${facing}-${dpr}x-sheet.png`;
  fs.writeFileSync(path.join(output, sheetFile), sheet.toBuffer('image/png'));
  evidence.push({ ...item, kind, view, outfit, facing, calm, dpr, sheetFile, frames });
  h.dispose();
}
for (const [file, hash] of Object.entries(sourceHashes)) {
  if (sha(fs.readFileSync(path.join(root, file))) !== hash) throw new Error(`Source changed during capture: ${file}`);
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ root, seal, sourceHashes,
  scope: 'Production cached-body renderer, body surface only; includes tools and clothes, excludes separate scene/overlay. Offscreen Skia, not native desktop acceptance.',
  dimensions: '219 CSS px stage; body design width 99 CSS px; device output is exact DPR 1 or 2', cases: evidence }, null, 2) + '\n');
console.log(JSON.stringify({ output, seal, cases: evidence.length, frames: evidence.reduce((n, c) => n + c.frames.length, 0) }));
