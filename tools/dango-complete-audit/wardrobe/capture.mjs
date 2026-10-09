// Finite wardrobe evidence: real production renderer, not an alternate painter.
// Every item and pair batch is isolated; native/GPU/memory behavior is out of scope.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ITEMS, VIEWS, PAIRS, inventory } from '../inventory.mjs';
import { catalog, proofTimes } from '../actions/catalog.mjs';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
import { traceFrame } from '../../dango-state-cycle-preview/metrics.mjs';
import { makeWardrobeMetrics, summarize } from './metrics.mjs';
import { pinSources, changedSources, sha256 } from './source-pin.mjs';
import { sampleActivityStory } from '../../../src/capabilities/companion/presentation/activity-playback.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-complete-audit/wardrobe'));
const part = arg('part'), canvasPackage = arg('canvas-package');
if (!canvasPackage) throw Error('Supply the existing --canvas-package path');
fs.mkdirSync(out, { recursive: true });
if (!part) {
  const pin = pinSources(root);
  fs.writeFileSync(path.join(out, 'source-pin.json'), JSON.stringify(pin, null, 2));
  const queue = [...ITEMS.map(item => `item:${item.renderKey}`), ...VIEWS.map(view => `pairs:${view}`), 'risks:motion'];
  let cursor = 0, failed = false;
  async function runBatch() {
    while (cursor < queue.length && !failed) {
    const next = queue[cursor++];
    const [batchKind, batchKey] = next.split(':');
    const recordPath = batchKind === 'item' ? path.join(out, 'items', batchKey, 'record.json')
      : batchKind === 'pairs' ? path.join(out, 'pairs', batchKey, 'record.json') : path.join(out, 'risks', 'record.json');
    const records = [recordPath, ...(batchKind === 'item' && !process.argv.includes('--skip-video')
      ? [path.join(out, 'items', batchKey, 'motion-record.json')] : [])];
    if (process.argv.includes('--resume') && records.every(file => {
      if (!fs.existsSync(file)) return false;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      return saved.changedSources?.length === 0 && JSON.stringify(saved.sourceHashes) === JSON.stringify(pin);
    })) { console.log(`Current-source evidence retained: ${next}`); continue; }
    const processBatch = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2), `--part=${next}`], { stdio: 'inherit' });
    const [status, signal] = await once(processBatch, 'exit');
    if (status !== 0) { failed = true; throw Error(`Batch ${next} failed: ${status ?? signal}`); }
    if (changedSources(root, pin).length) { failed = true; throw Error('Source changed between batches; rerun with --resume after edits settle'); }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(2, Number(arg('jobs') || 1))) }, runBatch));
  const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
  const changed = changedSources(root, pin);
  fs.writeFileSync(path.join(out, 'capture-summary.json'), JSON.stringify({ inventory: inventory(), sourceHashes: pin,
    changedSources: changed, generatedAt: new Date().toISOString(), renderer: 'Exact production createPetRenderer / local Skia',
    boundary: 'Finite single-item action/view samples and static cross-slot pairs, not all powersets or native validation' }, null, 2));
  if (changed.length) throw Error(`Sources changed: ${changed.join(', ')}`);
  process.exit(0);
}

const backend = createRequire(import.meta.url)(canvasPackage);
const backendVersion = JSON.parse(fs.readFileSync(path.join(canvasPackage, 'package.json'), 'utf8')).version;
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href), pin = pinSources(root);
const metrics = makeWardrobeMetrics(backend), assets = new Map();
const renderer = 'Production createPetRenderer / existing offscreen Skia; native desktop and GPU unverified';
function trace(harness, atMs, items, view, action, diagnostic = true) {
  const drawn = traceFrame(harness, atMs), row = metrics.measure(drawn, harness.body, items, view, action, diagnostic);
  for (const call of drawn.calls) if (call.src && !assets.has(call.src)) {
    const filename = fileURLToPath(call.src);
    assets.set(call.src, { file: path.relative(root, filename), sha256: sha256(fs.readFileSync(filename)) });
  }
  return { atMs, ...row };
}
function harness(items, view, options = {}) { return createRenderHarness(source, { skin: 'pink', outfit: items.map(item => item.id), view, dpr: 2, ...options }); }
function canvas(width, height) {
  const surface = backend.createCanvas(width, height), ctx = surface.getContext('2d');
  ctx.fillStyle = '#eef2ed'; ctx.fillRect(0, 0, width, height); return surface;
}
function label(ctx, text, x, y, size = 12) { ctx.fillStyle = '#29413f'; ctx.font = `${size}px sans-serif`; ctx.fillText(text, x, y); }
function phaseLabel(sample, action) {
  const beat = Number.parseInt(sample.phase, 10);
  return `${(sample.atMs / 1000).toFixed(2)}s ${Number.isFinite(beat) ? `beat ${beat}` : 'action'}: ${action?.motion || 'idle'}`;
}
function save(surface, filename) { fs.writeFileSync(filename, surface.toBuffer('image/png')); }
function release(surface) { surface.width = 1; surface.height = 1; }
function record(filename, value) {
  const changed = changedSources(root, pin);
  fs.writeFileSync(filename, JSON.stringify({ ...value, renderer, sourceHashes: pin, changedSources: changed,
    assets: [...assets.values()], backend: { package: '@napi-rs/canvas', version: backendVersion, node: process.version },
    generatedAt: new Date().toISOString() }, null, 2));
  if (changed.length) throw Error(`Sources changed during ${part}: ${changed.join(', ')}`);
}

async function captureItem(item) {
  const dir = path.join(out, 'items', item.renderKey); fs.mkdirSync(dir, { recursive: true });
  const staticProof = canvas(1380, 720), s = staticProof.getContext('2d'), staticRows = [];
  label(s, `${item.id} | 99 CSS px body width + 2x | actual production output`, 18, 30, 19);
  for (const [i, view] of VIEWS.entries()) {
    const h = harness([item], view, { blink: false }); h.select('expression', 'life.idle'); h.draw(0); h.draw(1000);
    const row = trace(h, 1600, [item], view, null); staticRows.push({ view, ...row });
    label(s, view, i * 460 + 16, 58, 16);
    s.drawImage(h.body, i * 460 + 121, 60, 219, 219); s.drawImage(h.body, i * 460 + 11, 250, 438, 438);
    save(h.body, path.join(dir, `static-${view}.png`)); h.dispose();
  }
  save(staticProof, path.join(dir, 'static-proof.png')); release(staticProof);
  if (process.argv.includes('--static-only')) {
    record(path.join(dir, 'static-record.json'), { itemId: item.id, renderKey: item.renderKey, staticRows });
    return;
  }
  const cases = [], allowed = inventory().actionViews.filter(row => row.allowed && !row.alias);
  for (const entry of catalog.filter(value => value.kind !== 'expression')) {
    for (const declared of allowed.filter(row => row.kind === entry.kind && row.id === entry.id)) {
      const view = declared.effectiveView, proof = proofTimes(entry), columns = entry.story ? 3 : 7;
      const sheet = canvas(columns * 220, Math.ceil(proof.length / columns) * 248 + 34), ctx = sheet.getContext('2d');
      label(ctx, `${item.renderKey} | ${entry.kind}/${entry.id} | ${view} | 99 CSS px body width`, 10, 23, 13);
      const h = harness([item], view); h.select(entry.kind, entry.id); const rows = []; let cursor = 0;
      for (const [i, sample] of proof.entries()) {
        // Sample production state in time order, including transitions between story beats.
        for (; cursor < sample.atMs; cursor += 100) h.draw(cursor);
        const action = sampleActivityStory(entry.item, sample.atMs / entry.durationMs).action;
        const row = trace(h, sample.atMs, [item], view, action); rows.push({ ...sample, ...row });
        const x = i % columns * 220, y = 34 + Math.floor(i / columns) * 248;
        ctx.drawImage(h.body, x, y, 219, 219);
        label(ctx, phaseLabel(sample, action), x + 7, y + 236, 10);
      }
      const filename = `${entry.kind}-${entry.id}-${view}.png`; save(sheet, path.join(dir, filename));
      cases.push({ kind: entry.kind, actionId: entry.id, view, itemId: item.id, file: filename, summary: summarize(rows), rows,
        numericStatus: rows.some(row => row.numericStatus === 'flagged') ? 'flagged' : 'checked',
        visualReview: { status: 'not-individually-reviewed', findings: [] } });
      h.dispose(); release(sheet);
    }
  }
  record(path.join(dir, 'record.json'), { itemId: item.id, renderKey: item.renderKey, slot: item.exclusiveGroup,
    bodyDesignWidthCssPx: 99, stageCssPx: 219, staticProof: 'static-proof.png', staticRows, cases,
    staticReview: { status: 'awaiting-review', findings: [] }, motionReview: { status: 'awaiting-review', findings: [] } });
  console.log(JSON.stringify({ item: item.id, cases: cases.length, flagged: cases.filter(row => row.numericStatus === 'flagged').length }));
  if (!process.argv.includes('--skip-video')) await captureVideo(item, dir);
}

async function captureVideo(item, dir) {
  const view = 'three-quarter', h = harness([item], view); h.select('action', 'chase-laser');
  const fps = 30, durationMs = 9500, screen = canvas(680, 500), ctx = screen.getContext('2d');
  const file = path.join(dir, 'run-normal-speed.mp4');
  const encoder = spawn('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', '680x500', '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = ''; encoder.stderr.on('data', chunk => { errors += chunk; }); const exited = once(encoder, 'exit');
  const rows = [], contact = canvas(8 * 230, 300), c = contact.getContext('2d');
  const contactFrames = [0, 5, 10, 14, 19, 23, 27, 31]; let proofIndex = 0;
  for (let frame = 0; frame < durationMs / 1000 * fps; frame++) {
    const atMs = frame / fps * 1000;
    rows.push(trace(h, atMs, [item], view, source.behaviors.PET_ACTIONS['chase-laser'], frame % 5 === 0));
    ctx.fillStyle = '#eef2ed'; ctx.fillRect(0, 0, 680, 500);
    label(ctx, `${item.renderKey} | chase-laser | normal speed`, 16, 27, 18);
    label(ctx, `${(atMs / 1000).toFixed(2)} / 9.5s | actual production renderer`, 16, 48, 12);
    ctx.drawImage(h.body, -10, 170, 219, 219); ctx.drawImage(h.body, 228, 55, 438, 438);
    label(ctx, '99 CSS px body design width', 10, 406, 12); label(ctx, '2x inspection', 320, 474, 12);
    if (contactFrames.includes(frame)) {
      c.drawImage(h.body, proofIndex * 230, 32, 219, 219);
      label(c, `${(atMs / 1000).toFixed(3)}s`, proofIndex * 230 + 10, 280, 12); proofIndex++;
    }
    const rgba = ctx.getImageData(0, 0, 680, 500).data;
    if (!encoder.stdin.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength))) await once(encoder.stdin, 'drain');
  }
  encoder.stdin.end(); const [code] = await exited; if (code) throw Error(errors);
  label(c, `${item.renderKey}: uninterrupted run cycle samples`, 12, 22, 15); save(contact, path.join(dir, 'run-contact-sheet.png'));
  record(path.join(dir, 'motion-record.json'), { itemId: item.id, view, fps, durationMs, clip: 'run-normal-speed.mp4',
    summary: summarize(rows), rows, visualReview: { status: 'awaiting-review', findings: [] } });
  h.dispose(); release(screen); release(contact);
}

function capturePairs(view) {
  const dir = path.join(out, 'pairs', view); fs.mkdirSync(dir, { recursive: true }); const rows = [];
  for (let begin = 0; begin < PAIRS.length; begin += 12) {
    const selected = PAIRS.slice(begin, begin + 12), sheet = canvas(4 * 310, 3 * 330 + 38), ctx = sheet.getContext('2d');
    label(ctx, `All cross-slot pairs | ${view} | cases ${begin + 1}-${begin + selected.length} of 99 | 99 CSS px body`, 12, 25, 15);
    for (const [local, pair] of selected.entries()) {
      const h = harness(pair, view, { blink: false }); h.select('expression', 'life.idle'); h.draw(0); h.draw(1000);
      const row = trace(h, 1600, pair, view, null), x = local % 4 * 310, y = 38 + Math.floor(local / 4) * 330;
      ctx.drawImage(h.body, x + 45, y + 25, 219, 219);
      label(ctx, `#${begin + local + 1} ${pair[0].renderKey}`, x + 12, y + 270, 13);
      label(ctx, `+ ${pair[1].renderKey}`, x + 12, y + 292, 13);
      const filename = `pair-${String(begin + local + 1).padStart(3, '0')}.png`; save(h.body, path.join(dir, filename));
      rows.push({ pairIndex: begin + local + 1, items: pair.map(item => item.id), view, file: filename, ...row,
        visualReview: { status: 'awaiting-review', findings: [] } }); h.dispose();
    }
    save(sheet, path.join(dir, `sheet-${String(begin / 12 + 1).padStart(2, '0')}.png`)); release(sheet);
  }
  record(path.join(dir, 'record.json'), { view, rows, summary: summarize(rows) });
  console.log(JSON.stringify({ pairs: view, cases: rows.length, summary: summarize(rows) }));
}

function captureRisks() {
  const dir = path.join(out, 'risks'); fs.mkdirSync(dir, { recursive: true }); const cases = [];
  const entries = catalog.filter(entry => ['happy-hop', 'chase-laser', 'spin', 'rest-nap'].includes(entry.id));
  for (const pairIndex of [13, 21, 24, 32, 44, 53, 54, 57]) for (const entry of entries) {
    const pair = PAIRS[pairIndex - 1], view = entry.views[0].effective;
    const h = harness(pair, view); h.select(entry.kind, entry.id);
    const proof = proofTimes(entry), columns = entry.story ? 3 : 7;
    const sheet = canvas(columns * 220, Math.ceil(proof.length / columns) * 248 + 34), ctx = sheet.getContext('2d');
    label(ctx, `Pair ${pairIndex} ${pair.map(item => item.renderKey).join('+')} | ${entry.id} | ${view}`, 10, 23, 13);
    const rows = []; let cursor = 0;
    for (const [i, sample] of proof.entries()) {
      for (; cursor < sample.atMs; cursor += 100) h.draw(cursor);
      const action = sampleActivityStory(entry.item, sample.atMs / entry.durationMs).action;
      rows.push({ ...sample, ...trace(h, sample.atMs, pair, view, action) });
      const x = i % columns * 220, y = 34 + Math.floor(i / columns) * 248;
      ctx.drawImage(h.body, x, y, 219, 219); label(ctx, phaseLabel(sample, action), x + 7, y + 236, 10);
    }
    const file = `pair-${String(pairIndex).padStart(3, '0')}-${entry.id}.png`; save(sheet, path.join(dir, file));
    cases.push({ pairIndex, items: pair.map(item => item.id), kind: entry.kind, actionId: entry.id, view,
      file, rows, summary: summarize(rows), visualReview: { status: 'awaiting-review', findings: [] } });
    h.dispose(); release(sheet);
  }
  record(path.join(dir, 'record.json'), { cases, summary: summarize(cases.flatMap(entry => entry.rows)) });
  console.log(JSON.stringify({ riskCases: cases.length, flagged: cases.filter(entry => entry.summary.flaggedFrames).length }));
}

const [kind, key] = part.split(':');
if (kind === 'item') {
  const item = ITEMS.find(value => value.renderKey === key); if (!item) throw Error(`Unknown item ${key}`);
  await captureItem(item);
} else if (kind === 'pairs' && VIEWS.includes(key)) capturePairs(key);
else if (kind === 'risks' && key === 'motion') captureRisks();
else throw Error(`Unknown part ${part}`);
metrics.dispose();
