'use strict';

const dismissMigrationNotice = require('./application/dismiss-migration-notice');
const { ipcRoutes } = require('./contract/ipc-codec');
const dailyMarker = require('./domain/daily-marker');
const migrationNotices = require('./domain/migration-notices');

module.exports = Object.freeze({
  ipcRoutes,
  updateReleasePolicy: Object.freeze({ ...require('./domain/update-release-policy') }),
  desktopUpdates: Object.freeze({ ...require('./application/desktop-updates'), ...require('./application/update-admission') }),
  dailyMarker: Object.freeze({ ...dailyMarker }),
  dismissMigrationNotice: Object.freeze({ ...dismissMigrationNotice }),
  migrationNotices: Object.freeze({ ...migrationNotices })
});
