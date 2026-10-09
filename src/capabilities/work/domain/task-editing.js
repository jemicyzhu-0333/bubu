'use strict';

const { isPlainObject } = require('../../../core/field-normalizers');
const { EDIT_SCOPES, LIMITS, normalizeStep } = require('./task-model');
const {
  collectUsedIds,
  findSeries,
  findTask,
  makeUniqueId,
  refreshNextAction,
  taskWriteBlockReason
} = require('./task-state');

const CONTENT_PATCH_FIELDS = Object.freeze([
  'title',
  'description',
  'tags',
  'energy',
  'estimateMinutes'
]);

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task editing requires a finite non-negative time');
  }
  return value;
}

function applyStepOperations(task, operations, { usedIds, createId }) {
  for (const operation of operations) {
    if (operation.op === 'add') {
      if (task.steps.length >= LIMITS.STEPS) return 'step-limit-reached';
      const id = makeUniqueId(usedIds, createId, 'step');
      task.steps.push(normalizeStep({ id, title: operation.title, done: false }, task.steps.length, new Set()));
      continue;
    }
    if (operation.op === 'rename' || operation.op === 'remove') {
      const index = task.steps.findIndex(step => step.id === operation.stepId);
      if (index < 0) return 'step-not-found';
      if (task.steps[index].done) return 'step-completed';
      if (operation.op === 'rename') task.steps[index].title = operation.title;
      else task.steps.splice(index, 1);
      continue;
    }
    if (operation.op === 'reorder') {
      const current = task.steps.map(step => step.id);
      const requested = operation.stepIds;
      if (requested.length !== current.length || new Set(requested).size !== requested.length
          || requested.some(id => !current.includes(id))) {
        return 'step-order-mismatch';
      }
      task.steps = requested.map(id => task.steps.find(step => step.id === id));
      continue;
    }
    return 'step-operation-invalid';
  }
  return null;
}

/**
 * Apply one validated task patch to the caller's isolated work draft. A
 * recurring occurrence and its future template are updated together only when
 * the caller explicitly selects that scope.
 */
function updateTask(state, input = {}, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task editing requires a state draft');
  }
  const updatedAt = requireTimestamp(input.now);
  if (typeof options.createId !== 'function') {
    throw new TypeError('task editing requires an id factory');
  }
  const inferEnergy = typeof options.inferEnergy === 'function' ? options.inferEnergy : null;
  const suggestDuration = typeof options.suggestDuration === 'function' ? options.suggestDuration : null;
  const patch = isPlainObject(input.patch) ? input.patch : {};
  const task = findTask(state, input.taskId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };

  const series = task.seriesId ? findSeries(state, task.seriesId) : null;
  const scope = EDIT_SCOPES.includes(input.scope) ? input.scope : 'current';
  if (series && !EDIT_SCOPES.includes(input.scope)) {
    return { ok: false, reason: 'recurrence-scope-required' };
  }

  if ('title' in patch) {
    task.title = patch.title;
    if (task.energyAuto && inferEnergy) task.energy = inferEnergy(task.title);
    if (suggestDuration) task.suggestedMin = suggestDuration(task.title, task.energy);
  }
  if ('description' in patch) task.description = patch.description;
  if ('tags' in patch) task.tags = patch.tags;
  if ('energy' in patch) {
    if (patch.energy === 'auto') {
      task.energyAuto = true;
      if (inferEnergy) task.energy = inferEnergy(task.title);
    } else {
      task.energy = patch.energy;
      task.energyAuto = false;
    }
    if (suggestDuration) task.suggestedMin = suggestDuration(task.title, task.energy);
  }
  if ('estimateMinutes' in patch) {
    task.estimateMinutes = patch.estimateMinutes;
    task.estimateSource = patch.estimateMinutes === null ? 'rule' : 'user';
  }
  for (const field of ['plannedFor', 'scheduledFor', 'deadline', 'expiresAt']) {
    if (!(field in patch)) continue;
    task[field] = patch[field];
    if (field === 'scheduledFor') task.scheduleNotifiedAt = null;
    if (field === 'expiresAt') task.expired = false;
  }
  if ('blocker' in patch) task.blocker = patch.blocker;
  if ('nextAction' in patch) task.nextAction = patch.nextAction;

  if (Array.isArray(patch.steps)) {
    const failure = applyStepOperations(task, patch.steps, {
      usedIds: collectUsedIds(state),
      createId: options.createId
    });
    if (failure) return { ok: false, reason: failure };
    refreshNextAction(task);
  }

  task.updatedAt = updatedAt;
  if (series && scope === 'current-and-future') {
    const template = series.template;
    if ('title' in patch) template.title = task.title;
    if ('description' in patch) template.description = task.description;
    if ('tags' in patch) template.tags = [...task.tags];
    if ('energy' in patch) {
      template.energy = task.energy;
      template.energyAuto = task.energyAuto;
    }
    if ('estimateMinutes' in patch) template.estimateMinutes = task.estimateMinutes;
    if (Array.isArray(patch.steps)) template.stepTitles = task.steps.map(step => step.title);
    series.updatedAt = updatedAt;
  }

  return {
    ok: true,
    task,
    series,
    scope,
    touchedContent: CONTENT_PATCH_FIELDS.some(field => field in patch)
  };
}

function focusEditBlockReason(state, { taskId, patch, scope }, focusPolicy) {
  if (!focusPolicy || typeof focusPolicy.isTimingSession !== 'function' || typeof focusPolicy.sessionKind !== 'function') {
    throw new TypeError('guarded task editing requires the execution focus policy');
  }
  if (state.focusSession?.taskId !== taskId || !focusPolicy.isTimingSession(state.focusSession)
    || focusPolicy.sessionKind(state.focusSession) === 'break') return null;
  const pendingStepsOnly = patch && Object.keys(patch).length === 1 && Array.isArray(patch.steps)
    && patch.steps.length > 0 && patch.steps.every(step => step && ['add', 'rename'].includes(step.op))
    && (scope === undefined || scope === 'current');
  return pendingStepsOnly ? null : 'task-in-focus';
}

function updateTaskGuarded(state, input, options) {
  const blocked = focusEditBlockReason(state, input, options.focusPolicy);
  return blocked ? { ok: false, reason: blocked } : updateTask(state, input, options);
}

const RESTORABLE_FIELDS = Object.freeze(['title', 'description', 'tags', 'estimateMinutes', 'estimateSource',
  'plannedFor', 'energy', 'energyAuto', 'suggestedMin', 'nextAction']);
const RESTORABLE_SERIES_FIELDS = Object.freeze(['title', 'description', 'tags', 'energy', 'energyAuto',
  'estimateMinutes', 'stepTitles']);

// A compensation restores only named fields; it cannot restore an entity snapshot
// containing completion, investment, reward or execution state.
function restoreTask(state, input, options) {
  const task = findTask(state, input.entityId);
  const blocked = taskWriteBlockReason(task);
  if (blocked) return { ok: false, reason: blocked };
  const patch = input.fields.length ? { title: task.title, steps: input.steps } : { steps: input.steps };
  const focused = focusEditBlockReason(state, { taskId: task.id, patch, scope: input.scope }, options.focusPolicy);
  if (focused) return { ok: false, reason: focused };
  if (!input.fields.every(item => RESTORABLE_FIELDS.includes(item.field))
    || !input.seriesFields.every(item => RESTORABLE_SERIES_FIELDS.includes(item.field))) return { ok: false, reason: 'undo-fields-invalid' };
  const series = task.seriesId ? findSeries(state, task.seriesId) : null;
  if (series && !EDIT_SCOPES.includes(input.scope)) return { ok: false, reason: 'recurrence-scope-required' };
  if (input.seriesFields.length && (!series || input.scope !== 'current-and-future')) return { ok: false, reason: 'undo-series-invalid' };
  for (const step of input.steps) {
    if (!['rename', 'remove'].includes(step.op)) return { ok: false, reason: 'undo-step-invalid' };
    const target = task.steps.find(item => item.id === step.stepId);
    if (!target) return { ok: false, reason: 'step-not-found' };
    if (target.done) return { ok: false, reason: 'step-completed' };
  }
  const error = applyStepOperations(task, input.steps, { usedIds: collectUsedIds(state), createId: options.createId });
  if (error) return { ok: false, reason: error };
  for (const field of input.fields) task[field.field] = structuredClone(field.value);
  task.updatedAt = requireTimestamp(input.now);
  if (input.seriesFields.length) {
    for (const field of input.seriesFields) series.template[field.field] = structuredClone(field.value);
    series.updatedAt = input.now;
  }
  return { ok: true, task, series, scope: input.scope };
}

module.exports = { updateTask, updateTaskGuarded, focusEditBlockReason, restoreTask,
  RESTORABLE_FIELDS, RESTORABLE_SERIES_FIELDS };
