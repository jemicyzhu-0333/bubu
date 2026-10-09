'use strict';

function confirmPlannedTasks(state, { taskIds, dayKey, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task planning requires a state draft');
  }
  if (!Array.isArray(taskIds) || typeof dayKey !== 'string'
      || !Number.isFinite(now) || now < 0) {
    return { ok: false, reason: 'task-plan-invalid', updatedTasks: [] };
  }
  const selected = new Set(taskIds);
  const updatedTasks = [];
  for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
    if (!task || !selected.has(task.id) || task.done || task.skippedAt || task.expired) continue;
    task.plannedFor = dayKey;
    task.updatedAt = now;
    updatedTasks.push(task.id);
  }
  return { ok: true, updatedTasks };
}

module.exports = { confirmPlannedTasks };
