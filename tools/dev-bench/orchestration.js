'use strict';

const { SCENARIOS } = require('./scenarios');
const { createDisposableProfile } = require('./profile-fixture');

function launchBench({ app, argv = process.argv, createProfile = createDisposableProfile,
  startMain = () => require('../../src/main'), log = console.log } = {}) {
  if (app.isPackaged) throw new Error('the development bench is not available in packaged applications');
  const scenario = (argv.find(argument => argument.startsWith('--scenario=')) || '--scenario=all').slice(11);
  if (!SCENARIOS.includes(scenario)) throw new Error(`choose a scenario: ${SCENARIOS.join(', ')}`);
  const profile = createProfile({ scenario });
  // The fixture has committed and closed before main can acquire its SQL owner.
  app.setPath('userData', profile.userDataPath);
  app.setPath('sessionData', profile.userDataPath);
  if (!argv.includes('--dev')) argv.push('--dev');
  log(`小步 isolated bench (${scenario}): ${profile.userDataPath}`);
  if (argv.includes('--devtools')) {
    app.on('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', () => window.webContents.openDevTools({ mode: 'detach', activate: false }));
    });
  }
  startMain();
  return profile;
}

module.exports = { launchBench };
