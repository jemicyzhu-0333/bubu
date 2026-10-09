'use strict';

const v = require('./ai-change-record-values');
const { fail } = require('./ai-change-receipt');
const { validateAiChangeEvent } = require('../../../core/ai-change-event-contract');
const DELIVERY_ERROR_CODES = Object.freeze(['timeline-unavailable', 'timeline-write-failed',
  'timeline-ack-failed', 'event-invalid', 'delivery-failed']);

function validateOutboxEntry(value) {
  if (!v.jsonValue(value) || !v.closed(value, ['eventId', 'receiptId', 'ownerId', 'commandId', 'event', 'attempts', 'lastAttemptAt', 'lastErrorCode'])
    || !['eventId', 'receiptId', 'ownerId', 'commandId'].every(key => v.id(value[key]))
    || !v.integer(value.attempts) || (value.attempts === 0
      ? value.lastAttemptAt !== null || value.lastErrorCode !== null
      : !v.timestamp(value.lastAttemptAt) || !DELIVERY_ERROR_CODES.includes(value.lastErrorCode))) fail('outbox-entry-invalid');
  validateAiChangeEvent(value.event);
  if (value.eventId !== value.event.id || value.commandId !== value.event.commandId
    || value.receiptId !== value.event.payload.receiptId
    || (value.lastAttemptAt !== null && value.lastAttemptAt < value.event.occurredAt)) fail('outbox-entry-identity-invalid');
  return value;
}
function makeOutboxEntry(receipt, event) {
  if (!v.jsonValue(event)) fail('outbox-event-invalid');
  return validateOutboxEntry({ eventId: event.id, receiptId: receipt.receiptId, ownerId: receipt.ownerId,
    commandId: receipt.commandId, event: JSON.parse(JSON.stringify(validateAiChangeEvent(event))),
    attempts: 0, lastAttemptAt: null, lastErrorCode: null });
}
module.exports = { DELIVERY_ERROR_CODES, validateOutboxEntry, makeOutboxEntry };
