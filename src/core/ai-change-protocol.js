'use strict';

// The model and trusted IPC share this closed proposal grammar. Confirmation,
// hashes, versions, generated identities and receipts are application outputs.
const MAX_OPERATIONS = 20;
const MAX_CANDIDATE_BYTES = 128 * 1024;
const OPERATION_TYPES = Object.freeze(['task.create', 'task.update', 'task.steps',
  'inbox.convert-task', 'inbox.keep', 'routine.schedule']);
const TASK_FIELDS = Object.freeze(['title', 'description', 'tags', 'estimateMinutes', 'plannedFor']);
const ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function closed(value, keys) {
  return plain(value) && Reflect.ownKeys(value).every(key => typeof key === 'string'
    && keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}
function id(value) { return typeof value === 'string' && ID.test(value); }
function jsonValue(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length) return false;
    return Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
      .every(descriptor => descriptor && 'value' in descriptor && jsonValue(descriptor.value, depth + 1));
  }
  if (!plain(value) || Object.getOwnPropertySymbols(value).length) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor =>
    descriptor.enumerable && 'value' in descriptor && jsonValue(descriptor.value, depth + 1));
}
function text(value, max, nullable = false) {
  return nullable && value === null || typeof value === 'string' && value === value.trim()
    && value.length > 0 && value.length <= max;
}
function day(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function taskFields(value, create) {
  if (!closed(value, [...TASK_FIELDS, ...(create ? ['steps'] : [])])) return false;
  if (create && !text(value.title, 100)) return false;
  if (!create && Object.keys(value).length === 0) return false;
  if ('title' in value && !text(value.title, 100)) return false;
  if ('description' in value && !text(value.description, 1000, true)) return false;
  if ('plannedFor' in value && !day(value.plannedFor)) return false;
  if ('estimateMinutes' in value && value.estimateMinutes !== null
    && (!Number.isInteger(value.estimateMinutes) || value.estimateMinutes < 1 || value.estimateMinutes > 1440)) return false;
  if ('tags' in value && (!Array.isArray(value.tags) || value.tags.length > 8
    || new Set(value.tags).size !== value.tags.length || !value.tags.every(tag => text(tag, 20)))) return false;
  if ('steps' in value && (!Array.isArray(value.steps) || value.steps.length > 100
    || !value.steps.every(step => closed(step, ['title']) && text(step.title, 200)))) return false;
  return true;
}
function scheduleValid(value) {
  if (value === null) return true;
  if (!closed(value, ['frequency', 'timesOfDay', 'weekdays', 'windowMinutes'])
    || !['daily', 'weekdays', 'weekly'].includes(value.frequency)
    || !Array.isArray(value.timesOfDay) || value.timesOfDay.length < 1 || value.timesOfDay.length > 6
    || new Set(value.timesOfDay).size !== value.timesOfDay.length
    || !value.timesOfDay.every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    || !Array.isArray(value.weekdays) || new Set(value.weekdays).size !== value.weekdays.length
    || !value.weekdays.every(n => Number.isInteger(n) && n >= 1 && n <= 7)
    || (value.frequency === 'weekly' ? value.weekdays.length < 1 : value.weekdays.length !== 0)
    || !Number.isInteger(value.windowMinutes) || value.windowMinutes < 5 || value.windowMinutes > 240) return false;
  return true;
}
function operationValid(operation) {
  if (!plain(operation) || !OPERATION_TYPES.includes(operation.type)) return false;
  const common = ['opId', 'type'];
  if (operation.opId !== undefined && !id(operation.opId)) return false;
  if (operation.type === 'task.create' || operation.type === 'inbox.convert-task') {
    const conversion = operation.type === 'inbox.convert-task';
    return closed(operation, [...common, 'input', ...(conversion ? ['entityId'] : [])])
      && (!conversion || id(operation.entityId)) && taskFields(operation.input, true);
  }
  if (!id(operation.entityId)) return false;
  if (operation.type === 'task.update' || operation.type === 'task.steps') {
    if (operation.scope !== undefined && !['current', 'current-and-future'].includes(operation.scope)) return false;
    if (operation.type === 'task.update') return closed(operation, [...common, 'entityId', 'scope', 'patch'])
      && taskFields(operation.patch, false);
    return closed(operation, [...common, 'entityId', 'scope', 'steps']) && Array.isArray(operation.steps)
      && operation.steps.length > 0 && operation.steps.length <= 100 && operation.steps.every(step =>
        step?.op === 'add' ? closed(step, ['op', 'title']) && text(step.title, 200)
          : step?.op === 'rename' && closed(step, ['op', 'stepId', 'title']) && id(step.stepId) && text(step.title, 200));
  }
  if (operation.type === 'inbox.keep') return closed(operation, [...common, 'entityId', 'classification'])
    && closed(operation.classification, ['category']) && ['unclassified', 'task', 'note'].includes(operation.classification.category);
  return closed(operation, [...common, 'entityId', 'schedule']) && scheduleValid(operation.schedule);
}
function validateCandidateOperations(operations) {
  try {
    if (!jsonValue(operations) || !Array.isArray(operations) || operations.length < 1 || operations.length > MAX_OPERATIONS
      || !operations.every(operationValid)) return { ok: false, reason: 'change-operations-invalid' };
    const ids = operations.map(op => op.opId).filter(Boolean);
    if (new Set(ids).size !== ids.length || Buffer.byteLength(JSON.stringify(operations)) > MAX_CANDIDATE_BYTES) {
      return { ok: false, reason: 'change-operations-invalid' };
    }
    return { ok: true, operations: structuredClone(operations) };
  } catch (_) { return { ok: false, reason: 'change-operations-invalid' }; }
}

// Providers receive the same closed operation variants as the IPC validator.
const stringSchema = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const objectSchema = (properties, required = Object.keys(properties)) =>
  ({ type: 'object', additionalProperties: false, properties, required });
const taskProperties = { title: stringSchema(100), description: nullable(stringSchema(1000)),
  tags: { type: 'array', maxItems: 8, uniqueItems: true, items: stringSchema(20) },
  estimateMinutes: nullable({ type: 'integer', minimum: 1, maximum: 1440 }),
  plannedFor: nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) };
const inputSchema = objectSchema({ ...taskProperties,
  steps: { type: 'array', maxItems: 100, items: objectSchema({ title: stringSchema(200) }) } }, ['title']);
const stepSchema = { oneOf: [objectSchema({ op: { const: 'add' }, title: stringSchema(200) }),
  objectSchema({ op: { const: 'rename' }, stepId: stringSchema(200), title: stringSchema(200) })] };
const scheduleSchema = nullable(objectSchema({ frequency: { enum: ['daily', 'weekdays', 'weekly'] },
  timesOfDay: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true,
    items: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } },
  weekdays: { type: 'array', maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 7 } },
  windowMinutes: { type: 'integer', minimum: 5, maximum: 240 } }));
function variant(type, fields, required = Object.keys(fields)) {
  return objectSchema({ type: { const: type }, ...fields }, ['type', ...required]);
}
const taskTarget = { entityId: stringSchema(200), scope: { enum: ['current', 'current-and-future'] } };
const changeProposalSchema = Object.freeze(objectSchema({ operations: { type: 'array', minItems: 1,
  maxItems: MAX_OPERATIONS, items: { oneOf: [
    variant('task.create', { input: inputSchema }),
    variant('task.update', { ...taskTarget, patch: { ...objectSchema(taskProperties, []), minProperties: 1 } }, ['entityId', 'patch']),
    variant('task.steps', { ...taskTarget, steps: { type: 'array', minItems: 1, maxItems: 100, items: stepSchema } }, ['entityId', 'steps']),
    variant('inbox.convert-task', { entityId: stringSchema(200), input: inputSchema }),
    variant('inbox.keep', { entityId: stringSchema(200), classification: objectSchema({ category: { enum: ['unclassified', 'task', 'note'] } }) }),
    variant('routine.schedule', { entityId: stringSchema(200), schedule: scheduleSchema })
  ] } } }));

module.exports = { MAX_OPERATIONS, MAX_CANDIDATE_BYTES, OPERATION_TYPES, TASK_FIELDS,
  ID, HASH, plain, closed, id, jsonValue, text, day, scheduleValid, operationValid, validateCandidateOperations, changeProposalSchema };
