'use strict';

function validMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function canReceiveLandingNote(state, taskId) {
  if (typeof taskId !== 'string' || !taskId) return false;
  const task = Array.isArray(state.tasks)
    ? state.tasks.find(item => item && item.id === taskId)
    : null;
  return Boolean(task && !task.done && !task.skippedAt);
}

function recordSessionInvestment(state, fact) {
  if (!fact || !validMetric(fact.elapsedMs) || !validMetric(fact.startedAt)) {
    throw new TypeError('session investment requires elapsed and start timestamps');
  }
  if (typeof fact.taskId !== 'string' || !fact.taskId) return { recorded: false };
  const task = Array.isArray(state.tasks)
    ? state.tasks.find(item => item && item.id === fact.taskId)
    : null;
  if (!task) return { recorded: false };
  task.focusedMs = (Number(task.focusedMs) || 0) + fact.elapsedMs;
  task.focusSessions = (Number(task.focusSessions) || 0) + 1;
  task.lastStartedAt = fact.startedAt;
  return { recorded: true, taskId: task.id };
}

module.exports = { canReceiveLandingNote, recordSessionInvestment };
