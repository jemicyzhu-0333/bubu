'use strict';

const { resolveSensoryPolicy } = require('../../../core/sensory-policy.mjs');
const { CHARACTERS, DEFAULT_CHARACTER_ID } = require('../../../content/nudge-characters');
const { DEFAULT_WHITELIST, MAX_NUDGE_WHITELIST_ENTRIES } = require('../../preferences');

// Explicit Windows identity aliases, not a claim about installed applications.
// Existing substring rules remain conservative; aliases cover differing process
// names only when the corresponding whitelist entry was actually selected.
const WINDOWS_FOREGROUND_ALIASES = Object.freeze([
  ['tencent meeting', '腾讯会议', 'wemeetapp', 'wemeet', 'tencentmeeting'],
  ['钉钉会议', 'dingtalk'],
  ['wechat', 'weixin'],
  ['飞书', 'lark', 'feishu'],
  ['obs', 'obs32', 'obs64'],
  ['quicktime', 'quicktimeplayer'],
  ['camtasia', 'camrecorder'],
  ['powerpoint', 'powerpnt'],
  ['teams', 'microsoft teams', 'ms-teams']
].map(group => Object.freeze(group)));

// A deferral this important survives a routine clear. Only an explicit "drop
// everything" (do-not-disturb, disposal) may cancel it, so the end-of-work
// reminder cannot be silently lost by an unrelated dismissal.
const PROTECTED_DEFERRED_PRIORITY = 100;
const DEFERRED_CLEAR_POLICIES = Object.freeze(['none', 'routine', 'all']);

const MIN_LEVEL = 1;
const MAX_LEVEL = 4;
const ROUTINE_DEFAULT_LEVEL = 2;
const ROUTINE_MAX_LEVEL = 3;
const REMINDER_TYPES = Object.freeze(['focus', 'rest', 'routine']);
const MAX_MESSAGE_LENGTH = 240;
const MAX_ACTIONS = 3;
const MAX_ACTION_LABEL_LENGTH = 30;
const MIN_DEFER_MINUTES = 1;
const MAX_DEFER_MINUTES = 60;
const DEFAULT_THEME_PRIMARY = '#f7768e';
const THEME_PRIMARY_PATTERN = /^#[0-9a-f]{6}$/i;

// Escalation is slow on purpose: a notification, then a quiet corner character,
// then the characters gathering, and only last a card that covers the work area.
const ESCALATION_STEPS = Object.freeze([
  Object.freeze({ level: 2, delayMs: 60 * 1000 }),
  Object.freeze({ level: 3, delayMs: 150 * 1000 }),
  Object.freeze({ level: 4, delayMs: 210 * 1000 })
]);

// Closing or clicking a reminder is an answer, not a chosen action, so it is
// accepted even though no button carries that id.
const PASSIVE_DISMISS_ACTIONS = Object.freeze(['dismiss', 'acknowledge']);

function clampLevel(value) {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Number(value) || MIN_LEVEL));
}

function clampLevelForType(type, value) {
  if (type !== 'routine') return clampLevel(value);
  const numeric = Number(value);
  const requested = value === null || value === '' || Number.isNaN(numeric)
    ? ROUTINE_DEFAULT_LEVEL
    : numeric;
  return Math.max(MIN_LEVEL, Math.min(ROUTINE_MAX_LEVEL, requested));
}

function escalationStepsFor(maxLevel) {
  const ceiling = clampLevel(maxLevel);
  return ESCALATION_STEPS.filter(step => step.level <= ceiling);
}

function prefersCompanionReminder(request) {
  return request.priority < PROTECTED_DEFERRED_PRIORITY
    && (request.type === 'routine' || request.context?.kind === 'focus-check');
}

function resolveDeferredPolicy(requested) {
  return DEFERRED_CLEAR_POLICIES.includes(requested) ? requested : 'routine';
}

function shouldCancelDeferral(priority, policy) {
  if (policy === 'all') return true;
  return policy === 'routine' && Number(priority) < PROTECTED_DEFERRED_PRIORITY;
}

function deferralDelayMs(minutes) {
  return Number(minutes) * 60 * 1000;
}

function deferralPriority(type, priority) {
  return type === 'routine'
    ? Math.max(PROTECTED_DEFERRED_PRIORITY, Number(priority) || 0)
    : Number(priority) || 0;
}

function sanitizeWhitelist(list) {
  return Array.isArray(list)
    ? list.filter(entry => typeof entry === 'string').slice(0, MAX_NUDGE_WHITELIST_ENTRIES)
    : [];
}

function matchesForegroundWhitelist(appName, whitelist, platform) {
  if (typeof appName !== 'string' || !appName) return false;
  const normalize = value => platform === 'win32' ? value.trim().toLowerCase().replace(/\.exe$/, '') : value.toLowerCase();
  const name = normalize(appName);
  return sanitizeWhitelist(whitelist).some(entry => {
    const selected = normalize(entry);
    if (name.includes(selected)) return true;
    return platform === 'win32' && WINDOWS_FOREGROUND_ALIASES.some(group => group.includes(name) && group.includes(selected));
  });
}

function defaultActions(type) {
  if (type === 'routine') {
    return [
      { id: 'complete-routine', label: '已完成', primary: true },
      { id: 'defer-15', label: '稍后（+15 分钟）', deferMinutes: 15 },
      { id: 'skip-routine-today', label: '今天跳过' }
    ];
  }
  if (type === 'focus') {
    return [
      { id: 'accept-focus', label: '开始一小步', primary: true },
      { id: 'defer-5', label: '5 分钟后再提醒', deferMinutes: 5 }
    ];
  }
  return [
    { id: 'accept-rest', label: '休息一下', primary: true },
    { id: 'defer-2', label: '2 分钟后再提醒', deferMinutes: 2 }
  ];
}

/**
 * Every reminder must offer at least one way out, so an empty or unusable action
 * list falls back to the shipped pair rather than showing a dead reminder. The
 * first action is the accepting one by convention, which is why it inherits the
 * accept id when a caller forgets to name it.
 */
function normalizeActions(type, actions) {
  const source = Array.isArray(actions) && actions.length ? actions : defaultActions(type);
  return source.slice(0, MAX_ACTIONS).map((action, index) => ({
    id: String(action && action.id || (index === 0 ? `accept-${type}` : 'dismiss')),
    label: String(action && action.label || '我知道了').slice(0, MAX_ACTION_LABEL_LENGTH),
    primary: Boolean(action && action.primary),
    deferMinutes: Number.isFinite(Number(action && action.deferMinutes))
      ? Math.max(MIN_DEFER_MINUTES, Math.min(MAX_DEFER_MINUTES, Number(action.deferMinutes)))
      : undefined
  }));
}

function cloneActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(action => ({ ...action }));
}

const MOTION_MODES = Object.freeze(['reduced', 'balanced', 'full']);
const STIMULATION_MODES = Object.freeze(['low', 'balanced', 'high']);

function normalizeMode(modes, value) {
  return modes.includes(value) ? value : 'balanced';
}

function normalizeReminderRequest(opts) {
  const requestedType = opts && opts.type;
  const type = REMINDER_TYPES.includes(requestedType) ? requestedType : 'rest';
  return {
    type,
    message: opts && opts.message ? String(opts.message).slice(0, MAX_MESSAGE_LENGTH) : '',
    maxLevel: clampLevelForType(type, opts && opts.maxLevel),
    character: opts && CHARACTERS[opts.character] ? opts.character : DEFAULT_CHARACTER_ID,
    whitelist: sanitizeWhitelist(opts && opts.whitelist),
    themePrimary: opts && THEME_PRIMARY_PATTERN.test(opts.themePrimary || '')
      ? opts.themePrimary
      : DEFAULT_THEME_PRIMARY,
    motionMode: normalizeMode(MOTION_MODES, opts && opts.motionMode),
    stimulationMode: normalizeMode(STIMULATION_MODES, opts && opts.stimulationMode),
    soundEnabled: !(opts && opts.soundEnabled === false),
    priority: Number.isFinite(Number(opts && opts.priority)) ? Number(opts.priority) : 0,
    actions: normalizeActions(type, opts && opts.actions),
    context: opts && opts.context && typeof opts.context === 'object' ? { ...opts.context } : {}
  };
}

// The echo a deferral replays later. It is a copy so a live reminder cannot be
// mutated through the snapshot handed to the action handler.
function cloneReminderRequest(source) {
  return {
    type: source.type,
    message: source.message,
    maxLevel: source.maxLevel,
    character: source.character,
    whitelist: [...source.whitelist],
    themePrimary: source.themePrimary,
    motionMode: source.motionMode,
    stimulationMode: source.stimulationMode,
    soundEnabled: source.soundEnabled,
    priority: source.priority,
    actions: cloneActions(source.actions),
    context: { ...source.context }
  };
}

// A reminder raised while a whitelisted app is in front stays at the notification
// level, and its title says so: the same offer, marked optional.
function reminderTitle(type, { optional = false } = {}) {
  if (type === 'rest') return optional ? '💗 可选休息' : '💗 可以休息一下';
  if (type === 'routine') return optional ? '⏰ 可选日常提醒' : '⏰ 日常提醒';
  return optional ? '⚡ 可选开始' : '⚡ 准备好时，开始一步';
}

function chooseLine(lines, roll) {
  if (!Array.isArray(lines) || !lines.length) return '';
  const safeRoll = Number.isFinite(roll) && roll >= 0 && roll < 1 ? roll : 0;
  return lines[Math.floor(safeRoll * lines.length)];
}

function resolveNudgeSensory({ motionMode, stimulationMode, systemReducedMotion } = {}) {
  const policy = resolveSensoryPolicy({
    motionMode,
    stimulationMode,
    systemReducedMotion: systemReducedMotion === true
  });
  return Object.freeze({
    motionMode: policy.motionMode,
    stimulationMode: policy.stimulationMode,
    lowStimulation: policy.lowStimulation,
    reduceMotion: policy.reduceMotion,
    calm: policy.calmVisuals
  });
}

function shouldReduceNudgeMotion(motionMode, systemReducedMotion) {
  return resolveNudgeSensory({ motionMode, systemReducedMotion }).reduceMotion;
}

// A live reminder keeps the mode it was raised with unless the new profile names
// a mode this build understands, so a partial or malformed settings push cannot
// silently reset motion or stimulation.
function mergeSensoryProfile(current, profile = {}) {
  return {
    motionMode: MOTION_MODES.includes(profile.motionMode) ? profile.motionMode : current.motionMode,
    stimulationMode: STIMULATION_MODES.includes(profile.stimulationMode)
      ? profile.stimulationMode
      : current.stimulationMode
  };
}

/**
 * Decide what a dismissal means before anything is torn down.
 *
 * An id that no button offered is refused rather than guessed at, because the
 * only way it can reach here is a stale renderer or a forged call — and either
 * way, acting on it would credit the user with a choice they never made.
 */
function planDismissal(state, actionId) {
  const snapshot = {
    actionId: String(actionId || 'dismiss'),
    instanceId: state.instanceId,
    type: state.type,
    context: { ...state.context },
    actions: cloneActions(state.actions),
    options: cloneReminderRequest(state)
  };
  const chosen = snapshot.actions.find(action => action.id === snapshot.actionId) || null;
  if (!chosen && !PASSIVE_DISMISS_ACTIONS.includes(snapshot.actionId)) {
    return { ok: false, reason: 'action-not-offered' };
  }
  return { ok: true, snapshot, chosen };
}

module.exports = {
  DEFAULT_WHITELIST,
  PROTECTED_DEFERRED_PRIORITY,
  DEFERRED_CLEAR_POLICIES,
  REMINDER_TYPES,
  ESCALATION_STEPS,
  MAX_LEVEL,
  ROUTINE_MAX_LEVEL,
  clampLevel,
  clampLevelForType,
  escalationStepsFor,
  prefersCompanionReminder,
  resolveDeferredPolicy,
  shouldCancelDeferral,
  deferralDelayMs,
  deferralPriority,
  sanitizeWhitelist,
  matchesForegroundWhitelist,
  defaultActions,
  normalizeActions,
  normalizeReminderRequest,
  cloneReminderRequest,
  reminderTitle,
  chooseLine,
  resolveNudgeSensory,
  shouldReduceNudgeMotion,
  mergeSensoryProfile,
  planDismissal
};
