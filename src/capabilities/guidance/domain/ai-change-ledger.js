'use strict';

// ARCHITECTURE「事务、投影与 IPC」: this guidance-owned value is committed with
// business changes, never after them. Delivery acknowledgement is a separate
// canonical commit. No clock, IDs, database access, or business mutation here.
const v = require('../contract/ai-change-record-values');
const contract = require('../contract/ai-change-receipt');
const { validateOutboxEntry, makeOutboxEntry, DELIVERY_ERROR_CODES } = require('../contract/ai-change-outbox');
const { fail, identityOf, identityKey, identityValid, validateReceipt } = contract;
const MAX_RECEIPTS = 512;
const MAX_OUTBOX = 2048;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const LEDGER_VERSION = 1;

function createLedger() { return { version: LEDGER_VERSION, nextCommitSequence: 1, receipts: [], outbox: [] }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function failure(ledger, reason) { return { ok: false, reason, code: reason, ledger }; }
function sameOwnerCommand(receipt, value) { return receipt.ownerId === value.ownerId && receipt.commandId === value.commandId; }

function validateLinks(ledger) {
  const receipts = new Map(ledger.receipts.map(receipt => [receipt.receiptId, receipt]));
  for (const receipt of ledger.receipts) {
    if (receipt.revertsReceiptId !== null) {
      const original = receipts.get(receipt.revertsReceiptId);
      if (!original || original.ownerId !== receipt.ownerId || original.conversationId !== receipt.conversationId
        || original.commitSequence >= receipt.commitSequence || original.status !== 'reverted'
        || original.revertedByReceiptId !== receipt.receiptId) fail('receipt-revert-link-invalid');
    }
    if (receipt.revertedByReceiptId !== null) {
      const undo = receipts.get(receipt.revertedByReceiptId);
      if (!undo || undo.revertsReceiptId !== receipt.receiptId) fail('receipt-revert-link-invalid');
    }
  }
  const summaries = new Set();
  for (const entry of ledger.outbox) {
    validateOutboxEntry(entry);
    if (entry.event.kind.startsWith('ai.change.')) {
      if (summaries.has(entry.receiptId)) fail('outbox-summary-duplicate');
      summaries.add(entry.receiptId);
    }
    const receipt = receipts.get(entry.receiptId);
    if (!receipt || !sameOwnerCommand(receipt, entry) || !receipt.eventIds.includes(entry.eventId)
      || entry.event.commandId !== receipt.commandId || entry.event.correlationId !== receipt.changeSetId
      || entry.event.causationId !== receipt.commandId || entry.event.occurredAt !== receipt.committedAt
      || entry.event.payload.applyGroupId !== receipt.applyGroupId
      || entry.event.payload.revertsReceiptId !== receipt.revertsReceiptId) fail('outbox-receipt-link-invalid');
    validateEventResult(entry.event, receipt);
  }
}

function validateEventResult(event, receipt) {
  const summary = event.kind.startsWith('ai.change.');
  if (summary) {
    if (event.taskId !== null || event.payload.count !== receipt.results.length
      || event.kind !== (receipt.revertsReceiptId === null ? 'ai.change.applied' : 'ai.change.reverted')) fail('outbox-summary-invalid');
    return;
  }
  const result = receipt.results.find(item => item.opId === event.payload.operationIds[0]);
  const kinds = result?.type === 'inbox.convert-task' ? ['inbox.resolved', 'task.changed']
    : result?.type === 'inbox.keep' ? ['inbox.resolved']
      : result?.type.startsWith('routine.') ? ['routine.schedule.changed'] : ['task.changed'];
  if (!result || !kinds.includes(event.kind)
    || (event.taskId !== null && !event.payload.entityRefs.some(ref => ref.kind === 'task' && ref.id === event.taskId))
    || event.payload.entityRefs.some(ref => !result.entityRefs.some(entity => entity.kind === ref.kind && entity.id === ref.id)
    || (ref.version !== null && !result.afterVersions.some(after => after.kind === ref.kind && after.id === ref.id && after.fingerprint === ref.version)))
    || (event.entityVersion !== null && !result.afterVersions.some(after => after.fingerprint === event.entityVersion))) fail('outbox-result-invalid');
}

function normalizeLedger(raw) {
  if (!v.jsonValue(raw) || !v.closed(raw, ['version', 'nextCommitSequence', 'receipts', 'outbox']) || raw.version !== LEDGER_VERSION
    || !v.integer(raw.nextCommitSequence, 1) || !v.list(raw.receipts, MAX_RECEIPTS, value => Boolean(validateReceipt(value)))
    || !v.list(raw.outbox, MAX_OUTBOX, () => true)) fail('ledger-invalid');
  const identities = new Set(), receiptIds = new Set(), commandIds = new Set(), eventIds = new Set(), opIds = new Set();
  let lastSequence = 0;
  let ownerId = null;
  for (const receipt of raw.receipts) {
    const key = identityKey(receipt);
    if (identities.has(key) || receiptIds.has(receipt.receiptId) || commandIds.has(receipt.commandId)) fail('receipt-identity-duplicate');
    if (ownerId !== null && ownerId !== receipt.ownerId) fail('receipt-owner-mismatch');
    ownerId = receipt.ownerId;
    if (receipt.commitSequence <= lastSequence || receipt.commitSequence >= raw.nextCommitSequence) fail('receipt-sequence-invalid');
    lastSequence = receipt.commitSequence;
    identities.add(key); receiptIds.add(receipt.receiptId); commandIds.add(receipt.commandId);
    for (const result of receipt.results) {
      const opKey = JSON.stringify([receipt.ownerId, receipt.conversationId, receipt.changeSetId, result.opId]);
      if (opIds.has(opKey)) fail('operation-already-applied');
      opIds.add(opKey);
    }
    for (const eventId of receipt.eventIds) {
      if (eventIds.has(eventId)) fail('event-identity-duplicate');
      eventIds.add(eventId);
    }
  }
  if (!v.unique(raw.outbox, entry => entry.eventId)) fail('outbox-identity-duplicate');
  validateLinks(raw);
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_LEDGER_BYTES) fail('ledger-capacity');
  return clone(raw);
}

function findIn(ledger, identity) {
  if (!identityValid(identity)) fail('receipt-identity-invalid');
  const receipt = ledger.receipts.find(item => identityKey(item, false) === identityKey(identity, false));
  if (!receipt) return null;
  if (receipt.ownerId !== identity.ownerId) fail('receipt-owner-mismatch');
  if (['operationsHash', 'previewHash', 'disclosureHash'].some(key => receipt[key] !== identity[key])) fail('receipt-hash-mismatch');
  return receipt;
}
function findReceipt(raw, identity) { return findIn(normalizeLedger(raw), identity); }

function capacityFor(raw, { receipts = 1, eventCount, receipt, events, now } = {}) {
  const ledger = normalizeLedger(raw);
  if (now !== undefined && !v.timestamp(now)) fail('timestamp-invalid');
  const count = events === undefined ? (eventCount === undefined ? 0 : eventCount) : events.length;
  if (!v.integer(receipts, 0, MAX_RECEIPTS) || !v.integer(count, 0, MAX_OUTBOX)) fail('capacity-request-invalid');
  if (ledger.nextCommitSequence > Number.MAX_SAFE_INTEGER - receipts) return failure(ledger, 'commit-sequence-exhausted');
  if (ledger.receipts.length + receipts > MAX_RECEIPTS) return failure(ledger, 'receipt-capacity');
  if (ledger.outbox.length + count > MAX_OUTBOX) return failure(ledger, 'outbox-capacity');
  if (receipt !== undefined) {
    validateReceipt(receipt);
    if (!Array.isArray(events)) fail('capacity-events-invalid');
    const candidate = { ...ledger, receipts: [...ledger.receipts, receipt], outbox: [...ledger.outbox,
      ...events.map(event => makeOutboxEntry(receipt, event))] };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_LEDGER_BYTES) return failure(ledger, 'ledger-capacity');
  }
  return { ok: true, ledger };
}

function appendReceipt(raw, { receipt, events, now } = {}) {
  const ledger = normalizeLedger(raw);
  validateReceipt(receipt);
  if (!v.timestamp(now)) fail('timestamp-invalid');
  const existing = findIn(ledger, identityOf(receipt));
  if (existing) return { ok: true, ledger, receipt: existing, replayed: true };
  if (now >= receipt.confirmationExpiresAt || now !== receipt.committedAt) return failure(ledger, 'confirmation-expired');
  if (receipt.commitSequence !== ledger.nextCommitSequence) return failure(ledger, 'commit-sequence-conflict');
  if (!v.list(events, 61, () => true, 1) || !v.unique(events, event => event.id)
    || events.length !== receipt.eventIds.length || events.some((event, index) => event.id !== receipt.eventIds[index])) fail('receipt-events-invalid');
  if (events.filter(event => event.kind.startsWith('ai.change.')).length !== 1) fail('outbox-summary-invalid');
  const capacity = capacityFor(ledger, { receipt, events, now });
  if (!capacity.ok) return capacity;
  if (receipt.revertsReceiptId !== null) {
    const original = ledger.receipts.find(item => item.receiptId === receipt.revertsReceiptId);
    if (!original || original.ownerId !== receipt.ownerId || original.conversationId !== receipt.conversationId
      || original.status !== 'applied' || !original.details?.undo || now >= original.details.undo.expiresAt) {
      return failure(ledger, 'receipt-not-reversible');
    }
    original.status = 'reverted';
    original.revertedByReceiptId = receipt.receiptId;
    // Consumed compensation must never be exposed as an available second undo.
    original.details.undo = null;
  }
  ledger.receipts.push(clone(receipt));
  ledger.outbox.push(...events.map(event => makeOutboxEntry(receipt, event)));
  ledger.nextCommitSequence += 1;
  return { ok: true, ledger: normalizeLedger(ledger), receipt: clone(receipt), replayed: false };
}

function deliveryTarget(ledger, { eventId, ownerId, commandId }) {
  if (![eventId, ownerId, commandId].every(v.id)) fail('delivery-identity-invalid');
  const receipt = ledger.receipts.find(item => item.eventIds.includes(eventId));
  if (!receipt) return null;
  if (!sameOwnerCommand(receipt, { ownerId, commandId })) fail('delivery-identity-mismatch');
  return { receipt, entry: ledger.outbox.find(item => item.eventId === eventId) || null };
}
function acknowledgeEvent(raw, identity = {}) {
  const ledger = normalizeLedger(raw);
  const target = deliveryTarget(ledger, identity);
  if (!target) return failure(ledger, 'outbox-event-not-found');
  if (!target.entry) return { ok: true, ledger, changed: false };
  ledger.outbox = ledger.outbox.filter(entry => entry.eventId !== identity.eventId);
  return { ok: true, ledger: normalizeLedger(ledger), changed: true };
}
function recordDeliveryFailure(raw, { now, errorCode, ...identity } = {}) {
  const ledger = normalizeLedger(raw);
  if (!v.timestamp(now) || !DELIVERY_ERROR_CODES.includes(errorCode)) fail('delivery-failure-invalid');
  const target = deliveryTarget(ledger, identity);
  if (!target?.entry) return failure(ledger, 'outbox-event-not-found');
  if (now < target.receipt.committedAt || target.entry.attempts === Number.MAX_SAFE_INTEGER) fail('delivery-attempt-invalid');
  target.entry.attempts += 1;
  target.entry.lastAttemptAt = now;
  target.entry.lastErrorCode = errorCode;
  return { ok: true, ledger: normalizeLedger(ledger) };
}
function markReverted(raw, { receiptId, revertedByReceiptId } = {}) {
  const ledger = normalizeLedger(raw);
  if (!v.id(receiptId) || !v.id(revertedByReceiptId)) fail('receipt-identity-invalid');
  const original = ledger.receipts.find(item => item.receiptId === receiptId);
  if (!original || original.revertedByReceiptId !== revertedByReceiptId) return failure(ledger, 'receipt-revert-link-invalid');
  return { ok: true, ledger, receipt: original, changed: false };
}

// Keep body-free identities indefinitely in v1. Expiring dedupe records would
// permit the same opId under a new proposalVersion. Capacity fails closed instead.
function redactWhere(raw, predicate) {
  const ledger = normalizeLedger(raw);
  let changed = false;
  for (const receipt of ledger.receipts) {
    if (receipt.details === null || !predicate(receipt)) continue;
    receipt.details = null; receipt.detailsRedacted = true; changed = true;
    for (const entry of ledger.outbox) {
      if (entry.receiptId === receipt.receiptId) {
        entry.event.visibility = 'private'; entry.event.redactionState = 'redacted';
      }
    }
  }
  return { ok: true, ledger: normalizeLedger(ledger), changed };
}
function pruneDetails(raw, { now } = {}) {
  if (!v.timestamp(now)) fail('timestamp-invalid');
  return redactWhere(raw, receipt => receipt.details.expiresAt <= now);
}
function redactDetails(raw, { ownerId, receiptIds } = {}) {
  if (!v.id(ownerId) || !v.list(receiptIds, MAX_RECEIPTS, v.id) || !v.unique(receiptIds)) fail('redaction-scope-invalid');
  const ledger = normalizeLedger(raw);
  if (receiptIds.some(id => !ledger.receipts.some(receipt => receipt.receiptId === id && receipt.ownerId === ownerId))) fail('redaction-owner-mismatch');
  return redactWhere(ledger, receipt => receiptIds.includes(receipt.receiptId));
}
module.exports = { LEDGER_VERSION, MAX_RECEIPTS, MAX_OUTBOX, MAX_LEDGER_BYTES, DELIVERY_ERROR_CODES,
  MAX_RECEIPT_BYTES: contract.MAX_RECEIPT_BYTES, DETAILS_TTL_MS: contract.DETAILS_TTL_MS, DEDUPE_TTL_MS: contract.DEDUPE_TTL_MS,
  CONFIRMATION_TTL_MS: contract.CONFIRMATION_TTL_MS, createLedger, normalizeLedger, findReceipt,
  capacityFor, appendReceipt, acknowledgeEvent, recordDeliveryFailure, markReverted, pruneDetails, redactDetails };
