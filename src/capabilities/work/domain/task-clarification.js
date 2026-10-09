'use strict';

const { trimmedString } = require('../../../core/field-normalizers');
const { LIMITS, normalizeStep } = require('./task-model');
const {
  collectUsedIds,
  findTask,
  makeUniqueId,
  taskWriteBlockReason
} = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task clarification requires a finite non-negative time');
  }
  return value;
}

function requireIdFactory(createId) {
  if (typeof createId !== 'function') {
    throw new TypeError('task clarification requires an id factory');
  }
  return createId;
}

function ensureNextActionStep(state, task, title, { createId } = {}) {
  const nextAction = trimmedString(title, null, LIMITS.NEXT_ACTION);
  if (!nextAction) return { ok: false, reason: 'next-action-required' };

  const steps = Array.isArray(task.steps) ? task.steps : (task.steps = []);
  const unfinishedIndex = steps.findIndex(step => step && !step.done);
  const needsStep = unfinishedIndex < 0 || steps[unfinishedIndex].title !== nextAction;
  if (!needsStep) return { ok: true, nextAction, step: null };
  if (steps.length >= LIMITS.STEPS) return { ok: false, reason: 'step-limit-reached' };

  const allocateId = requireIdFactory(createId);
  const id = makeUniqueId(collectUsedIds(state), allocateId, 'step');
  const step = normalizeStep({ id, title: nextAction, done: false }, steps.length, new Set());
  steps.splice(Math.max(0, unfinishedIndex), 0, step);
  return { ok: true, nextAction, step };
}

function applyLandingNote(state, input = {}, options = {}) {
  const task = findTask(state, input.taskId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };

  const recordedAt = requireTimestamp(input.now);
  const update = ensureNextActionStep(state, task, input.landingNote, options);
  if (!update.ok) return update;

  task.nextAction = update.nextAction;
  task.lastCheckpoint = update.nextAction;
  task.lastCheckpointAt = recordedAt;
  task.updatedAt = recordedAt;
  return { ok: true, task, step: update.step };
}

function clarifyTask(state, input = {}, options = {}) {
  const task = findTask(state, input.taskId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };

  const clarifiedAt = requireTimestamp(input.now);
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const firstUnfinished = steps.find(step => step && !step.done);
  const suggested = !input.nextAction && !firstUnfinished
    && typeof options.suggestNextAction === 'function'
    ? options.suggestNextAction(task.title)
    : null;
  const update = ensureNextActionStep(
    state,
    task,
    input.nextAction || (firstUnfinished && firstUnfinished.title) || suggested,
    options
  );
  if (!update.ok) return update;

  task.blocker = trimmedString(input.blocker, null, LIMITS.BLOCKER);
  task.nextAction = update.nextAction;
  task.activationFriction = Math.max(10, (Number(task.activationFriction) || 70) - 20);
  task.updatedAt = clarifiedAt;
  return { ok: true, task, step: update.step };
}

module.exports = { ensureNextActionStep, applyLandingNote, clarifyTask };
