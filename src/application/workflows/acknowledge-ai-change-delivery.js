'use strict';

const ACKNOWLEDGE_AI_CHANGE_DELIVERY_WRITES = Object.freeze(['aiCollaboration']);

// Only this named canonical workflow releases committed outbox identities.
// No business operation is evaluated here, even following a failed commit.
function createAcknowledgeAiChangeDeliveryWorkflow({ unitOfWork, ledger, ownerId } = {}) {
  if (!unitOfWork?.run || !ledger?.acknowledgeEvent || !ledger?.recordDeliveryFailure
      || typeof ownerId !== 'string' || !ownerId) throw new TypeError('delivery-workflow-ports-invalid');
  function update(identity, transition) {
    if (!identity || identity.ownerId !== ownerId) return { ok: false, reason: 'delivery-owner-mismatch' };
    try {
      const result = unitOfWork.run({ writes: ACKNOWLEDGE_AI_CHANGE_DELIVERY_WRITES, context: { durability: 'authoritative' }, transition: state => {
        const outcome = transition(state.aiCollaboration, identity);
        if (!outcome.ok) return { ok: false, reason: outcome.reason };
        state.aiCollaboration = outcome.ledger;
        return { ok: true, changed: outcome.changed !== false };
      } });
      return { ok: result.ok === true, changed: result.committed === true,
        ...(result.ok ? {} : { reason: result.reason || 'timeline-ack-failed' }) };
    } catch (_) { return { ok: false, reason: 'timeline-ack-failed' }; }
  }
  return Object.freeze({
    acknowledge: identity => update(identity, ledger.acknowledgeEvent),
    recordFailure: identity => update(identity, ledger.recordDeliveryFailure)
  });
}
module.exports = { ACKNOWLEDGE_AI_CHANGE_DELIVERY_WRITES, createAcknowledgeAiChangeDeliveryWorkflow };
