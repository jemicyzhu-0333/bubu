'use strict';

// Narrow, dependency-free codec for our repository's non-interlaced RGBA PNGs.
const zlib = require('node:zlib');
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const buffer = Buffer.alloc(bytes.length + 12);
  buffer.writeUInt32BE(bytes.length); buffer.write(type, 4); bytes.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
  return buffer;
}
function encodePNG({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.from(data);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePNG(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Invalid PNG signature');
  let width, height, ended = false; const parts = [];
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const length = buffer.readUInt32BE(offset), end = offset + 12 + length;
    if (end > buffer.length) throw new Error('Truncated PNG data');
    const type = buffer.toString('ascii', offset + 4, offset + 8), bytes = buffer.subarray(offset + 8, end - 4);
    if (crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) throw new Error('PNG CRC mismatch');
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4);
      if (!width || !height || width * height > 16777216 || bytes.length !== 13
          || bytes[8] !== 8 || bytes[9] !== 6 || bytes[10] || bytes[11] || bytes[12]) throw new Error('Expected bounded non-interlaced 8-bit RGBA PNG');
    } else if (type === 'IDAT') parts.push(bytes);
    else if (type === 'IEND') { ended = true; break; }
    offset = end;
  }
  if (!width || !ended) throw new Error('Incomplete PNG');
  const stride = width * 4, rows = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: height * (stride + 1) });
  if (rows.length !== height * (stride + 1)) throw new Error('Invalid PNG scanline length');
  const data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (stride + 1)];
    if (filter > 4) throw new Error('Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0, b = y ? data[i - stride] : 0, c = y && x >= 4 ? data[i - stride - 4] : 0;
      const predictors = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)];
      data[i] = (rows[y * (stride + 1) + 1 + x] + predictors[filter]) & 255;
    }
  }
  return { width, height, data };
}
// Area sampling with premultiplied alpha preserves small eyes and transparent edges.
// rect is destination pixels; artwork geometry is supplied by its existing manifest.
function composite(target, source, rect) {
  const [left, top, width, height] = rect;
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(target.height, Math.ceil(top + height)); y++) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(target.width, Math.ceil(left + width)); x++) {
      const x0 = Math.max(0, (x - left) * source.width / width), x1 = Math.min(source.width, (x + 1 - left) * source.width / width);
      const y0 = Math.max(0, (y - top) * source.height / height), y1 = Math.min(source.height, (y + 1 - top) * source.height / height);
      const sum = [0, 0, 0, 0]; let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const area = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
        const i = (sy * source.width + sx) * 4, a = source.data[i + 3] / 255;
        weight += area; sum[3] += area * a;
        for (let c = 0; c < 3; c++) sum[c] += source.data[i + c] * area * a;
      }
      if (!weight || !sum[3]) continue;
      const coverage = Math.min(1, (x1 - x0) * width / source.width) * Math.min(1, (y1 - y0) * height / source.height);
      const alpha = sum[3] / weight * coverage, i = (y * target.width + x) * 4;
      const old = target.data[i + 3] / 255, out = alpha + old * (1 - alpha);
      for (let c = 0; c < 3; c++) target.data[i + c] = Math.round((sum[c] / sum[3] * alpha + target.data[i + c] * old * (1 - alpha)) / out);
      target.data[i + 3] = Math.round(out * 255);
    }
  }
  return target;
}
function resize(source, size, padding = 0.06) {
  const scale = size * (1 - 2 * padding) / Math.max(source.width, source.height);
  const width = source.width * scale, height = source.height * scale;
  return composite({ width: size, height: size, data: Buffer.alloc(size * size * 4) }, source, [(size - width) / 2, (size - height) / 2, width, height]);
}
module.exports = { decodePNG, encodePNG, resize, composite };
