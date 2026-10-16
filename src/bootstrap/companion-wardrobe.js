'use strict';
const { equipAppearance, applyOutfit } = require('../capabilities/companion');
const { PET_OUTFIT_SETS, wornOutfitSetIds } = require('../content/companion/outfit-sets.mjs');

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
// Surprise-context facts for seasonal/outfit cues: current month and fully worn sets.
function outfitSurpriseContext(snapshot, items, now = new Date()) {
  let worn = [];
  try {
    const { appearanceSelection, formRegistry: forms } = require('../capabilities/companion');
    const selection = appearanceSelection.selectAppearance({ items, level: snapshot.level, unlockedSkins: snapshot.unlockedSkins,
      currentSkin: snapshot.currentSkin, equipped: snapshot.companion?.appearance?.equipped });
    worn = wornOutfitSetIds(forms.resolvePetForm(snapshot.currentSkin).id, selection.worn.map(item => item.id));
  } catch (_) { worn = []; }
  return { month: now.getMonth() + 1, wornOutfitSetIds: worn };
}
module.exports = { createCompanionWardrobe, outfitSurpriseContext };
