'use strict';

const focusDuration = require('./domain/focus-duration');
const settingsPatch = require('./domain/preferences-patch');

module.exports = Object.freeze({
  interfacePreferences: Object.freeze({ ...require('./domain/interface-preferences') }),
  workSchedule: Object.freeze({ ...require('./domain/work-schedule') }),
  ...require('./contract/settings'),
  ...require('./contract/ipc-codec'),
  focusDuration: Object.freeze({ ...focusDuration }),
  settingsPatch: Object.freeze({ ...settingsPatch })
});
