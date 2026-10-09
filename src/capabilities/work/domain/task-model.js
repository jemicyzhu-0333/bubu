'use strict';

const {
  isPlainObject,
  numberInRange,
  nonNegativeInteger,
  optionalInteger,
  booleanOr,
  trimmedString,
  validDayKey,
  validIsoOrNull,
  timestampOrNull,
  uniqueNormalizedId
} = require('../../../core/field-normalizers');
const { localDayKey } = require('../../../core/calendar');

// Schema 8 stops using `category: daily | midterm | adhoc` as the canonical
// fact. That single field used to decide recurrence, deadline, TTL, reward
// cycle, recommendation weight and UI grouping at once, so changing one concept
// silently cleared another. The orthogonal attributes below are independent and
// all optional; only `title` is required to capture a task.

const ENERGY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const ESTIMATE_SOURCES = Object.freeze(['user', 'rule', 'ai']);
const RECURRENCE_FREQUENCIES = Object.freeze(['daily', 'weekly', 'monthly']);
const RECURRENCE_STRATEGIES = Object.freeze(['fixed', 'after-completion']);
const SERIES_STATES = Object.freeze(['active', 'paused', 'ended']);
const EDIT_SCOPES = Object.freeze(['current', 'current-and-future']);

// 输入边界只有一份定义,面板与主进程都从 contract 读:两边各写一份的表现不是
// 报错,而是"面板说还能加,主进程把这一步吃掉了"。
const { LIMITS } = require('../contract/task-limits.mjs');

function defaultSuggestedMinutes(energy) {
  return energy === 'high' ? 45 : energy === 'low' ? 10 : 25;
}

function normalizeEnergy(value) {
  return ENERGY_LEVELS.includes(value) ? value : 'medium';
}

/**
 * Normalize an optional tag list: order preserved, duplicates removed, each tag
 * bounded. Tags exist for personal organization; the cap is an input boundary,
 * not an invitation for the UI to encourage filling all eight.
 */
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const tags = [];
  for (const candidate of raw) {
    const tag = trimmedString(candidate, null, LIMITS.TAG);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= LIMITS.TAGS) break;
  }
  return tags;
}

function normalizeEstimateMinutes(raw) {
  return optionalInteger(raw, LIMITS.ESTIMATE_MINUTES_MIN, LIMITS.ESTIMATE_MINUTES_MAX);
}

function requireFallbackTimestamp(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError(`${name} must be a finite non-negative timestamp`);
  }
  return value;
}

function normalizeStep(raw, index = 0, usedIds = new Set()) {
  const source = isPlainObject(raw) ? raw : {};
  // Legacy steps were identified only by their array index. Persist that
  // index as the first stable ID so existing reward-ledger identities remain
  // compatible, then disambiguate malformed duplicate IDs deterministically.
  const id = uniqueNormalizedId(source.id, String(index), usedIds);
  const done = booleanOr(source.done, false);
  return {
    id,
    title: trimmedString(source.title, `未命名步骤 ${index + 1}`, LIMITS.STEP_TITLE),
    done,
    completedAt: done ? timestampOrNull(source.completedAt) : null,
    completionCycle: nonNegativeInteger(source.completionCycle, 0, 1000000)
  };
}

/**
 * Normalize a task into the closed schema-8 shape.
 *
 * Unlike the schema-7 normalizer this does not spread unknown source fields.
 * That spread is exactly why `category` could survive a model split, and a
 * closed shape is what lets strict canonical validation prove that no business
 * code is still reading the retired field.
 */
function normalizeTask(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const index = nonNegativeInteger(options.index, 0, 1000000);
  const createdAt = timestampOrNull(source.createdAt)
    ?? requireFallbackTimestamp(options.now, 'options.now');
  const taskIds = options.usedIds instanceof Set ? options.usedIds : new Set();
  const id = uniqueNormalizedId(source.id, `recovered-${Math.round(createdAt)}-${index}`, taskIds);

  const energy = normalizeEnergy(source.energy);
  const stepIds = new Set();
  const steps = Array.isArray(source.steps)
    ? source.steps.map((step, stepIndex) => normalizeStep(step, stepIndex, stepIds))
    : [];

  // A recurrence occurrence is only meaningful with its immutable date. If a
  // corrupted record lost the date we degrade it to a plain one-off task rather
  // than invent a period from the current wall clock.
  const seriesIdCandidate = trimmedString(source.seriesId, null, 200);
  const occurrenceDate = seriesIdCandidate ? validDayKey(source.occurrenceDate) : null;
  const seriesId = occurrenceDate ? seriesIdCandidate : null;

  const done = booleanOr(source.done, false);
  const expiresAt = validIsoOrNull(source.expiresAt);
  const estimateMinutes = normalizeEstimateMinutes(source.estimateMinutes);

  return {
    // identity
    id,
    createdAt,
    updatedAt: timestampOrNull(source.updatedAt) ?? createdAt,
    // content
    title: trimmedString(source.title, '未命名任务', LIMITS.PERSISTED_TITLE),
    description: trimmedString(source.description, null, LIMITS.DESCRIPTION),
    steps,
    // lifecycle — `done` is an irreversible domain terminal state in 0.1.2
    done,
    completedAt: done ? timestampOrNull(source.completedAt) : null,
    skippedAt: seriesId && !done ? timestampOrNull(source.skippedAt) : null,
    expired: Boolean(expiresAt) && booleanOr(source.expired, false),
    archivedAt: timestampOrNull(source.archivedAt),
    archiveReason: trimmedString(source.archiveReason, null, LIMITS.ARCHIVE_REASON),
    // planning — these four never substitute for each other
    plannedFor: validDayKey(source.plannedFor),
    scheduledFor: validIsoOrNull(source.scheduledFor),
    scheduleNotifiedAt: timestampOrNull(source.scheduleNotifiedAt),
    deadline: validIsoOrNull(source.deadline),
    expiresAt,
    // recurrence
    seriesId,
    occurrenceDate,
    // organization
    tags: normalizeTags(source.tags),
    // effort
    energy,
    energyAuto: booleanOr(source.energyAuto, !ENERGY_LEVELS.includes(source.energy)),
    estimateMinutes,
    estimateSource: estimateMinutes !== null && ESTIMATE_SOURCES.includes(source.estimateSource)
      ? source.estimateSource
      : 'rule',
    suggestedMin: nonNegativeInteger(source.suggestedMin, defaultSuggestedMinutes(energy), LIMITS.ESTIMATE_MINUTES_MAX),
    // execution
    blocker: trimmedString(source.blocker, null, LIMITS.BLOCKER),
    nextAction: trimmedString(source.nextAction, null, LIMITS.NEXT_ACTION),
    lastCheckpoint: trimmedString(source.lastCheckpoint, null, LIMITS.NEXT_ACTION),
    lastCheckpointAt: timestampOrNull(source.lastCheckpointAt),
    activationFriction: optionalInteger(source.activationFriction, 0, 100),
    focusedMs: nonNegativeInteger(source.focusedMs, 0),
    focusSessions: nonNegativeInteger(source.focusSessions, 0),
    overdueCount: nonNegativeInteger(source.overdueCount, 0, 1000000),
    completionCycle: nonNegativeInteger(source.completionCycle, 0, 1000000),
    selectionCount: nonNegativeInteger(source.selectionCount, 0, 1000000),
    avoidanceCount: nonNegativeInteger(source.avoidanceCount, 0, 1000000),
    lastSelectedAt: timestampOrNull(source.lastSelectedAt),
    lastStartedAt: timestampOrNull(source.lastStartedAt),
    lastAvoidedAt: timestampOrNull(source.lastAvoidedAt)
  };
}

function normalizeWeekdays(raw) {
  if (!Array.isArray(raw)) return null;
  const days = [...new Set(
    raw
      .map(value => optionalInteger(value, 1, 7))
      .filter(value => value !== null)
  )].sort((left, right) => left - right);
  return days.length ? days : null;
}

/**
 * Validate a recurrence rule. 0.1.2 deliberately accepts a small, fully
 * validated grammar instead of arbitrary RRULE text: every field here has a
 * matching advance implementation and a test.
 *
 * `anchorDate` is never left empty: monthly clamping and weekly interval
 * alignment are both defined relative to it, so a missing anchor would make the
 * advance result depend on whatever clock the app happened to boot with.
 */
function normalizeRecurrenceRule(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const frequency = RECURRENCE_FREQUENCIES.includes(source.frequency) ? source.frequency : 'daily';
  const anchorDate = validDayKey(source.anchorDate)
    || validDayKey(options.anchorDate)
    || validDayKey(options.fallbackAnchorDate)
    || localDayKey(requireFallbackTimestamp(options.fallbackTimestamp, 'options.fallbackTimestamp'));
  return {
    frequency,
    interval: numberInRange(source.interval, 1, 1, LIMITS.RECURRENCE_INTERVAL_MAX, true),
    // Weekday sets only mean something for a weekly rule. Keeping a stale set
    // on a daily/monthly rule would make the advance result depend on a field
    // the user cannot see.
    weekdays: frequency === 'weekly' ? normalizeWeekdays(source.weekdays) : null,
    strategy: RECURRENCE_STRATEGIES.includes(source.strategy) ? source.strategy : 'fixed',
    anchorDate
  };
}

function normalizeSeriesTemplate(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const energy = normalizeEnergy(source.energy);
  const stepTitles = Array.isArray(source.stepTitles)
    ? source.stepTitles
      .map(title => trimmedString(title, null, LIMITS.STEP_TITLE))
      .filter(Boolean)
    : [];
  return {
    title: trimmedString(source.title, '未命名任务', LIMITS.PERSISTED_TITLE),
    description: trimmedString(source.description, null, LIMITS.DESCRIPTION),
    stepTitles,
    tags: normalizeTags(source.tags),
    energy,
    energyAuto: booleanOr(source.energyAuto, !ENERGY_LEVELS.includes(source.energy)),
    estimateMinutes: normalizeEstimateMinutes(source.estimateMinutes)
  };
}

function normalizeRecurrenceSeries(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const index = nonNegativeInteger(options.index, 0, 1000000);
  const createdAt = timestampOrNull(source.createdAt)
    ?? requireFallbackTimestamp(options.now, 'options.now');
  const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
  const id = uniqueNormalizedId(source.id, `recovered-series-${Math.round(createdAt)}-${index}`, usedIds);
  const state = SERIES_STATES.includes(source.state) ? source.state : 'active';
  return {
    id,
    createdAt,
    updatedAt: timestampOrNull(source.updatedAt) ?? createdAt,
    state,
    endedAt: state === 'ended' ? timestampOrNull(source.endedAt) : null,
    rule: normalizeRecurrenceRule(source.rule, {
      fallbackAnchorDate: validDayKey(source.lastOccurrenceDate) || options.fallbackAnchorDate,
      fallbackTimestamp: createdAt
    }),
    template: normalizeSeriesTemplate(source.template),
    openTaskId: trimmedString(source.openTaskId, null, 200),
    lastOccurrenceDate: validDayKey(source.lastOccurrenceDate),
    missedCount: nonNegativeInteger(source.missedCount, 0, 1000000)
  };
}

/**
 * The invariants a canonical schema-8 store must satisfy. Violations mean the
 * file is corrupted or was written by a build with a different model, so the
 * caller fails closed rather than "repairing" user data by guessing.
 */
function assertTaskModelInvariants(tasks, series) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const seriesList = Array.isArray(series) ? series : [];
  const seriesById = new Map();
  for (const item of seriesList) {
    if (!isPlainObject(item) || typeof item.id !== 'string') continue;
    if (seriesById.has(item.id)) throw new Error(`Duplicate recurrence series id: ${item.id}`);
    seriesById.set(item.id, item);
    if (item.rule && item.rule.weekdays !== null && item.rule.frequency !== 'weekly') {
      throw new Error(`Recurrence series ${item.id} declares weekdays without a weekly frequency`);
    }
  }

  const openBySeries = new Map();
  for (const task of taskList) {
    if (!isPlainObject(task) || !task.seriesId) continue;
    if (!seriesById.has(task.seriesId)) {
      throw new Error(`Task ${task.id} references a missing recurrence series: ${task.seriesId}`);
    }
    if (!task.occurrenceDate) {
      throw new Error(`Task ${task.id} belongs to a recurrence series without an occurrence date`);
    }
    if (task.done || task.skippedAt) continue;
    if (openBySeries.has(task.seriesId)) {
      throw new Error(`Recurrence series ${task.seriesId} has more than one open occurrence`);
    }
    openBySeries.set(task.seriesId, task.id);
  }

  for (const item of seriesById.values()) {
    if (!item.openTaskId) continue;
    if (openBySeries.get(item.id) !== item.openTaskId) {
      throw new Error(`Recurrence series ${item.id} points at a stale open occurrence: ${item.openTaskId}`);
    }
  }
}

module.exports = {
  ENERGY_LEVELS,
  ESTIMATE_SOURCES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_STRATEGIES,
  SERIES_STATES,
  EDIT_SCOPES,
  LIMITS,
  defaultSuggestedMinutes,
  normalizeEnergy,
  normalizeTags,
  normalizeEstimateMinutes,
  normalizeStep,
  normalizeTask,
  normalizeWeekdays,
  normalizeRecurrenceRule,
  normalizeSeriesTemplate,
  normalizeRecurrenceSeries,
  assertTaskModelInvariants
};
