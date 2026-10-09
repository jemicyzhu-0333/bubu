'use strict';
const { entityFingerprint } = require('./entity-fingerprint');
const { closed, id, time, candidateOriginValid, KINDS, sourceRefsValid, sourceKey } = require('../../core/memory-protocol');
const { memoryEligible } = require('../../core/memory-recall');
const fail = reason => ({ ok: false, reason,
  ...(reason === 'memory-commit-outcome-unknown' || reason === 'forgetting-commit-outcome-unknown'
    ? { reason: 'memory-commit-outcome-unknown', retrySameIdentity: true, outcome: 'unknown' } : {}) });
const copy = value => structuredClone(value);

const CONTEXT_REASONS = Object.freeze(['memory-authority-unavailable', 'memory-authority-invalid', 'memory-clock-invalid',
  'memory-commit-outcome-unknown', 'forgetting-ledger-unavailable', 'forgetting-ledger-mismatch',
  'memory-forgetting-cleanup-pending', 'memory-context-changed', 'memory-context-invalid-selection']);
function contextKeys(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) || {}, 'value'));
}
function contextCopy(value) {
  if (value === null || typeof value !== 'object') return value;
  const keys = Reflect.ownKeys(value), array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('memory-context-result-invalid');
  if (keys.some(key => typeof key !== 'string'
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
    || array && (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))) {
    throw new TypeError('memory-context-result-invalid');
  }
  if (array) return Array.from({ length: value.length }, (_, index) => contextCopy(value[index]));
  return Object.fromEntries(keys.map(key => [key, contextCopy(value[key])]));
}
function contextRequest(request) {
  if (!contextKeys(request, ['ids'])) return false;
  const ids = request.ids;
  return ids === null || Array.isArray(ids) && ids.length <= 8 && Reflect.ownKeys(ids).length === ids.length + 1
    && Array.from({ length: ids.length }, (_, index) => Object.getOwnPropertyDescriptor(ids, String(index)))
      .every(value => value && Object.hasOwn(value, 'value') && id(value.value))
    && new Set(ids).size === ids.length;
}
function contextAuthority(value) {
  return contextKeys(value, ['ownerId', 'ledgerId', 'sequence']) && id(value.ownerId) && id(value.ledgerId)
    && Number.isSafeInteger(value.sequence) && value.sequence >= 0;
}
function contextItem(value, at) {
  return contextKeys(value, ['id', 'version', 'status', 'kind', 'subject', 'body', 'source', 'scope',
    'validFrom', 'expiresAt', 'contextAllowed', 'updatedAt']) && id(value.id) && KINDS.includes(value.kind)
    && typeof value.subject === 'string' && value.subject.trim().length > 0 && [...value.subject].length <= 200
    && typeof value.body === 'string' && value.body.trim().length > 0 && [...value.body].length <= 500
    && ['global', 'work', 'personal'].includes(value.scope) && time(value.validFrom) && time(value.updatedAt)
    && (value.expiresAt === null || time(value.expiresAt)) && memoryEligible(value, at);
}
function contextFailure(value) {
  if (!value || value.ok !== false || !CONTEXT_REASONS.includes(value.reason)) return null;
  const unknown = value.reason === 'memory-commit-outcome-unknown';
  if (!contextKeys(value, unknown ? ['ok', 'availability', 'reason', 'outcome', 'retrySameIdentity'] : ['ok', 'availability', 'reason'])
    || value.availability !== 'unavailable' || unknown && (value.outcome !== 'unknown' || value.retrySameIdentity !== true)) return null;
  return { ok: false, availability: 'unavailable', reason: value.reason,
    ...(unknown ? { outcome: 'unknown', retrySameIdentity: true } : {}) };
}
function createContextService(repository) {
  const unavailable = () => ({ ok: false, availability: 'unavailable', reason: 'memory-authority-unavailable' });
  return Object.freeze({
    readContextSnapshot(request) {
      try {
        if (!contextRequest(request)) return { ok: false, availability: 'unavailable', reason: 'memory-context-invalid-selection' };
        const ids = copy(request.ids), reader = repository?.contextReader, method = reader?.readContextSnapshot;
        if (repository?.available !== true || typeof method !== 'function') return unavailable();
        const value = contextCopy(method.call(reader, { ids: copy(ids) }));
        const failure = contextFailure(value); if (failure) return failure;
        if (!contextKeys(value, ['ok', 'items', 'sampledAt', 'authority']) || value.ok !== true || !time(value.sampledAt)
          || !contextAuthority(value.authority) || !Array.isArray(value.items) || value.items.length > (ids === null ? 500 : ids.length)
          || value.items.some(item => !contextItem(item, value.sampledAt))
          || new Set(value.items.map(item => item.id)).size !== value.items.length
          || ids !== null && (value.items.length !== ids.length || value.items.some(item => !ids.includes(item.id)))) return unavailable();
        return value;
      } catch (_) { return unavailable(); }
    },
    readContextForgettingState() {
      try {
        const reader = repository?.contextReader, method = reader?.readContextForgettingState;
        if (repository?.available !== true || typeof method !== 'function') return unavailable();
        const value = contextCopy(method.call(reader));
        const failure = contextFailure(value); if (failure) return failure;
        if (!contextKeys(value, ['ok', 'ownerId', 'ledgerId', 'sequence', 'memoryIds', 'sourceRefs']) || value.ok !== true
          || !contextAuthority({ ownerId: value.ownerId, ledgerId: value.ledgerId, sequence: value.sequence })
          || !Array.isArray(value.memoryIds) || !value.memoryIds.every(id) || new Set(value.memoryIds).size !== value.memoryIds.length
          || !Array.isArray(value.sourceRefs) || value.sourceRefs.some(ref => !sourceRefsValid([ref]))
          || new Set(value.sourceRefs.map(sourceKey)).size !== value.sourceRefs.length) return unavailable();
        return value;
      } catch (_) { return unavailable(); }
    }
  });
}

function createMemoryService({ repository, now, idFactory, onInvalidate = () => {}, unavailableReason = 'memory-authority-unavailable' } = {}) {
  if (typeof now !== 'function' || typeof idFactory !== 'function') throw new TypeError('memory-service-ports-invalid');
  const previews = new Map(), issuedIds = new Set(), pendingInvalidations = new Map();
  let recycling = false;
  function nextId(kind) {
    for (let attempt = 0; attempt < 64; attempt++) {
      const value = idFactory(kind);
      if (id(value) && !issuedIds.has(value)) { issuedIds.add(value); return value; }
    }
    throw new Error('memory-id-unavailable');
  }
  function call(method, request) {
    if (repository?.available !== true || typeof repository[method] !== 'function') return fail(unavailableReason || 'memory-authority-unavailable');
    try { return repository[method](request); } catch (_) { return fail('memory-authority-unavailable'); }
  }
  function reconcileInvalidation(result, commandId = result.receipt?.commandId) {
    if (!commandId || !result.ok && !result.forgettingCommitted) return result;
    const pending = pendingInvalidations.get(commandId);
    if (!pending) return result;
    // A committed command is never repeated to repair a failed observer. Keep
    // its exact fact pending until a receipt/replay can deliver the effect.
    try {
      onInvalidate(copy(pending));
      pendingInvalidations.delete(commandId);
    } catch (_) { result.invalidationPending = true; }
    return result;
  }
  function pruneExpired() {
    const at = now();
    if (!time(at)) return;
    for (const [key, item] of previews) if (at >= item.value.expiresAt) previews.delete(key);
  }
  function prepare(request, origin, candidateOrigin = null) {
    pruneExpired();
    if (origin === 'reviewed-model' && !candidateOriginValid(candidateOrigin)) return fail('memory-candidate-invalid');
    if (!closed(request, ['operation', 'targetId', 'expectedVersion', 'input', 'resolution'])
      || !['add', 'update', 'activate', 'pause', 'remove', 'restore', 'permanent-remove'].includes(request.operation)) return fail('memory-preview-invalid');
    if (previews.size >= 50) return fail('memory-preview-capacity');
    try {
      const createdAt = now(); if (!time(createdAt) || !time(createdAt + 10 * 60 * 1000)) return fail('memory-clock-invalid');
      const candidate = { ...copy(request), expectedVersion: request.expectedVersion ?? null,
        previewId: nextId('memory-preview'), createdAt,
        ...(candidateOrigin ? { candidateOrigin: copy(candidateOrigin) } : {}) };
      if (['add', 'update'].includes(request.operation)) {
        if (!closed(request.input, ['kind', 'subject', 'body', 'status', 'sourceRefs', 'validFrom', 'expiresAt', 'scope', 'privacyLevel'])) return fail('memory-input-invalid');
        candidate.input = { ...copy(request.input), sourceType: origin === 'model' ? 'model-proposed' : origin === 'reviewed-model' ? 'user-edit'
          : request.operation === 'add' ? 'user-statement' : 'user-edit',
        status: origin === 'model' ? 'candidate' : request.input.status || 'active' };
      }
      if (request.operation === 'add') candidate.allocatedId = nextId('memory');
      const result = call('preview', candidate); if (!result.ok) return result;
      return store(result.preview);
    } catch (_) { return fail('memory-preview-failed'); }
  }
  function store(preview) {
    const value = copy(preview); delete value.ok;
    const previewHash = entityFingerprint(value);
    previews.set(value.previewId, { value, previewHash });
    return { ok: true, preview: { ...copy(value), previewHash } };
  }
  function preview(request) { return prepare(request, 'manual'); }
  function proposeCandidate(request) {
    if (request?.operation !== 'add') return fail('memory-candidate-invalid');
    return prepare(request, 'model');
  }
  function confirm(request, beforeCommit = null) {
    if (!closed(request, ['previewId', 'previewHash', 'expectedVersion']) || !id(request.previewId)
      || !/^[a-f0-9]{64}$/.test(request.previewHash)
      || request.expectedVersion !== null && (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)) return fail('memory-confirmation-invalid');
    const prior = call('lookupConfirmation', request);
    if (!prior.ok) return prior;
    if (prior.receipt) {
      previews.delete(request.previewId);
      return reconcileInvalidation({ ok: true, receipt: prior.receipt, replayed: true, historyStatus: prior.historyStatus });
    }
    pendingInvalidations.delete(request.previewId);
    const stored = previews.get(request.previewId);
    if (!stored || stored.previewHash !== request.previewHash || stored.value.expectedVersion !== request.expectedVersion) return fail('memory-preview-conflict');
    if (beforeCommit) {
      const allowed = beforeCommit(stored.value);
      if (!allowed?.ok) return allowed || fail('memory-confirmation-invalid');
    }
    const result = call('commit', { preview: stored.value, previewHash: stored.previewHash,
      receiptId: nextId('memory-receipt'), eventId: nextId('memory-event') });
    if (result.ok || result.forgettingCommitted || result.retrySameIdentity) {
      pendingInvalidations.set(request.previewId, { memoryIds: copy(stored.value.affectedIds), sourceRefs: copy(stored.value.invalidatedSourceRefs),
        permanent: stored.value.permanent, forgettingCommitted: result.forgettingCommitted === true || stored.value.permanent });
      reconcileInvalidation(result, request.previewId);
      if (result.ok) previews.delete(request.previewId);
    }
    return result;
  }
  function confirmReviewed(request, validateSources = null) {
    if (!closed(request, ['previewId', 'previewHash', 'expectedVersion', 'permanentAcknowledged'])
      || request.permanentAcknowledged !== undefined && typeof request.permanentAcknowledged !== 'boolean') {
      return fail('memory-confirmation-invalid');
    }
    const { permanentAcknowledged, ...ticket } = request;
    return confirm(ticket, preview => {
      if (preview.permanent && permanentAcknowledged !== true) return fail('memory-permanent-acknowledgement-required');
      return validateSources ? validateSources(preview) : { ok: true };
    });
  }
  function previewUndo(request) {
    pruneExpired();
    if (!closed(request, ['receiptId']) || !id(request.receiptId)) return fail('memory-undo-invalid');
    if (previews.size >= 50) return fail('memory-preview-capacity');
    const undo = call('undo', request); if (!undo.ok) return undo;
    const result = call('preview', { operation: 'undo', targetId: undo.targetId, expectedVersion: undo.expectedVersion,
      undoRecord: undo.undoRecord, undoReceiptId: request.receiptId, previewId: nextId('memory-preview'), createdAt: now() });
    return result.ok ? store(result.preview) : result;
  }
  function pruneRecycle() {
    if (recycling || repository?.available !== true) return { ok: true, pending: [] };
    recycling = true;
    const pending = [];
    try {
      let cursor = null;
      do {
        const page = call('list', { status: 'removed', limit: 100, cursor });
        if (!page.ok) return page;
        for (const record of page.items) {
          if (!time(record.recycleUntil) || now() < record.recycleUntil) continue;
          const prepared = prepare({ operation: 'permanent-remove', targetId: record.id, expectedVersion: record.version }, 'retention');
          if (!prepared.ok) { pending.push(record.id); continue; }
          // Retention consent covers this row. Broader source-derived erasure
          // still needs a fresh, explicit user review instead of auto-expansion.
          if (prepared.preview.affectedIds.some(id => id !== record.id)) {
            previews.delete(prepared.preview.previewId); pending.push(record.id); continue;
          }
          const result = confirm({ previewId: prepared.preview.previewId, previewHash: prepared.preview.previewHash,
            expectedVersion: prepared.preview.expectedVersion });
          if (!result.ok) pending.push(record.id);
        }
        cursor = page.nextCursor || null;
      } while (cursor);
      return { ok: true, pending };
    } finally { recycling = false; }
  }
  function list(request) {
    pruneRecycle();
    const result = call('list', request);
    if (result.ok) result.items = result.items.map(record => record.status === 'removed' && now() >= record.recycleUntil
      ? { ...record, body: '保留期已到，等待完成清理', retentionCleanupPending: true } : record);
    return result;
  }
  function cancel({ previewId }) { return { ok: previews.delete(previewId) }; }
  return Object.freeze({ available: repository?.available === true, contextReader: createContextService(repository), preview, proposeCandidate,
    previewReviewedCandidate: (request, origin) => ['add', 'update', 'permanent-remove'].includes(request?.operation) ? prepare(request, 'reviewed-model', origin) : fail('memory-candidate-invalid'), confirm, confirmReviewed, previewUndo, cancel,
    list, pruneRecycle,
    usage: request => call('usage', request), receipt: request => reconcileInvalidation(call('receipt', request)),
    outbox: request => call('outbox', request), acknowledgeOutbox: request => call('acknowledgeOutbox', request),
    forgettingState: () => call('forgettingState'), findBySource: request => call('findBySource', request), candidateStatus: request => call('candidateStatus', request), getVersion: request => call('getVersion', request) });
}
module.exports = { createMemoryService };
