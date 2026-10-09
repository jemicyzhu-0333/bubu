#!/usr/bin/env node
'use strict';

// PET_VISUAL「舞台与坐标契约」: current Dango raster, never the retired grid.
// All platforms use the same approved neutral PNG, with transparent safe padding.
const fs = require('node:fs');
const path = require('node:path');
const { decodePNG, encodePNG, resize } = require('./app-icon-png');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'assets/companion/dango/raster/views/front/neutral.png';
const ICONSET = [
  ['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64],
  ['128x128', 128], ['128x128@2x', 256], ['256x256', 256],
  ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]
];
function ico(images) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i], entry = 6 + i * 16, png = images.get(size);
    header[entry] = size % 256; header[entry + 1] = size % 256;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...sizes.map(size => images.get(size))]);
}
function icns(images) {
  // PNG-backed modern macOS representations; no macOS-only iconutil invocation.
  const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
    ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = entries.map(([type, size]) => {
    const png = images.get(size), header = Buffer.alloc(8);
    header.write(type); header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8); header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((sum, bytes) => sum + bytes.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}
async function buildAssets(root = ROOT) {
  const source = decodePNG(fs.readFileSync(path.join(root, SOURCE)));
  const images = new Map([16, 24, 32, 48, 64, 128, 256, 512, 1024]
    .map(size => [size, encodePNG(resize(source, size))]));
  const assets = new Map(ICONSET.map(([name, size]) => [`assets/icon.iconset/icon_${name}.png`, images.get(size)]));
  assets.set('assets/icon.png', images.get(512));
  assets.set('assets/icon.ico', ico(images)); assets.set('assets/icon.icns', icns(images));
  const { buildTrayAssets } = require('./make-tray-icons');
  for (const [name, bytes] of await buildTrayAssets(root)) assets.set(name, bytes);
  return assets;
}
function syncAssets(root, assets, check = false) {
  const changed = [];
  for (const [name, bytes] of assets) {
    const destination = path.join(root, name);
    if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) continue;
    changed.push(name);
    if (!check) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
  }
  if (check && changed.length) throw new Error(`Stale or missing application icons: ${changed.join(', ')}. Run npm run make-icon.`);
  return changed;
}
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/make-icon.js [--check]');
  const check = process.argv.includes('--check'), assets = await buildAssets();
  const changed = syncAssets(ROOT, assets, check);
  console.log(check ? `Application icons match current Dango source (${assets.size} files).`
    : `Application icons verified against current Dango source; ${changed.length} files updated.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildAssets, syncAssets, ico, icns, SOURCE };
