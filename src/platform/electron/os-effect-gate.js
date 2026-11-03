'use strict';
const { readFixtureIsolation, recordFixtureSuppression } = require('./dev/fixture-isolation');

// Single adapter between OS-effect adapters (tray, shortcuts, notifications,
// login item, dev hot reload) and the dev-only capture isolation scope.
// Production: no scope is installed, so every call returns false and the
// adapter performs its real OS effect unchanged.
function suppressOsEffect(effect) {
  if (!readFixtureIsolation()) return false;
  recordFixtureSuppression(effect);
  return true;
}
module.exports = { suppressOsEffect };
