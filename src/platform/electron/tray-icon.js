'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parsePalette } = require('./tray-palette');
const ASSET_ROOT = path.join(__dirname, '../../../assets/tray');
const cached = new Map();
function bytes(name) {
  if (!cached.has(name)) cached.set(name, fs.readFileSync(path.join(ASSET_ROOT, name)));
  return Buffer.from(cached.get(name));
}
function assertDecoded(image, scales) {
  if (!image || typeof image.isEmpty !== 'function' || image.isEmpty()
      || typeof image.getScaleFactors !== 'function'
      || scales.some(scale => !image.getScaleFactors().includes(scale))) {
    throw new Error('Invalid packaged tray PNG representation');
  }
}
function createTrayIcon({ nativeImage, frame, mood, palette, platform = process.platform }) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') throw new TypeError('Electron nativeImage is required');
  if (!Number.isInteger(frame) || frame < 0 || frame > 7) throw new TypeError('tray icon frame must be an integer from 0 to 7');
  if (!['idle', 'focus', 'break', 'celebrate'].includes(mood)) throw new TypeError('tray icon mood is invalid');
  parsePalette(palette); // Keep the input contract; tiny status marks use a fixed high-contrast identity.
  const state = mood === 'celebrate' ? 'celebrate' : frame === 7 ? 'closed' : frame === 6 ? 'half' : 'neutral';
  const template = platform === 'darwin';
  const base = platform === 'linux' ? 22 : 16;
  const sizes = platform === 'win32' ? [16, 20, 24, 32] : [base, base * 2];
  const name = size => template ? `${state}Template${size === 32 ? '@2x' : ''}.png` : `${state}-${size}.png`;
  const image = nativeImage.createFromBuffer(bytes(name(base)), { scaleFactor: 1 });
  assertDecoded(image, [1]);
  for (const size of sizes.slice(1)) {
    image.addRepresentation({ scaleFactor: size / base, buffer: bytes(name(size)), width: size, height: size });
    assertDecoded(image, [1, size / base]);
  }
  if (template) image.setTemplateImage(true);
  return image;
}
module.exports = { createTrayIcon };
