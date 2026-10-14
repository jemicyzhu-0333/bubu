import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { auditForeIdentity, visibleIdentity } from '../tools/dango-fore-identity-check.mjs';
import { DANGO_LIMB_RIG } from '../src/content/companion/dango-limbs.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const tool = fileURLToPath(new URL('../tools/dango-fore-identity-check.mjs', import.meta.url));
function png(kind, pad = 0) {
  const width = kind === 'fore' ? 3 : 2, canvas = createCanvas(width + pad * 2, 2 + pad * 2);
  const context = canvas.getContext('2d'); context.fillStyle = '#f86878';
  context.fillRect(pad, pad, width, 2); context.fillStyle = '#1a1b26';
  context.fillRect(pad, pad, 1, 1);
  return canvas.toBuffer('image/png');
}
function fixture(t, { duplicate = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dango fore identity '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, bytes) => { fs.writeFileSync(path.join(root, name), bytes); return hash(bytes); };
  const manifest = { extensions: { runtimeReady: false }, segments: {} };
  for (const segment of ['upper', 'fore']) {
    const kind = duplicate ? 'upper' : segment, bytes = png(kind);
    const recipe = { schema: 'dango-source-arm-strip/1', source: `${segment}-master.png`,
      sourceSha256: write(`${segment}-master.png`, bytes), sourceCropFile: `${segment}-source.png`,
      crop: kind === 'fore' ? [4, 0, 7, 2] : [0, 0, 2, 2],
      polygon: kind === 'fore' ? [[4, 0], [7, 0], [7, 2]] : [[0, 0], [2, 0], [2, 2]] };
    const sourceHash = write(`${segment}-source.png`, bytes);
    const recipeHash = write(`${segment}-recipe.json`, JSON.stringify(recipe));
    const frames = [0, 90].map(angle => ({ angle, src: `${segment}-${angle}.png`,
      productionSrc: `${segment}-${angle}-8x.png`, sha256: write(`${segment}-${angle}.png`, bytes),
      source: `${segment}-source.png`, sourceSha256: sourceHash,
      sourceRecipe: `${segment}-recipe.json`, sourceRecipeSha256: recipeHash,
      inverseSamplingMatrix: [[1, 0, 0], [0, 1, 0]] }));
    for (const frame of frames) write(frame.productionSrc, bytes);
    manifest.segments[`arm-${segment}-l`] = { frames };
  }
  const save = () => write('limbs.json', JSON.stringify(manifest)); save();
  const recipe = (segment, edit) => {
    const name = `${segment}-recipe.json`, value = JSON.parse(fs.readFileSync(path.join(root, name)));
    edit(value); const sha = write(name, JSON.stringify(value));
    for (const frame of manifest.segments[`arm-${segment}-l`].frames) frame.sourceRecipeSha256 = sha;
    save();
  };
  return { root, manifest, write, save, recipe };
}

test('distinct synthetic material and resolvable recipes pass evidence only', async t => {
  const f = fixture(t), report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'PASS'); assert.equal(report.materialStatus, 'PASS');
  assert.equal(report.sourceChainStatus, 'PASS'); assert.equal(report.runtimeReady, false);
  assert.match(report.scope, /not complete author provenance, anatomy/);
});

test('duplicate PNG/source/mask/recipe material fails even under different filenames', async t => {
  const report = await auditForeIdentity(fixture(t, { duplicate: true }).root);
  assert.equal(report.status, 'FAIL'); assert.equal(report.sourceChainStatus, 'PASS');
  assert.ok(report.pairs.every(pair => pair.samePngBytes && pair.sameVisibleRgba && pair.sameExtraction));
  assert.ok(report.duplicates.some(pair => pair.foreAngle !== pair.upperAngle));
});

test('renamed files and semantic-only recipe changes cannot create independence', async t => {
  const f = fixture(t, { duplicate: true });
  for (const frame of f.manifest.segments['arm-fore-l'].frames) {
    frame.src = `renamed-${frame.angle}.png`; f.write(frame.src, png('upper'));
    frame.semantic = { segment: 'independent-fore', status: 'approved' };
  }
  f.recipe('fore', value => { value.label = 'brand new fore'; });
  const report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'FAIL'); assert.ok(report.pairs.every(pair => pair.sameExtraction));
});

// A legal ancillary text chunk changes PNG bytes without changing decoded pixels.
function addText(bytes) {
  const typeAndData = Buffer.from('tEXtComment\0Different file metadata');
  let crc = 0xffffffff;
  for (const byte of typeAndData) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(typeAndData.length + 8);
  chunk.writeUInt32BE(typeAndData.length - 4); typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([bytes.subarray(0, bytes.length - 12), chunk, bytes.subarray(bytes.length - 12)]);
}

test('changed PNG metadata and refreshed file hashes still fail visible identity', async t => {
  const f = fixture(t, { duplicate: true }), changed = addText(png('upper'));
  for (const frame of f.manifest.segments['arm-fore-l'].frames) frame.sha256 = f.write(frame.src, changed);
  f.save(); const report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.pairs.every(pair => !pair.samePngBytes && pair.sameVisibleRgba));
});

test('transparent canvas padding and image translation are not new visible material', async t => {
  const f = fixture(t, { duplicate: true });
  for (const frame of f.manifest.segments['arm-fore-l'].frames) {
    frame.sha256 = f.write(frame.src, png('upper', 3)); f.write(frame.productionSrc, png('upper', 2));
  }
  f.save(); const report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'FAIL'); assert.ok(report.pairs.every(pair => pair.sameVisibleRgba));
});

test('invisible RGB is ignored while a visible color or alpha change is retained', () => {
  const a = { width: 3, height: 1, data: Uint8Array.from([1, 2, 3, 0, 20, 30, 40, 255, 4, 5, 6, 0]) };
  const b = { width: 1, height: 1, data: Uint8Array.from([20, 30, 40, 255]) };
  assert.deepEqual(visibleIdentity(a), visibleIdentity(b));
  b.data[0]++; assert.notEqual(visibleIdentity(a).sha256, visibleIdentity(b).sha256);
  b.data[0]--; b.data[3]--; assert.notEqual(visibleIdentity(a).sha256, visibleIdentity(b).sha256);
  assert.throws(() => visibleIdentity({ width: 1, height: 1, data: [9, 8, 7, 0] }), /Empty/);
});

test('independent materials from different regions of the same master are allowed', async t => {
  const f = fixture(t), master = createCanvas(5, 2), context = master.getContext('2d');
  context.fillStyle = '#f86878'; context.fillRect(0, 0, 5, 2);
  context.fillStyle = '#1a1b26'; context.fillRect(0, 0, 1, 1); context.fillRect(2, 0, 1, 1);
  const sha = f.write('shared-master.png', master.toBuffer('image/png'));
  for (const segment of ['upper', 'fore']) {
    const [x, width] = segment === 'upper' ? [0, 2] : [2, 3], crop = createCanvas(width, 2);
    crop.getContext('2d').putImageData(context.getImageData(x, 0, width, 2), 0, 0);
    assert.deepEqual(crop.toBuffer('image/png'), png(segment), 'source is the actual declared master region');
    f.recipe(segment, value => {
      value.source = 'shared-master.png'; value.sourceSha256 = sha; value.crop = [x, 0, x + width, 2];
      value.polygon = [[x, 0], [x + width, 0], [x + width, 2], [x, 2]];
    });
  }
  assert.equal((await auditForeIdentity(f.root)).status, 'PASS');
});


test('changed output pixels cannot hide a duplicated source crop', async t => {
  const f = fixture(t), bytes = png('upper');
  const sha = f.write('fore-source.png', bytes);
  for (const frame of f.manifest.segments['arm-fore-l'].frames) frame.sourceSha256 = sha;
  f.save(); const report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.pairs.every(pair => !pair.sameVisibleRgba && pair.sameSourceVisibleRgba));
});

test('changing only paint while reusing the exact master/crop/mask still fails extraction identity', async t => {
  const f = fixture(t), upper = JSON.parse(fs.readFileSync(path.join(f.root, 'upper-recipe.json')));
  f.recipe('fore', value => { value.source = upper.source; value.sourceSha256 = upper.sourceSha256;
    value.crop = upper.crop; value.polygon = upper.polygon; });
  const report = await auditForeIdentity(f.root);
  assert.equal(report.materialStatus, 'PASS'); assert.equal(report.status, 'FAIL');
  assert.ok(report.pairs.every(pair => pair.sameExtraction));
});

test('missing master keeps pixel evidence separate from failed provenance', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'fore-master.png'));
  const report = await auditForeIdentity(f.root);
  assert.equal(report.status, 'FAIL'); assert.equal(report.materialStatus, 'PASS');
  assert.equal(report.sourceChainStatus, 'FAIL'); assert.equal(report.pairs.length, 2);
});

test('rectangular source-alpha distinct-fore recipe is supported without inventing a mask path', async t => {
  const f = fixture(t);
  f.recipe('fore', value => {
    value.schema = 'dango-source-distinct-fore/1'; value.master = value.source;
    value.masterSha256 = value.sourceSha256;
    delete value.source; delete value.sourceSha256; delete value.sourceCropFile; delete value.polygon;
  });
  assert.equal((await auditForeIdentity(f.root)).status, 'PASS');
});

test('stale declared hashes and unverified source paths fail closed', async t => {
  const f = fixture(t); f.manifest.segments['arm-fore-l'].frames[0].sha256 = '0'.repeat(64); f.save();
  assert.match((await auditForeIdentity(f.root)).failures.join('\n'), /frame hash/);
  f.recipe('fore', value => { value.source = '../outside.png'; });
  assert.equal((await auditForeIdentity(f.root)).status, 'FAIL');
});

test('missing fore angle and duplicate angle cannot yield a partial pass', async t => {
  const f = fixture(t); f.manifest.segments['arm-fore-l'].frames.pop(); f.save();
  assert.equal((await auditForeIdentity(f.root)).status, 'FAIL');
  const frames = f.manifest.segments['arm-fore-l'].frames; frames.push({ ...frames[0] }); f.save();
  assert.match((await auditForeIdentity(f.root)).failures.join('\n'), /repeated angle/);
});

test('CLI exit code fails duplicates and passes distinct evidence in a relocated path with spaces', t => {
  for (const duplicate of [true, false]) {
    const f = fixture(t, { duplicate });
    const result = spawnSync(process.execPath, [tool, `--root=${f.root}`, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, duplicate ? 1 : 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, duplicate ? 'FAIL' : 'PASS');
  }
});

test('shipped material remains inactive; any duplicates are reported, never accepted', async () => {
  const report = await auditForeIdentity();
  assert.equal(report.runtimeReady, false); assert.equal(DANGO_LIMB_RIG.hostAcceptsContract, null);
  assert.equal(report.sourceChainStatus, 'PASS', report.failures.join('\n'));
  assert.ok(report.pairs.length > 0);
  // Do not freeze the old duplicate artwork forever: a future complete distinct
  // package may pass identity, while activation still requires separate review.
  assert.equal(report.status, report.duplicates.length ? 'FAIL' : 'PASS');
});
