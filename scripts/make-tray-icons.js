'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { decodePNG, resize, composite } = require('./app-icon-png');
const { encodeBitmap } = require('../src/platform/electron/tray-bitmap');
const ROOT = path.resolve(__dirname, '..');

async function buildTrayAssets(root = ROOT) {
  const rasterRoot = path.join(root, 'assets/companion/dango/raster');
  const { DANGO_RASTER } = await import(pathToFileURL(path.join(rasterRoot, 'dango.raster.mjs')).href);
  const view = DANGO_RASTER.views.front;
  const neutral = decodePNG(fs.readFileSync(path.join(rasterRoot, view.neutral.src)));
  const [left, top, width, height] = view.neutral.rect;
  const images = new Map();
  function layer(sprites) {
    const image = { width: neutral.width, height: neutral.height, data: Buffer.alloc(neutral.width * neutral.height * 4) };
    for (const sprite of sprites) {
      if (!images.has(sprite.src)) images.set(sprite.src, decodePNG(fs.readFileSync(path.join(rasterRoot, sprite.src))));
      const [x, y, w, h] = sprite.rect;
      composite(image, images.get(sprite.src), [(x - left) / width * neutral.width, (y - top) / height * neutral.height,
        w / width * neutral.width, h / height * neutral.height]);
    }
    return image;
  }
  // PET_VISUAL「舞台与坐标契约」: use current, independent production PNGs
  // and manifest geometry. Ears and feet sit behind the same canonical body.
  const sources = new Map([
    ['body', layer(['ear-left', 'ear-right', 'foot-left', 'foot-right'].map(name => view.parts[name]).concat(view.body))],
    ...['neutral', 'half', 'closed', 'sparkle'].map(name => [`eyes-${name}`, layer(view.face.eyes[name])]),
    ...['neutral', 'grin'].map(name => [`mouth-${name}`, layer([view.face.mouth[name]])])
  ]);
  const assets = new Map();
  for (const [name, source] of sources) {
    for (const size of [22, 44]) assets.set(`assets/tray/${name}-${size}.bmp`, encodeBitmap(resize(source, size)));
  }
  return assets;
}

module.exports = { buildTrayAssets };
