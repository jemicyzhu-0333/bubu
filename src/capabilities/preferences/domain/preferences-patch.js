'use strict';

const { isDeepStrictEqual } = require('node:util');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../contract/settings');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validatePatch(rawPatch, currentSettings) {
  if (!isPlainObject(rawPatch) || Object.keys(rawPatch).length === 0) {
    return { ok: false, reason: 'settings-patch-invalid' };
  }
  const current = normalizeSettings(currentSettings);
  const patch = {};
  for (const [key, value] of Object.entries(rawPatch)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
      return { ok: false, reason: 'settings-field-invalid', field: key };
    }
    patch[key] = value;
  }
  const normalized = normalizeSettings({ ...current, ...patch });
  for (const [key, value] of Object.entries(patch)) {
    if (!isDeepStrictEqual(normalized[key], value)) {
      return { ok: false, reason: 'settings-field-invalid', field: key };
    }
  }
  return { ok: true, patch, settings: normalized };
}

function applyPreferencesPatch(state, patch) {
  const validation = validatePatch(patch, state.settings);
  if (!validation.ok) return validation;
  const changed = !isDeepStrictEqual(normalizeSettings(state.settings), validation.settings);
  if (changed) state.settings = validation.settings;
  return { ok: true, changed, changedKeys: changed ? Object.keys(validation.patch) : [] };
}

module.exports = { validatePatch, applyPreferencesPatch };
