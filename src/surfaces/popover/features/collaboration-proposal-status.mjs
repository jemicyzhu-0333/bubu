'use strict';

const STATES = new Set(['proposal', 'applied', 'reverted', 'removed', 'unavailable']);
const nullableText = value => value === null || typeof value === 'string' && value.length > 0;

// This read-only projection is deliberately separate from model messages and
// from each store's independently confirmed review workflow.
function createCollaborationProposalStatus({ surfaceClient, getState, view }) {
  let epoch = 0;
  const unavailable = ref => ({ proposalId: ref.id, store: ref.store, status: 'unavailable',
    receiptId: null, version: null, targetId: null, historyStatus: null });
  function invalidate() { ++epoch; view.proposalStatuses(getState().record?.id, []); }
  async function refresh() {
    const state = getState(), token = ++epoch;
    if (!state.open || !state.record) return;
    const record = state.record, conversationId = record.id, refs = view.visibleProposalRefs();
    const current = () => token === epoch && getState().open && getState().record === record;
    view.proposalStatuses(conversationId, []);
    const projected = [];
    for (let offset = 0; offset < refs.length; offset += 50) {
      if (!current()) return;
      const batch = refs.slice(offset, offset + 50);
      let result;
      try { result = await surfaceClient.getConversationProposalStatus?.({ conversationId, proposalIds: batch.map(ref => ref.id) }); }
      catch (_) { result = null; }
      if (!current()) return;
      for (const ref of batch) {
        const matches = result?.ok && Array.isArray(result.items) ? result.items.filter(item => item?.proposalId === ref.id) : [];
        const item = matches.length === 1 ? matches[0] : null;
        const valid = item && item.store === ref.store && STATES.has(item.status)
          && nullableText(item.receiptId) && nullableText(item.targetId)
          && (item.version === null || Number.isSafeInteger(item.version) && item.version >= 1)
          && [null, 'pending', 'synced'].includes(item.historyStatus);
        projected.push(valid ? structuredClone(item) : unavailable(ref));
      }
      view.proposalStatuses(conversationId, projected);
    }
  }
  return Object.freeze({ refresh, invalidate });
}

export { createCollaborationProposalStatus };
