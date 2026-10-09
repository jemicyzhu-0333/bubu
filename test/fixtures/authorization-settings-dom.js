'use strict';

// Explicit static synthetic nodes for the real settings save handlers, not a
// browser/layout fixture. No markup/filesystem read, source rewrite, timers,
// updater commands, or drawer open/close/RAF path is used by this fixture.
function createAuthorizationSettingsDom() {
  const nodes = new Map();
  function node(selector, dataset = {}, initialClasses = []) {
    const classes = new Set(initialClasses), listeners = new Map();
    const element = {
      value: '', textContent: '', dataset: { ...dataset }, disabled: false,
      checked: false, open: false, attributes: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : force;
          if (enabled) classes.add(name); else classes.delete(name);
          return enabled;
        }
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      fire(type, extra = {}) {
        const event = { target: this, currentTarget: this, preventDefault() {}, ...extra };
        for (const listener of Array.from(listeners.get(type) || [])) listener(event);
      }
    };
    nodes.set(selector, element);
    return element;
  }
  for (const id of [
    'aiModelInput', 'aiBaseUrlInput', 'aiApiKeyInput', 'aiConfigStatus',
    'aiSaveConfig', 'aiCredentialState', 'aiActiveMode', 'aiImportCredential',
    'aiClearCredential', 'settingsSaveStatus', 'btnSettings', 'btnSettingsClose',
    'appShell', 'configStorageStatus', 'setPomodoro', 'setBreak', 'setSoft',
    'setHydration', 'setWorkStart', 'setWorkEnd', 'setFocusLvl', 'setRestLvl',
    'aiPrivacyStatus', 'energyCalibrationStatus', 'energyCalibrationFeedback',
    'btnResetEnergyCalibration', 'settingGroupEnergy', 'settingGroupPlanning'
  ]) node(`#${id}`);
  node('#settingsMask', {}, ['hidden']);
  for (const key of [
    'strategyGuidanceEnabled', 'dailyReviewEnabled', 'aiBreakdownEnabled',
    'aiClarifyEnabled', 'aiMemoryEnabled', 'aiImpulseEnergyEnabled',
    'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'energyCurveEnabled',
    'workEndReminder', 'dnd', 'soundEnabled'
  ]) node(`[data-toggle="${key}"]`, { toggle: key });
  const groups = new Map([
    ['[data-setting]', []],
    ['.motion-mode, .stimulation-mode, .pet-activity-mode', []],
    ['.ttl-set-chip', []], ['.char-chip', []], ['[data-test-nudge]', []],
    ['.motion-mode', []], ['.stimulation-mode', []], ['.pet-activity-mode', []]
  ]);
  const $ = selector => nodes.get(selector) || null;
  const $$ = selector => groups.get(selector) || [];
  const document = { body: { dataset: {} }, querySelector: $,
    getElementById: id => $(`#${id}`) };
  return { $, $$, document,
    fire(selector, type, extra) {
      const element = $(selector);
      if (!element) throw new Error(`Unknown static fixture selector: ${selector}`);
      element.fire(type, extra);
    },
    input(selector, value) {
      const element = $(selector);
      if (!element) throw new Error(`Unknown static fixture selector: ${selector}`);
      element.value = value;
      element.fire('input');
    }
  };
}
module.exports = { createAuthorizationSettingsDom };
