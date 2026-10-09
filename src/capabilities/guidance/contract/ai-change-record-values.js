'use strict';

// Closed, body-free identities and typed compensation values for the canonical
// receipt. These validators never coerce or discard an unrecognised field.
const { isPlainObject, validDayKey } = require('../../../core/field-normalizers');
const { SCHEDULE_FREQUENCIES, TIME_OF_DAY_PATTERN } = require('../../../core/routine-model');
const ENTITY_KINDS = Object.freeze(['task', 'recurrenceSeries', 'inbox', 'routine']);
const OPERATION_TYPES = Object.freeze(['task.create', 'task.update', 'task.steps', 'inbox.convert-task',
  'inbox.keep', 'routine.schedule', 'task.restore', 'routine.restore-schedule']);
const TASK_FIELDS = Object.freeze(['title', 'description', 'tags', 'estimateMinutes', 'estimateSource',
  'plannedFor', 'energy', 'energyAuto', 'suggestedMin', 'nextAction']);
const SERIES_FIELDS = Object.freeze(['title', 'description', 'tags', 'energy', 'energyAuto', 'estimateMinutes', 'stepTitles']);
const DIFF_FIELDS = Object.freeze([...new Set([...TASK_FIELDS, ...SERIES_FIELDS, 'steps', 'classification', 'resolution', 'schedule', 'energySignalIds'])]);
const { inboxRecords, impulseInbox } = require('../../work');
const { CATEGORIES } = inboxRecords;
const { TRIAGE_ROUTINE_KINDS: ROUTINE_KINDS, TRIAGE_LEVELS } = impulseInbox;

function closed(value, keys) {
  return isPlainObject(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)
      && Object.getOwnPropertyDescriptor(value, key).get === undefined
      && Object.getOwnPropertyDescriptor(value, key).set === undefined);
}
function jsonValue(value, depth = 0) {
  if (depth > 24) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (!isPlainObject(value) && !Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 || !keys.includes('length'))) return false;
  return keys.every(key => {
    if (Array.isArray(value) && key === 'length') return true;
    if (typeof key !== 'string') return false;
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && !descriptor.get && !descriptor.set && jsonValue(descriptor.value, depth + 1);
  });
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
}
function id(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);
}
function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function timestamp(value) { return integer(value, 0, 8.64e15); }
function text(value, max, nullable = false) {
  return (nullable && value === null) || (typeof value === 'string' && value.length <= max
    && value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
}
function list(value, maximum, predicate, minimum = 0) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum
    && value.every(predicate) && Object.keys(value).length === value.length;
}
function unique(value, key = item => item) { return new Set(value.map(key)).size === value.length; }
function entityRef(value) { return closed(value, ['kind', 'id']) && ENTITY_KINDS.includes(value.kind) && id(value.id); }
function entityVersion(value) {
  return closed(value, ['kind', 'id', 'fingerprint']) && ENTITY_KINDS.includes(value.kind)
    && id(value.id) && hash(value.fingerprint);
}
function versions(value) {
  return list(value, 60, entityVersion) && unique(value, item => `${item.kind}:${item.id}`);
}
function schedule(value) {
  if (value === null) return true;
  return closed(value, ['frequency', 'timesOfDay', 'weekdays', 'windowMinutes'])
    && SCHEDULE_FREQUENCIES.includes(value.frequency)
    && list(value.timesOfDay, 6, item => typeof item === 'string' && TIME_OF_DAY_PATTERN.test(item), 1)
    && unique(value.timesOfDay) && value.timesOfDay.every((item, index) => !index || item > value.timesOfDay[index - 1])
    && list(value.weekdays, 7, item => integer(item, 1, 7), value.frequency === 'weekly' ? 1 : 0)
    && unique(value.weekdays) && value.weekdays.every((item, index) => !index || item > value.weekdays[index - 1])
    && (value.frequency === 'weekly' || value.weekdays.length === 0) && integer(value.windowMinutes, 5, 240);
}
function step(value) {
  return closed(value, ['id', 'title', 'done', 'completedAt', 'completionCycle']) && id(value.id)
    && text(value.title, 200) && value.title.length > 0 && typeof value.done === 'boolean'
    && (value.completedAt === null || (value.done && timestamp(value.completedAt))) && integer(value.completionCycle, 0, 1000000);
}
function classification(value) {
  return value === null || (closed(value, ['category', 'routineKind', 'level']) && CATEGORIES.includes(value.category)
    && (value.routineKind === null || (['routine', 'log'].includes(value.category) && ROUTINE_KINDS.includes(value.routineKind)))
    && (value.level === null || (value.category === 'state' && TRIAGE_LEVELS.includes(value.level))));
}
function resolution(value) {
  return value === null || (closed(value, ['action', 'category', 'targetId'])
    && ['promote', 'next-step', 'schedule', 'someday', 'routine', 'log', 'state', 'feeling', 'keep'].includes(value.action)
    && CATEGORIES.includes(value.category) && (value.targetId === null || id(value.targetId)));
}
function fieldValue(field, value, absent = false) {
  if (absent && value === null) return true;
  switch (field) {
    case 'title': return text(value, 500) && value.length > 0;
    case 'description': return text(value, 1000, true);
    case 'nextAction': return text(value, 200, true);
    case 'energySignalIds': return list(value, 100, id) && unique(value);
    case 'tags': return list(value, 8, item => text(item, 20) && item.length > 0) && unique(value);
    case 'stepTitles': return list(value, 100, item => text(item, 200) && item.length > 0);
    case 'energy': return ['low', 'medium', 'high'].includes(value);
    case 'energyAuto': return typeof value === 'boolean';
    case 'suggestedMin': return integer(value, 0, 1440);
    case 'estimateMinutes': return value === null || integer(value, 1, 1440);
    case 'estimateSource': return value === null || ['user', 'rule', 'ai'].includes(value);
    case 'plannedFor': return value === null || (typeof value === 'string' && validDayKey(value) === value);
    case 'steps': return list(value, 100, step) && unique(value, item => item.id);
    case 'classification': return classification(value);
    case 'resolution': return resolution(value);
    case 'schedule': return schedule(value);
    default: return false;
  }
}
function fieldChanges(value) {
  return list(value, DIFF_FIELDS.length, item => closed(item, ['field', 'before', 'after'])
    && DIFF_FIELDS.includes(item.field) && fieldValue(item.field, item.before, true) && fieldValue(item.field, item.after))
    && unique(value, item => item.field);
}
function restoreFields(value, allowed) {
  return list(value, allowed.length, item => closed(item, ['field', 'value'])
    && allowed.includes(item.field) && fieldValue(item.field, item.value)) && unique(value, item => item.field);
}
function undoOperation(value) {
  if (!isPlainObject(value)) return false;
  if (value.type === 'task.restore') {
    return closed(value, ['type', 'entityId', 'scope', 'fields', 'steps', 'seriesFields']) && id(value.entityId)
      && ['current', 'current-and-future'].includes(value.scope) && restoreFields(value.fields, TASK_FIELDS)
      && restoreFields(value.seriesFields, SERIES_FIELDS) && (value.scope === 'current-and-future' || value.seriesFields.length === 0)
      && list(value.steps, 100, item => (closed(item, ['op', 'stepId', 'title']) && item.op === 'rename'
        && id(item.stepId) && text(item.title, 200) && item.title.length > 0)
        || (closed(item, ['op', 'stepId']) && item.op === 'remove' && id(item.stepId)))
      && unique(value.steps, item => item.stepId)
      && value.fields.length + value.steps.length + value.seriesFields.length > 0;
  }
  return value.type === 'routine.restore-schedule' && closed(value, ['type', 'entityId', 'timezone', 'schedule'])
    && id(value.entityId) && timezone(value.timezone) && schedule(value.schedule);
}
function timezone(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch (_) { return false; }
}
function evidenceRefs(value) {
  return list(value, 50, item => closed(item, ['kind', 'id', 'revision'])
    && [...ENTITY_KINDS, 'message', 'summary', 'event'].includes(item.kind) && id(item.id)
    && (item.revision === null || id(item.revision))) && unique(value, item => `${item.kind}:${item.id}:${item.revision}`);
}
module.exports = { ENTITY_KINDS, OPERATION_TYPES, TASK_FIELDS, SERIES_FIELDS, DIFF_FIELDS, closed, jsonValue, integer,
  id, hash, timestamp, text, list, unique, entityRef, entityVersion, versions, schedule, timezone, fieldValue,
  fieldChanges, undoOperation, evidenceRefs };
