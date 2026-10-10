'use strict';
const { equipAppearance, applyOutfit } = require('../capabilities/companion');
const { USAGI_OUTFIT_SETS } = require('../content/companion/usagi-wardrobe.mjs');

function createCompanionWardrobe(ports) {
  const appearance = equipAppearance.createEquipAppearanceCommand(ports);
  const outfit = applyOutfit.createApplyOutfitCommand({ ...ports, looks: USAGI_OUTFIT_SETS });
  function register(registerIpc) {
    registerIpc('appearance:equip', (_event, payload) => appearance.equip(payload));
    registerIpc('appearance:reset', () => appearance.reset());
    registerIpc('appearance:apply-outfit', (_event, payload) => outfit.apply(payload));
  }
  return Object.freeze({ register });
}
module.exports = { createCompanionWardrobe };
