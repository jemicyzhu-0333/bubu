'use strict';
const { guidance, progress } = require('../capabilities');
const { createChangeSetService } = require('../application/ai/change-set-service');
const { createConversationChanges } = require('../application/ai/conversation-changes');
const { createRedactAiChangeDetailsWorkflow } = require('../application/workflows/redact-ai-change-details');
const { createPruneAiChangeDetailsWorkflow } = require('../application/workflows/prune-ai-change-details');
const { createChangeOutboxPublisher } = require('../application/ai/change-outbox-publisher');
const { createAcknowledgeAiChangeDeliveryWorkflow } = require('../application/workflows/acknowledge-ai-change-delivery');

// Config changes and their receipt/outbox share one existing state transaction.
// Timeline delivery follows that transaction and cannot re-execute business work.
function createAiConfirmedChanges({ storage, sessions, grants, reads, getProvider, readSnapshot, factStore,
  now, idFactory, lifecycle, changePorts, durability } = {}) {
  const unavailable = () => ({ ok: false, reason: 'change-storage-unavailable' });
  if (!changePorts?.unitOfWork || typeof changePorts.readRevision !== 'function') {
    return Object.freeze({ preview: unavailable, confirm: unavailable, cancel: unavailable,
      getReceipt: unavailable, listReceipts: unavailable, previewUndo: unavailable, redactConversation: () => ({ ok: true, changed: false }), invalidate: () => {} });
  }
  const ledger = guidance.aiChangeLedger;
  const ownerId = storage.ownerId;
  const delivery = createAcknowledgeAiChangeDeliveryWorkflow({ unitOfWork: changePorts.unitOfWork, ledger, ownerId });
  const publisher = createChangeOutboxPublisher({ readSnapshot, ledger,
    timeline: factStore?.timeline, delivery, ownerId, now });
  const privacy = createRedactAiChangeDetailsWorkflow({ unitOfWork: changePorts.unitOfWork, ownerId });
  const retention = createPruneAiChangeDetailsWorkflow({ unitOfWork: changePorts.unitOfWork, ledger, ownerId, now });
  let disposed = false;
  function maintain() {
    const pruned = retention.execute();
    // Retry redaction of already-delivered metadata using durable receipt flags.
    // Failure does not restore detail or forget the pending privacy requirement.
    if (factStore?.timeline?.redactReceipt) {
      for (const receipt of readSnapshot().aiCollaboration.receipts) {
        if (receipt.ownerId === ownerId && receipt.detailsRedacted) {
          try { factStore.timeline.redactReceipt(receipt.receiptId); } catch (_) {}
        }
      }
    }
    return pruned;
  }
  function drain() {
    if (disposed) return;
    if (durability && !durability.verify().ok) return { ok: false, reason: 'change-durability-uncertain', delivered: 0 };
    const maintenance = maintain();
    const result = publisher.drain({ limit: 25 });
    if (maintenance.changed || result.delivered > 0) {
      try { changePorts.publishTimeline?.(); } catch (_) { /* Delivery is already committed. */ }
    }
    return result;
  }
  const changes = createConversationChanges({ sessions, grants, reads, getProvider, readSnapshot, ownerId,
    identityAvailable: storage.identityAvailable === true, now, idFactory, durability,
    createService: validateAuthorization => createChangeSetService({ ...changePorts,
      ownerId, identityAvailable: storage.identityAvailable === true, readSnapshot, now, idFactory, ledger, durability,
      getTimezone: changePorts.getTimezone || (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      buildEvents: progress.aiChangeEvents.buildEvents, validateAuthorization,
      publish: fact => { try { changePorts.publish?.(fact); } finally { drain(); } } }) });
  if (lifecycle) {
    lifecycle.register('ai:change-delivery', () => { disposed = true; changes.invalidate(); });
    lifecycle.interval('timer:ai-change-delivery', drain, 30000);
    lifecycle.timeout('timer:ai-change-startup-delivery', drain, 0);
  }
  return Object.freeze({ ...changes, drain,
    redactConversation: payload => {
      const result = privacy.execute(payload);
      if (result.ok && durability && !durability.verify().ok) return { ok: false, reason: 'receipt-privacy-pending',
        receiptDetailsRedacted: result.changed, durability: 'unconfirmed' };
      return result;
    },
    confirm: payload => { const result = changes.confirm(payload); if (result.ok) drain(); return result; },
    getReceipt: payload => { maintain(); return changes.getReceipt(payload); },
    listReceipts: payload => { maintain(); return changes.listReceipts(payload); } });
}
module.exports = { createAiConfirmedChanges };
