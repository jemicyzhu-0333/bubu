'use strict';

// Default forms are available to existing schema-10 profiles as well as new
// ones. Earned unlocks stay in unlockedSkins; merely offering a form must not
// rewrite a user's stored state or require a same-schema migration.
const ALWAYS_AVAILABLE_SKIN_IDS = Object.freeze(['pink', 'usagi']);

function isSkinAvailable(skinId, unlockedSkins) {
  return typeof skinId === 'string' && (ALWAYS_AVAILABLE_SKIN_IDS.includes(skinId)
    || (Array.isArray(unlockedSkins) && unlockedSkins.includes(skinId)));
}

module.exports = { ALWAYS_AVAILABLE_SKIN_IDS, isSkinAvailable };
