'use strict';

const { normalizeTask, normalizeStep } = require('./task-model');
const { collectUsedIds, makeUniqueId, findTask } = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task duplication requires a finite non-negative time');
  }
  return value;
}

function requireIdFactory(createId) {
  if (typeof createId !== 'function') {
    throw new TypeError('task duplication requires an id factory');
  }
  return createId;
}

function duplicateTask(state, { taskId, now } = {}, { createId } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task duplication requires a state draft');
  }
  const duplicatedAt = requireTimestamp(now);
  const allocateId = requireIdFactory(createId);
  const source = findTask(state, taskId)
    || (Array.isArray(state.archivedTasks)
      ? state.archivedTasks.find(task => task && task.id === taskId) || null
      : null);
  if (!source) return { ok: false, reason: 'task-not-found' };

  const usedIds = collectUsedIds(state);
  const taskIdCopy = makeUniqueId(usedIds, allocateId, 'task');
  const stepIds = new Set();
  const task = normalizeTask({
    id: taskIdCopy,
    createdAt: duplicatedAt,
    updatedAt: duplicatedAt,
    title: source.title,
    description: source.description,
    steps: (Array.isArray(source.steps) ? source.steps : []).map((step, index) => normalizeStep({
      id: makeUniqueId(usedIds, allocateId, 'step'),
      title: step.title,
      done: false
    }, index, stepIds)),
    tags: Array.isArray(source.tags) ? [...source.tags] : [],
    energy: source.energy,
    energyAuto: source.energyAuto,
    estimateMinutes: source.estimateMinutes,
    estimateSource: source.estimateSource,
    suggestedMin: source.suggestedMin
  }, { now: duplicatedAt, usedIds: new Set() });

  state.tasks.unshift(task);
  return { ok: true, task };
}

module.exports = { duplicateTask };
