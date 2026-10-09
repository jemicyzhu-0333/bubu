'use strict';

const { ipcRoutes } = require('./contract/ipc-codec');
const nudgePolicy = require('./domain/nudge-policy');
const reminderMarker = require('./domain/reminder-marker');
const sittingClock = require('./domain/sitting-clock');
const sittingReminder = require('./application/sitting-reminder');
const recordWorkEndReminder = require('./application/record-work-end-reminder');

module.exports = Object.freeze({
  ipcRoutes,
  nudgePolicy: Object.freeze({ ...nudgePolicy }),
  reminderMarker: Object.freeze({ ...reminderMarker }),
  sittingClock: Object.freeze({ ...sittingClock }),
  sittingReminder: Object.freeze({ ...sittingReminder }),
  recordWorkEndReminder: Object.freeze({ ...recordWorkEndReminder })
});
