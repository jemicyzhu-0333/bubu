'use strict';
const { validTimeContext } = require('./ai-change-event-contract');

const KINDS = Object.freeze(['rhythm', 'friction', 'preference', 'context', 'pattern']);
const STATUSES = Object.freeze(['candidate', 'active', 'paused', 'removed']);
const SOURCES = Object.freeze(['user-statement', 'user-edit', 'deterministic', 'model-proposed', 'legacy-import']);
const OPERATIONS = Object.freeze(['add', 'update', 'activate', 'pause', 'remove', 'restore', 'permanent-remove', 'undo']);
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const UNDO_TTL_MS = 10 * 60 * 1000;
const RECYCLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MEMORIES = 500;
const SOURCE_KINDS = ['task', 'inbox', 'routine', 'planning-preference', 'memory', 'timeline', 'activity', 'energy', 'message'];
const closed = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).every(key => keys.includes(key));
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max;
const clone = value => structuredClone(value);
const normalizeSubject = value => value.trim().toLowerCase().replace(/\s+/g, ' ');
const topicKey = value => JSON.stringify([value.kind, normalizeSubject(value.subject), value.scope]);
const sourceKey = value => JSON.stringify([value.kind, value.id]);
const sourceRefsValid = refs => Array.isArray(refs) && refs.length <= 50 && refs.every(ref =>
  closed(ref, ['kind', 'id', 'revision']) && SOURCE_KINDS.includes(ref.kind) && id(ref.id)
  && (ref.revision === null || id(ref.revision)))
  && new Set(refs.map(ref => JSON.stringify(ref))).size === refs.length;

function inputValid(input) {
  return closed(input, ['kind', 'subject', 'body', 'status', 'sourceType', 'sourceRefs', 'validFrom', 'expiresAt', 'scope', 'privacyLevel'])
    && KINDS.includes(input.kind) && text(input.subject, 200) && text(input.body, 500)
    && [undefined, 'candidate', 'active'].includes(input.status)
    && SOURCES.filter(value => value !== 'legacy-import').includes(input.sourceType)
    && (input.sourceType !== 'model-proposed' || [undefined, 'candidate'].includes(input.status))
    && (!['model-proposed', 'deterministic'].includes(input.sourceType) || input.sourceRefs?.length > 0)
    && (input.sourceRefs === undefined || sourceRefsValid(input.sourceRefs))
    && (input.validFrom === undefined || time(input.validFrom))
    && (input.expiresAt === undefined || input.expiresAt === null || time(input.expiresAt))
    && [undefined, 'global', 'work', 'personal'].includes(input.scope)
    && [undefined, 'standard', 'sensitive'].includes(input.privacyLevel);
}
function recordValid(record) {
  return closed(record, ['id', 'version', 'kind', 'subject', 'body', 'status', 'sourceType', 'legacySource', 'sourceRefs',
    'confirmedAt', 'validFrom', 'expiresAt', 'scope', 'privacyLevel', 'createdAt', 'updatedAt', 'lastUsedAt', 'useCount', 'removedAt', 'recycleUntil'])
    && id(record.id) && Number.isSafeInteger(record.version) && record.version > 0
    && KINDS.includes(record.kind) && text(record.subject, 200) && text(record.body, 500)
    && STATUSES.includes(record.status) && SOURCES.includes(record.sourceType) && sourceRefsValid(record.sourceRefs)
    && [null, 'user-confirmed', 'aggregated'].includes(record.legacySource)
    && (record.sourceType === 'legacy-import' || record.legacySource === null)
    && (record.confirmedAt === null || time(record.confirmedAt))
    && (record.status !== 'active' || record.sourceType !== 'model-proposed')
    && time(record.validFrom) && (record.expiresAt === null || time(record.expiresAt) && record.expiresAt > record.validFrom)
    && ['global', 'work', 'personal'].includes(record.scope) && ['standard', 'sensitive'].includes(record.privacyLevel)
    && time(record.createdAt) && time(record.updatedAt) && record.updatedAt >= record.createdAt
    && (record.status === 'removed' ? time(record.removedAt) && time(record.recycleUntil)
      && record.recycleUntil === record.removedAt + RECYCLE_TTL_MS : record.removedAt === null && record.recycleUntil === null)
    && (record.lastUsedAt === null || time(record.lastUsedAt)) && Number.isSafeInteger(record.useCount) && record.useCount >= 0;
}
const candidateOriginValid = value => closed(value, ['conversationId', 'proposalId', 'messageId'])
  && ['conversationId', 'proposalId', 'messageId'].every(key => id(value[key]));
function receiptValid(value) {
  return closed(value, ['version', 'receiptId', 'commandId', 'ownerId', 'store', 'operation', 'memoryId', 'beforeVersion',
    'afterVersion', 'affectedIds', 'previewHash', 'committedAt', 'undoExpiresAt', 'revertsReceiptId', 'permanent', 'eventId', 'candidateOrigin'])
    && (value.candidateOrigin == null || candidateOriginValid(value.candidateOrigin))
    && value.version === 1 && value.store === 'memory' && OPERATIONS.includes(value.operation)
    && ['receiptId', 'commandId', 'ownerId', 'memoryId', 'eventId'].every(key => id(value[key]))
    && ['beforeVersion', 'afterVersion'].every(key => value[key] === null || Number.isSafeInteger(value[key]) && value[key] > 0)
    && Array.isArray(value.affectedIds) && value.affectedIds.length > 0 && value.affectedIds.length <= 500 && value.affectedIds.every(id)
    && /^[a-f0-9]{64}$/.test(value.previewHash) && time(value.committedAt)
    && (value.undoExpiresAt === null || time(value.undoExpiresAt)) && (value.revertsReceiptId === null || id(value.revertsReceiptId))
    && typeof value.permanent === 'boolean' && value.permanent === (value.operation === 'permanent-remove');
}
function eventTimeContextValid(value, occurredAt) {
  return closed(value, ['timezone', 'utcOffsetMinutes', 'localDayKey'])
    && typeof value.timezone === 'string' && /^[A-Za-z0-9_+./-]{1,80}$/.test(value.timezone)
    && Number.isInteger(value.utcOffsetMinutes) && Math.abs(value.utcOffsetMinutes) <= 14 * 60
    && typeof value.localDayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.localDayKey)
    && time(occurredAt) && validTimeContext({ ...value, occurredAt });
}
function eventValid(value) {
  return closed(value, ['version', 'id', 'kind', 'ownerId', 'receiptId', 'commandId', 'occurredAt', 'memoryId', 'operation',
    'entityVersion', 'affectedIds', 'permanent', 'timezone', 'utcOffsetMinutes', 'localDayKey']) && value.version === 1 && ['memory.changed', 'memory.reverted'].includes(value.kind)
    && ['id', 'ownerId', 'receiptId', 'commandId', 'memoryId'].every(key => id(value[key])) && time(value.occurredAt)
    && eventTimeContextValid({ timezone: value.timezone, utcOffsetMinutes: value.utcOffsetMinutes, localDayKey: value.localDayKey }, value.occurredAt)
    && OPERATIONS.includes(value.operation) && (value.entityVersion === null || Number.isSafeInteger(value.entityVersion) && value.entityVersion > 0)
    && Array.isArray(value.affectedIds) && value.affectedIds.length > 0 && value.affectedIds.length <= 500 && value.affectedIds.every(id)
    && typeof value.permanent === 'boolean' && value.permanent === (value.operation === 'permanent-remove');
}
function reference(record) { return { kind: 'memory', id: record.id, revision: String(record.version) }; }
function sourceRefs(records) {
  return [...new Map(records.filter(Boolean).flatMap(record => [reference(record), ...record.sourceRefs])
    .map(ref => [JSON.stringify(ref), clone(ref)])).values()];
}
function injectible(record, at, scope = 'global') {
  return record.status === 'active' && record.validFrom <= at && (record.expiresAt === null || record.expiresAt > at)
    && (record.scope === 'global' || record.scope === scope) && record.privacyLevel === 'standard';
}
function projection(record, records, at) {
  const conflictIds = records.filter(other => other.id !== record.id && other.status === 'active'
    && topicKey(other) === topicKey(record) && other.validFrom <= at && (other.expiresAt === null || other.expiresAt > at))
    .map(other => other.id).sort();
  return { ...clone(record), source: record.sourceType === 'deterministic' ? 'aggregated'
    : record.sourceType === 'legacy-import' ? record.legacySource : record.sourceType === 'model-proposed' ? 'candidate' : 'user-confirmed',
  contextAllowed: injectible(record, at, record.scope) && conflictIds.length === 0, conflictIds };
}

// All decisions are clockless. The application supplies identity and exact time;
// storage re-evaluates this transition under its write transaction.
function planMutation({ operation, targetId, expectedVersion, input, resolution = 'reject', allocatedId, undoRecord }, records, at) {
  if (!OPERATIONS.includes(operation) || !time(at) || !['reject', 'keep-conflict'].includes(resolution)) return { ok: false, reason: 'memory-mutation-invalid' };
  const before = records.find(record => record.id === targetId) || null;
  if (operation !== 'add' && (!before || before.version !== expectedVersion)) return { ok: false, reason: 'memory-version-conflict' };
  if (operation === 'add' && (targetId !== undefined || expectedVersion !== null || !id(allocatedId))) return { ok: false, reason: 'memory-mutation-invalid' };
  if (operation === 'add' && records.some(record => record.id === allocatedId)) return { ok: false, reason: 'memory-id-conflict' };
  if (['add', 'update'].includes(operation) && !inputValid(input)) return { ok: false, reason: 'memory-input-invalid' };
  if (!['add', 'update'].includes(operation) && input !== undefined) return { ok: false, reason: 'memory-input-invalid' };
  if (before?.status === 'removed' && at >= before.recycleUntil && operation !== 'permanent-remove') return { ok: false, reason: 'memory-recycle-expired' };
  if (before?.version === Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'memory-version-exhausted' };
  let after = before && clone(before);
  if (operation === 'add' || operation === 'update') {
    const status = input.status || 'candidate';
    after = { id: before?.id || allocatedId, version: (before?.version || 0) + 1,
      kind: input.kind, subject: input.subject.trim(), body: input.body.trim(), status, sourceType: input.sourceType,
      legacySource: null, sourceRefs: clone(input.sourceRefs || []), confirmedAt: status === 'active' ? at : null,
      validFrom: input.validFrom ?? at, expiresAt: input.expiresAt ?? null,
      scope: input.scope || 'global', privacyLevel: input.privacyLevel || 'standard',
      createdAt: before?.createdAt ?? at, updatedAt: at, removedAt: null, recycleUntil: null, lastUsedAt: before?.lastUsedAt ?? null, useCount: before?.useCount || 0 };
    const duplicates = records.filter(item => item.id !== after.id && item.status !== 'removed' && topicKey(item) === topicKey(after));
    if (duplicates.length && resolution !== 'keep-conflict') return { ok: false, reason: 'memory-duplicate', duplicateIds: duplicates.map(item => item.id) };
    if (!before && records.length >= MAX_MEMORIES) return { ok: false, reason: 'memory-capacity' };
  } else if (operation === 'permanent-remove') after = null;
  else {
    if (operation === 'undo') {
      if (!recordValid(undoRecord) || undoRecord.id !== before.id) return { ok: false, reason: 'memory-undo-unavailable' };
      after = clone(undoRecord);
    } else if (operation === 'activate') {
      if (!['candidate', 'paused'].includes(before.status)) return { ok: false, reason: 'memory-transition-invalid' };
      after.status = 'active'; after.confirmedAt = at;
      if (after.sourceType === 'model-proposed') after.sourceType = 'user-edit';
    } else if (operation === 'pause') after.status = 'paused';
    else if (operation === 'remove') { after.status = 'removed'; after.removedAt = at; after.recycleUntil = at + RECYCLE_TTL_MS; }
    else if (operation === 'restore') {
      if (before.status !== 'removed') return { ok: false, reason: 'memory-transition-invalid' };
      after.status = 'paused'; after.removedAt = null; after.recycleUntil = null;
    }
    after.version = before.version + 1; after.updatedAt = at;
    after.lastUsedAt = before.lastUsedAt; after.useCount = before.useCount;
  }
  if (after && !recordValid(after)) return { ok: false, reason: 'memory-input-invalid' };
  if (after && before && JSON.stringify({ ...after, version: 0, updatedAt: 0 }) === JSON.stringify({ ...before, version: 0, updatedAt: 0 })) {
    return { ok: false, reason: 'memory-no-op' };
  }
  return { ok: true, before: clone(before), after, affectedIds: [after?.id || before.id],
    invalidatedSourceRefs: sourceRefs([before]), permanent: operation === 'permanent-remove' };
}
// Preview timestamps are not user confirmation. Only transition metadata is
// restamped at commit; explicit validity and the prior undo record stay intact.
function stampCommittedRecord(record, operation, at) {
  const value = clone(record);
  value.updatedAt = at;
  if (operation === 'add') value.createdAt = at;
  if (operation === 'activate' || ['add', 'update'].includes(operation) && value.status === 'active') value.confirmedAt = at;
  if (operation === 'remove') { value.removedAt = at; value.recycleUntil = at + RECYCLE_TTL_MS; }
  if (!recordValid(value)) throw new Error('memory-clock-invalid');
  return value;
}
module.exports = { RECYCLE_TTL_MS, KINDS, STATUSES, SOURCES, OPERATIONS, PREVIEW_TTL_MS, UNDO_TTL_MS, MAX_MEMORIES,
  closed, id, time, inputValid, recordValid, sourceRefsValid, normalizeSubject, topicKey, sourceKey,
  reference, sourceRefs, injectible, projection, planMutation, stampCommittedRecord, candidateOriginValid, receiptValid, eventValid, eventTimeContextValid };
