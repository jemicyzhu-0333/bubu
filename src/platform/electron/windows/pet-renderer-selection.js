'use strict';
const path = require('node:path');
const { isDevProfile } = require('../../../core/runtime-profile');

// ARCHITECTURE「V2 动画研究底座」: one explicit, unpackaged development seam;
// never select a URL or executable supplied by the environment.
function selectPetRendererPage({ pagePath, development = false, defaultApp = false, requested } = {}) {
  if (typeof pagePath !== 'string' || !pagePath) throw new TypeError('pet page path is required');
  if (!development || !defaultApp || requested !== '1') return pagePath;
  return path.resolve(path.dirname(pagePath), '../surfaces/pet/realtime/index.html');
}
function readPetRendererSelection(development = isDevProfile(process.argv)) {
  return { development, defaultApp: process.defaultApp === true, requested: process.env.BUBU_DEV_REALTIME_PET };
}
module.exports = { selectPetRendererPage, readPetRendererSelection };
