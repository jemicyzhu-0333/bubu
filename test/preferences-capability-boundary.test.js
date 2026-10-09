'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../src/capabilities/preferences');

test('preferences exposes focus-duration state changes through its frozen facade', () => {
  assert.equal(Object.isFrozen(preferences), true);
  assert.equal(Object.isFrozen(preferences.focusDuration), true);
  assert.equal(Object.isFrozen(preferences.settingsPatch), true);
  assert.deepEqual(
    preferences.focusDuration.rememberSelection(
      { pomodoroMinutes: 25, lastChosenFocusMinutes: null, dnd: false },
      45
    ),
    {
      ok: true,
      settings: { pomodoroMinutes: 25, lastChosenFocusMinutes: 45, dnd: false }
    }
  );
  assert.deepEqual(
    preferences.focusDuration.rememberSelection({ pomodoroMinutes: 25 }, 2),
    { ok: false, reason: 'invalid-focus-duration' }
  );
});
