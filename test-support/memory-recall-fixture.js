'use strict';

const { memoryEligible } = require('../src/core/memory-recall');
const { createMemoryRecall } = require('../src/application/ai/memory-recall');
const fields = ['id', 'version', 'status', 'kind', 'subject', 'body', 'source', 'scope',
  'validFrom', 'expiresAt', 'contextAllowed', 'updatedAt'];

// Synthetic M1 port only: no database, repair, management API or old-list adapter.
function createMemoryRecallFixture({ records = () => [], now = () => 1000,
  authority = () => ({ ownerId: 'synthetic-owner', ledgerId: 'SYNTHETIC_PRIVATE_LEDGER', sequence: 0 }),
  available = () => true, forgetting = () => ({ memoryIds: [], sourceRefs: [] }),
  onSnapshot = () => {}, onForgetting = () => {} } = {}) {
  const contextReader = Object.freeze({
    readContextSnapshot(request) {
      onSnapshot(request, this);
      if (!available()) return { ok: false, reason: 'memory-authority-unavailable' };
      const sampledAt = now();
      const eligible = records().filter(item => memoryEligible(item, sampledAt));
      const items = request.ids === null ? eligible : request.ids.map(id => eligible.find(item => item.id === id));
      if (items.some(item => !item)) return { ok: false, reason: 'memory-context-invalid-selection' };
      return { ok: true, sampledAt, authority: structuredClone(authority()),
        items: items.map(item => Object.fromEntries(fields.map(key => [key,
          key === 'updatedAt' ? (item.updatedAt ?? item.validFrom) : structuredClone(item[key])])) ) };
    },
    readContextForgettingState() {
      onForgetting(this);
      if (!available()) return { ok: false, reason: 'memory-authority-unavailable' };
      return { ok: true, ...structuredClone(authority()), ...structuredClone(forgetting()) };
    }
  });
  return { contextReader, memoryRecall: createMemoryRecall({ contextReader }) };
}

// Only unrelated fixtures with an explicit empty selection may use this stub.
function prepareEmptyMemorySelection({ grant } = {}) {
  const ids = grant?.selection?.memoryIds;
  if (!Array.isArray(ids) || ids.length) return { ok: false, reason: 'memory-context-invalid' };
  return { ok: true, validate: () => ({ ok: true }) };
}

module.exports = { createMemoryRecallFixture, prepareEmptyMemorySelection };
