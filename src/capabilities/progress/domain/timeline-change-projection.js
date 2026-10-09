'use strict';

const { AI_CHANGE_EVENT_KINDS } = require('../../../core/ai-change-event-contract');

function metadata(event, payload) {
  const refs = Array.isArray(payload.entityRefs) ? payload.entityRefs : [];
  return Object.freeze({
    receiptId: typeof payload.receiptId === 'string' ? payload.receiptId : null,
    applyGroupId: typeof payload.applyGroupId === 'string' ? payload.applyGroupId : null,
    revertsReceiptId: typeof payload.revertsReceiptId === 'string' ? payload.revertsReceiptId : null,
    count: Number.isInteger(payload.count) ? payload.count : 1,
    operationIds: Object.freeze(Array.isArray(payload.operationIds) ? payload.operationIds.filter(id => typeof id === 'string').slice(0, 1) : []),
    entityRefs: Object.freeze(refs.filter(ref => ref && ['task', 'inbox', 'routine'].includes(ref.kind)
      && typeof ref.id === 'string').slice(0, 2).map(ref => Object.freeze({ kind: ref.kind, id: ref.id, version: ref.version || null })))
  });
}
function projectProvenance(event, payload) {
  const value = {};
  for (const key of ['schemaVersion', 'receivedAt', 'timezone', 'utcOffsetMinutes', 'localDayKey',
    'actor', 'source', 'correlationId', 'entityVersion', 'visibility', 'redactionState']) value[key] = event[key] ?? null;
  value.change = event.source === 'ai-collaboration' && AI_CHANGE_EVENT_KINDS.includes(event.kind) ? metadata(event, payload) : null;
  return value;
}
function groupChangeMarkers(markers) {
  const groups = new Map(), output = [];
  for (const marker of markers) {
    if (!marker.change?.receiptId || !marker.commandId) { output.push(marker); continue; }
    const key = JSON.stringify([marker.commandId, marker.change.receiptId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(marker);
  }
  for (const group of groups.values()) {
    const summary = group.find(marker => marker.kind.startsWith('ai.change.')) || group[0];
    const privateGroup = group.some(marker => marker.visibility === 'private' || marker.redactionState === 'redacted');
    output.push(Object.freeze({ ...summary,
      visibility: privateGroup ? 'private' : summary.visibility,
      redactionState: group.some(marker => marker.redactionState === 'redacted') ? 'redacted' : summary.redactionState,
      changes: Object.freeze(group.filter(marker => !marker.kind.startsWith('ai.change.'))),
      groupedEventIds: Object.freeze(group.map(marker => marker.eventId)) }));
  }
  return output.sort((a, b) => a.occurredAt - b.occurredAt || String(a.eventId).localeCompare(String(b.eventId)));
}
module.exports = { projectProvenance, groupChangeMarkers };
