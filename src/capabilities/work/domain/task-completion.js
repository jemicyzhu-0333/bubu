'use strict';

const { localDayKey, parseDayKey } = require('../../../core/calendar');
const {
  collectUsedIds,
  findTask,
  findSeries,
  taskWriteBlockReason,
  advanceSeries
} = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task completion requires a finite non-negative time');
  }
  return value;
}

/**
 * Seal one work item in an isolated transaction draft. This transition owns
 * only work state; execution pointers, rewards and companion benefits are
 * coordinated by the complete-work-item application workflow.
 */
function completeTask(state, input = {}, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task completion requires a state draft');
  }
  const now = requireTimestamp(input.now);
  const referenceDay = parseDayKey(input.referenceDay) && input.referenceDay;
  if (!referenceDay) throw new TypeError('task completion requires a valid reference day');
  if (typeof options.createId !== 'function') {
    throw new TypeError('task completion requires an id factory');
  }

  const task = findTask(state, input.id);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };

  const unfinishedCount = (Array.isArray(task.steps) ? task.steps : [])
    .filter(step => !step.done).length;
  if (unfinishedCount > 0 && input.confirmUnfinishedSteps !== true) {
    return { ok: false, reason: 'unfinished-steps-need-confirmation', unfinishedCount };
  }

  task.done = true;
  task.completedAt = now;
  task.updatedAt = now;
  task.completionCycle = (Number(task.completionCycle) || 0) + 1;

  const series = task.seriesId ? findSeries(state, task.seriesId) : null;
  // Engaging with a round clears the behind-count. Completing today means the
  // user is caught up, so the "missed N rounds" nudge resets to zero here; it
  // only re-accrues through the daily catch-up when rounds genuinely go by
  // unaddressed. Without this the count is a monotonic accumulator that keeps
  // reading "漏了 N 轮" forever, even after the user resumes doing it every day.
  if (series) series.missedCount = 0;
  const nextOccurrence = series ? advanceSeries(state, series, {
    closedOn: task.occurrenceDate,
    completedOn: localDayKey(now),
    referenceDay,
    now,
    usedIds: collectUsedIds(state),
    createId: options.createId
  }) : null;

  return { ok: true, task, series, nextOccurrence };
}

module.exports = { completeTask };
