'use strict';
const { encodePNG } = require('./app-icon-png');
const { rasterSymbol, symbolSvg } = require('./tray-symbol');
const SIZES = Object.freeze([16, 18, 20, 22, 24, 32, 40, 44, 48]);
const STATES = Object.freeze(['neutral', 'half', 'closed', 'celebrate']);
async function buildTrayAssets() {
  const assets = new Map();
  for (const state of STATES) {
    assets.set(`assets/tray/${state}.svg`, Buffer.from(symbolSvg(state)));
    assets.set(`assets/tray/${state}Template.svg`, Buffer.from(symbolSvg(state, true)));
    for (const size of SIZES) assets.set(`assets/tray/${state}-${size}.png`, encodePNG(rasterSymbol(size, state)));
    for (const size of [16, 32]) {
      assets.set(`assets/tray/${state}Template${size === 32 ? '@2x' : ''}.png`, encodePNG(rasterSymbol(size, state, true)));
    }
  }
  return assets;
}
module.exports = { buildTrayAssets, SIZES, STATES };
