'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { suppressOsEffect } = require('../src/platform/electron/os-effect-gate');
const { readFixtureIsolationDiagnostics } = require('../src/platform/electron/dev/fixture-isolation');

test('without an installed capture scope every OS effect proceeds (production unchanged)', () => {
  for (const effect of ['trayCreate', 'shortcutClaim', 'notificationShow', 'loginWrite', 'developmentStart'])
    assert.equal(suppressOsEffect(effect), false);
  assert.equal(readFixtureIsolationDiagnostics().installed, false);
});
test('OS adapters reach the isolation scope only through the single gate', () => {
  const dir = path.join(__dirname, '../src/platform/electron');
  for (const file of ['app-host.js', 'tray.js', 'shortcuts.js', 'notifications.js', 'dev/pet-development.js']) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(source, /readFixtureIsolation|recordFixtureSuppression/, file);
    assert.match(source, /suppressOsEffect\(/, file);
  }
});
