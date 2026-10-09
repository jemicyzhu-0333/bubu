'use strict';

const {
  MAX_NATIVE_COORDINATE,
  isPlainObject,
  numberInRange,
  optionalInteger,
  booleanOr
} = require('../../../core/field-normalizers');
const {
  MIN_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,
  DEFAULT_FOCUS_MINUTES
} = require('../../execution').sessionDuration;
const { MAX_AI_CANONICAL_URL_LENGTH, baseUrlFromEndpoint } = require('../../../core/llm/endpoint');
const {
  DEFAULT_WHITELIST,
  MAX_NUDGE_WHITELIST_ENTRIES,
  MAX_NUDGE_WHITELIST_ENTRY_LENGTH
} = require('./nudge-whitelist');

// 早先还有一个 `aiProvider` 枚举（'local' / 'api'）。它被删掉了：'local' 那条路强制
// loopback 却同样要求 https，而本机推理服务几乎都跑明文 http，因此从未真正可用；
// 而“连哪儿”本来就完全由 `aiBaseUrl` 决定。一个只能取单值的模式开关不提供信息，
// 只提供选错的机会。`aiBreakdownEnabled` 仍然是唯一的 AI 总开关。
// Model ids come from many vendors: `gpt-5-mini`, `anthropic/claude-sonnet-4`,
// `qwen2.5:7b`. Bound the charset instead of guessing a vendor's naming.
const AI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
// User input stays compact, but WHATWG serializes Unicode hosts, paths and
// queries as punycode / percent escapes. A valid 200-code-unit input can thus
// become much longer without gaining any new semantic content. Only this bound
// is a settings concern — what the field will accept from a human. The canonical
// and on-the-wire bounds belong to the address vocabulary in core/llm/endpoint.
const MAX_AI_URL_INPUT_LENGTH = 200;
// A global shortcut is registered with the OS for the whole desktop, so a bad
// accelerator does not fail locally: it either silently fails to register or
// takes that key away from every other application. Two things are therefore
// validated — the accelerator is spelled the way Electron parses it, and it
// carries at least one modifier. `Space` on its own is a registerable
// accelerator and would make the space bar unusable system-wide.
// The spelling must be canonical rather than case-insensitive: normalization
// runs on every startup and only ever accepts or falls back, never rewrites, so
// whatever is persisted here has to be registerable as-is.
const SHORTCUT_MODIFIERS = Object.freeze([
  'CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Control', 'Ctrl',
  'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'
]);
const SHORTCUT_KEY_PATTERN = /^(?:[A-Za-z0-9]|F[1-9]|F1\d|F2[0-4]|num[0-9]|numdec|numadd|numsub|nummult|numdiv|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus)$/;
const MAX_SHORTCUT_LENGTH = 80;
// Retention bounds the timeline's own history only; the per-day scalars in
// `stats` are never pruned, so a short window still leaves the heat map intact.
// The floor exists because a window shorter than a month cannot explain the
// heat map cells the user can already click; the ceiling is there because an
// unbounded retention setting is not a setting.
const MIN_TIMELINE_RETENTION_DAYS = 30;
const MAX_TIMELINE_RETENTION_DAYS = 3650;
const DEFAULT_SETTINGS = Object.freeze({
  pomodoroMinutes: DEFAULT_FOCUS_MINUTES,
  lastChosenFocusMinutes: null,
  breakMinutes: 5,
  softReminderEvery: 15,
  hydrationEvery: 45,
  soundEnabled: true,
  dnd: false,
  nudgeCharacter: 'spider',
  focusMaxLevel: 2,
  restMaxLevel: 2,
  nudgeWhitelist: DEFAULT_WHITELIST,
  petEnabled: true,
  petPosition: null,
  workStartHour: 10,
  workEndHour: 21,
  workEndReminder: true,
  adhocTtlMode: 'midnight',
  adhocTtlHours: 12,
  motionMode: 'balanced',
  stimulationMode: 'balanced',
  petActivityMode: 'balanced',
  energyCheckInHalfLifeMinutes: 180,
  strategyGuidanceEnabled: true,
  dailyReviewEnabled: true,
  quickPanelEnabled: true,
  quickPanelShortcut: 'Alt+Shift+Space',
  routineRemindersEnabled: true,
  energyCurveEnabled: true,
  timelineRetentionDays: 400,
  autoCheckUpdates: true,
  aiBreakdownEnabled: false,
  // Both default to false on purpose: clarification sends what the user typed to
  // an external model, and memory sends their history. Defaulting either to true
  // would make that decision on the user's behalf during an upgrade.
  aiClarifyEnabled: false,
  aiMemoryEnabled: false,
  // A captured impulse is private by default. This opt-in allows sending only
  // its bounded text to the configured model for a short-lived energy signal.
  aiImpulseEnergyEnabled: false,
  aiCaptureTriageEnabled: false,
  aiPetMealsEnabled: false,
  // The companion mirrors the front app category and audible music player locally.
  // Reading what is on the desktop is the person's decision, so it starts off.
  activityMirrorEnabled: false,
  aiModel: 'qwen3.8-max',
  aiBaseUrl: null
});

function normalizeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const workStartHour = numberInRange(source.workStartHour, DEFAULT_SETTINGS.workStartHour, 0, 22, true);
  const workEndHour = numberInRange(source.workEndHour, DEFAULT_SETTINGS.workEndHour, workStartHour + 1, 24, true);
  const whitelist = Array.isArray(source.nudgeWhitelist)
    ? source.nudgeWhitelist
      .filter(value => typeof value === 'string')
      .map(value => value.trim().slice(0, MAX_NUDGE_WHITELIST_ENTRY_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_NUDGE_WHITELIST_ENTRIES)
    : [...DEFAULT_WHITELIST];
  const position = isPlainObject(source.petPosition)
    && Number.isFinite(source.petPosition.x)
    && Number.isFinite(source.petPosition.y)
    ? {
        x: numberInRange(source.petPosition.x, 0, -MAX_NATIVE_COORDINATE, MAX_NATIVE_COORDINATE, true),
        y: numberInRange(source.petPosition.y, 0, -MAX_NATIVE_COORDINATE, MAX_NATIVE_COORDINATE, true)
      }
    : null;
  const legacyProviderNeedsReview = source.aiProvider === 'none'
    || source.aiProvider === 'local'
    || (source.aiProvider === 'api'
      && !Object.prototype.hasOwnProperty.call(source, 'aiModel'));
  const legacyAiBaseUrl = isHttpsEndpoint(source.aiEndpoint, MAX_AI_URL_INPUT_LENGTH)
    ? baseUrlFromEndpoint(source.aiEndpoint)
    : DEFAULT_SETTINGS.aiBaseUrl;
  // WHATWG canonicalization can expand Unicode or control characters into a
  // much longer ASCII URL. Never emit a migrated value that today's own field
  // validator would reject on the next startup.
  const safeLegacyAiBaseUrl = isHttpsEndpoint(legacyAiBaseUrl)
    ? legacyAiBaseUrl
    : DEFAULT_SETTINGS.aiBaseUrl;

  return {
    pomodoroMinutes: numberInRange(
      source.pomodoroMinutes,
      DEFAULT_SETTINGS.pomodoroMinutes,
      MIN_FOCUS_MINUTES,
      MAX_FOCUS_MINUTES,
      true
    ),
    // Today may remember the user's most recent explicit choice. It is a
    // convenience default, never a second persisted limit.
    lastChosenFocusMinutes: optionalInteger(source.lastChosenFocusMinutes, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES),
    breakMinutes: numberInRange(source.breakMinutes, DEFAULT_SETTINGS.breakMinutes, 1, 60, true),
    softReminderEvery: numberInRange(source.softReminderEvery, DEFAULT_SETTINGS.softReminderEvery, 5, 180, true),
    hydrationEvery: numberInRange(source.hydrationEvery, DEFAULT_SETTINGS.hydrationEvery, 15, 240, true),
    soundEnabled: booleanOr(source.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    dnd: booleanOr(source.dnd, DEFAULT_SETTINGS.dnd),
    nudgeCharacter: ['spider', 'cat', 'robot'].includes(source.nudgeCharacter)
      ? source.nudgeCharacter
      : DEFAULT_SETTINGS.nudgeCharacter,
    focusMaxLevel: numberInRange(source.focusMaxLevel, DEFAULT_SETTINGS.focusMaxLevel, 1, 4, true),
    restMaxLevel: numberInRange(source.restMaxLevel, DEFAULT_SETTINGS.restMaxLevel, 1, 4, true),
    nudgeWhitelist: whitelist,
    petEnabled: booleanOr(source.petEnabled, DEFAULT_SETTINGS.petEnabled),
    petPosition: position,
    workStartHour,
    workEndHour,
    workEndReminder: booleanOr(source.workEndReminder, DEFAULT_SETTINGS.workEndReminder),
    adhocTtlMode: source.adhocTtlMode === 'hours' ? 'hours' : 'midnight',
    adhocTtlHours: numberInRange(source.adhocTtlHours, DEFAULT_SETTINGS.adhocTtlHours, 1, 24 * 14, true),
    motionMode: ['reduced', 'balanced', 'full'].includes(source.motionMode)
      ? source.motionMode : DEFAULT_SETTINGS.motionMode,
    stimulationMode: ['low', 'balanced', 'high'].includes(source.stimulationMode)
      ? source.stimulationMode : DEFAULT_SETTINGS.stimulationMode,
    petActivityMode: ['off', 'quiet', 'balanced', 'lively', 'chaos'].includes(source.petActivityMode)
      ? source.petActivityMode : DEFAULT_SETTINGS.petActivityMode,
    energyCheckInHalfLifeMinutes: numberInRange(
      source.energyCheckInHalfLifeMinutes,
      DEFAULT_SETTINGS.energyCheckInHalfLifeMinutes,
      30,
      12 * 60,
      true
    ),
    strategyGuidanceEnabled: booleanOr(source.strategyGuidanceEnabled, DEFAULT_SETTINGS.strategyGuidanceEnabled),
    dailyReviewEnabled: booleanOr(source.dailyReviewEnabled, DEFAULT_SETTINGS.dailyReviewEnabled),
    quickPanelEnabled: booleanOr(source.quickPanelEnabled, DEFAULT_SETTINGS.quickPanelEnabled),
    quickPanelShortcut: isGlobalShortcut(source.quickPanelShortcut)
      ? source.quickPanelShortcut.trim()
      : DEFAULT_SETTINGS.quickPanelShortcut,
    routineRemindersEnabled: booleanOr(source.routineRemindersEnabled, DEFAULT_SETTINGS.routineRemindersEnabled),
    energyCurveEnabled: booleanOr(source.energyCurveEnabled, DEFAULT_SETTINGS.energyCurveEnabled),
    autoCheckUpdates: booleanOr(source.autoCheckUpdates, DEFAULT_SETTINGS.autoCheckUpdates),
    timelineRetentionDays: numberInRange(
      source.timelineRetentionDays,
      DEFAULT_SETTINGS.timelineRetentionDays,
      MIN_TIMELINE_RETENTION_DAYS,
      MAX_TIMELINE_RETENTION_DAYS,
      true
    ),
    // The earliest schema-8 writer did not persist a model and used provider as
    // part of its network policy. Today's single provider is public-only and has
    // a persisted model; carrying that old shape forward as enabled could select
    // a different billed model or reinterpret a blocked endpoint as a public
    // request. Preserve its configuration, but require an explicit re-enable.
    aiBreakdownEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiBreakdownEnabled, DEFAULT_SETTINGS.aiBreakdownEnabled),
    // These two ride on the same re-enable requirement: a store whose provider
    // shape needs review must not come back with any outbound path already on.
    aiClarifyEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiClarifyEnabled, DEFAULT_SETTINGS.aiClarifyEnabled),
    aiMemoryEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiMemoryEnabled, DEFAULT_SETTINGS.aiMemoryEnabled),
    aiImpulseEnergyEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiImpulseEnergyEnabled, DEFAULT_SETTINGS.aiImpulseEnergyEnabled),
    aiCaptureTriageEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiCaptureTriageEnabled, DEFAULT_SETTINGS.aiCaptureTriageEnabled),
    aiPetMealsEnabled: legacyProviderNeedsReview
      ? false
      : booleanOr(source.aiPetMealsEnabled, DEFAULT_SETTINGS.aiPetMealsEnabled),
    activityMirrorEnabled: booleanOr(source.activityMirrorEnabled, DEFAULT_SETTINGS.activityMirrorEnabled),
    aiModel: AI_MODEL_PATTERN.test(String(source.aiModel || '').trim())
      ? String(source.aiModel).trim() : DEFAULT_SETTINGS.aiModel,
    // Only an explicit https base URL is persisted. The credential itself never
    // enters business state: it lives in an OS-encrypted file read by the main
    // process alone. Settings written before base URLs existed held a full
    // endpoint, so the request path is stripped back off rather than dropped.
    // A value that is already a base URL is left byte-identical: normalization
    // runs on every startup, and rewriting a stored value here would trip the
    // same-schema migration guard on a file that is perfectly readable.
    aiBaseUrl: isHttpsEndpoint(source.aiBaseUrl)
      ? source.aiBaseUrl.trim()
      : safeLegacyAiBaseUrl
  };
}

function isGlobalShortcut(value) {
  if (typeof value !== 'string') return false;
  const accelerator = value.trim();
  if (!accelerator || accelerator.length > MAX_SHORTCUT_LENGTH) return false;
  const parts = accelerator.split('+');
  // At least one modifier and exactly one key, so `parts.length >= 2`.
  if (parts.length < 2 || parts.length > 5) return false;
  const key = parts.pop();
  if (!SHORTCUT_KEY_PATTERN.test(key)) return false;
  const seen = new Set();
  for (const modifier of parts) {
    if (!SHORTCUT_MODIFIERS.includes(modifier) || seen.has(modifier)) return false;
    seen.add(modifier);
  }
  return true;
}

function isHttpsEndpoint(value, maxLength = MAX_AI_CANONICAL_URL_LENGTH) {
  if (typeof value !== 'string') return false;
  const endpoint = value.trim();
  if (!endpoint || endpoint.length > maxLength || /\s/.test(endpoint)) return false;
  try {
    const parsed = new URL(endpoint);
    // Credentials belong in encrypted provider storage, never in a persisted
    // endpoint. Fragments are not sent over HTTP and would make two visually
    // different settings resolve to the same request target.
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.hash;
  } catch (_) {
    return false;
  }
}

module.exports = {
  AI_MODEL_PATTERN,
  MAX_AI_URL_INPUT_LENGTH,
  MAX_AI_CANONICAL_URL_LENGTH,
  MAX_SHORTCUT_LENGTH,
  MIN_TIMELINE_RETENTION_DAYS,
  MAX_TIMELINE_RETENTION_DAYS,
  MAX_NUDGE_WHITELIST_ENTRIES,
  MAX_NUDGE_WHITELIST_ENTRY_LENGTH,
  DEFAULT_WHITELIST,
  DEFAULT_SETTINGS,
  baseUrlFromEndpoint,
  isGlobalShortcut,
  isHttpsEndpoint,
  normalizeSettings
};
