'use strict';
const PRUNE_AI_CHANGE_DETAILS_WRITES = Object.freeze(['aiCollaboration']);
function createPruneAiChangeDetailsWorkflow({ unitOfWork, ledger, ownerId, now } = {}) {
  if (!unitOfWork?.run || !ledger?.pruneDetails || typeof now !== 'function') throw new TypeError('receipt-retention-ports-invalid');
  function execute() {
    try {
      const at = now();
      const result = unitOfWork.run({ writes: PRUNE_AI_CHANGE_DETAILS_WRITES, context: { now: at, durability: 'authoritative' }, transition: state => {
        if (state.aiCollaboration.receipts.some(receipt => receipt.ownerId !== ownerId)) return { ok: false, reason: 'change-profile-mismatch' };
        const pruned = ledger.pruneDetails(state.aiCollaboration, { now: at });
        if (!pruned.ok) return { ok: false, reason: pruned.reason || 'receipt-retention-failed' };
        state.aiCollaboration = pruned.ledger;
        return { ok: true };
      } });
      return { ok: result.ok === true, changed: result.committed === true,
        ...(result.ok ? {} : { reason: result.reason || 'receipt-retention-failed' }) };
    } catch (_) { return { ok: false, reason: 'receipt-retention-failed' }; }
  }
  return Object.freeze({ execute });
}
module.exports = { PRUNE_AI_CHANGE_DETAILS_WRITES, createPruneAiChangeDetailsWorkflow };
