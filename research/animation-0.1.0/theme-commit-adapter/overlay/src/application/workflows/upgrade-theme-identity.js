'use strict';
// A version-only upgrade. Existing records get no fabricated completion IDs,
// timestamps, preset assignments or theme eligibility.
function prepareThemeIdentityUpgrade(source, { assertSource, assertTarget }) {
  assertSource(source);
  if (source.schemaVersion !== 20) throw new TypeError('config-theme-upgrade-source-invalid');
  const candidate = structuredClone(source);
  candidate.schemaVersion = 21;
  assertTarget(candidate);
  return candidate;
}
module.exports = { prepareThemeIdentityUpgrade };
