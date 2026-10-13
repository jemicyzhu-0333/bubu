'use strict';

const { 'app-maintenance': maintenance } = require('../../capabilities');
const UPGRADE_ROUTINE_RETENTION_WRITES = Object.freeze(['schemaVersion']);

// ARCHITECTURE「持久化与迁移」: preserve every source byte's meaning. Only
// the accepted retention capacity changes; occurrence identities never move.
function prepareRoutineRetentionUpgrade(source, { assertSource, assertTarget }) {
  assertSource(source);
  const candidate = structuredClone(source);
  candidate.schemaVersion = maintenance.preferencesSchema.nextRoutineRetentionSchema(source.schemaVersion);
  assertTarget(candidate);
  return candidate;
}

module.exports = { UPGRADE_ROUTINE_RETENTION_WRITES, prepareRoutineRetentionUpgrade };
