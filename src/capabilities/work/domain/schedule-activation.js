'use strict';

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('schedule activation requires a finite non-negative time');
  }
  return value;
}

// A reservation fires once. `scheduleNotifiedAt` is the receipt, so a task that
// already announced itself stays quiet no matter how often the watcher ticks,
// and a finished, skipped or expired round never announces at all.
function activateDueSchedules(state, activatedAt) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.tasks)) {
    throw new TypeError('schedule activation requires a state draft with tasks');
  }
  const now = requireTimestamp(activatedAt);
  const activatedTaskIds = [];
  for (const task of state.tasks) {
    if (!task || task.done || task.skippedAt || task.expired || task.scheduleNotifiedAt) continue;
    const scheduledAt = task.scheduledFor ? Date.parse(task.scheduledFor) : Number.NaN;
    if (!Number.isFinite(scheduledAt) || scheduledAt > now) continue;
    task.scheduleNotifiedAt = now;
    activatedTaskIds.push(task.id);
  }
  return { ok: true, activatedTaskIds };
}

module.exports = { activateDueSchedules };
