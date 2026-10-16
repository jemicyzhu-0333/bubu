'use strict';

// Single registry of styling recipes for every pet form. A recipe only names
// existing catalog pieces; adding a set = one entry here (plus a test).
import { USAGI_OUTFIT_SETS } from './usagi-wardrobe.mjs';

const outfit = (id, label, formId, itemIds, extra = {}) =>
  Object.freeze({ id, label, formId, itemIds: Object.freeze(itemIds), ...extra });

const DANGO_OUTFIT_SETS = Object.freeze([
  outfit('halloween-night', '南瓜之夜', 'dango', ['seasonal.pumpkin-beret', 'seasonal.plum-cape'],
    { season: 'halloween', views: Object.freeze(['front']) })
]);

const PET_OUTFIT_SETS = Object.freeze([...USAGI_OUTFIT_SETS, ...DANGO_OUTFIT_SETS]);
const outfitSetsFor = formId => PET_OUTFIT_SETS.filter(look => look.formId === formId);

export { PET_OUTFIT_SETS, DANGO_OUTFIT_SETS, outfitSetsFor };
