'use strict';

const focusDuration = require('./domain/focus-duration');
const settingsPatch = require('./domain/preferences-patch');

module.exports = Object.freeze({
  workSchedule: Object.freeze({ ...require('./domain/work-schedule') }),
  ...require('./contract/settings'),
  ...require('./contract/ipc-codec'),
  focusDuration: Object.freeze({ ...focusDuration }),
  settingsPatch: Object.freeze({ ...settingsPatch })
});
