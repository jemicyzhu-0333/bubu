'use strict';
function nextPreferencesSchema(version) {
  if (version !== 18) throw new Error('config-preferences-upgrade-source-invalid');
  return 19;
}
module.exports = { nextPreferencesSchema };
