'use strict';
const { launchBench } = require('./orchestration');
module.exports = { launchBench };
// Existing Electron verification entries require this module to start the bench.
// Plain Node can import the orchestration for synthetic-port tests without Electron.
if (process.versions.electron) module.exports.profile = launchBench({ app: require('electron').app });
