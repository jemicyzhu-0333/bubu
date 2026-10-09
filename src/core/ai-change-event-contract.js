'use strict';

// Closed, content-free events for a confirmed receipt. Detail lives behind the
// receipt identity; timeline rows never contain task, inbox or conversation text.
const AI_CHANGE_EVENT_KINDS = Object.freeze(['task.changed', 'inbox.resolved',
  'routine.schedule.changed', 'ai.change.applied', 'ai.change.reverted']);
const EVENT_KEYS = Object.freeze(['id', 'schemaVersion', 'occurredAt', 'receivedAt', 'timezone',
  'utcOffsetMinutes', 'localDayKey', 'dayKey', 'kind', 'actor', 'source', 'correlationId',
  'causationId', 'commandId', 'entityVersion', 'visibility', 'redactionState',
  'taskId', 'sessionId', 'durationMs', 'payload']);
const PAYLOAD_KEYS = Object.freeze(['receiptId', 'applyGroupId', 'operationIds', 'entityRefs', 'count', 'revertsReceiptId']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/.test(value);
const hash = value => value === null || typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
function closed(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}
function validTimeContext(event) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: event.timezone,
      timeZoneName: 'longOffset' }).formatToParts(event.occurredAt);
    const offsetName = parts.find(part => part.type === 'timeZoneName')?.value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetName);
    const offset = offsetName === 'GMT' ? 0 : match
      ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : NaN;
    if (offset !== event.utcOffsetMinutes) return false;
    const local = new Date(event.occurredAt + event.utcOffsetMinutes * 60000);
    return Number.isFinite(local.getTime()) && local.toISOString().slice(0, 10) === event.localDayKey;
  } catch (_) { return false; }
}
function validateAiChangeEvent(event) {
  if (!closed(event, EVENT_KEYS) || event.schemaVersion !== 1 || !id(event.id)
      || !AI_CHANGE_EVENT_KINDS.includes(event.kind) || !time(event.occurredAt) || !time(event.receivedAt)
      || typeof event.timezone !== 'string' || !/^[A-Za-z0-9_+./-]{1,80}$/.test(event.timezone)
      || !Number.isInteger(event.utcOffsetMinutes) || Math.abs(event.utcOffsetMinutes) > 14 * 60
      || !day(event.dayKey) || event.dayKey !== event.localDayKey || !validTimeContext(event) || event.actor !== 'user'
      || event.source !== 'ai-collaboration' || !id(event.correlationId) || !id(event.causationId)
      || !id(event.commandId) || event.causationId !== event.commandId || !hash(event.entityVersion)
      || !['normal', 'private'].includes(event.visibility) || !['none', 'redacted'].includes(event.redactionState)
      || (event.taskId !== null && !id(event.taskId)) || event.sessionId !== null || event.durationMs !== null) {
    throw new TypeError('ai-change-event-invalid');
  }
  const value = event.payload;
  if (!closed(value, PAYLOAD_KEYS) || !id(value.receiptId) || !id(value.applyGroupId)
      || !Array.isArray(value.operationIds) || value.operationIds.length > 1 || !value.operationIds.every(id)
      || !Array.isArray(value.entityRefs) || value.entityRefs.length > 2
      || !value.entityRefs.every(ref => closed(ref, ['kind', 'id', 'version'])
        && ['task', 'inbox', 'routine'].includes(ref.kind) && id(ref.id) && hash(ref.version))
      || !Number.isInteger(value.count) || value.count < 1 || value.count > 20
      || (value.revertsReceiptId !== null && !id(value.revertsReceiptId))
      || Buffer.byteLength(JSON.stringify(value), 'utf8') > 2048) throw new TypeError('ai-change-event-payload-invalid');
  const summary = event.kind === 'ai.change.applied' || event.kind === 'ai.change.reverted';
  if ((summary && (value.operationIds.length || value.entityRefs.length || event.entityVersion !== null))
      || (!summary && (value.operationIds.length !== 1 || value.count !== 1))) {
    throw new TypeError('ai-change-event-identity-invalid');
  }
  return Object.freeze({ ...event, payload: Object.freeze({ ...value,
    operationIds: Object.freeze([...value.operationIds]), entityRefs: Object.freeze(value.entityRefs.map(ref => Object.freeze({ ...ref }))) }) });
}
module.exports = { AI_CHANGE_EVENT_KINDS, validateAiChangeEvent, validTimeContext };
