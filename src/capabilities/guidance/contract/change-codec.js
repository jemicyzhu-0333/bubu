'use strict';
const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { validateCandidateOperations } = require('../../../core/ai-change-protocol');
const { cursorOffset } = require('../../../core/ai-read-cursor');
function object(validation, keys) {
  const value = validation.requireObject();
  if (value) validation.rejectUnknown(value, keys);
  return value;
}
function identity(validation, value, fields) {
  return Object.fromEntries(fields.map(field => [field, validation.validateId(value[field], field)]));
}
function version(validation, value, field) {
  if (!Number.isSafeInteger(value) || value < 1) validation.fail(`${field} is invalid`);
  return value;
}
const codec = createCapabilityCodec({
  'ai:conversation-context-choices': validation => {
    const value = object(validation, ['conversationId', 'kind', 'query', 'cursor']);
    if (!value) return;
    if (!['task', 'inbox', 'routine', 'memory'].includes(value.kind)) validation.fail('kind is invalid');
    if (value.query !== undefined && (typeof value.query !== 'string' || [...value.query].length > 200)) validation.fail('query is invalid');
    if (cursorOffset(value.cursor) === null) validation.fail('cursor is invalid');
    return { ...identity(validation, value, ['conversationId']), kind: value.kind,
      ...(value.query !== undefined ? { query: value.query } : {}), cursor: value.cursor ?? null };
  },
  'ai:change-preview': validation => {
    const value = object(validation, ['conversationId', 'scopeGrantId', 'proposalId', 'operations', 'changeSetId', 'expectedProposalVersion']);
    if (!value) return;
    const result = identity(validation, value, ['conversationId', 'scopeGrantId', 'proposalId']);
    if (value.operations !== undefined) {
      const parsed = validateCandidateOperations(value.operations);
      if (!parsed.ok) validation.fail('operations are invalid');
      else result.operations = parsed.operations;
    }
    if (value.changeSetId !== undefined) result.changeSetId = validation.validateId(value.changeSetId, 'changeSetId');
    if (value.expectedProposalVersion !== undefined) result.expectedProposalVersion = version(validation, value.expectedProposalVersion, 'expectedProposalVersion');
    return result;
  },
  'ai:change-confirm': validation => {
    const value = object(validation, ['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash']);
    if (!value) return;
    const result = { ...identity(validation, value, ['conversationId', 'changeSetId', 'applyGroupId']),
      proposalVersion: version(validation, value.proposalVersion, 'proposalVersion') };
    for (const field of ['operationsHash', 'previewHash', 'disclosureHash']) {
      if (typeof value[field] !== 'string' || !/^[a-f0-9]{64}$/.test(value[field])) validation.fail(`${field} is invalid`);
      result[field] = value[field];
    }
    return result;
  },
  'ai:change-cancel': validation => {
    const value = object(validation, ['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash']);
    if (!value) return;
    const result = { ...identity(validation, value, ['conversationId', 'changeSetId', 'applyGroupId']),
      proposalVersion: version(validation, value.proposalVersion, 'proposalVersion') };
    for (const field of ['operationsHash', 'previewHash', 'disclosureHash']) {
      if (typeof value[field] !== 'string' || !/^[a-f0-9]{64}$/.test(value[field])) validation.fail(`${field} is invalid`);
      result[field] = value[field];
    }
    return result;
  },
  'ai:change-receipt': validation => {
    const value = object(validation, ['receiptId']);
    return value ? identity(validation, value, ['receiptId']) : undefined;
  },
  'ai:conversation-receipts': validation => {
    const value = object(validation, ['conversationId', 'limit', 'cursor']);
    if (!value) return;
    const limit = value.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) validation.fail('limit is invalid');
    if (cursorOffset(value.cursor) === null) validation.fail('cursor is invalid');
    return { ...identity(validation, value, ['conversationId']), limit, cursor: value.cursor ?? null };
  },
  'ai:change-undo-preview': validation => {
    const value = object(validation, ['conversationId', 'receiptId', 'scopeGrantId']);
    if (!value) return;
    return { ...identity(validation, value, ['conversationId', 'receiptId']),
      ...(value.scopeGrantId !== undefined ? identity(validation, value, ['scopeGrantId']) : {}) };
  }
});
const ipcRoutes = describeRoutes('guidance', codec,
  Object.fromEntries(codec.channels.map(channel => [channel, ['popover']])),
  ['ai:conversation-context-choices', 'ai:change-receipt', 'ai:conversation-receipts']);
module.exports = { ipcRoutes };
