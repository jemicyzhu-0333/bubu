'use strict';

const { localDayKey, parseDayKey } = require('../../../core/calendar');
const {
  advanceSeries,
  collectUsedIds,
  findSeries,
  findTask,
  taskWriteBlockReason
} = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('occurrence skipping requires a finite non-negative time');
  }
  return value;
}

/**
 * Seal one recurring work occurrence without treating it as a failure. This
 * transition owns only work state; execution references are coordinated by the
 * skip-work-occurrence workflow.
 */
function skipOccurrence(state, input = {}, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('occurrence skipping requires a state draft');
  }
  const skippedAt = requireTimestamp(input.now);
  const referenceDay = parseDayKey(input.referenceDay) && input.referenceDay;
  if (!referenceDay) throw new TypeError('occurrence skipping requires a valid reference day');
  if (typeof options.createId !== 'function') {
    throw new TypeError('occurrence skipping requires an id factory');
  }

  const task = findTask(state, input.taskId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };
  if (!task.seriesId) return { ok: false, reason: 'task-not-recurring' };

  const series = findSeries(state, task.seriesId);
  if (!series) return { ok: false, reason: 'series-not-found' };

  task.skippedAt = skippedAt;
  task.updatedAt = skippedAt;
  // A deliberate skip is engagement, not a miss: the user addressed this round.
  // Clear the behind-count so the nudge does not outlive the decision (same
  // reset as completion — see task-completion.js).
  series.missedCount = 0;
  const nextOccurrence = advanceSeries(state, series, {
    closedOn: task.occurrenceDate,
    completedOn: localDayKey(skippedAt),
    referenceDay,
    now: skippedAt,
    usedIds: collectUsedIds(state),
    createId: options.createId
  });

  return { ok: true, task, series, nextOccurrence };
}

module.exports = { skipOccurrence };
