'use strict';

const { isPlainObject, trimmedString } = require('../../../core/field-normalizers');
const {
  ENERGY_LEVELS,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_STRATEGIES,
  SERIES_STATES,
  EDIT_SCOPES,
  LIMITS
} = require('../domain/task-model');

function validateTags(validation, candidate) {
  const { fail } = validation;
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate) || candidate.length > LIMITS.TAGS) {
    fail(`tags must be an array with at most ${LIMITS.TAGS} entries`);
    return [];
  }
  const tags = [];
  for (const [index, raw] of candidate.entries()) {
    const tag = trimmedString(raw, null, LIMITS.TAG);
    if (typeof raw !== 'string' || !tag || raw.trim().length > LIMITS.TAG) {
      fail(`tags[${index}] must be a non-empty string of at most ${LIMITS.TAG} characters`);
    } else if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

function validateEstimateMinutes(validation, candidate) {
  if (candidate === null || candidate === undefined) return null;
  if (!Number.isInteger(candidate)
      || candidate < LIMITS.ESTIMATE_MINUTES_MIN
      || candidate > LIMITS.ESTIMATE_MINUTES_MAX) {
    validation.fail(
      `estimateMinutes must be null or an integer from ${LIMITS.ESTIMATE_MINUTES_MIN} to ${LIMITS.ESTIMATE_MINUTES_MAX}`
    );
    return null;
  }
  return candidate;
}

function validateRecurrence(validation, candidate) {
  const { fail, rejectUnknown, validateDayKeyField } = validation;
  if (candidate === null || candidate === undefined) return null;
  if (!isPlainObject(candidate)) {
    fail('recurrence must be null or an object');
    return null;
  }
  rejectUnknown(candidate, ['frequency', 'interval', 'weekdays', 'strategy', 'anchorDate']);
  if (!RECURRENCE_FREQUENCIES.includes(candidate.frequency)) {
    fail(`recurrence.frequency must be one of: ${RECURRENCE_FREQUENCIES.join(', ')}`);
  }
  if (!Number.isInteger(candidate.interval)
      || candidate.interval < 1
      || candidate.interval > LIMITS.RECURRENCE_INTERVAL_MAX) {
    fail(`recurrence.interval must be an integer from 1 to ${LIMITS.RECURRENCE_INTERVAL_MAX}`);
  }
  if (!RECURRENCE_STRATEGIES.includes(candidate.strategy)) {
    fail(`recurrence.strategy must be one of: ${RECURRENCE_STRATEGIES.join(', ')}`);
  }
  let weekdays = null;
  if (candidate.weekdays !== undefined && candidate.weekdays !== null) {
    if (candidate.frequency !== 'weekly') fail('recurrence.weekdays is only supported for a weekly rule');
    else if (!Array.isArray(candidate.weekdays)
        || candidate.weekdays.length < 1 || candidate.weekdays.length > 7
        || candidate.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
      fail('recurrence.weekdays must contain 1 to 7 integers from 1 (Monday) through 7 (Sunday)');
    } else weekdays = [...new Set(candidate.weekdays)].sort((left, right) => left - right);
  }
  const anchorDate = validateDayKeyField(candidate.anchorDate, 'recurrence.anchorDate');
  return { frequency: candidate.frequency, interval: candidate.interval, weekdays, strategy: candidate.strategy, anchorDate };
}

function validateStepOperations(validation, candidate) {
  const { fail, rejectUnknown, validateId, validateBoundedString } = validation;
  if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > LIMITS.STEPS) {
    fail(`patch.steps must be an array with 1 to ${LIMITS.STEPS} operations`);
    return [];
  }
  return candidate.map((operation, index) => {
    if (!isPlainObject(operation)) {
      fail(`patch.steps[${index}] must be an object`);
      return null;
    }
    if (operation.op === 'add') {
      rejectUnknown(operation, ['op', 'title']);
      const title = validateBoundedString(operation.title, `patch.steps[${index}].title`, LIMITS.STEP_TITLE);
      return title ? { op: 'add', title } : null;
    }
    if (operation.op === 'rename') {
      rejectUnknown(operation, ['op', 'stepId', 'title']);
      const stepId = validateId(operation.stepId, `patch.steps[${index}].stepId`);
      const title = validateBoundedString(operation.title, `patch.steps[${index}].title`, LIMITS.STEP_TITLE);
      return stepId && title ? { op: 'rename', stepId, title } : null;
    }
    if (operation.op === 'remove') {
      rejectUnknown(operation, ['op', 'stepId']);
      const stepId = validateId(operation.stepId, `patch.steps[${index}].stepId`);
      return stepId ? { op: 'remove', stepId } : null;
    }
    if (operation.op === 'reorder') {
      rejectUnknown(operation, ['op', 'stepIds']);
      if (!Array.isArray(operation.stepIds) || operation.stepIds.length < 1
          || operation.stepIds.length > LIMITS.STEPS
          || operation.stepIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)
          || new Set(operation.stepIds.map(id => id.trim())).size !== operation.stepIds.length) {
        fail(`patch.steps[${index}].stepIds must be the complete list of unique step ids`);
        return null;
      }
      return { op: 'reorder', stepIds: operation.stepIds.map(id => id.trim()) };
    }
    fail(`patch.steps[${index}].op must be add, rename, remove, or reorder`);
    return null;
  }).filter(Boolean);
}

function decodeTaskInput(validation, requireSteps) {
  const { requireObject, rejectUnknown, validateBoundedString, validateDayKeyField, validateDateField } = validation;
  const object = requireObject();
  if (!object) return undefined;
  rejectUnknown(object, [
    'title', 'description', 'energy', 'tags', 'estimateMinutes',
    'plannedFor', 'scheduledFor', 'deadline', 'expiresAt', 'recurrence', 'steps'
  ]);
  const title = validateBoundedString(object.title, 'title', LIMITS.TITLE);
  const description = object.description === undefined || object.description === null
    ? null : validateBoundedString(object.description, 'description', LIMITS.DESCRIPTION);
  const energy = object.energy === undefined ? 'auto' : object.energy;
  if (!['auto', ...ENERGY_LEVELS].includes(energy)) validation.fail('energy must be auto, low, medium, or high');
  const tags = validateTags(validation, object.tags) || [];
  const estimateMinutes = validateEstimateMinutes(validation, object.estimateMinutes);
  const plannedFor = validateDayKeyField(object.plannedFor, 'plannedFor');
  const scheduledFor = validateDateField(object.scheduledFor, 'scheduledFor');
  const deadline = validateDateField(object.deadline, 'deadline');
  const expiresAt = validateDateField(object.expiresAt, 'expiresAt');
  const recurrence = validateRecurrence(validation, object.recurrence);
  let steps = [];
  if (object.steps !== undefined) {
    if (!Array.isArray(object.steps) || object.steps.length > LIMITS.STEPS) {
      validation.fail(`steps must be an array with at most ${LIMITS.STEPS} entries`);
    } else {
      steps = object.steps.map((step, index) => {
        if (!isPlainObject(step)) {
          validation.fail(`steps[${index}] must be an object`);
          return null;
        }
        rejectUnknown(step, ['title']);
        const stepTitle = validateBoundedString(step.title, `steps[${index}].title`, LIMITS.STEP_TITLE);
        return stepTitle ? { title: stepTitle, done: false } : null;
      }).filter(Boolean);
    }
  }
  if (requireSteps && steps.length === 0) validation.fail('at least one valid step is required');
  return {
    title, description, energy, tags, estimateMinutes,
    plannedFor, scheduledFor, deadline, expiresAt, recurrence, steps
  };
}

function decodeTaskUpdate(validation) {
  const { context, requireObject, rejectUnknown, validateId, validateBoundedString, validateDayKeyField, validateDateField } = validation;
  const object = requireObject();
  if (!object) return undefined;
  rejectUnknown(object, ['id', 'patch', 'scope']);
  const id = validateId(object.id);
  if (!isPlainObject(object.patch)) validation.fail('patch must be an object');
  const patch = {};
  if (isPlainObject(object.patch)) {
    rejectUnknown(object.patch, [
      'title', 'description', 'energy', 'tags', 'estimateMinutes',
      'plannedFor', 'scheduledFor', 'deadline', 'expiresAt', 'blocker', 'nextAction', 'steps'
    ]);
    if ('title' in object.patch) {
      const title = validateBoundedString(object.patch.title, 'patch.title', LIMITS.TITLE);
      if (title) patch.title = title;
    }
    if ('description' in object.patch) {
      patch.description = object.patch.description === null || object.patch.description === ''
        ? null : validateBoundedString(object.patch.description, 'patch.description', LIMITS.DESCRIPTION);
    }
    if ('energy' in object.patch) {
      if (!['auto', ...ENERGY_LEVELS].includes(object.patch.energy)) validation.fail('patch.energy is invalid');
      else patch.energy = object.patch.energy;
    }
    if ('tags' in object.patch) patch.tags = validateTags(validation, object.patch.tags) || [];
    if ('estimateMinutes' in object.patch) patch.estimateMinutes = validateEstimateMinutes(validation, object.patch.estimateMinutes);
    if ('plannedFor' in object.patch) patch.plannedFor = validateDayKeyField(object.patch.plannedFor, 'patch.plannedFor');
    for (const field of ['scheduledFor', 'deadline', 'expiresAt']) {
      if (field in object.patch) patch[field] = validateDateField(object.patch[field], `patch.${field}`);
    }
    for (const [field, limit] of [['blocker', LIMITS.BLOCKER], ['nextAction', LIMITS.NEXT_ACTION]]) {
      if (field in object.patch) {
        patch[field] = object.patch[field] === null || object.patch[field] === ''
          ? null : validateBoundedString(object.patch[field], `patch.${field}`, limit);
      }
    }
    if ('steps' in object.patch) patch.steps = validateStepOperations(validation, object.patch.steps);
    if (Object.keys(patch).length === 0) validation.fail('patch must contain at least one supported field');
  }
  const isRecurring = Boolean(context.currentTask && context.currentTask.seriesId);
  let scope;
  if (object.scope !== undefined) {
    if (!EDIT_SCOPES.includes(object.scope)) validation.fail(`scope must be one of: ${EDIT_SCOPES.join(', ')}`);
    else scope = object.scope;
  } else if (isRecurring) validation.fail('a recurring task patch must declare scope: current or current-and-future');
  return { id, patch, scope };
}

function decodeSeriesUpdate(validation) {
  const { requireObject, rejectUnknown, validateId } = validation;
  const object = requireObject();
  if (!object) return undefined;
  rejectUnknown(object, ['seriesId', 'rule', 'state']);
  const seriesId = validateId(object.seriesId, 'seriesId');
  let rule = object.rule === undefined ? undefined : validateRecurrence(validation, object.rule);
  if (rule && isPlainObject(object.rule)
      && (object.rule.anchorDate === undefined || object.rule.anchorDate === null || object.rule.anchorDate === '')) {
    rule = { ...rule };
    delete rule.anchorDate;
  }
  let state;
  if (object.state !== undefined) {
    if (!SERIES_STATES.includes(object.state)) validation.fail(`state must be one of: ${SERIES_STATES.join(', ')}`);
    else state = object.state;
  }
  if (rule === undefined && state === undefined) validation.fail('series update must change the rule or the state');
  return { seriesId, rule, state };
}

module.exports = { decodeTaskInput, decodeTaskUpdate, decodeSeriesUpdate };
