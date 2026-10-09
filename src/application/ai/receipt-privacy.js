'use strict';
const { guidance } = require('../../capabilities');
function redactRelatedReceipts(state, { conversationId, sourceRefs = [] } = {}) {
  if (!state.aiCollaboration) return { ok: true, changed: false };
  const receipts = state.aiCollaboration.receipts;
  const refs = new Set(sourceRefs.map(ref => `${ref.kind}:${ref.id}`));
  const selected = receipts.filter(receipt => receipt.details && (receipt.conversationId === conversationId
    || receipt.details.evidenceRefs.some(ref => refs.has(`${ref.kind}:${ref.id}`))
    || receipt.results.some(result => result.entityRefs.some(ref => refs.has(`${ref.kind}:${ref.id}`)))));
  if (!selected.length) return { ok: true, changed: false };
  const result = guidance.aiChangeLedger.redactDetails(state.aiCollaboration, {
    ownerId: selected[0].ownerId, receiptIds: selected.map(receipt => receipt.receiptId) });
  if (result.ok) state.aiCollaboration = result.ledger;
  return { ok: result.ok === true, changed: result.changed === true,
    ...(result.ok ? {} : { reason: result.reason || 'receipt-redaction-failed' }) };
}
module.exports = { redactRelatedReceipts };
