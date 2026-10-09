'use strict';

const { trimmedString } = require('../../../core/field-normalizers');
const { LIMITS } = require('./task-model');
const { findTask } = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task archiving requires a finite non-negative time');
  }
  return value;
}

/**
 * Move a work item into recoverable history. Execution references are owned by
 * another capability and are cleared by the coordinating workflow.
 */
function archiveTask(state, { taskId, reason, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task archiving requires a state draft');
  }
  const archivedAt = requireTimestamp(now);
  const task = findTask(state, taskId);
  if (!task) return { ok: false, reason: 'task-not-found' };
  if (task.seriesId && !task.done && !task.skippedAt) {
    return { ok: false, reason: 'open-recurrence-occurrence' };
  }

  const archivedTask = {
    ...task,
    archivedAt,
    archiveReason: trimmedString(reason, 'manual', LIMITS.ARCHIVE_REASON)
  };
  state.archivedTasks = [
    archivedTask,
    ...state.archivedTasks.filter(candidate => candidate.id !== task.id)
  ];
  state.tasks = state.tasks.filter(candidate => candidate.id !== task.id);
  return { ok: true, task: archivedTask };
}

module.exports = { archiveTask };
