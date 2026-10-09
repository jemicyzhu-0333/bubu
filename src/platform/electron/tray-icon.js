'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { decodeBitmap, encodeBitmap, compositePixels } = require('./tray-bitmap');
const { parsePalette, recolorPixels } = require('./tray-palette');

const ICON_SIZE = 22;
const ASSET_ROOT = path.join(__dirname, '../../../assets/tray');
const layers = new Map();

function readLayer(name, size) {
  const key = `${name}-${size}`;
  if (!layers.has(key)) {
    layers.set(key, decodeBitmap(fs.readFileSync(path.join(ASSET_ROOT, `${key}.bmp`)), size));
  }
  // Cached source pixels must never be tinted in place: a skin or mood switch
  // can return to any palette without retaining the previous icon's colors.
  const source = layers.get(key);
  return { width: size, height: size, data: Buffer.from(source.data) };
}

function makeBitmap(size, eyeState, celebrating, colors) {
  const body = readLayer('body', size);
  recolorPixels(body.data, colors, 'body');
  const eyes = readLayer(`eyes-${eyeState}`, size);
  recolorPixels(eyes.data, colors, celebrating ? 'accent' : 'eye');
  const mouth = readLayer(`mouth-${celebrating ? 'grin' : 'neutral'}`, size);
  recolorPixels(mouth.data, colors, 'mouth');
  compositePixels(body.data, eyes.data);
  compositePixels(body.data, mouth.data);
  return encodeBitmap(body);
}

function createTrayIcon({ nativeImage, frame, mood, palette }) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new TypeError('Electron nativeImage is required');
  }
  if (!Number.isInteger(frame) || frame < 0 || frame > 7) {
    throw new TypeError('tray icon frame must be an integer from 0 to 7');
  }
  if (!['idle', 'focus', 'break', 'celebrate'].includes(mood)) {
    throw new TypeError('tray icon mood is invalid');
  }
  const colors = parsePalette(palette);
  const celebrating = mood === 'celebrate';
  const eyeState = celebrating ? 'sparkle' : frame === 7 ? 'closed' : frame === 6 ? 'half' : 'neutral';
  const image = nativeImage.createFromBuffer(makeBitmap(ICON_SIZE, eyeState, celebrating, colors));
  image.addRepresentation({
    scaleFactor: 2,
    buffer: makeBitmap(ICON_SIZE * 2, eyeState, celebrating, colors),
    width: ICON_SIZE * 2,
    height: ICON_SIZE * 2
  });
  return image;
}

module.exports = { createTrayIcon };
