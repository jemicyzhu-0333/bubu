'use strict';

const { closed, id, jsonValue } = require('../../core/ai-change-protocol');
const { entityFingerprint } = require('../ai/entity-fingerprint');
const { guidance } = require('../../capabilities');

const STORES = Object.freeze({ 'change-set': 'config', 'memory-candidate': 'memory', 'planning-preference-candidate': 'planning' });
const fail = reason => ({ ok: false, reason });
const empty = (proposalId, store, status = 'proposal') => ({ proposalId, store, status,
  receiptId: null, version: null, targetId: null, historyStatus: null });

// This projection reads canonical receipts only. It neither resumes a provider
// nor grants authority, and never turns one store's success into another's.
function createConversationProposalStatus({ sessions, ownerId, identityAvailable, readSnapshot, memory, durability, now }) {
  return function query(payload) {
    if (!jsonValue(payload) || !closed(payload, ['conversationId', 'proposalIds']) || !id(payload.conversationId)
      || !Array.isArray(payload.proposalIds) || payload.proposalIds.length > 50 || !payload.proposalIds.every(id)
      || new Set(payload.proposalIds).size !== payload.proposalIds.length) return fail('proposal-status-query-invalid');
    if (!identityAvailable) return fail('proposal-status-owner-unavailable');
    const loaded = sessions.get({ conversationId: payload.conversationId });
    if (!loaded?.ok || loaded.conversation?.ownerId !== ownerId) return fail('proposal-status-conversation-unavailable');
    const sources = payload.proposalIds.map(proposalId => loaded.conversation.messages.filter(message =>
      message.role === 'assistant' && message.proposal?.id === proposalId && STORES[message.proposal.kind]));
    if (sources.some(matches => matches.length !== 1)) return fail('proposal-status-source-invalid');
    let snapshot, snapshotAvailable = false;
    try { snapshot = readSnapshot(); snapshotAvailable = !durability || durability.verify().ok; } catch (_) {}
    const items = sources.map(([message]) => {
      const proposalId = message.proposal.id, store = STORES[message.proposal.kind], base = empty(proposalId, store);
      try {
        if (store === 'memory') {
          const found = memory?.candidateStatus({ conversationId: payload.conversationId, proposalId });
          if (!found?.ok) return empty(proposalId, store, 'unavailable');
          return found.receipt ? { ...base, status: found.status, receiptId: found.receipt.receiptId,
            version: found.currentVersion, targetId: found.receipt.memoryId, historyStatus: found.historyStatus } : base;
        }
        if (!snapshotAvailable) return empty(proposalId, store, 'unavailable');
        if (store === 'planning') {
          const found = guidance.planningPreferences.lookupPlanningPreferenceReceipt(snapshot,
            { origin: { conversationId: payload.conversationId, proposalId }, now: now() });
          if (!found.ok) return found.reason === 'planning-receipt-not-found' ? base : empty(proposalId, store, 'unavailable');
          return { ...base, status: found.status, receiptId: found.receipt.receiptId,
            version: found.currentVersion, targetId: found.receipt.preferenceId, historyStatus: null };
        }
        const changeSetId = `change-${entityFingerprint({ ownerId, conversationId: payload.conversationId, proposalId })}`;
        const matches = snapshot.aiCollaboration.receipts.filter(receipt => receipt.ownerId === ownerId
          && receipt.conversationId === payload.conversationId && receipt.changeSetId === changeSetId);
        if (!matches.length) return base;
        if (matches.length !== 1) return empty(proposalId, store, 'unavailable');
        const receipt = matches[0];
        return { ...base, status: receipt.status, receiptId: receipt.receiptId, version: receipt.appliedRevision,
          historyStatus: snapshot.aiCollaboration.outbox.some(entry => entry.receiptId === receipt.receiptId) ? 'pending' : 'synced' };
      } catch (_) { return empty(proposalId, store, 'unavailable'); }
    });
    return { ok: true, items };
  };
}
module.exports = { createConversationProposalStatus };
