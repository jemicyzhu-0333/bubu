'use strict';

// Windows Electron treats even an empty ELECTRON_RUN_AS_NODE value as present.
// Native installed-app verification must omit that variable, including inherited
// casing aliases, rather than selecting Node mode before production bootstrap.
function installedElectronEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => name.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
}
module.exports = { installedElectronEnvironment };
