'use strict';
const path = require('node:path');
const { openForgettingLedger } = require('../platform/persistence/sqlite/sqlite-database');
const { createMemoryService } = require('../application/ai/memory-service');
const { validateAiChangeEvent } = require('../core/ai-change-event-contract');

// SQL memory and its independent forgetting authority are never replaced by a
// disposable JSONL or in-memory writer. A missing port leaves local drafts only.
function openMemoryAuthority({ factStore, storage, userDataPath, now, idFactory,
  restoreState = 'current-local', openLedger = openForgettingLedger, timeContextFor } = {}) {
  const listeners = new Set();
  let ledgerStore = null, repository = null, reason = 'memory-authority-unavailable';
  let initialized = null;
  try {
    if (storage?.identityAvailable === true && typeof factStore?.memoryAuthorityState === 'function') {
      const state = factStore.memoryAuthorityState();
      initialized = state.ok ? state.initialized : null;
      if (state.ok && (!state.initialized || state.ownerId === storage.ownerId)) {
        ledgerStore = openLedger({ filePath: path.join(userDataPath, 'memory-forgetting.sqlite'), ownerId: storage.ownerId,
          expectedLedgerId: state.initialized ? state.ledgerId : undefined, create: !state.initialized,
          restoreState, lockAcquired: true });
        if (ledgerStore.status === 'available') {
          const opened = factStore.openMemoryAuthority({ ownerId: storage.ownerId, forgettingLedger: ledgerStore.ledger, now, timeContextFor });
          if (opened.ok) { repository = opened.repository; initialized = true; reason = null; }
          else reason = opened.reason;
        } else reason = ledgerStore.reason;
      }
    }
  } catch (_) { reason = 'memory-authority-unavailable'; }
  const service = createMemoryService({ repository, now, idFactory, unavailableReason: reason, onInvalidate: fact => {
    for (const listener of listeners) listener(fact);
  } });
  function drain() {
    service.pruneRecycle();
    if (!service.available || !factStore?.timeline?.supportsConfirmedChanges) return { ok: false, reason: 'memory-timeline-unavailable' };
    const pending = service.outbox({ limit: 25 });
    if (!pending.ok) return pending;
    let delivered = 0;
    for (const item of pending.items) {
      // A separate SQL receipt is represented by one content-free timeline row;
      // its memory payload never passes through the config receipt ledger.
      const result = service.receipt({ receiptId: item.receiptId });
      if (!result.ok) return { ok: false, delivered, reason: 'memory-receipt-unavailable' };
      const receipt = result.receipt;
      const event = validateAiChangeEvent({ id: item.id, schemaVersion: 1, occurredAt: item.occurredAt,
        receivedAt: item.occurredAt, timezone: item.timezone, utcOffsetMinutes: item.utcOffsetMinutes,
        localDayKey: item.localDayKey, dayKey: item.localDayKey,
        kind: item.kind === 'memory.reverted' ? 'ai.change.reverted' : 'ai.change.applied', actor: 'user', source: 'ai-collaboration',
        correlationId: item.commandId, causationId: item.commandId, commandId: item.commandId, entityVersion: null,
        visibility: 'private', redactionState: item.permanent ? 'redacted' : 'none', taskId: null, sessionId: null, durationMs: null,
        payload: { receiptId: item.receiptId, applyGroupId: `memory-group:${item.receiptId}`, operationIds: [], entityRefs: [],
          count: 1, revertsReceiptId: receipt.revertsReceiptId } });
      let appended;
      try { appended = factStore.timeline.appendConfirmedEvent(event); } catch (_) { appended = null; }
      if (!appended?.ok || (!appended.inserted && !appended.verifiedDuplicate)) return { ok: false, delivered, reason: 'memory-timeline-write-failed' };
      if (!service.acknowledgeOutbox({ eventId: item.id }).ok) return { ok: false, delivered, reason: 'memory-timeline-ack-failed' };
      delivered++;
    }
    return { ok: true, delivered };
  }
  return Object.freeze({ service, initialized, reason, drain,
    onInvalidate: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    close: () => { listeners.clear(); ledgerStore?.close(); } });
}
module.exports = { openMemoryAuthority };
