'use strict';

const appearanceSelection = require('./domain/appearance-selection');
const completionBenefits = require('./domain/completion-benefits');
const equipAppearance = require('./application/equip-appearance');
const feeding = require('./domain/feeding');
const foodShop = require('./domain/food-shop');
const levelUpFeedback = require('./application/level-up-feedback');
const persistSurpriseState = require('./application/persist-surprise-state');
const selectSkin = require('./application/select-skin');
const skinAvailability = require('./domain/skin-availability');
const skinSelection = require('./domain/skin-selection');
const relationshipProjection = require('./domain/relationship-projection');
const petContent = require('./pet-content');
const petCatalog = require('./pet-catalog');
const formRegistry = require('./form-registry.mjs');

module.exports = Object.freeze({
  applyOutfit: Object.freeze({ ...require('./application/apply-outfit') }),
  invalidateMealCare: Object.freeze({ ...require('./application/invalidate-meal-care') }),
  foodCommand: Object.freeze({ ...require('./domain/food-command') }),
  mealRhythm: Object.freeze({ ...require('./domain/meal-rhythm') }),
  mealServing: Object.freeze({ ...require('./domain/meal-serving') }),
  activityMirror: Object.freeze({ ...require('./domain/activity-mirror') }),
  concurrentActivity: Object.freeze({ ...require('./domain/concurrent-activity') }),
  skinProjection: Object.freeze({ ...require('./domain/skin-projection') }),
  ...require('./contract/constants'),
  ...require('./contract/ipc-codec'),
  appearanceSelection: Object.freeze({ ...appearanceSelection }),
  completionBenefits: Object.freeze({ ...completionBenefits }),
  equipAppearance: Object.freeze({ ...equipAppearance }),
  feeding: Object.freeze({ ...feeding }),
  foodShop: Object.freeze({ ...foodShop }),
  levelUpFeedback: Object.freeze({ ...levelUpFeedback }),
  persistSurpriseState: Object.freeze({ ...persistSurpriseState }),
  selectSkin: Object.freeze({ ...selectSkin }),
  skinAvailability: Object.freeze({ ...skinAvailability }),
  skinSelection: Object.freeze({ ...skinSelection }),
  petContent: Object.freeze({ ...petContent }),
  petCatalog: Object.freeze({ ...petCatalog }),
  formRegistry: Object.freeze({ ...formRegistry }),
  relationshipProjection: Object.freeze({ ...relationshipProjection })
});
