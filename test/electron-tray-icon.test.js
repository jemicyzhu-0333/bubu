'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTrayIcon } = require('../src/platform/electron/tray-icon');
const { buildTrayAssets, SIZES, STATES } = require('../scripts/make-tray-icons');
const { decodePNG } = require('../scripts/app-icon-png');
const ROOT = path.resolve(__dirname, '..');
const PALETTE = { 1: '#1a1b26', 2: '#f7768e', 3: '#c53b53', 4: '#1a1b26' };
const nativeImage = { createFromBuffer(buffer, options) {
  return { buffer, options, representations: [], template: false,
    isEmpty() { return false; }, getScaleFactors() { return [1, ...this.representations.map(item => item.scaleFactor)]; },
    addRepresentation(value) { this.representations.push(value); }, setTemplateImage(value) { this.template = value; } };
} };
function icon(platform = 'linux', frame = 0, mood = 'idle', factory = createTrayIcon) {
  return factory({ nativeImage, frame, mood, palette: PALETTE, platform });
}

test('small status symbols reproduce their vector source in independent target sizes', async () => {
  const generated = await buildTrayAssets();
  assert.equal(generated.size, 52);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'assets/tray')).sort(), [...generated.keys()].map(file => path.basename(file)).sort());
  for (const [file, bytes] of generated) assert.deepEqual(fs.readFileSync(path.join(ROOT, file)), bytes, file);
});

test('all target sizes have transparent safety margins and a clearly occupied face', () => {
  for (const state of STATES) for (const size of SIZES) {
    const { data, width, height } = decodePNG(fs.readFileSync(path.join(ROOT, `assets/tray/${state}-${size}.png`)));
    assert.equal(width, size); assert.equal(height, size);
    const alpha = (x, y) => data[(y * size + x) * 4 + 3];
    for (let n = 0; n < size; n++) {
      assert.equal(alpha(n, 0), 0); assert.equal(alpha(0, n), 0);
      assert.equal(alpha(n, size - 1), 0); assert.equal(alpha(size - 1, n), 0);
    }
    let solid = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) solid++;
    assert.ok(solid > size * size * .35 && solid < size * size * .8, `${state} ${size}px bounded occupied area`);
    assert.ok(alpha(Math.floor(size / 2), Math.floor(size / 2)) > 200, 'face stays solid');
  }
});

for (const [platform, sizes, scales] of [['darwin', [16, 32], [1, 2]], ['win32', [16, 20, 24, 32], [1, 1.25, 1.5, 2]], ['linux', [22, 44], [1, 2]]]) {
  test(`${platform} native image exposes correctly labelled DPI representations`, () => {
    const image = icon(platform), representations = [{ buffer: image.buffer, scaleFactor: image.options.scaleFactor }, ...image.representations];
    assert.deepEqual(representations.map(item => decodePNG(item.buffer).width), sizes);
    assert.deepEqual(representations.map(item => item.scaleFactor), scales);
    assert.equal(image.template, platform === 'darwin');
    if (platform === 'darwin') for (const item of representations) {
      const data = decodePNG(item.buffer).data;
      for (let i = 0; i < data.length; i += 4) assert.equal(data[i] + data[i + 1] + data[i + 2], 0, 'template is black plus alpha');
    }
  });
}

test('blink and celebration remain distinct without changing asset cache', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const open = icon(platform);
    for (let frame = 1; frame < 6; frame++) assert.deepEqual(icon(platform, frame).buffer, open.buffer);
    assert.notDeepEqual(icon(platform, 6).buffer, open.buffer);
    assert.notDeepEqual(icon(platform, 7).buffer, icon(platform, 6).buffer);
    assert.notDeepEqual(icon(platform, 0, 'celebrate').buffer, open.buffer);
    const copy = Buffer.from(open.buffer); open.buffer.fill(0);
    assert.deepEqual(icon(platform).buffer, copy);
  }
});

test('fixed contrasting outline and fill do not disappear with unlocked low-contrast skin palettes', () => {
  const base = icon('win32');
  const other = createTrayIcon({ nativeImage, platform: 'win32', frame: 0, mood: 'idle',
    palette: { 1: '#ffffff', 2: '#ffffff', 3: '#ffffff', 4: '#ffffff' } });
  assert.deepEqual(other.buffer, base.buffer);
  const data = decodePNG(base.buffer).data;
  assert.ok(data.some((v, i) => i % 4 === 0 && v === 27 && data[i + 3] > 200));
  assert.ok(data.some((v, i) => i % 4 === 0 && v === 255 && data[i + 3] > 200));
});

test('packaged status icon uses only bundled PNGs and narrow platform adapters', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-tray-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = path.join(root, 'src/platform/electron'); fs.mkdirSync(adapter, { recursive: true });
  for (const file of ['tray-icon.js', 'tray-palette.js']) fs.copyFileSync(path.join(ROOT, 'src/platform/electron', file), path.join(adapter, file));
  fs.cpSync(path.join(ROOT, 'assets/tray'), path.join(root, 'assets/tray'), { recursive: true });
  const packaged = require(path.join(adapter, 'tray-icon.js')).createTrayIcon;
  for (const platform of ['darwin', 'win32', 'linux']) assert.deepEqual(icon(platform, 7, 'idle', packaged).buffer, icon(platform, 7).buffer);
});

test('invalid frame, mood, native image and palette input still fail closed', () => {
  assert.throws(() => icon('linux', -1), /frame/);
  assert.throws(() => icon('linux', 1.5), /frame/);
  assert.throws(() => icon('linux', 0, 'unknown'), /mood/);
  assert.throws(() => createTrayIcon({ nativeImage: null, frame: 0, mood: 'idle', palette: PALETTE }), /nativeImage/);
  assert.throws(() => createTrayIcon({ nativeImage, frame: 0, mood: 'idle', palette: {} }), /palette|color/);
});

test('an empty decoded PNG or silently rejected high-DPI representation fails closed', () => {
  for (const failure of ['base', 'retina']) {
    const broken = { createFromBuffer() { return {
      isEmpty: () => failure === 'base', getScaleFactors: () => [1], addRepresentation() {}
    }; } };
    assert.throws(() => createTrayIcon({ nativeImage: broken, platform: 'linux',
      frame: 0, mood: 'idle', palette: PALETTE }), /Invalid packaged tray PNG/);
  }
});
