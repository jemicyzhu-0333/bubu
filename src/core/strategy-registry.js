'use strict';

const { PET_ACTIONS } = require('../content/behaviors.mjs');
const { resolveSensoryPolicy } = require('./sensory-policy.mjs');
const { isPlainObject } = require('./field-normalizers');

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PHASES = Object.freeze(['pre-start', 'distraction', 'working-memory', 'time-visibility', 'recovery']);
const MOTION_LEVELS = Object.freeze(['static', 'gentle', 'full']);
const SOURCE_TIERS = Object.freeze(['research', 'clinical-practice', 'community', 'product-hypothesis']);
const BLOCKERS = Object.freeze(['unclear', 'too-big', 'boring', 'anxious', 'low-energy', 'interrupted']);
const ENERGY_BANDS = Object.freeze(['low', 'medium', 'high']);
const ASSERTIVE_TERMS = Object.freeze(['一定', '必然', '治疗', '诊断', '你正在']);
const STRATEGY_KEYS = Object.freeze([
  'id', 'familyId', 'phase', 'text', 'detail', 'actionId', 'staticFallback',
  'motionLevel', 'focusAllowed', 'cooldownMs', 'weight', 'sourceTier', 'triggers'
]);
const TRIGGER_KEYS = Object.freeze(['blockers', 'energyBands', 'minEstimateMinutes', 'hasNextAction']);
const DEFAULT_DAILY_BUDGET = 4;
// 窗口长度对调用方也是硬约束：账本由调用方维护，它若按另一个长度裁剪，两边对“最近”
// 的理解就不一致，而不一致只表现为偶尔重复推荐同一条，看起来像随机。
const MAX_RECENT = 5;

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

function boundedText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function validateEnumList(value, allowed, label) {
  if (!Array.isArray(value) || value.some(item => !allowed.includes(item)) || new Set(value).size !== value.length) {
    throw new TypeError(`${label} must be a unique array of supported values`);
  }
  return Object.freeze([...value]);
}

function validateStrategy(raw) {
  if (!isPlainObject(raw)) throw new TypeError('strategy must be an object');
  exactKeys(raw, STRATEGY_KEYS, 'strategy');
  if (!ID_PATTERN.test(raw.id) || !ID_PATTERN.test(raw.familyId)) throw new TypeError('strategy ids are invalid');
  if (!PHASES.includes(raw.phase)) throw new TypeError(`unsupported strategy phase: ${raw.phase}`);
  if (!PET_ACTIONS[raw.actionId]) throw new TypeError(`unknown strategy actionId: ${raw.actionId}`);
  if (!MOTION_LEVELS.includes(raw.motionLevel)) throw new TypeError('strategy motionLevel is invalid');
  if (!SOURCE_TIERS.includes(raw.sourceTier)) throw new TypeError('strategy sourceTier is invalid');
  if (typeof raw.focusAllowed !== 'boolean') throw new TypeError('strategy focusAllowed must be boolean');
  if (!Number.isSafeInteger(raw.cooldownMs) || raw.cooldownMs < 60_000 || raw.cooldownMs > 7 * 86400000) {
    throw new RangeError('strategy cooldownMs is outside the supported range');
  }
  if (!Number.isSafeInteger(raw.weight) || raw.weight < 1 || raw.weight > 10000) {
    throw new RangeError('strategy weight is outside the supported range');
  }
  const text = boundedText(raw.text, 'strategy text', 200);
  const detail = boundedText(raw.detail, 'strategy detail', 500);
  const staticFallback = boundedText(raw.staticFallback, 'strategy staticFallback', 200);
  if (ASSERTIVE_TERMS.some(term => `${text}${detail}${staticFallback}`.includes(term))) {
    throw new TypeError(`strategy ${raw.id} uses prohibited deterministic or diagnostic wording`);
  }
  if (!isPlainObject(raw.triggers)) throw new TypeError('strategy triggers must be an object');
  exactKeys(raw.triggers, TRIGGER_KEYS, 'strategy triggers');
  if (!Number.isSafeInteger(raw.triggers.minEstimateMinutes)
      || raw.triggers.minEstimateMinutes < 0 || raw.triggers.minEstimateMinutes > 1440) {
    throw new RangeError('strategy minEstimateMinutes is invalid');
  }
  if (typeof raw.triggers.hasNextAction !== 'boolean') throw new TypeError('strategy hasNextAction must be boolean');
  const triggers = Object.freeze({
    blockers: validateEnumList(raw.triggers.blockers, BLOCKERS, 'strategy blockers'),
    energyBands: validateEnumList(raw.triggers.energyBands, ENERGY_BANDS, 'strategy energyBands'),
    minEstimateMinutes: raw.triggers.minEstimateMinutes,
    hasNextAction: raw.triggers.hasNextAction
  });
  return Object.freeze({ ...raw, text, detail, staticFallback, triggers });
}

function validateStrategyManifest(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) throw new TypeError('strategy manifest must contain 1–200 entries');
  const seen = new Set();
  return Object.freeze(raw.map(item => {
    const strategy = validateStrategy(item);
    if (seen.has(strategy.id)) throw new TypeError(`duplicate strategy id: ${strategy.id}`);
    seen.add(strategy.id);
    return strategy;
  }));
}

function taskMatches(strategy, task, energyBand) {
  const triggers = strategy.triggers;
  if (triggers.energyBands.length && !triggers.energyBands.includes(energyBand)) return false;
  if (triggers.blockers.length && task && task.blocker && !triggers.blockers.includes(task.blocker)) return false;
  const estimate = Number(task && (task.estimateMinutes || task.suggestedMin)) || 0;
  if (estimate < triggers.minEstimateMinutes) return false;
  if (triggers.hasNextAction && !(task && task.nextAction)) return false;
  return true;
}

function hardGate(strategy, context, action) {
  const policy = resolveSensoryPolicy(context.settings || context.sensory || {});
  if (!context.explicitRequest) {
    if (context.sensitiveForeground) return 'sensitive-foreground';
    if (!policy.allowAutonomousCues) return policy.dnd ? 'dnd' : 'sensory-policy';
  }
  if (context.focusActive && (!strategy.focusAllowed || action.kind !== 'ambient')) return 'focus-gate';
  if (policy.reduceMotion && strategy.motionLevel !== 'static') return 'motion-gate';
  if (policy.lowStimulation && strategy.motionLevel === 'full') return 'stimulation-gate';
  return null;
}

function weightedPick(candidates, rng) {
  const total = candidates.reduce((sum, item) => sum + item.score, 0);
  let needle = Math.max(0, Math.min(0.999999999, Number(rng()) || 0)) * total;
  for (const candidate of candidates) {
    needle -= candidate.score;
    if (needle < 0) return candidate.strategy;
  }
  return candidates[candidates.length - 1].strategy;
}

function selectStrategy(manifest, context = {}, runtime = {}) {
  const registry = validateStrategyManifest(manifest);
  if (!PHASES.includes(context.phase)) return { strategy: null, reason: 'invalid-phase' };
  // 档位曾经被静默改写成 medium。策略是按档位筛的，所以一个认不出来的档位会让用户
  // 拿到一批本不该匹配的建议，而且从外部完全看不出来——和 phase 一样报出来。
  if (!ENERGY_BANDS.includes(context.energyBand)) {
    return { strategy: null, reason: 'invalid-energy-band' };
  }
  if (!context.explicitRequest && Number(runtime.shownToday) >= (runtime.dailyBudget || DEFAULT_DAILY_BUDGET)) {
    return { strategy: null, reason: 'daily-budget' };
  }
  const now = Number.isFinite(Number(context.now)) ? Number(context.now) : Date.now();
  const feedback = isPlainObject(context.feedback) ? context.feedback : {};
  const recent = new Set(Array.isArray(runtime.recentIds) ? runtime.recentIds.slice(-MAX_RECENT) : []);
  const byId = isPlainObject(runtime.lastShownAtById) ? runtime.lastShownAtById : {};
  const byFamily = isPlainObject(runtime.lastShownAtByFamily) ? runtime.lastShownAtByFamily : {};
  const candidates = [];
  let firstGate = null;
  for (const strategy of registry) {
    if (strategy.phase !== context.phase || !taskMatches(strategy, context.task, context.energyBand)) continue;
    const action = PET_ACTIONS[strategy.actionId];
    const gate = hardGate(strategy, context, action);
    if (gate) { firstGate ||= gate; continue; }
    const preference = feedback[strategy.id];
    if (preference && preference.helpful === false) continue;
    const cooldown = preference && preference.helpful === true
      ? Math.max(strategy.cooldownMs, 2 * 60 * 60 * 1000)
      : strategy.cooldownMs;
    if (!context.explicitRequest && now - (Number(byId[strategy.id]) || 0) < cooldown) continue;
    if (!context.explicitRequest && now - (Number(byFamily[strategy.familyId]) || 0) < Math.floor(cooldown / 2)) continue;
    if (recent.has(strategy.id)) continue;
    const familyRejected = Object.entries(feedback).some(([id, item]) => (
      item && item.helpful === false && registry.some(other => other.id === id && other.familyId === strategy.familyId)
    ));
    const score = strategy.weight * (preference && preference.helpful === true ? 1.5 : 1) * (familyRejected ? 0.5 : 1);
    candidates.push({ strategy, score });
  }
  if (!candidates.length) return { strategy: null, reason: firstGate || 'no-match' };
  return { strategy: weightedPick(candidates, typeof context.rng === 'function' ? context.rng : Math.random), reason: null };
}

function recordStrategyShown(feedback, strategyId, now = Date.now()) {
  const source = isPlainObject(feedback) ? feedback : {};
  const previous = isPlainObject(source[strategyId]) ? source[strategyId] : {};
  return {
    ...source,
    [strategyId]: {
      helpful: typeof previous.helpful === 'boolean' ? previous.helpful : null,
      updatedAt: now,
      shownCount: Math.min(1000000, (Number(previous.shownCount) || 0) + 1),
      dismissedCount: Number(previous.dismissedCount) || 0
    }
  };
}

function recordStrategyFeedback(feedback, strategyId, helpful, now = Date.now()) {
  if (typeof helpful !== 'boolean') throw new TypeError('strategy feedback must be boolean');
  const source = isPlainObject(feedback) ? feedback : {};
  const previous = isPlainObject(source[strategyId]) ? source[strategyId] : {};
  return {
    ...source,
    [strategyId]: {
      helpful,
      updatedAt: now,
      shownCount: Number(previous.shownCount) || 0,
      dismissedCount: Math.min(1000000, (Number(previous.dismissedCount) || 0) + (helpful ? 0 : 1))
    }
  };
}

module.exports = {
  PHASES,
  ASSERTIVE_TERMS,
  DEFAULT_DAILY_BUDGET,
  MAX_RECENT,
  validateStrategy,
  validateStrategyManifest,
  selectStrategy,
  recordStrategyShown,
  recordStrategyFeedback
};
