'use strict';
const { createElectronStoreAdapter } = require('./electron-store-adapter');
const { PERSISTED_SCHEMA_VERSION, normalizePersistedState, assertCanonicalPersistedState } = require('./persisted-schema');

// The application has one SQL authority. Legacy JSON-only profiles are preserved
// and refused rather than silently imported or replaced by a new empty profile.
function createSqliteStateAdapter(options = {}) {
  return createElectronStoreAdapter({ normalize: normalizePersistedState, ...options,
    schemaVersion: PERSISTED_SCHEMA_VERSION, jsonMirror: false, currentOnly: true,
    assertCanonical: assertCanonicalPersistedState });
}
module.exports = { createSqliteStateAdapter };
