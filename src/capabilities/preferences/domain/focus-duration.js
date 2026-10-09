'use strict';

const { sessionDuration } = require('../../execution');

function rememberSelection(settings, minutes) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: 'settings-required' };
  }
  if (!sessionDuration.isFocusMinutes(minutes)) {
    return { ok: false, reason: 'invalid-focus-duration' };
  }
  return {
    ok: true,
    settings: { ...settings, lastChosenFocusMinutes: minutes }
  };
}

module.exports = { rememberSelection };
