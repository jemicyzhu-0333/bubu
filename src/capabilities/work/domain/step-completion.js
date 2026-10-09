'use strict';

const {
  findTask,
  taskWriteBlockReason,
  refreshNextAction
} = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('step completion requires a finite non-negative time');
  }
  return value;
}

/**
 * Seal one checkpoint on the caller's isolated draft. Reward accounting is a
 * progress concern and is deliberately returned to the coordinating workflow.
 */
function completeStep(state, { taskId, stepId, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('step completion requires a state draft');
  }
  const completedAt = requireTimestamp(now);
  const task = findTask(state, taskId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };

  const step = Array.isArray(task.steps)
    ? task.steps.find(candidate => candidate && candidate.id === stepId)
    : null;
  if (!step) return { ok: false, reason: 'step-not-found' };
  if (step.done) return { ok: false, reason: 'step-completed' };

  step.done = true;
  step.completedAt = completedAt;
  step.completionCycle = (Number(step.completionCycle) || 0) + 1;
  task.updatedAt = completedAt;
  refreshNextAction(task);
  return { ok: true, task, step };
}

module.exports = { completeStep };
