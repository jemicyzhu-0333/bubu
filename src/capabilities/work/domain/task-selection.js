'use strict';

const { parsedTimestamp, taskStartBlockReason } = require('./task-availability');

const MAX_SELECTION_COUNT = 1_000_000;

function currentSelectionCount(value) {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_SELECTION_COUNT)
    : 0;
}

function selectTaskForNow(task, now) {
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('task selection time must be a finite non-negative timestamp');
  }
  const blockReason = taskStartBlockReason(task, now);
  if (blockReason && blockReason !== 'task-scheduled') {
    return { ok: false, reason: blockReason };
  }

  const selected = {
    ...task,
    selectionCount: Math.min(currentSelectionCount(task.selectionCount) + 1, MAX_SELECTION_COUNT),
    lastSelectedAt: now
  };
  const scheduledAt = parsedTimestamp(task.scheduledFor);
  if (scheduledAt !== null && scheduledAt > now) {
    selected.scheduledFor = null;
    selected.scheduleNotifiedAt = null;
  }
  return { ok: true, task: selected };
}

module.exports = { selectTaskForNow };
