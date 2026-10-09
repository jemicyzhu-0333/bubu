'use strict';

const { MAX_NATIVE_COORDINATE, isPlainObject } = require('../../../core/field-normalizers');
const { sessionDuration } = require('../../execution');
const { MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES } = sessionDuration;
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const {
  AI_MODEL_PATTERN,
  MAX_AI_URL_INPUT_LENGTH,
  MIN_TIMELINE_RETENTION_DAYS,
  MAX_TIMELINE_RETENTION_DAYS,
  MAX_NUDGE_WHITELIST_ENTRIES,
  MAX_NUDGE_WHITELIST_ENTRY_LENGTH,
  DEFAULT_SETTINGS,
  baseUrlFromEndpoint,
  isGlobalShortcut,
  isHttpsEndpoint,
  normalizeSettings
} = require('./settings');

function decodeSettingsPatch(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, Object.keys(DEFAULT_SETTINGS));
  if (Object.keys(object).length === 0) validation.fail('settings patch must not be empty');
  const hasCurrentSettings = isPlainObject(validation.context.currentSettings);
  const merged = { ...normalizeSettings(validation.context.currentSettings), ...object };
  const value = {};
  const ranges = {
    pomodoroMinutes: [MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES],
    lastChosenFocusMinutes: [MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES],
    breakMinutes: [1, 60],
    softReminderEvery: [5, 180],
    hydrationEvery: [15, 240],
    focusMaxLevel: [1, 4],
    restMaxLevel: [1, 4],
    workStartHour: [0, 22],
    workEndHour: [1, 24],
    adhocTtlHours: [1, 24 * 14],
    energyCheckInHalfLifeMinutes: [30, 12 * 60],
    timelineRetentionDays: [MIN_TIMELINE_RETENTION_DAYS, MAX_TIMELINE_RETENTION_DAYS]
  };
  const booleans = new Set([
    'soundEnabled', 'dnd', 'petEnabled', 'workEndReminder',
    'strategyGuidanceEnabled', 'dailyReviewEnabled', 'quickPanelEnabled',
    'routineRemindersEnabled', 'energyCurveEnabled', 'autoCheckUpdates',
    'aiBreakdownEnabled', 'aiClarifyEnabled', 'aiMemoryEnabled', 'aiImpulseEnergyEnabled',
    'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'activityMirrorEnabled'
  ]);
  const enums = {
    locale: ['system', 'zh-CN', 'en'],
    theme: ['system', 'light', 'dark'],
    nudgeCharacter: ['spider', 'cat', 'robot'],
    adhocTtlMode: ['midnight', 'hours'],
    motionMode: ['reduced', 'balanced', 'full'],
    stimulationMode: ['low', 'balanced', 'high'],
    petActivityMode: ['off', 'quiet', 'balanced', 'lively', 'chaos']
  };

  for (const [key, candidate] of Object.entries(object)) {
    if (ranges[key]) {
      const [min, max] = ranges[key];
      if (key === 'lastChosenFocusMinutes' && candidate === null) value[key] = null;
      else if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
        validation.fail(`${key} must be an integer from ${min} to ${max}`);
      } else value[key] = candidate;
    } else if (booleans.has(key)) {
      if (typeof candidate !== 'boolean') validation.fail(`${key} must be boolean`);
      else value[key] = candidate;
    } else if (enums[key]) {
      if (!enums[key].includes(candidate)) validation.fail(`${key} is invalid`);
      else value[key] = candidate;
    } else if (key === 'quickPanelShortcut') {
      // Only a canonical accelerator is accepted, and the accepted value is
      // stored verbatim. Repairing a near-miss here would persist a string this
      // same validator rejects on the next read, and a shortcut the OS refuses
      // to register looks to the user exactly like a broken hotkey.
      if (!isGlobalShortcut(candidate)) {
        validation.fail('quickPanelShortcut must be an Electron accelerator with at least one modifier');
      } else value[key] = candidate.trim();
    } else if (key === 'aiModel') {
      if (typeof candidate !== 'string' || !AI_MODEL_PATTERN.test(candidate.trim())) {
        validation.fail('aiModel must be 1 to 80 characters of letters, digits, dot, colon, slash, underscore or dash');
      } else value[key] = candidate.trim();
    } else if (key === 'aiBaseUrl') {
      if (candidate !== null && !isHttpsEndpoint(candidate, MAX_AI_URL_INPUT_LENGTH)) {
        validation.fail('aiBaseUrl must be null or an https URL of at most 200 characters');
      } else if (candidate === null) value[key] = null;
      else {
        const normalizedBaseUrl = baseUrlFromEndpoint(candidate);
        if (!isHttpsEndpoint(normalizedBaseUrl)) {
          validation.fail('aiBaseUrl exceeds the canonical URL length limit after normalization');
        } else value[key] = normalizedBaseUrl;
      }
    } else if (key === 'nudgeWhitelist') {
      if (!Array.isArray(candidate) || candidate.length > MAX_NUDGE_WHITELIST_ENTRIES
          || candidate.some(item => typeof item !== 'string' || !item.trim()
            || item.length > MAX_NUDGE_WHITELIST_ENTRY_LENGTH)) {
        validation.fail(`nudgeWhitelist must contain at most ${MAX_NUDGE_WHITELIST_ENTRIES} non-empty strings`);
      } else value[key] = candidate.map(item => item.trim());
    } else if (key === 'petPosition') {
      if (isPlainObject(candidate)) validation.rejectUnknown(candidate, ['x', 'y']);
      if (candidate !== null && (!isPlainObject(candidate)
          || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)
          || Math.abs(candidate.x) > MAX_NATIVE_COORDINATE || Math.abs(candidate.y) > MAX_NATIVE_COORDINATE)) {
        validation.fail(`petPosition must be null or finite x/y coordinates within ±${MAX_NATIVE_COORDINATE}`);
      } else value[key] = candidate === null ? null : { x: Math.round(candidate.x), y: Math.round(candidate.y) };
    } else {
      // Unreachable for a payload the user can send: `rejectUnknown` above has
      // already narrowed `key` to `DEFAULT_SETTINGS`. It fires when a new
      // default is added without a validator here — previously that key was
      // accepted, silently dropped from `value`, and the patch became a no-op
      // with no error anywhere. Refusing loudly turns that into a failing test.
      validation.fail(`${key} has no validator in the preferences codec`);
    }
  }
  const canCheckWorkRange = hasCurrentSettings || ('workStartHour' in object && 'workEndHour' in object);
  if (canCheckWorkRange && Number.isInteger(merged.workStartHour) && Number.isInteger(merged.workEndHour)
      && merged.workEndHour <= merged.workStartHour) {
    validation.fail('workEndHour must be later than workStartHour');
  }
  return value;
}

const codec = createCapabilityCodec({
  'settings:update': decodeSettingsPatch,
  'settings:get-interface': emptyPayload,
  'pet:toggleDnd': emptyPayload,
  'pet:hide': emptyPayload,
  // ARCHITECTURE「快捷行动面板」: a read-only query for the accelerator that actually registered. It
  // takes no payload, but still goes through the codec so the closed contract
  // stays exhaustive rather than growing an ad-hoc bare channel.
  'quickPanel:describeShortcut': emptyPayload
});

const ipcRoutes = describeRoutes('preferences', codec, {
  'settings:update': ['popover'],
  'settings:get-interface': ['popover', 'impulse', 'pet', 'nudgeCorner', 'nudgeFullscreen'],
  'pet:toggleDnd': ['pet'],
  'pet:hide': ['pet'],
  'quickPanel:describeShortcut': ['popover']
}, ['quickPanel:describeShortcut', 'settings:get-interface']);

module.exports = { ipcRoutes };
