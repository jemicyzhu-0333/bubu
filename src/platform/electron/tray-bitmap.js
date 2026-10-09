'use strict';

// Packaged tray layers use top-down BGRA BITMAPV4 with explicit alpha masks.
// This narrow codec keeps nativeImage's existing BMP contract on both platforms.
function encodeBitmap({ width, height, data }) {
  const pixelDataSize = width * height * 4;
  const buffer = Buffer.alloc(122 + pixelDataSize);
  buffer.write('BM');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(122, 10);
  buffer.writeUInt32LE(108, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(-height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(32, 28);
  buffer.writeUInt32LE(3, 30);
  buffer.writeUInt32LE(pixelDataSize, 34);
  buffer.writeUInt32LE(2835, 38);
  buffer.writeUInt32LE(2835, 42);
  buffer.writeUInt32LE(0x00FF0000, 54);
  buffer.writeUInt32LE(0x0000FF00, 58);
  buffer.writeUInt32LE(0x000000FF, 62);
  buffer.writeUInt32LE(0xFF000000, 66);
  buffer.write('BGRs', 70);
  for (let i = 0; i < data.length; i += 4) {
    buffer[122 + i] = data[i + 2];
    buffer[123 + i] = data[i + 1];
    buffer[124 + i] = data[i];
    buffer[125 + i] = data[i + 3];
  }
  return buffer;
}

function decodeBitmap(buffer, size) {
  if (buffer.length !== 122 + size * size * 4 || buffer.toString('ascii', 0, 2) !== 'BM'
    || buffer.readUInt32LE(2) !== buffer.length || buffer.readUInt32LE(10) !== 122
    || buffer.readUInt32LE(14) !== 108 || buffer.readInt32LE(18) !== size
    || buffer.readInt32LE(22) !== -size || buffer.readUInt16LE(26) !== 1
    || buffer.readUInt16LE(28) !== 32 || buffer.readUInt32LE(30) !== 3
    || buffer.readUInt32LE(54) !== 0x00FF0000 || buffer.readUInt32LE(58) !== 0x0000FF00
    || buffer.readUInt32LE(62) !== 0x000000FF || buffer.readUInt32LE(66) !== 0xFF000000) {
    throw new Error('Invalid packaged tray bitmap');
  }
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = buffer[124 + i];
    data[i + 1] = buffer[123 + i];
    data[i + 2] = buffer[122 + i];
    data[i + 3] = buffer[125 + i];
  }
  return { width: size, height: size, data };
}

function compositePixels(target, source) {
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3] / 255;
    if (!alpha) continue;
    const old = target[i + 3] / 255, out = alpha + old * (1 - alpha);
    for (let c = 0; c < 3; c += 1) {
      target[i + c] = Math.round((source[i + c] * alpha + target[i + c] * old * (1 - alpha)) / out);
    }
    target[i + 3] = Math.round(out * 255);
  }
  return target;
}

module.exports = { encodeBitmap, decodeBitmap, compositePixels };
