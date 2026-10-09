'use strict';

const { localDayKey, compareDayKeys } = require('./calendar');
const { isPlainObject, nonNegativeInteger, validDayKey } = require('./field-normalizers');
const { taskModel, recurrence } = require('../capabilities/work');
const { normalizeRecurrenceSeries } = taskModel;
const { nextOccurrenceDate, buildOccurrence } = recurrence;
const { sessionDuration } = require('../capabilities/execution');
const { MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES } = sessionDuration;

// schema 7 → 8: split `category: daily | midterm | adhoc` into independent
// attributes. This module is the only place allowed to read `category`; after it
// runs the field no longer exists in canonical state, which is what proves no
// business code still depends on it.

const LEGACY_CATEGORIES = Object.freeze(['daily', 'midterm', 'adhoc']);
const MAX_MIGRATION_NOTICES = 10;

/**
 * The business day the migration attributes to. It must be monotonic against
 * the persisted day markers: a clock or time-zone rollback would otherwise place
 * the first occurrence in an earlier period than a reward that was already paid,
 * and the historical event identity would stop matching.
 */
function migrationBusinessDay(source, now) {
  let day = localDayKey(now);
  for (const marker of [source && source.lastResetDate, source && source.lastCompletedDate]) {
    const candidate = validDayKey(marker);
    if (candidate && compareDayKeys(candidate, day) > 0) day = candidate;
  }
  return day;
}

function uniqueId(base, usedIds) {
  let id = base;
  let suffix = 1;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
}

/**
 * Drop the retired category and give the task the orthogonal planning fields.
 *
 * The four planning fields never substitute for each other, so each legacy
 * category contributes exactly the one it actually owned. A one-off task that
 * had no expiry keeps having none: 0.1.2 must not hand ordinary tasks a fresh
 * midnight deadline they never asked for.
 */
function orthogonalizeTask(legacy, { seriesId = null, occurrenceDate = null } = {}) {
  const category = LEGACY_CATEGORIES.includes(legacy.category) ? legacy.category : null;
  const migrated = {
    ...legacy,
    seriesId,
    occurrenceDate,
    plannedFor: validDayKey(legacy.plannedFor) || occurrenceDate,
    tags: [],
    description: null,
    estimateMinutes: null,
    estimateSource: 'rule',
    skippedAt: null
  };

  if (category === 'daily') {
    migrated.deadline = null;
    migrated.expiresAt = null;
    migrated.expired = false;
  } else if (category === 'midterm') {
    migrated.deadline = legacy.deadline ?? null;
    migrated.expiresAt = null;
    migrated.expired = false;
  } else if (category === 'adhoc') {
    migrated.deadline = null;
    migrated.expiresAt = legacy.expiresAt ?? null;
    migrated.expired = Boolean(legacy.expiresAt) && legacy.expired === true;
  }
  // A task with no recognizable category predates categories entirely. Keep
  // whatever dates it already carried; inventing any would be a silent change.

  // `normalizeTask` is a closed shape, so `category`, `dailyMissedCount`,
  // `lastResetDate` and `reopenedAt` disappear without an explicit delete.
  return migrated;
}

function seriesFromDailyTask(legacy, { occurrenceDate, now, usedSeriesIds }) {
  const steps = Array.isArray(legacy.steps) ? legacy.steps : [];
  return normalizeRecurrenceSeries({
    id: uniqueId(`series-${legacy.id}`, usedSeriesIds),
    createdAt: legacy.createdAt,
    updatedAt: now,
    state: 'active',
    rule: {
      frequency: 'daily',
      interval: 1,
      weekdays: null,
      strategy: 'fixed',
      anchorDate: occurrenceDate
    },
    template: {
      title: legacy.title,
      description: null,
      stepTitles: steps.map(step => (isPlainObject(step) ? step.title : null)).filter(Boolean),
      tags: [],
      energy: legacy.energy,
      energyAuto: legacy.energyAuto,
      estimateMinutes: null
    },
    openTaskId: null,
    lastOccurrenceDate: occurrenceDate,
    missedCount: nonNegativeInteger(legacy.dailyMissedCount, 0, 1000000)
  }, { now, fallbackAnchorDate: occurrenceDate });
}

/**
 * Convert legacy task collections into the schema-8 model.
 *
 * Task and step IDs are never rewritten: the reward ledger keys idempotency off
 * them, and a rewrite would let an already paid completion be paid again.
 */
function migrateTaskModel(source, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const migrationDayKey = validDayKey(options.migrationDayKey) || migrationBusinessDay(source, now);
  const legacyTasks = Array.isArray(source.tasks) ? source.tasks.filter(isPlainObject) : [];
  const legacyArchived = Array.isArray(source.archivedTasks) ? source.archivedTasks.filter(isPlainObject) : [];

  const usedTaskIds = new Set(
    [...legacyTasks, ...legacyArchived]
      .map(task => (typeof task.id === 'string' ? task.id.trim() : ''))
      .filter(Boolean)
  );
  const usedSeriesIds = new Set();
  const tasks = [];
  const recurrenceSeries = [];

  for (const legacy of legacyTasks) {
    if (legacy.category !== 'daily') {
      tasks.push(orthogonalizeTask(legacy));
      continue;
    }

    const series = seriesFromDailyTask(legacy, { occurrenceDate: migrationDayKey, now, usedSeriesIds });
    const occurrence = orthogonalizeTask(legacy, {
      seriesId: series.id,
      occurrenceDate: migrationDayKey
    });
    tasks.push(occurrence);

    if (occurrence.done) {
      // The completed record stays read-only history. Exactly one follow-up
      // occurrence is created so the user is not greeted by a pile of debt.
      const advance = nextOccurrenceDate(series.rule, {
        fromDayKey: migrationDayKey,
        referenceDay: migrationDayKey
      });
      const nextTask = buildOccurrence(series, {
        date: advance.date,
        now,
        taskId: uniqueId(`${occurrence.id}-occ-${advance.date}`, usedTaskIds),
        suggestedMin: legacy.suggestedMin
      });
      tasks.push(nextTask);
      series.openTaskId = nextTask.id;
      series.missedCount += advance.skipped;
    } else {
      series.openTaskId = occurrence.id;
    }
    recurrenceSeries.push(series);
  }

  return {
    // Archived records are a visibility state, not a live plan. They never spawn
    // a series: doing so would resurrect a task the user deliberately put away.
    tasks,
    archivedTasks: legacyArchived.map(legacy => orthogonalizeTask(legacy)),
    recurrenceSeries,
    migrationDayKey
  };
}

/**
 * 0.1.0 persisted focus durations up to 180 minutes while the settings stepper
 * stopped at 90. schema 8 narrows the range to 5–120; an existing value inside
 * the new range is kept exactly, and only an out-of-range one is clamped, with a
 * dismissible notice so the change is visible rather than silent.
 */
function migrateFocusMinutes(rawMinutes, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const minutes = Math.round(Number(rawMinutes));
  if (!Number.isFinite(minutes) || minutes <= MAX_FOCUS_MINUTES) {
    return { minutes: rawMinutes, notice: null };
  }
  return {
    minutes: MAX_FOCUS_MINUTES,
    notice: {
      id: 'migration:focus-minutes-clamped',
      kind: 'focus-minutes-clamped',
      createdAt: now,
      payload: {
        from: Math.max(MIN_FOCUS_MINUTES, minutes),
        to: MAX_FOCUS_MINUTES
      }
    }
  };
}

module.exports = {
  LEGACY_CATEGORIES,
  MAX_MIGRATION_NOTICES,
  migrationBusinessDay,
  orthogonalizeTask,
  migrateTaskModel,
  migrateFocusMinutes
};
