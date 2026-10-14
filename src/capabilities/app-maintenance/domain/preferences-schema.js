'use strict';
function nextPreferencesSchema(version) {
  if (version !== 18) throw new Error('config-preferences-upgrade-source-invalid');
  return 19;
}
function nextRoutineRetentionSchema(version) {
  if (version !== 19) throw new Error('config-routine-retention-upgrade-source-invalid');
  return 20;
}
module.exports = { nextPreferencesSchema, nextRoutineRetentionSchema };
