'use strict';

// Inspect a privately supplied sprite sheet without putting its pixels in src/.
// Run with Electron: electron tools/dev-bench/inspect-pet-sheet.cjs <png-path>
const path = require('node:path');
const { app, nativeImage } = require('electron');

function boundsForCell(bitmap, imageWidth, cell, threshold) {
  let left = cell.right;
  let top = cell.bottom;
  let right = cell.left - 1;
  let bottom = cell.top - 1;
  let pixels = 0;
  for (let y = cell.top; y < cell.bottom; y += 1) {
    for (let x = cell.left; x < cell.right; x += 1) {
      if (bitmap[(y * imageWidth + x) * 4 + 3] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      pixels += 1;
    }
  }
  return { left, top, right, bottom, pixels };
}

function occupancy(bitmap, width, height, from, to, horizontal) {
  const counts = [];
  const end = horizontal ? height : width;
  for (let position = 0; position < end; position += 1) {
    let count = 0;
    for (let other = from; other < to; other += 1) {
      const x = horizontal ? other : position;
      const y = horizontal ? position : other;
      if (bitmap[(y * width + x) * 4 + 3] >= 128) count += 1;
    }
    counts.push(count);
  }
  return counts;
}

app.whenReady().then(() => {
  const source = process.argv.find(argument => argument.endsWith('.png'));
  if (!source) throw new Error('Pass the private PNG as an argument');
  const image = nativeImage.createFromPath(path.resolve(source));
  if (image.isEmpty()) throw new Error(`Cannot read PNG: ${source}`);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const rows = occupancy(bitmap, width, height, 0, width, true);
  const rowSplit = 540;
  const topColumns = occupancy(bitmap, width, height, 0, rowSplit, false);
  const bottomColumns = occupancy(bitmap, width, height, rowSplit, height, false);
  const gap = (counts, center, radius) => counts.slice(center - radius, center + radius + 1)
    .flatMap((count, index) => count === 0 ? [index + center - radius] : []);
  const cells = [
    ...['front', 'profile', 'back', 'three-quarter'].map((name, index) => ({
      name, left: index * width / 4, top: 0, right: (index + 1) * width / 4, bottom: rowSplit
    })),
    ...['excited', 'sparkle', 'sleepy', 'wave', 'idle'].map((name, index) => ({
      name, left: [0, 326, 616, 920, 1214][index], top: rowSplit,
      right: [326, 616, 920, 1214, width][index], bottom: height
    }))
  ];
  console.log(JSON.stringify({ width, height, bytes: bitmap.length,
    rowGap: gap(rows, rowSplit, 32),
    topColumnGaps: [384, 768, 1152].map(x => [x, gap(topColumns, x, 35)]),
    bottomColumnGaps: [326, 616, 920, 1214].map(x => [x, gap(bottomColumns, x, 35)]),
    cells: cells.map(cell => ({
    name: cell.name, cell, opaque: boundsForCell(bitmap, width, cell, 128),
    visible: boundsForCell(bitmap, width, cell, 1)
  })) }, null, 2));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
