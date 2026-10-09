'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTrayIcon } = require('../src/platform/electron/tray-icon');
const { decodeBitmap } = require('../src/platform/electron/tray-bitmap');
const { parsePalette, recolorPixels } = require('../src/platform/electron/tray-palette');
const { buildTrayAssets } = require('../scripts/make-tray-icons');
const { decodePNG, resize } = require('../scripts/app-icon-png');

const ROOT = path.resolve(__dirname, '..');
const PALETTE = Object.freeze({ 1: '#1a1b26', 2: '#f7768e', 3: '#c53b53', 4: '#1a1b26' });
const nativeImage = {
  createFromBuffer(buffer) {
    return { buffer, representations: [], addRepresentation(value) { this.representations.push(value); } };
  }
};
function icon(frame = 0, mood = 'idle', palette = PALETTE, factory = createTrayIcon) {
  return factory({ nativeImage, frame, mood, palette });
}
function pixels(image, size) {
  return decodeBitmap(size === 22 ? image.buffer : image.representations[0].buffer, size).data;
}
function asset(name, size) {
  return decodeBitmap(fs.readFileSync(path.join(ROOT, `assets/tray/${name}-${size}.bmp`)), size).data;
}
function alpha(data) {
  return Buffer.from(Array.from({ length: data.length / 4 }, (_, index) => data[index * 4 + 3]));
}
function differences(first, second) {
  const result = [];
  for (let i = 0; i < first.length; i += 4) {
    if (!first.subarray(i, i + 4).equals(second.subarray(i, i + 4))) result.push(i);
  }
  return result;
}

test('tray assets reproduce the current production PNGs and manifest byte for byte', async () => {
  const generated = await buildTrayAssets();
  assert.equal(generated.size, 14);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'assets/tray')).sort(),
    [...generated.keys()].map(file => path.basename(file)).sort());
  for (const [file, bytes] of generated) assert.deepEqual(fs.readFileSync(path.join(ROOT, file)), bytes, file);
});

test('tray silhouette preserves canonical ears, foot gap, transparent margins and independently sampled 2x', () => {
  const source = decodePNG(fs.readFileSync(path.join(ROOT, 'assets/companion/dango/raster/views/front/neutral.png')));
  const image = icon();
  for (const size of [22, 44]) {
    const actual = pixels(image, size), expected = resize(source, size).data;
    assert.deepEqual(alpha(actual), alpha(expected), `${size}px exact canonical silhouette`);
    const at = (x, y) => actual[(y * size + x) * 4 + 3];
    for (let n = 0; n < size; n += 1) {
      assert.equal(at(n, 0), 0);
      assert.equal(at(n, size - 1), 0);
      assert.equal(at(0, n), 0);
      assert.equal(at(size - 1, n), 0);
    }
    const earY = size === 22 ? 2 : 4, footY = size === 22 ? 19 : 39;
    assert.ok(at(Math.floor(size * .28), earY) > 128);
    assert.ok(at(Math.floor(size * .72), earY) > 128);
    assert.equal(at(Math.floor(size / 2), earY), 0, 'ear notch stays transparent');
    assert.ok(at(Math.floor(size * .30), footY) > 128);
    assert.ok(at(Math.floor(size * .70), footY) > 128);
    assert.equal(at(Math.floor(size / 2), footY), 0, 'two feet stay separate');
  }
  const one = pixels(image, 22), two = pixels(image, 44);
  let independentlySampled = 0;
  for (let y = 0; y < 44; y += 1) for (let x = 0; x < 44; x += 1) {
    const i = (y * 44 + x) * 4, j = (Math.floor(y / 2) * 22 + Math.floor(x / 2)) * 4;
    if (!two.subarray(i, i + 4).equals(one.subarray(j, j + 4))) independentlySampled += 1;
  }
  assert.ok(independentlySampled > 300, '2x must not enlarge a 22-cell fallback');
});

test('all eight tray frames retain open, half and closed timing; celebrate uses independent sparkle eyes', () => {
  const frames = Array.from({ length: 8 }, (_, frame) => icon(frame));
  for (const size of [22, 44]) {
    const open = pixels(frames[0], size);
    for (let frame = 1; frame < 6; frame += 1) assert.deepEqual(pixels(frames[frame], size), open);
    const half = pixels(frames[6], size), closed = pixels(frames[7], size);
    assert.notDeepEqual(half, open);
    assert.notDeepEqual(closed, half);
    const eyeMask = asset('eyes-neutral', size);
    for (const frame of [half, closed]) {
      assert.deepEqual(alpha(frame), alpha(open));
      assert.ok(differences(frame, open).every(i => eyeMask[i + 3] > 0), 'blink only replaces eye pixels');
    }
    for (const mood of ['focus', 'break']) assert.deepEqual(pixels(icon(0, mood), size), open);
    const celebration = pixels(icon(0, 'celebrate'), size);
    assert.notDeepEqual(celebration, open);
    for (let frame = 1; frame < 8; frame += 1) assert.deepEqual(pixels(icon(frame, 'celebrate'), size), celebration);
    assert.deepEqual(alpha(celebration), alpha(open));
  }
});

test('every palette slot changes its own material without changing silhouette or cached source pixels', () => {
  const initial = icon();
  for (const slot of [1, 2, 3, 4]) {
    const palette = { ...PALETTE, [slot]: '#49d484' }, saved = { ...palette };
    const recolored = icon(0, 'focus', palette);
    assert.deepEqual(palette, saved);
    for (const size of [22, 44]) {
      const before = pixels(initial, size), after = pixels(recolored, size);
      const changed = differences(before, after);
      assert.ok(changed.length > 0, `slot ${slot} changes ${size}px pixels`);
      assert.deepEqual(alpha(after), alpha(before));
      if (slot >= 3) {
        const mask = asset(slot === 3 ? 'mouth-neutral' : 'eyes-neutral', size);
        assert.ok(changed.every(i => mask[i + 3] > 0), `slot ${slot} remains scoped to its face layer`);
      }
    }
    assert.deepEqual(icon().buffer, initial.buffer, 'cached assets remain unchanged after recoloring');
  }
  const writable = icon();
  writable.buffer.fill(0);
  assert.deepEqual(icon().buffer, initial.buffer, 'callers cannot mutate the cached source');
});

test('celebration retains the accent slot for its sparkle eyes and mouth', () => {
  const original = icon(0, 'celebrate');
  const accent = icon(0, 'celebrate', { ...PALETTE, 3: '#49d484' });
  const eye = icon(0, 'celebrate', { ...PALETTE, 4: '#49d484' });
  for (const size of [22, 44]) {
    const before = pixels(original, size), changed = differences(before, pixels(accent, size));
    const eyes = asset('eyes-sparkle', size), mouth = asset('mouth-grin', size);
    assert.ok(changed.some(i => eyes[i + 3] > 0));
    assert.ok(changed.some(i => mouth[i + 3] > 0));
    assert.ok(changed.every(i => eyes[i + 3] > 0 || mouth[i + 3] > 0));
    assert.deepEqual(pixels(eye, size), before, 'ordinary eye slot does not replace celebration accent');
  }
});

test('body and eye recoloring match the current production material policy and preserve glints', async () => {
  const { recolorRasterPixels } = await import('../src/capabilities/companion/presentation/raster/palette.mjs');
  for (const mode of ['body', 'eye']) {
    const source = Buffer.from([247, 118, 142, 255, 26, 27, 38, 255, 255, 255, 255, 255,
      250, 245, 235, 128, 252, 182, 202, 80, 60, 20, 35, 0]);
    const colors = { 1: '#0a1421', 2: '#7dcfff', 3: '#3d59a1', 4: '#a9b1d6' };
    assert.deepEqual(recolorPixels(Buffer.from(source), parsePalette(colors), mode),
      recolorRasterPixels(Buffer.from(source), colors, mode));
    assert.deepEqual(recolorPixels(Buffer.from(source), parsePalette(colors), mode).subarray(8, 12),
      source.subarray(8, 12), 'white glints stay white');
  }
});

test('all real skin and mood palettes remain visible and keep the current raster outline', async () => {
  const { SKINS } = await import('../src/skins.mjs');
  const expected = alpha(pixels(icon(), 22));
  for (const [skin, definition] of Object.entries(SKINS)) {
    for (const mood of ['idle', 'focus', 'break', 'celebrate']) {
      const image = icon(0, mood, definition.palette[mood]);
      assert.deepEqual(alpha(pixels(image, 22)), expected, `${skin}/${mood}`);
      assert.ok(pixels(image, 44).some((value, index) => index % 4 === 3 && value === 255));
    }
  }
});

test('packaged tray runs using only production adapter files and bundled BMP layers', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhder-tray-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = path.join(root, 'src/platform/electron');
  fs.mkdirSync(adapter, { recursive: true });
  for (const file of ['tray-icon.js', 'tray-palette.js', 'tray-bitmap.js']) {
    fs.copyFileSync(path.join(ROOT, 'src/platform/electron', file), path.join(adapter, file));
  }
  fs.cpSync(path.join(ROOT, 'assets/tray'), path.join(root, 'assets/tray'), { recursive: true });
  const packaged = require(path.join(adapter, 'tray-icon.js')).createTrayIcon;
  for (const [frame, mood] of [[0, 'idle'], [6, 'focus'], [7, 'break'], [0, 'celebrate']]) {
    const expected = icon(frame, mood), actual = icon(frame, mood, PALETTE, packaged);
    assert.deepEqual(actual.buffer, expected.buffer);
    assert.deepEqual(actual.representations[0].buffer, expected.representations[0].buffer);
  }
});

test('tray rejects malformed palettes and corrupt packaged BMPs', () => {
  for (const palette of [null, {}, { ...PALETTE, 2: '#fff' }, { ...PALETTE, 3: null }]) {
    assert.throws(() => icon(0, 'idle', palette), /palette|color/);
  }
  assert.throws(() => icon(-1), /frame/);
  assert.throws(() => icon(1.5), /frame/);
  assert.throws(() => icon(0, 'unknown'), /mood/);
  assert.throws(() => createTrayIcon({ nativeImage: null, frame: 0, mood: 'idle', palette: PALETTE }), /nativeImage/);
  assert.throws(() => decodeBitmap(Buffer.alloc(0), 22), /packaged tray bitmap/);
  const corrupted = fs.readFileSync(path.join(ROOT, 'assets/tray/body-22.bmp'));
  corrupted.writeUInt32LE(0, 66);
  assert.throws(() => decodeBitmap(corrupted, 22), /packaged tray bitmap/);
});
