'use strict';
const { equipAppearance, applyOutfit } = require('../capabilities/companion');
const { PET_OUTFIT_SETS } = require('../content/companion/outfit-sets.mjs');

function createCompanionWardrobe(ports) {
  const appearance = equipAppearance.createEquipAppearanceCommand(ports);
  const outfit = applyOutfit.createApplyOutfitCommand({ ...ports, looks: PET_OUTFIT_SETS });
  function register(registerIpc) {
    registerIpc('appearance:equip', (_event, payload) => appearance.equip(payload));
    registerIpc('appearance:reset', () => appearance.reset());
    registerIpc('appearance:apply-outfit', (_event, payload) => outfit.apply(payload));
  }
  return Object.freeze({ register });
}
module.exports = { createCompanionWardrobe };
