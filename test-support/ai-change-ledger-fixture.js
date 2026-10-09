'use strict';
const { aiChangeLedger: ledger } = require('../src/capabilities/guidance');
const NOW = 1791111600000;
const HASH = 'a'.repeat(64);
const AFTER_HASH = 'b'.repeat(64);
function receiptFixture(number = 1, options = {}) {
  const receipt = {
    version: 1, receiptId: `receipt-${number}`, commandId: `command-${number}`, ownerId: 'owner-1',
    conversationId: 'conversation-1', changeSetId: `change-${number}`, proposalVersion: 1, applyGroupId: 'group-1',
    operationsHash: HASH, previewHash: HASH, disclosureHash: HASH, commitSequence: number, appliedRevision: number,
    committedAt: NOW, confirmationExpiresAt: NOW + ledger.CONFIRMATION_TTL_MS,
    dedupeUntil: NOW + ledger.DEDUPE_TTL_MS, status: 'applied', revertsReceiptId: null, revertedByReceiptId: null,
    results: [{ opId: `op-${number}`, type: 'task.update', entityRefs: [{ kind: 'task', id: 'task-1' }],
      beforeVersions: [{ kind: 'task', id: 'task-1', fingerprint: HASH }],
      afterVersions: [{ kind: 'task', id: 'task-1', fingerprint: AFTER_HASH }], changed: true }],
    details: { expiresAt: NOW + ledger.DETAILS_TTL_MS,
      diff: [{ opId: `op-${number}`, type: 'task.update', entityRef: { kind: 'task', id: 'task-1' },
        fields: [{ field: 'title', before: 'Old title', after: 'New title' }], derivedChanges: [],
        reversibility: { status: 'available', reason: null } }], evidenceRefs: [],
      undo: { expiresAt: NOW + ledger.DETAILS_TTL_MS,
        operations: [{ type: 'task.restore', entityId: 'task-1', scope: 'current', fields: [{ field: 'title', value: 'Old title' }], steps: [], seriesFields: [] }],
        expectedPostVersions: [{ kind: 'task', id: 'task-1', fingerprint: AFTER_HASH }] } },
    detailsRedacted: false, eventIds: [`event-${number}`], ...options
  };
  return receipt;
}
function summaryFixture(receipt, patch = {}) {
  return { id: receipt.eventIds[0], schemaVersion: 1, occurredAt: receipt.committedAt, receivedAt: receipt.committedAt,
    timezone: 'Etc/UTC', utcOffsetMinutes: 0, localDayKey: '2026-10-04', dayKey: '2026-10-04',
    kind: receipt.revertsReceiptId ? 'ai.change.reverted' : 'ai.change.applied', actor: 'user', source: 'ai-collaboration',
    correlationId: receipt.changeSetId, causationId: receipt.commandId, commandId: receipt.commandId, entityVersion: null,
    visibility: 'normal', redactionState: 'none', taskId: null, sessionId: null, durationMs: null,
    payload: { receiptId: receipt.receiptId, applyGroupId: receipt.applyGroupId, operationIds: [], entityRefs: [],
      count: receipt.results.length, revertsReceiptId: receipt.revertsReceiptId }, ...patch };
}
function appendFixture(state = ledger.createLedger(), number = 1, options = {}) {
  const receipt = receiptFixture(number, options);
  return ledger.appendReceipt(state, { receipt, events: [summaryFixture(receipt)], now: receipt.committedAt });
}
function identityOf(receipt) {
  return Object.fromEntries(['ownerId', 'conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
    'operationsHash', 'previewHash', 'disclosureHash'].map(key => [key, receipt[key]]));
}
module.exports = { NOW, HASH, AFTER_HASH, receiptFixture, summaryFixture, appendFixture, identityOf };
