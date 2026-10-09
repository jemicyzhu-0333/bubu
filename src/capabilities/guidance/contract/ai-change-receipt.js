'use strict';

const v = require('./ai-change-record-values');
const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const MAX_RECEIPT_BYTES = 256 * 1024;
const RECEIPT_KEYS = Object.freeze(['version', 'receiptId', 'commandId', 'ownerId', 'conversationId',
  'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash',
  'commitSequence', 'appliedRevision', 'committedAt', 'confirmationExpiresAt', 'dedupeUntil', 'status',
  'revertsReceiptId', 'revertedByReceiptId', 'results', 'details', 'detailsRedacted', 'eventIds']);
const IDENTITY_KEYS = Object.freeze(['ownerId', 'conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
  'operationsHash', 'previewHash', 'disclosureHash']);
const REASONS = Object.freeze(['creation-not-reversible', 'inbox-consumption-not-reversible', 'no-change', 'compensation-not-reversible']);

function fail(code) {
  const error = new TypeError(`AI change ledger failed validation: ${code}`);
  error.code = code;
  throw error;
}
function identityValid(value) {
  return v.closed(value, IDENTITY_KEYS) && ['ownerId', 'conversationId', 'changeSetId', 'applyGroupId'].every(key => v.id(value[key]))
    && v.integer(value.proposalVersion, 1) && ['operationsHash', 'previewHash', 'disclosureHash'].every(key => v.hash(value[key]));
}
function identityOf(receipt) { return Object.fromEntries(IDENTITY_KEYS.map(key => [key, receipt[key]])); }
function identityKey(receipt, owner = true) {
  return JSON.stringify([...(owner ? [receipt.ownerId] : []), receipt.conversationId,
    receipt.changeSetId, receipt.proposalVersion, receipt.applyGroupId]);
}
function resultValid(value) {
  return v.closed(value, ['opId', 'type', 'entityRefs', 'beforeVersions', 'afterVersions', 'changed'])
    && v.id(value.opId) && v.OPERATION_TYPES.includes(value.type) && typeof value.changed === 'boolean'
    && v.list(value.entityRefs, 3, v.entityRef, 1) && v.unique(value.entityRefs, ref => `${ref.kind}:${ref.id}`)
    && v.versions(value.beforeVersions) && v.versions(value.afterVersions)
    && [...value.beforeVersions, ...value.afterVersions].every(ref => value.entityRefs.some(entity => entity.kind === ref.kind && entity.id === ref.id));
}
function diffValid(value) {
  return v.closed(value, ['opId', 'type', 'entityRef', 'fields', 'derivedChanges', 'reversibility'])
    && v.id(value.opId) && v.OPERATION_TYPES.includes(value.type) && v.entityRef(value.entityRef)
    && v.fieldChanges(value.fields) && v.fieldChanges(value.derivedChanges)
    && v.unique([...value.fields, ...value.derivedChanges], field => field.field)
    && v.closed(value.reversibility, ['status', 'reason'])
    && (value.reversibility.status === 'available' ? value.reversibility.reason === null
      : value.reversibility.status === 'unavailable' && REASONS.includes(value.reversibility.reason));
}
function undoValid(value, details, receipt) {
  if (value === null) return true;
  return v.closed(value, ['expiresAt', 'operations', 'expectedPostVersions']) && v.timestamp(value.expiresAt)
    && value.expiresAt >= receipt.committedAt && value.expiresAt <= details.expiresAt
    && v.list(value.operations, 20, v.undoOperation, 1) && v.versions(value.expectedPostVersions)
    && value.operations.every(op => value.expectedPostVersions.some(ref => ref.id === op.entityId
      && ref.kind === (op.type === 'task.restore' ? 'task' : 'routine')))
    && value.expectedPostVersions.every(ref => receipt.results.some(result => result.afterVersions.some(after =>
      after.kind === ref.kind && after.id === ref.id && after.fingerprint === ref.fingerprint)));
}
function detailsValid(value, receipt) {
  if (value === null) return receipt.detailsRedacted;
  return !receipt.detailsRedacted && v.closed(value, ['expiresAt', 'diff', 'evidenceRefs', 'undo'])
    && v.timestamp(value.expiresAt) && value.expiresAt >= receipt.committedAt
    && value.expiresAt <= receipt.committedAt + DETAILS_TTL_MS && value.expiresAt <= receipt.dedupeUntil
    && v.list(value.diff, 60, diffValid) && v.unique(value.diff, row => `${row.opId}:${row.entityRef.kind}:${row.entityRef.id}`)
    && value.diff.every(row => receipt.results.some(result => result.opId === row.opId && result.type === row.type
      && result.entityRefs.some(ref => ref.kind === row.entityRef.kind && ref.id === row.entityRef.id)))
    && v.evidenceRefs(value.evidenceRefs) && undoValid(value.undo, value, receipt);
}
function validateReceipt(receipt) {
  if (!v.jsonValue(receipt) || !v.closed(receipt, RECEIPT_KEYS) || receipt.version !== 1 || !identityValid(identityOf(receipt))
    || !v.id(receipt.receiptId) || !v.id(receipt.commandId) || !v.integer(receipt.commitSequence, 1)
    || !v.integer(receipt.appliedRevision, 1) || !v.timestamp(receipt.committedAt)
    || !v.timestamp(receipt.confirmationExpiresAt) || receipt.confirmationExpiresAt <= receipt.committedAt
    || receipt.confirmationExpiresAt > receipt.committedAt + CONFIRMATION_TTL_MS
    || !v.timestamp(receipt.dedupeUntil) || receipt.dedupeUntil < receipt.confirmationExpiresAt
    || receipt.dedupeUntil < receipt.committedAt + DEDUPE_TTL_MS
    || !['applied', 'reverted'].includes(receipt.status)
    || !(receipt.revertsReceiptId === null || v.id(receipt.revertsReceiptId))
    || (receipt.status === 'applied' ? receipt.revertedByReceiptId !== null : !v.id(receipt.revertedByReceiptId))
    || receipt.receiptId === receipt.revertsReceiptId || receipt.receiptId === receipt.revertedByReceiptId
    || !v.list(receipt.results, 20, resultValid, 1) || !v.unique(receipt.results, result => result.opId)
    || typeof receipt.detailsRedacted !== 'boolean' || !detailsValid(receipt.details, receipt)
    || !v.list(receipt.eventIds, 61, v.id, 1) || !v.unique(receipt.eventIds)) fail('receipt-invalid');
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > MAX_RECEIPT_BYTES) fail('receipt-capacity');
  return receipt;
}
module.exports = { DETAILS_TTL_MS, DEDUPE_TTL_MS, CONFIRMATION_TTL_MS, MAX_RECEIPT_BYTES,
  IDENTITY_KEYS, fail, identityValid, identityOf, identityKey, validateReceipt };
