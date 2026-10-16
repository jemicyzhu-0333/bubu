'use strict';

// Single registry of styling recipes for every pet form. A recipe only names
// existing catalog pieces; adding a set = one entry here (plus a test).
import { USAGI_OUTFIT_SETS } from './usagi-wardrobe.mjs';

const outfit = (id, label, formId, itemIds, extra = {}) =>
  Object.freeze({ id, label, formId, itemIds: Object.freeze(itemIds), ...extra });

const DANGO_OUTFIT_SETS = Object.freeze([
  outfit('halloween-night', '南瓜之夜', 'dango', ['seasonal.pumpkin-beret', 'seasonal.plum-cape'],
    { season: 'halloween', views: Object.freeze(['front']),
      // Outfit-linked performance: played once when the set becomes fully worn,
      // and offered as a seasonal surprise cue while worn in the listed months.
      wearAction: 'halloween-lantern',
      seasonalCue: Object.freeze({ months: Object.freeze([10]), weight: 600, cooldownMs: 4 * 60 * 60_000,
        message: '南瓜灯亮啦，小幽灵也来串门～' }) })
]);

const PET_OUTFIT_SETS = Object.freeze([...USAGI_OUTFIT_SETS, ...DANGO_OUTFIT_SETS]);
const outfitSetsFor = formId => PET_OUTFIT_SETS.filter(look => look.formId === formId);


// Sets whose every piece is currently worn.
function wornOutfitSetIds(formId, itemIds) {
  const worn = new Set(Array.isArray(itemIds) ? itemIds : []);
  return outfitSetsFor(formId).filter(look => look.itemIds.every(id => worn.has(id))).map(look => look.id);
}

// The wear action of a set that was not fully worn before and is now.
function outfitWearAction(formId, previousIds, nextIds) {
  if (!Array.isArray(previousIds)) return null;
  const before = new Set(wornOutfitSetIds(formId, previousIds));
  const look = outfitSetsFor(formId).find(candidate => candidate.wearAction
    && !before.has(candidate.id) && wornOutfitSetIds(formId, nextIds).includes(candidate.id));
  return look ? look.wearAction : null;
}

// Seasonal surprise cues derived from the same registry (one source of truth).
function outfitSeasonalCues() {
  return PET_OUTFIT_SETS.filter(look => look.wearAction && look.seasonalCue).map(look => ({
    id: `outfit.${look.id}`, familyId: `seasonal.${look.season || look.id}`, kind: 'attention',
    weight: look.seasonalCue.weight, priority: 20, cost: 1, globalCooldownMs: 30_000,
    familyCooldownMs: look.seasonalCue.cooldownMs, cooldownMs: look.seasonalCue.cooldownMs, focusAllowed: false,
    discoveryId: null, requires: { months: [...look.seasonalCue.months], outfitSetId: look.id },
    actionId: look.wearAction, message: look.seasonalCue.message
  }));
}

export { PET_OUTFIT_SETS, DANGO_OUTFIT_SETS, outfitSetsFor, wornOutfitSetIds, outfitWearAction, outfitSeasonalCues };
