'use strict';

function recordTaskAvoidance(state, { taskId, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task avoidance requires a state draft');
  }
  if (typeof taskId !== 'string' || !taskId.trim()
      || typeof now !== 'number' || !Number.isFinite(now) || now < 0) {
    return { ok: false, reason: 'task-avoidance-invalid' };
  }
  const task = Array.isArray(state.tasks)
    ? state.tasks.find(candidate => candidate && candidate.id === taskId) || null
    : null;
  if (!task) return { ok: false, reason: 'task-not-found' };
  if (task.done) return { ok: false, reason: 'task-completed' };
  if (task.skippedAt) return { ok: false, reason: 'occurrence-skipped' };
  task.avoidanceCount = Math.min(1_000_000, (Number(task.avoidanceCount) || 0) + 1);
  task.lastAvoidedAt = now;
  return { ok: true, taskId: task.id, avoidanceCount: task.avoidanceCount };
}

module.exports = { recordTaskAvoidance };
