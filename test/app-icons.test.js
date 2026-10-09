'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodePNG, encodePNG, resize } = require('../scripts/app-icon-png');
const { buildAssets, syncAssets, SOURCE } = require('../scripts/make-icon');
const ROOT = path.resolve(__dirname, '..');
const assets = buildAssets();

test('application PNG sizes depict current canonical Dango and keep transparent corners', async () => {
  const files = await assets, source = decodePNG(fs.readFileSync(path.join(ROOT, SOURCE)));
  for (const [name, bytes] of files) {
    if (!name.startsWith('assets/icon') || !name.endsWith('.png')) continue;
    const image = decodePNG(bytes);
    assert.equal(image.width, image.height);
    assert.deepEqual(image.data, resize(source, image.width).data, name);
    assert.equal(image.data[3], 0);
    assert.ok(image.data.some((value, i) => i % 4 === 3 && value > 128), name);
    const colors = new Set();
    for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]) colors.add(image.data.subarray(i, i + 3).toString('hex'));
    assert.ok(colors.size > 20, `${name} must not regress to the retired flat grid`);
  }
});
test('ICO directory embeds all current PNG representations with correct offsets', async () => {
  const files = await assets, ico = files.get('assets/icon.ico');
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 7);
  const source = decodePNG(fs.readFileSync(path.join(ROOT, SOURCE)));
  let end = 6 + 7 * 16;
  for (let i = 0; i < 7; i++) {
    const entry = 6 + i * 16, size = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt32LE(entry + 12), end);
    const length = ico.readUInt32LE(entry + 8), decoded = decodePNG(ico.subarray(end, end + length));
    assert.equal(decoded.width, size); assert.deepEqual(decoded.data, resize(source, size).data);
    end += length;
  }
  assert.equal(end, ico.length);
});
test('ICNS container uses the same current PNG pixels for normal and Retina sizes', async () => {
  const files = await assets, icns = files.get('assets/icon.icns');
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const expected = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  const source = decodePNG(fs.readFileSync(path.join(ROOT, SOURCE))); let count = 0;
  for (let offset = 8; offset < icns.length;) {
    const type = icns.toString('ascii', offset, offset + 4), length = icns.readUInt32BE(offset + 4);
    const image = decodePNG(icns.subarray(offset + 8, offset + length));
    assert.equal(image.width, expected[type]); assert.deepEqual(image.data, resize(source, expected[type]).data);
    offset += length; count++;
  }
  assert.equal(count, 11);
});
test('content checks reject stale, missing and corrupt files; rebuild repairs, unchanged build preserves mtime', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhder-icons-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new Map([['assets/icon.icns', (await assets).get('assets/icon.icns')]]);
  assert.throws(() => syncAssets(root, files, true), /Stale or missing/);
  assert.equal(syncAssets(root, files).length, 1);
  const destination = path.join(root, 'assets/icon.icns'), stat = fs.statSync(destination);
  assert.deepEqual(syncAssets(root, files), []); assert.equal(fs.statSync(destination).mtimeMs, stat.mtimeMs);
  fs.writeFileSync(destination, Buffer.from('legacy'));
  assert.throws(() => syncAssets(root, files, true), /Stale or missing/);
  syncAssets(root, files); assert.deepEqual(syncAssets(root, files, true), []);
  const changedSource = new Map([['assets/icon.icns', Buffer.from('new source pixels')]]);
  assert.throws(() => syncAssets(root, changedSource, true), /Stale or missing/);
  assert.equal(syncAssets(root, changedSource).length, 1);
});
test('PNG codec roundtrips transparency and rejects corruption; tiny resizes remain visible', () => {
  const source = decodePNG(fs.readFileSync(path.join(ROOT, SOURCE)));
  assert.deepEqual(decodePNG(encodePNG(source)), source);
  const bad = encodePNG(source); bad[bad.length - 1] ^= 1;
  assert.throws(() => decodePNG(bad), /CRC/);
  assert.ok(resize(source, 16).data.some((v, i) => i % 4 === 3 && v > 128));
});
test('committed application and tray assets are byte-current', async () => {
  assert.deepEqual(syncAssets(ROOT, await assets, true), []);
});
test('area sampling premultiplies alpha rather than bleeding invisible RGB into artwork', () => {
  const source = { width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 0]) };
  const tiny = resize(source, 1, 0);
  assert.deepEqual([...tiny.data], [255, 0, 0, 64]);
});
