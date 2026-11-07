'use strict';
const path = require('node:path');

// ARCHITECTURE「V2 动画研究底座」: a single, process-local capture scope.
// This is not a registry of replaceable services. Only these fixed OS effects
// and the existing IPC host are restricted; real windows and storage remain real.
const EFFECTS = Object.freeze([
  'shortcutRegisterAll', 'shortcutClaim', 'shortcutDispose', 'notificationShow',
  'loginRead', 'loginWrite', 'trayCreate', 'trayOperation', 'trayDispose',
  'developmentStart', 'blockedIPC'
]);
const ALLOWED_IPC = new Set([
  'settings:get-interface', 'pet:getState', 'pet:getContent', 'pet:getBounds',
  'pet:getFeedState', 'pet:updateRuntime', 'pet:cueAck'
]);
let scope = null;

function assertCurrent(value) {
  if (value.invalidated) throw new Error('fixture-isolation-invalidated');
  try {
    if (value.app.isPackaged !== false || !value.defaultApp || !value.argv.includes('--dev')
        || value.app.getPath('userData') !== value.profilePath
        || value.app.getPath('sessionData') !== value.profilePath
        || value.assertOwnedProfile() !== true) throw new Error('fixture-isolation-scope-mismatch');
  } catch {
    value.invalidated = true;
    // Ownership callbacks may use filesystem ports; never export their paths.
    throw new Error('fixture-isolation-scope-mismatch');
  }
}

function installFixtureIsolation(options = {}) {
  if (scope) throw new Error('fixture-isolation-already-installed');
  const keys = ['app', 'profilePath', 'assertOwnedProfile', 'defaultApp', 'argv'];
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => !keys.includes(key))) throw new TypeError('fixture-isolation-options-invalid');
  const { app, profilePath, assertOwnedProfile, defaultApp = process.defaultApp === true, argv = process.argv } = options;
  if (!app || typeof app.getPath !== 'function' || typeof profilePath !== 'string'
      || !path.isAbsolute(profilePath) || typeof assertOwnedProfile !== 'function'
      || !Array.isArray(argv) || !argv.every(item => typeof item === 'string') || defaultApp !== true)
    throw new TypeError('fixture-isolation-capability-invalid');
  const candidate = { app, profilePath, assertOwnedProfile, defaultApp,
    argv: [...argv], closed: false, invalidated: false,
    suppressed: Object.fromEntries(EFFECTS.map(effect => [effect, 0])) };
  assertCurrent(candidate);
  scope = candidate;
  return Object.freeze({ close() {
    if (scope.closed) return false;
    // Keep denial in force for queued callbacks through process exit.
    scope.closed = true;
    return true;
  } });
}

function readFixtureIsolation() {
  if (!scope) return false;
  assertCurrent(scope);
  return true;
}

// Closing keeps OS-effect denial active, but retires mutation authority.
function readActiveFixtureIsolation() {
  return Boolean(readFixtureIsolation() && !scope.closed && !scope.invalidated);
}

function recordFixtureSuppression(effect) {
  if (!EFFECTS.includes(effect)) throw new TypeError('fixture-effect-unknown');
  if (!readFixtureIsolation()) return false;
  scope.suppressed[effect] = Math.min(Number.MAX_SAFE_INTEGER, scope.suppressed[effect] + 1);
  return true;
}

function assertFixtureIpcAllowed(channel) {
  if (readFixtureIsolation() && !ALLOWED_IPC.has(channel)) {
    recordFixtureSuppression('blockedIPC');
    throw new Error('fixture-ipc-disabled');
  }
}

function readFixtureIsolationDiagnostics() {
  return Object.freeze({ schemaVersion: 1, installed: scope !== null,
    closed: scope?.closed ?? false, invalidated: scope?.invalidated ?? false,
    suppressed: Object.freeze({ ...(scope?.suppressed ?? Object.fromEntries(EFFECTS.map(effect => [effect, 0]))) }) });
}
module.exports = { installFixtureIsolation, readFixtureIsolation, readActiveFixtureIsolation, recordFixtureSuppression,
  assertFixtureIpcAllowed, readFixtureIsolationDiagnostics };
