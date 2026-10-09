'use strict';

const { createHash } = require('node:crypto');
const { validateAiChangeEvent } = require('../../../core/ai-change-event-contract');

// ARCHITECTURE「事务、投影与 IPC」: a deterministic receipt projection, not a
// second writer. Never copy a proposed operation, diff, title or source body.
function eventId(receipt, operationId, kind) {
  const identity = JSON.stringify([receipt.commandId, receipt.receiptId, operationId, kind]);
  return `ai-event-${createHash('sha256').update(identity).digest('hex')}`;
}
function kindsFor(type) {
  if (type === 'inbox.convert-task') return ['inbox.resolved', 'task.changed'];
  if (type === 'inbox.keep') return ['inbox.resolved'];
  if (['routine.schedule', 'routine.restore-schedule'].includes(type)) return ['routine.schedule.changed'];
  if (['task.create', 'task.update', 'task.steps', 'task.restore'].includes(type)) return ['task.changed'];
  throw new TypeError('ai-change-operation-invalid');
}
function references(result, kind) {
  const allowed = kind === 'inbox.resolved' ? ['inbox', 'task'] : [kind.startsWith('routine.') ? 'routine' : 'task'];
  return result.entityRefs.filter(ref => allowed.includes(ref.kind)).slice(0, 2).map(ref => ({
    kind: ref.kind, id: ref.id,
    version: result.afterVersions.find(version => version.kind === ref.kind && version.id === ref.id)?.fingerprint || null
  }));
}
function buildEvents({ receipt, changeSet, occurredAt, timezone, utcOffsetMinutes, localDayKey } = {}) {
  if (!receipt || occurredAt !== receipt.committedAt || !Array.isArray(receipt.results)
      || receipt.results.length < 1 || receipt.results.length > 20
      || (changeSet && changeSet.changeSetId !== receipt.changeSetId)) throw new TypeError('ai-change-receipt-invalid');
  const base = {
    schemaVersion: 1, occurredAt, receivedAt: occurredAt, timezone, utcOffsetMinutes,
    localDayKey, dayKey: localDayKey, actor: 'user', source: 'ai-collaboration',
    correlationId: receipt.changeSetId, causationId: receipt.commandId, commandId: receipt.commandId,
    visibility: receipt.detailsRedacted ? 'private' : 'normal',
    redactionState: receipt.detailsRedacted ? 'redacted' : 'none', sessionId: null, durationMs: null
  };
  const payload = { receiptId: receipt.receiptId, applyGroupId: receipt.applyGroupId,
    revertsReceiptId: receipt.revertsReceiptId || null };
  const events = [];
  for (const result of receipt.results) {
    if (!result.changed) continue;
    for (const kind of kindsFor(result.type)) {
      const refs = references(result, kind);
      if (!refs.length) throw new TypeError('ai-change-entity-invalid');
      const primary = refs.find(ref => ref.kind === (kind === 'inbox.resolved' ? 'inbox'
        : kind.startsWith('routine.') ? 'routine' : 'task'));
      if (!primary) throw new TypeError('ai-change-entity-invalid');
      events.push(validateAiChangeEvent({ ...base, id: eventId(receipt, result.opId, kind), kind,
        entityVersion: primary.version, taskId: refs.find(ref => ref.kind === 'task')?.id || null,
        payload: { ...payload, operationIds: [result.opId], entityRefs: refs, count: 1 } }));
    }
  }
  const kind = receipt.revertsReceiptId ? 'ai.change.reverted' : 'ai.change.applied';
  events.push(validateAiChangeEvent({ ...base, id: eventId(receipt, null, kind), kind,
    entityVersion: null, taskId: null,
    payload: { ...payload, operationIds: [], entityRefs: [], count: receipt.results.length } }));
  return Object.freeze(events);
}
module.exports = { buildEvents };
