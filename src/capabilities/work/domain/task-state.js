'use strict';

const { normalizeTask } = require('./task-model');
const { nextOccurrenceDate, buildOccurrence } = require('./recurrence');

function collectUsedIds(state) {
  const ids = new Set();
  for (const collection of ['tasks', 'archivedTasks']) {
    for (const task of Array.isArray(state[collection]) ? state[collection] : []) {
      if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
      if (typeof task.id === 'string') ids.add(task.id);
      for (const step of Array.isArray(task.steps) ? task.steps : []) {
        if (step && typeof step === 'object' && !Array.isArray(step) && typeof step.id === 'string') {
          ids.add(step.id);
        }
      }
    }
  }
  return ids;
}

function makeUniqueId(usedIds, createId, prefix) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = createId(prefix);
    if (typeof candidate === 'string' && candidate.trim() && !usedIds.has(candidate.trim())) {
      const id = candidate.trim();
      usedIds.add(id);
      return id;
    }
  }
  throw new Error('Could not allocate a unique task identity');
}

function findTask(state, id) {
  return Array.isArray(state.tasks) ? state.tasks.find(task => task && task.id === id) || null : null;
}

function findSeries(state, seriesId) {
  return Array.isArray(state.recurrenceSeries)
    ? state.recurrenceSeries.find(series => series && series.id === seriesId) || null
    : null;
}

function taskWriteBlockReason(task) {
  if (!task) return 'task-not-found';
  if (task.done) return 'task-completed';
  if (task.skippedAt) return 'occurrence-skipped';
  return null;
}

function refreshNextAction(task) {
  const next = Array.isArray(task.steps) ? task.steps.find(step => !step.done) : null;
  task.nextAction = next ? next.title : null;
}

function advanceSeries(state, series, options) {
  const { closedOn, completedOn, referenceDay, now, usedIds, createId } = options;
  series.lastOccurrenceDate = closedOn;
  series.updatedAt = now;
  series.openTaskId = null;
  if (series.state !== 'active') return null;

  const advance = nextOccurrenceDate(series.rule, {
    lastOccurrenceDate: closedOn,
    completedOn,
    referenceDay
  });
  const taskId = makeUniqueId(usedIds, createId, 'task');
  const occurrence = normalizeTask(buildOccurrence(series, {
    date: advance.date,
    now,
    taskId,
    stepId: () => makeUniqueId(usedIds, createId, 'step')
  }), { now, usedIds: new Set() });

  state.tasks.unshift(occurrence);
  series.openTaskId = occurrence.id;
  series.lastOccurrenceDate = advance.date;
  series.missedCount = (Number(series.missedCount) || 0) + advance.skipped;
  return { occurrence, skipped: advance.skipped };
}

module.exports = {
  collectUsedIds,
  makeUniqueId,
  findTask,
  findSeries,
  taskWriteBlockReason,
  refreshNextAction,
  advanceSeries
};
