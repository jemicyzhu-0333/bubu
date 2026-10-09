'use strict';
const { entityFingerprint } = require('../application/ai/entity-fingerprint');
const { memoryContextVersion } = require('../application/ai/context-choices');
const { createMemoryRecall } = require('../application/ai/memory-recall');
const { validateMemoryProposal } = require('../core/ai-memory-protocol');
const { closed } = require('../core/memory-protocol');
const direct = operation => operation();
function createMemoryManagement({ authority, collaboration, now, lifecycle, publishChange = () => {} } = {}) {
  const memory = authority.service;
  const memoryRecall = createMemoryRecall({ contextReader: memory.contextReader });
  const acceptedMessages = new Set();
  function safeState(invokeSource) {
    try {
      const read = invokeSource(() => memoryRecall.forgettingState);
      return invokeSource(() => read.call(memoryRecall, invokeSource));
    } catch (_) { return { ok: false }; }
  }
  function isContextMessageAllowed(message, { conversationId, invokeSource = direct } = {}) {
    const state = safeState(invokeSource);
    const blocked = new Set((state.sourceRefs || []).map(ref => `${ref.kind}:${ref.id}`));
    for (const id of state.memoryIds || []) blocked.add(`memory:${id}`);
    const getSession = invokeSource(() => collaboration.sessions.get);
    const loaded = invokeSource(() => getSession.call(collaboration.sessions, { conversationId }));
    const records = new Map((loaded.conversation?.messages || []).map(item => [item.id, item]));
    const visiting = new Set();
    function memoryAllowed(id) {
      const getVersion = invokeSource(() => memoryRecall.getVersion);
      return invokeSource(() => getVersion.call(memoryRecall, { id }, invokeSource)).contextAllowed === true;
    }
    function allowed(item) {
      if (!item || item.contextAllowed !== true || blocked.has(`message:${item.id}`) || visiting.has(item.id)) return false;
      if (!state.ok && (!acceptedMessages.has(`${conversationId}:${item.id}`)
        || item.sourceRefs.some(ref => ref.kind === 'memory'))) return false;
      visiting.add(item.id);
      const result = item.sourceRefs.every(ref => !blocked.has(`${ref.kind}:${ref.id}`)
        && (ref.kind !== 'memory' || memoryAllowed(ref.id))
        && (ref.kind !== 'message' || allowed(records.get(ref.id))));
      visiting.delete(item.id);
      return result;
    }
    // Pre-lineage derived history cannot prove it omitted a forgotten message.
    if ((state.sourceRefs || []).some(ref => ref.kind === 'message') && message.role === 'assistant'
      && !message.sourceRefs.some(ref => ref.kind === 'message')) return false;
    return allowed(records.get(message.id));
  }
  const unsubscribe = authority.onInvalidate(fact => {
    collaboration.invalidateScopes();
    let cursor = null;
    do {
      const page = collaboration.sessions.list({ cursor });
      for (const item of page.items || []) collaboration.sessions.revoke({ conversationId: item.id,
        sourceRefs: [...fact.sourceRefs, ...fact.memoryIds.map(id => ({ kind: 'memory', id, revision: null }))].slice(0, 50) });
      cursor = page.nextCursor || null;
    } while (cursor);
    publishChange({ settings: true });
  });
  const candidateBindings = new Map();
  function previewProposal({ conversationId, proposalId, input, replacePreviewId }) {
    const loaded = collaboration.sessions.get({ conversationId });
    if (!loaded.ok) return loaded;
    const message = loaded.conversation.messages.find(item => item.role === 'assistant' && item.proposal?.id === proposalId);
    if (!message || message.proposal.kind !== 'memory-candidate') return { ok: false, reason: 'memory-candidate-invalid' };
    const historical = memory.candidateStatus({ conversationId, proposalId });
    if (!historical.ok) return historical;
    if (historical.receipt) return { ok: false, reason: 'memory-candidate-already-reviewed', memoryId: historical.receipt.memoryId,
      receiptId: historical.receipt.receiptId, status: historical.status };
    if (!isContextMessageAllowed(message, { conversationId })
      || !collaboration.reads.validateContextVersions(message.sourceRefs)) return { ok: false, reason: 'memory-source-forgotten' };
    let body;
    try { body = validateMemoryProposal(JSON.parse(message.proposal.body)); } catch (_) { return { ok: false, reason: 'memory-candidate-invalid' }; }
    const change = body.memoryChange;
    if (change?.operation === 'forget' && input !== undefined) return { ok: false, reason: 'memory-input-invalid' };
    if (input !== undefined && !closed(input, ['kind', 'subject', 'body', 'scope', 'expiresAt', 'privacyLevel'])) return { ok: false, reason: 'memory-input-invalid' };
    let target = {};
    if (change) {
      const current = memoryRecall.getVersion({ id: change.id });
      const refs = message.sourceRefs.filter(ref => ref.kind === 'memory' && ref.id === change.id);
      if (!current.ok || current.contextAllowed !== true || refs.length !== 1 || refs[0].revision !== memoryContextVersion(current)) {
        return { ok: false, reason: 'memory-version-conflict' };
      }
      target = { targetId: current.id, expectedVersion: current.version };
    }
    if (message.sourceRefs.length >= 50) return { ok: false, reason: 'memory-source-budget' };
    if (replacePreviewId) {
      const previous = candidateBindings.get(replacePreviewId);
      if (!previous || previous.conversationId !== conversationId || previous.proposalId !== proposalId) return { ok: false, reason: 'memory-preview-conflict' };
      memory.cancel({ previewId: replacePreviewId }); candidateBindings.delete(replacePreviewId);
    }
    const operation = change?.operation === 'forget' ? 'permanent-remove' : change ? 'update' : 'add';
    const request = { operation, ...target };
    if (operation !== 'permanent-remove') request.input = { ...(body.memoryCandidate || change.input), ...(input || {}),
      sourceRefs: [...message.sourceRefs, { kind: 'message', id: message.id, revision: null }] };
    const preview = memory.previewReviewedCandidate(request,
    { conversationId, proposalId, messageId: message.id });
    if (preview.ok) candidateBindings.set(preview.preview.previewId, { conversationId, proposalId,
      hash: entityFingerprint(message.proposal), sourceRefs: message.sourceRefs });
    return preview;
  }
  function confirm(payload) {
    const result = memory.confirmReviewed(payload, preview => {
      const binding = candidateBindings.get(payload.previewId);
      if (!preview.candidateOrigin) return { ok: true };
      if (!binding) return { ok: false, reason: 'memory-preview-conflict' };
      const loaded = collaboration.sessions.get({ conversationId: binding.conversationId });
      const message = loaded.conversation?.messages.find(item => item.proposal?.id === binding.proposalId);
      if (!message || entityFingerprint(message.proposal) !== binding.hash || !isContextMessageAllowed(message, binding)
        || !collaboration.reads.validateContextVersions(binding.sourceRefs)) return { ok: false, reason: 'memory-source-forgotten' };
      return { ok: true };
    });
    if (result.ok || result.forgettingCommitted) {
      candidateBindings.delete(payload.previewId);
      try { const delivered = authority.drain(); if (!delivered.ok) result.deliveryPending = true; } catch (_) { result.deliveryPending = true; }
      try { publishChange({ settings: true, timeline: true }); } catch (_) { result.refreshPending = true; }
    }
    return result;
  }
  function register(registerIpc) {
    registerIpc('memory:list', (_event, payload) => memory.list(payload || {}));
    registerIpc('memory:remember', () => ({ ok: false, reason: 'memory-reviewed-change-required' }));
    registerIpc('memory:forget', () => ({ ok: false, reason: 'memory-reviewed-change-required' }));
    registerIpc('memory:clear', () => ({ ok: false, reason: 'memory-reviewed-change-required' }));
    registerIpc('memory:change-preview', (_event, payload) => memory.preview(payload));
    registerIpc('memory:change-confirm', (_event, payload) => confirm(payload));
    registerIpc('memory:undo-preview', (_event, payload) => memory.previewUndo(payload));
    registerIpc('memory:receipt', (_event, payload) => memory.receipt(payload));
    registerIpc('memory:change-cancel', (_event, payload) => { candidateBindings.delete(payload.previewId); return memory.cancel(payload); });
    registerIpc('memory:proposal-preview', (_event, payload) => previewProposal(payload));
  }
  if (lifecycle) {
    lifecycle.register('memory:authority', () => { unsubscribe(); authority.close(); });
    lifecycle.interval('timer:memory-outbox', () => { const result = authority.drain(); if (result.delivered) publishChange({ timeline: true }); }, 30000);
    lifecycle.timeout('timer:memory-outbox-startup', () => authority.drain(), 0);
  }
  return Object.freeze({ register, isContextMessageAllowed, previewProposal, confirm,
    rememberAcceptedMessage: ({ conversationId, messageId }) => {
      acceptedMessages.add(`${conversationId}:${messageId}`);
      if (acceptedMessages.size > 10000) acceptedMessages.delete(acceptedMessages.values().next().value);
    } });
}
module.exports = { createMemoryManagement };
