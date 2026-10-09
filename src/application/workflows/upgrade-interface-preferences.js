'use strict';
const { preferences, 'app-maintenance': maintenance } = require('../../capabilities');
const UPGRADE_INTERFACE_PREFERENCES_WRITES = Object.freeze(['schemaVersion', 'settings']);
// ARCHITECTURE「合入前的18→19升级门禁」: an explicit offline workflow. The
// persistence port validates the exact additive candidate and commits it once;
// it never gives a general normalizer permission to repair old user data.
function prepareInterfacePreferencesUpgrade(source, assertCanonical) {
  if (!source || typeof assertCanonical !== 'function') throw new TypeError('config-preferences-upgrade-source-invalid');
  const candidate = structuredClone(source);
  candidate.schemaVersion = maintenance.preferencesSchema.nextPreferencesSchema(source.schemaVersion);
  candidate.settings = preferences.interfacePreferences.upgradeSchema18Settings(candidate.settings);
  assertCanonical(candidate);
  return candidate;
}
module.exports = { UPGRADE_INTERFACE_PREFERENCES_WRITES, prepareInterfacePreferencesUpgrade };
