'use strict';

const { cancelMealAdvice } = require('./meal-rhythm');
const { isSkinAvailable } = require('./skin-availability');

function selectSkin(state, { skinId, availableSkinIds } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('skin selection requires a state draft');
  }
  if (!Array.isArray(availableSkinIds)
      || typeof skinId !== 'string'
      || !availableSkinIds.includes(skinId)) {
    return { ok: false, reason: 'skin-not-found' };
  }
  if (!isSkinAvailable(skinId, state.unlockedSkins)) {
    return { ok: false, reason: 'skin-locked' };
  }
  if (state.currentSkin === skinId) {
    return { ok: true, changed: false, skinId };
  }
  state.currentSkin = skinId;
  cancelMealAdvice(state);
  return { ok: true, changed: true, skinId };
}

module.exports = { selectSkin };
