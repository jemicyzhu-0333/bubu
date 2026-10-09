import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { catalog, proofTimes } from './catalog.mjs';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
import { framePixels } from '../../dango-frequency-audit/audit.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
if (!arg('id')) {
  for (const entry of catalog.filter(value => value.kind === 'expression')) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--id=${entry.id}`, `--canvas-package=${arg('canvas-package')}`], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`static view ${entry.id} failed: ${result.status || result.signal}`);
  }
} else {
  const backend = createRequire(import.meta.url)(arg('canvas-package'));
  backend.GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'sans-serif');
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
  const { loadSource, createRenderHarness } = await import('../../usagi-gallery/runtime-harness.mjs');
  const source = await loadSource(pathToFileURL(root).href), entry = catalog.find(value => value.id === arg('id'));
  const out = path.join(root, 'dist/dango-complete-audit/actions/expression', entry.id);
  const recordPath = path.join(out, 'record.json'), record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const originalProbes = { views: record.views, requestProofs: record.requestProofs, checks: { ...record.checks } };
  const h = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: 'three-quarter-left' }); h.select('expression', entry.id);
  const samples = proofTimes(entry), sheet = backend.createCanvas(1610, 318), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#eef0ef'; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.fillStyle = '#263642'; ctx.font = '15px sans-serif';
  ctx.fillText(`${entry.id} · authored static three-quarter-left · 99 CSS px body`, 12, 24);
  let cursor = 0;
  for (const [index, sample] of samples.entries()) {
    while (cursor < sample.atMs) { h.draw(cursor); cursor += 1000 / 30; }
    h.draw(sample.atMs); ctx.drawImage(h.body, index * 230 + 5, 50, 219, 219);
    ctx.fillStyle = '#263642'; ctx.font = '12px sans-serif'; ctx.fillText(`${(sample.atMs / 1000).toFixed(2)}s`, index * 230 + 8, 289);
  }
  fs.writeFileSync(path.join(out, 'phases-three-quarter-left.png'), sheet.toBuffer('image/png')); h.dispose();
  const leftProbe = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: 'three-quarter-left', blink: false });
  leftProbe.select('expression', entry.id); leftProbe.draw(0); leftProbe.draw(entry.durationMs * .5);
  const leftPixels = framePixels(leftProbe.body); leftProbe.dispose();
  record.views = entry.views;
  record.requestProofs = record.requestProofs.map(proof => ({ ...proof,
    effective: entry.views.find(value => value.requested === proof.requested).effective,
    ...(proof.requested === 'three-quarter-left' ? { hash: leftPixels.hash, occupied: leftPixels.occupied, edge: leftPixels.edge } : {}) }));
  record.checks.requestFallbackMismatches = record.requestProofs.filter(proof => proof.hash !== record.requestProofs.find(value => value.requested === proof.effective)?.hash).length;
  if (!record.phaseProofs.some(proof => proof.view === 'three-quarter-left')) record.phaseProofs.push({ view: 'three-quarter-left', file: 'phases-three-quarter-left.png', samples: samples.length });
  const right = createRenderHarness(source, { skin: 'pink', outfit: false, dpr: 2, view: 'three-quarter-right', blink: false });
  right.select('expression', entry.id); right.draw(0); right.draw(entry.durationMs * .5);
  const hash = framePixels(right.body).hash;
  record.explicitRightAlias = { requested: 'three-quarter-right', effective: 'three-quarter-right', hash,
    sameAsCanonicalQuarter: hash === record.requestProofs.find(value => value.requested === 'three-quarter').hash };
  right.dispose();
  record.primaryViewProbeEvidence ||= originalProbes;
  record.staticViewValidation = { generatedAt: new Date().toISOString(),
    toolSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    explanation: 'Later validation uses the production artist view resolver. Original primary video/provenance and original probe classification are retained separately.',
    sourceHashes: Object.fromEntries(Object.keys(record.sourceHashes).map(file => [file,
      createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])) };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id: entry.id, leftProof: true, rightAliasEqual: record.explicitRightAlias.sameAsCanonicalQuarter,
    requestFallbackMismatches: record.checks.requestFallbackMismatches }));
}
