'use strict';

const { validateAiChangeEvent } = require('../../core/ai-change-event-contract');
const MAX_DRAIN = 100;
const DEFAULT_DRAIN = 25;

// One bounded post-commit pass. Bootstrap owns scheduling and shutdown. The
// publisher reads only durable canonical outbox entries; it has no business
// executor, network port, transaction callback, timer, or source content.
function createChangeOutboxPublisher({ readSnapshot, ledger, timeline, delivery, ownerId, now } = {}) {
  if (typeof readSnapshot !== 'function' || !ledger?.normalizeLedger || !delivery?.acknowledge
      || typeof ownerId !== 'string' || !ownerId || typeof now !== 'function') throw new TypeError('outbox-publisher-ports-invalid');
  let draining = false;
  function pending() {
    const state = ledger.normalizeLedger(readSnapshot().aiCollaboration);
    if (state.receipts.some(receipt => receipt.ownerId !== ownerId)) throw new TypeError('delivery-owner-mismatch');
    return state.outbox;
  }
  function failure(entry, errorCode) {
    try { delivery.recordFailure?.({ eventId: entry.eventId, ownerId, commandId: entry.commandId,
      now: now(), errorCode }); } catch (_) { /* The event stays pending even when failure bookkeeping fails. */ }
  }
  function drain({ limit = DEFAULT_DRAIN } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DRAIN) return { ok: false, reason: 'drain-limit-invalid' };
    if (draining) return { ok: false, reason: 'drain-in-progress' };
    draining = true;
    let attempted = 0, delivered = 0, reason = null;
    try {
      const queue = pending();
      if (!timeline?.supportsConfirmedChanges || typeof timeline.appendConfirmedEvent !== 'function') {
        return { ok: false, reason: 'timeline-unavailable', attempted, delivered, pending: queue.length, more: queue.length > 0 };
      }
      for (const entry of queue.slice(0, limit)) {
        attempted += 1;
        let event;
        try { event = validateAiChangeEvent(entry.event); }
        catch (_) { reason = 'event-invalid'; failure(entry, reason); break; }
        let result;
        try {
          if (event.redactionState === 'redacted' && typeof timeline.redactReceipt === 'function') {
            const redacted = timeline.redactReceipt(entry.receiptId);
            if (!redacted?.ok) throw new Error('redaction-pending');
          }
          result = timeline.appendConfirmedEvent(event);
        } catch (_) { result = null; }
        if (!result?.ok || (result.inserted !== true && result.verifiedDuplicate !== true)) {
          reason = 'timeline-write-failed'; failure(entry, reason); break;
        }
        let acknowledged;
        try { acknowledged = delivery.acknowledge({ eventId: entry.eventId, ownerId, commandId: entry.commandId }); }
        catch (_) { acknowledged = null; }
        if (!acknowledged?.ok) { reason = 'timeline-ack-failed'; failure(entry, reason); break; }
        delivered += 1;
      }
      const remaining = pending().length;
      return { ok: reason === null, ...(reason ? { reason } : {}), attempted, delivered, pending: remaining, more: remaining > 0 };
    } catch (_) { return { ok: false, reason: 'outbox-read-failed', attempted, delivered, pending: null, more: true }; }
    finally { draining = false; }
  }
  return Object.freeze({ drain });
}
module.exports = { MAX_DRAIN, DEFAULT_DRAIN, createChangeOutboxPublisher };
