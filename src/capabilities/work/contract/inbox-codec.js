'use strict';

const { CATEGORIES, MAX_KEEP_ALL, decodeHistoryCursor } = require('../domain/inbox-records');
const { TRIAGE_LEVELS, TRIAGE_ROUTINE_KINDS } = require('../domain/impulse-inbox');

function decodeOrganize(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['id', 'action', 'category', 'routineKind', 'level', 'title', 'routineId', 'createNew']);
  const id = validation.validateId(object.id);
  if (!['classify', 'keep', 'routine', 'log', 'state'].includes(object.action)) validation.fail('invalid inbox action');
  if (object.action === 'classify' && !CATEGORIES.includes(object.category)) validation.fail('invalid inbox category');
  if (object.category !== undefined && !CATEGORIES.includes(object.category)) validation.fail('invalid category');
  if (object.routineKind != null && !TRIAGE_ROUTINE_KINDS.includes(object.routineKind)) validation.fail('invalid routine kind');
  if (object.level != null && !TRIAGE_LEVELS.includes(object.level)) validation.fail('invalid energy level');
  const title = object.title === undefined ? undefined : validation.validateBoundedString(object.title, 'title', 40);
  const routineId = object.routineId == null ? null : validation.validateId(object.routineId, 'routineId');
  if (object.createNew !== undefined && typeof object.createNew !== 'boolean') validation.fail('createNew must be boolean');
  return { id, action: object.action, category: object.category, routineKind: object.routineKind, level: object.level, title, routineId, createNew: object.createNew === true };
}

function decodeInboxHistory(validation) {
  const object = validation.payload == null ? {} : validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['cursor', 'limit', 'category']);
  const { cursor = null, limit = 30, category = null } = object;
  if (cursor !== null && !decodeHistoryCursor(cursor)) validation.fail('invalid cursor');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) validation.fail('invalid limit');
  if (category !== null && !CATEGORIES.includes(category)) validation.fail('invalid category');
  return { cursor, limit, category };
}

function decodeKeepAll(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['ids']);
  if (!Array.isArray(object.ids) || object.ids.length < 1 || object.ids.length > MAX_KEEP_ALL) validation.fail(`ids must list 1-${MAX_KEEP_ALL} captures`);
  const ids = object.ids.map(id => validation.validateId(id, 'ids'));
  if (new Set(ids).size !== ids.length) validation.fail('ids must be unique');
  return { ids };
}

module.exports = { decodeOrganize, decodeInboxHistory, decodeKeepAll };
