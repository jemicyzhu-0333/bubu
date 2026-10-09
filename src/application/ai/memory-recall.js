'use strict';

const { validMemoryIds, qualifyMemorySelection, discoverMemory } = require('../../core/memory-recall');
const direct = operation => operation();
const CONTEXT_FIELDS = Object.freeze(['id', 'version', 'status', 'kind', 'subject', 'body', 'source', 'scope',
  'validFrom', 'expiresAt', 'contextAllowed', 'updatedAt']);
const unavailable = () => ({ ok: false, reason: 'memory-authority-unavailable' });
const failure = result => ({ ok: false, reason: result?.reason === 'memory-context-invalid-selection'
  ? 'memory-context-invalid' : 'memory-authority-unavailable' });

// ARCHITECTURE「有界记忆检索」: only the nonrepairing M1 reader is held here.
// The optional synchronous wrapper belongs to the caller's authorization owner.
function createMemoryRecall({ contextReader } = {}) {
  function snapshot(ids, invokeSource) {
    const read = invokeSource(() => contextReader?.readContextSnapshot);
    if (typeof read !== 'function') return unavailable();
    const result = invokeSource(() => read.call(contextReader, { ids: ids === null ? null : [...ids] }));
    if (!result?.ok) return failure(result);
    const authority = result.authority;
    if (!Number.isFinite(result.sampledAt) || !Array.isArray(result.items) || result.items.length > (ids === null ? 500 : ids.length)
      || typeof authority?.ownerId !== 'string' || !authority.ownerId
      || typeof authority.ledgerId !== 'string' || !authority.ledgerId
      || !Number.isSafeInteger(authority.sequence) || authority.sequence < 0) return unavailable();
    return { ok: true, items: result.items.map(item => Object.fromEntries(CONTEXT_FIELDS.map(key => [key, item[key]]))),
      sampledAt: result.sampledAt,
      authority: { ownerId: authority.ownerId, ledgerId: authority.ledgerId, sequence: authority.sequence } };
  }
  function selected(ids, invokeSource = direct) {
    if (!validMemoryIds(ids)) return { ok: false, reason: 'memory-selection-budget' };
    if (!ids.length) return { ok: true, items: [], sampledAt: null, authority: null };
    const selectedIds = [...ids];
    try {
      const result = snapshot(selectedIds, invokeSource);
      if (!result.ok) return result;
      const qualified = qualifyMemorySelection(result.items, selectedIds, result.sampledAt);
      if (!qualified.ok) return qualified;
      return { ...qualified, sampledAt: result.sampledAt, authority: { ...result.authority } };
    } catch (_) { return unavailable(); }
  }
  function discovery(args = {}, invokeSource = direct) {
    try {
      const result = snapshot(null, invokeSource);
      if (!result.ok) return result;
      const page = discoverMemory(result.items, args, result.sampledAt);
      return page.ok ? { ok: true, items: page.items, nextCursor: page.nextCursor } : page;
    } catch (_) { return unavailable(); }
  }
  function getVersion({ id } = {}, invokeSource = direct) {
    const result = selected([id], invokeSource);
    if (!result.ok) return result;
    return { ok: true, id: result.items[0].id, version: result.items[0].version, contextAllowed: true };
  }
  function forgettingState(invokeSource = direct) {
    try {
      const read = invokeSource(() => contextReader?.readContextForgettingState);
      if (typeof read !== 'function') return unavailable();
      const result = invokeSource(() => read.call(contextReader));
      return result?.ok ? { ok: true, ownerId: result.ownerId, ledgerId: result.ledgerId,
        sequence: result.sequence, memoryIds: [...result.memoryIds],
        sourceRefs: result.sourceRefs.map(ref => ({ kind: ref.kind, id: ref.id, revision: ref.revision })) } : failure(result);
    } catch (_) { return unavailable(); }
  }
  return Object.freeze({ discovery, selected, getVersion, forgettingState });
}

module.exports = { createMemoryRecall };
