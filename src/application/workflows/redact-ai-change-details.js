'use strict';
const { redactRelatedReceipts } = require('../ai/receipt-privacy');
const REDACT_AI_CHANGE_DETAILS_WRITES = Object.freeze(['aiCollaboration']);
function createRedactAiChangeDetailsWorkflow({ unitOfWork, ownerId } = {}) {
  function execute({ conversationId } = {}) {
    if (typeof conversationId !== 'string' || !conversationId) return { ok: false, reason: 'receipt-redaction-invalid' };
    try {
      const result = unitOfWork.run({ writes: REDACT_AI_CHANGE_DETAILS_WRITES, context: { durability: 'authoritative' }, transition: state => {
        if (state.aiCollaboration.receipts.some(receipt => receipt.ownerId !== ownerId)) return { ok: false, reason: 'change-profile-mismatch' };
        return redactRelatedReceipts(state, { conversationId });
      } });
      return { ok: result.ok === true, changed: result.committed === true,
        ...(result.ok ? {} : { reason: result.reason || 'receipt-redaction-failed' }) };
    } catch (_) { return { ok: false, reason: 'receipt-redaction-failed' }; }
  }
  return Object.freeze({ execute });
}
module.exports = { REDACT_AI_CHANGE_DETAILS_WRITES, createRedactAiChangeDetailsWorkflow };
