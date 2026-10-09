'use strict';
const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const memory = require('../../../core/memory-protocol');

function object(validation, keys, value = validation.payload) {
  if (!memory.closed(value, keys) || Reflect.ownKeys(value).some(key => typeof key !== 'string'
    || !('value' in Object.getOwnPropertyDescriptor(value, key)))) {
    validation.fail('payload must contain only declared plain data fields'); return null;
  }
  return value;
}
function identity(validation, value, field) {
  if (!memory.id(value)) validation.fail(`${field} is invalid`);
  return value;
}
function version(validation, value, nullable = false) {
  if (!(nullable && value === null) && (!Number.isSafeInteger(value) || value < 1)) validation.fail('expectedVersion is invalid');
  return value;
}
function input(validation, value) {
  const data = object(validation, ['kind', 'subject', 'body', 'status', 'validFrom', 'expiresAt', 'scope', 'privacyLevel'], value);
  if (!data) return;
  // Origin and source references are always assigned by the trusted application.
  // The domain grammar is reused with a fixed validation-only manual origin.
  if (!memory.inputValid({ ...data, sourceType: 'user-statement' })) validation.fail('input is invalid');
  return { ...data };
}
const codec = createCapabilityCodec({
  'memory:list': validation => {
    const value = object(validation, ['status', 'limit', 'cursor'], validation.payload ?? {});
    if (!value) return;
    if (value.status !== undefined && !memory.STATUSES.includes(value.status)) validation.fail('status is invalid');
    if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100)) validation.fail('limit is invalid');
    if (value.cursor !== undefined && value.cursor !== null) identity(validation, value.cursor, 'cursor');
    return { ...value };
  },
  'memory:change-preview': validation => {
    const value = object(validation, ['operation', 'targetId', 'expectedVersion', 'input', 'resolution']);
    if (!value) return;
    if (!['add', 'update', 'activate', 'pause', 'remove', 'restore', 'permanent-remove'].includes(value.operation)) validation.fail('operation is invalid');
    const adding = value.operation === 'add';
    if (adding && value.targetId !== undefined) validation.fail('add cannot target an existing ID');
    if (adding && value.expectedVersion !== undefined && value.expectedVersion !== null) validation.fail('add expectedVersion must be null');
    const result = { operation: value.operation, expectedVersion: adding ? null : version(validation, value.expectedVersion) };
    if (!adding) result.targetId = identity(validation, value.targetId, 'targetId');
    if (['add', 'update'].includes(value.operation)) result.input = input(validation, value.input);
    else if (value.input !== undefined) validation.fail('this operation does not accept input');
    if (value.resolution !== undefined) {
      if (!['reject', 'keep-conflict'].includes(value.resolution)) validation.fail('resolution is invalid');
      result.resolution = value.resolution;
    }
    return result;
  },
  'memory:change-confirm': validation => {
    const value = object(validation, ['previewId', 'previewHash', 'expectedVersion', 'permanentAcknowledged']);
    if (!value) return;
    if (typeof value.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.previewHash)) validation.fail('previewHash is invalid');
    if (value.permanentAcknowledged !== undefined && typeof value.permanentAcknowledged !== 'boolean') validation.fail('permanentAcknowledged is invalid');
    return { previewId: identity(validation, value.previewId, 'previewId'), previewHash: value.previewHash,
      expectedVersion: version(validation, value.expectedVersion, true),
      ...(value.permanentAcknowledged !== undefined ? { permanentAcknowledged: value.permanentAcknowledged } : {}) };
  },
  'memory:undo-preview': validation => {
    const value = object(validation, ['receiptId']);
    return value ? { receiptId: identity(validation, value.receiptId, 'receiptId') } : undefined;
  },
  'memory:receipt': validation => {
    const value = object(validation, ['receiptId']);
    return value ? { receiptId: identity(validation, value.receiptId, 'receiptId') } : undefined;
  },
  'memory:change-cancel': validation => {
    const value = object(validation, ['previewId']);
    return value ? { previewId: identity(validation, value.previewId, 'previewId') } : undefined;
  },
  'memory:proposal-preview': validation => {
    const value = object(validation, ['conversationId', 'proposalId', 'input', 'replacePreviewId']);
    if (!value) return;
    const result = { conversationId: identity(validation, value.conversationId, 'conversationId'),
      proposalId: identity(validation, value.proposalId, 'proposalId') };
    if (value.input !== undefined) {
      const editable = object(validation, ['kind', 'subject', 'body', 'scope', 'expiresAt', 'privacyLevel'], value.input);
      if (!editable || !['kind', 'subject', 'body', 'scope', 'expiresAt'].every(key => Object.hasOwn(editable, key))) validation.fail('candidate input is incomplete');
      else result.input = input(validation, editable);
    }
    if (value.replacePreviewId !== undefined) result.replacePreviewId = identity(validation, value.replacePreviewId, 'replacePreviewId');
    return result;
  }
});
const ipcRoutes = describeRoutes('guidance', codec, Object.fromEntries(codec.channels.map(channel => [channel, ['popover']])),
  ['memory:list', 'memory:receipt']);
module.exports = { ipcRoutes };
