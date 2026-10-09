'use strict';
const { createMemoryDurability } = require('./memory-durability');
const { verifyMemorySchema } = require('./versioned-memory-schema');
const { isDeepStrictEqual } = require('node:util');
const { localEventContext } = require('../../../application/effects/inbox-timeline-effects');
const { entityFingerprint } = require('../../../application/ai/entity-fingerprint');
const { memoryEligible } = require('../../../core/memory-recall');
const { closed, id, time, recordValid, receiptValid, eventValid, sourceRefsValid, sourceKey, sourceRefs, topicKey, projection,
  planMutation, stampCommittedRecord, candidateOriginValid, eventTimeContextValid, PREVIEW_TTL_MS, UNDO_TTL_MS } = require('../../../core/memory-protocol');

const fail = reason => ({ ok: false, availability: 'unavailable', reason,
  ...(reason === 'memory-commit-outcome-unknown' || reason === 'forgetting-commit-outcome-unknown'
    ? { reason: 'memory-commit-outcome-unknown', outcome: 'unknown', retrySameIdentity: true } : {}) });
const copy = value => structuredClone(value);
const withoutUsage = value => value && Object.fromEntries(Object.entries(value).filter(([key]) => !['lastUsedAt', 'useCount'].includes(key)));
function memoryAuthorityState(handle) {
  try {
    const rows = handle.all('SELECT * FROM memory_authority');
    if (!rows.length) return { ok: true, initialized: false };
    const row = rows[0];
    if (rows.length !== 1 || row.singleton !== 1 || !id(row.owner_id) || !id(row.ledger_id)
      || !Number.isSafeInteger(row.ledger_sequence) || row.ledger_sequence < 0 || !time(row.cutover_at)
      || !Number.isSafeInteger(row.verification_count) || row.verification_count < 0) return fail('memory-authority-invalid');
    return { ok: true, initialized: true, ownerId: row.owner_id, ledgerId: row.ledger_id, ledgerSequence: row.ledger_sequence };
  } catch (_) { return fail('memory-authority-unavailable'); }
}
function readRecords(handle) {
  const rows = handle.all('SELECT * FROM memory_records');
  if (rows.length > 500) throw new Error('memory-authority-invalid');
  return rows.map(row => {
    const record = JSON.parse(row.record);
    if (!recordValid(record) || record.id !== row.id || record.version !== row.version) throw new Error('memory-authority-invalid');
    return record;
  });
}
function parsedReceipt(row, ownerId) {
  const value = JSON.parse(row.receipt);
  if (!receiptValid(value) || value.ownerId !== ownerId || value.receiptId !== row.receipt_id
    || value.commandId !== row.command_id || value.memoryId !== row.memory_id || value.previewHash !== row.preview_hash
    || (value.candidateOrigin?.conversationId || null) !== row.origin_conversation_id
    || (value.candidateOrigin?.proposalId || null) !== row.origin_proposal_id) throw new Error('memory-authority-invalid');
  return value;
}
function importedRecord(row) {
  return { id: row.id, version: 1, kind: row.kind, subject: row.subject, body: row.body,
    status: 'active', sourceType: 'legacy-import', legacySource: row.source, sourceRefs: [], confirmedAt: null,
    validFrom: row.created_at, expiresAt: row.expires_at, scope: 'global', privacyLevel: 'standard',
    createdAt: row.created_at, updatedAt: row.updated_at, removedAt: null, recycleUntil: null, lastUsedAt: row.last_used_at, useCount: row.use_count };
}
function writeRecord(handle, record) {
  const prior = handle.get('SELECT source_refs FROM memory_sources WHERE memory_id=?', [record.id]);
  const refs = prior ? JSON.parse(prior.source_refs) : [];
  if (!sourceRefsValid(refs)) throw new Error('memory-authority-invalid');
  const lineage = [...new Map([...refs, ...record.sourceRefs].map(ref => [sourceKey(ref), { ...ref, revision: null }])).values()];
  if (lineage.length > 50) throw new Error('memory-source-capacity');
  handle.run('INSERT INTO memory_records(id,version,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,record=excluded.record',
    [record.id, record.version, JSON.stringify(record)]);
  handle.run('INSERT INTO memory_sources VALUES(?,?) ON CONFLICT(memory_id) DO UPDATE SET source_refs=excluded.source_refs',
    [record.id, JSON.stringify(lineage)]);
}
function readLineage(handle, records) {
  const rows = handle.all('SELECT * FROM memory_sources');
  if (rows.length !== records.length) throw new Error('memory-authority-invalid');
  return rows.map(row => {
    const refs = JSON.parse(row.source_refs), record = records.find(value => value.id === row.memory_id);
    if (!record || !sourceRefsValid(refs) || record.sourceRefs.some(ref => !refs.some(source => sourceKey(source) === sourceKey(ref)))) throw new Error('memory-authority-invalid');
    return { ...record, sourceRefs: refs };
  });
}
function blocked(record, state) {
  const ids = new Set(state.memoryIds), keys = new Set(state.sourceRefs.map(sourceKey));
  return ids.has(record.id) || record.sourceRefs.some(ref => keys.has(sourceKey(ref)));
}
function undoRows(handle) {
  return handle.all('SELECT * FROM memory_undo').map(row => {
    const record = JSON.parse(row.record);
    if (!recordValid(record) || record.id !== row.memory_id || !Number.isSafeInteger(row.post_version)
      || !time(row.expires_at) || !id(row.receipt_id)) throw new Error('memory-authority-invalid');
    return { ...row, record };
  });
}
function removalReceipt(removal, ownerId) {
  return { version: 1, receiptId: removal.receiptId, commandId: removal.commandId, ownerId,
    store: 'memory', operation: 'permanent-remove', memoryId: removal.targetId, beforeVersion: removal.beforeVersion,
    afterVersion: null, affectedIds: removal.affectedIds, previewHash: removal.previewHash, committedAt: removal.committedAt,
    undoExpiresAt: null, revertsReceiptId: null, permanent: true, eventId: removal.eventId, candidateOrigin: removal.candidateOrigin || null };
}
function verifyRemovalReceipt(row, removal, ownerId) {
  if (!row) throw new Error('memory-authority-invalid');
  const actual = parsedReceipt(row, ownerId);
  if (!isDeepStrictEqual({ ...actual, candidateOrigin: actual.candidateOrigin || null }, removalReceipt(removal, ownerId))) {
    throw new Error('memory-authority-invalid');
  }
}
function scrub(handle, state) {
  const records = readLineage(handle, readRecords(handle)), undo = undoRows(handle);
  const ids = new Set([...state.memoryIds, ...records.filter(record => blocked(record, state)).map(record => record.id),
    ...undo.filter(row => blocked(row.record, state)).map(row => row.memory_id)]);
  for (const memoryId of ids) {
    handle.run('DELETE FROM memory_records WHERE id=?', [memoryId]);
    handle.run('DELETE FROM memory_sources WHERE memory_id=?', [memoryId]);
    handle.run('DELETE FROM memory_undo WHERE memory_id=?', [memoryId]);
    handle.run('DELETE FROM agent_memories WHERE id=?', [memoryId]);
  }
  // The independent ledger contains only receipt identity, version and IDs.
  // Replaying it after a crash writes content removal + receipt + outbox in one
  // SQL commit, so a failed second-store commit remains safely recoverable.
  for (const removal of state.removals || []) {
    const value = removalReceipt(removal, state.ownerId);
    const prior = handle.get('SELECT * FROM memory_receipts WHERE command_id=?', [removal.commandId]);
    if (prior) { verifyRemovalReceipt(prior, removal, state.ownerId); continue; }
    const event = { version: 1, id: removal.eventId, kind: 'memory.changed', ownerId: state.ownerId,
      receiptId: removal.receiptId, commandId: removal.commandId, occurredAt: removal.committedAt,
      memoryId: removal.targetId, operation: 'permanent-remove', entityVersion: null, affectedIds: removal.affectedIds, permanent: true,
      ...removal.eventTimeContext };
    handle.run('INSERT INTO memory_receipts VALUES(?,?,?,?,?,?,?)', [value.receiptId, value.commandId, value.memoryId, value.previewHash, JSON.stringify(value), value.candidateOrigin?.conversationId || null, value.candidateOrigin?.proposalId || null]);
    handle.run('INSERT INTO memory_outbox VALUES(?,?,?,NULL)', [event.id, value.receiptId, JSON.stringify(event)]);
  }
  handle.run('UPDATE memory_authority SET ledger_sequence=? WHERE singleton=1', [state.sequence]);
}

const CONTEXT_FIELDS = Object.freeze(['id', 'version', 'status', 'kind', 'subject', 'body', 'source', 'scope',
  'validFrom', 'expiresAt', 'contextAllowed', 'updatedAt']);
const CONTEXT_TABLES = Object.freeze(['memory_authority', 'memory_records', 'memory_sources', 'memory_undo',
  'memory_receipts', 'memory_outbox']);
function contextSelection(request) {
  if (!request || Object.getPrototypeOf(request) !== Object.prototype
    || Reflect.ownKeys(request).length !== 1) return false;
  const descriptor = Object.getOwnPropertyDescriptor(request, 'ids');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  const ids = descriptor.value;
  return ids === null || Array.isArray(ids) && ids.length <= 8 && Reflect.ownKeys(ids).length === ids.length + 1
    && Array.from({ length: ids.length }, (_, index) => Object.getOwnPropertyDescriptor(ids, String(index)))
      .every(value => value && Object.hasOwn(value, 'value') && id(value.value))
    && new Set(ids).size === ids.length;
}
function uniqueContextRows(rows, key) {
  if (!Array.isArray(rows) || rows.some(row => !id(row[key])) || new Set(rows.map(row => row[key])).size !== rows.length) {
    throw new Error('memory-authority-invalid');
  }
}
function contextLedgerValid(state, ownerId) {
  if (!state || state.ok !== true || state.ownerId !== ownerId || !id(state.ledgerId)
    || !Number.isSafeInteger(state.sequence) || state.sequence < 0
    || !Array.isArray(state.memoryIds) || !state.memoryIds.every(id)
    || new Set(state.memoryIds).size !== state.memoryIds.length
    || !Array.isArray(state.sourceRefs) || state.sourceRefs.some(ref => !sourceRefsValid([ref]))
    || new Set(state.sourceRefs.map(sourceKey)).size !== state.sourceRefs.length
    || !Array.isArray(state.removals) || state.removals.length !== state.sequence) return false;
  for (const key of ['commandId', 'receiptId', 'eventId']) uniqueContextRows(state.removals, key);
  const affected = new Set();
  for (const removal of state.removals) {
    if (!receiptValid(removalReceipt(removal, ownerId)) || !removal.affectedIds.includes(removal.targetId)
      || !eventTimeContextValid(removal.eventTimeContext, removal.committedAt)) return false;
    removal.affectedIds.forEach(value => affected.add(value));
  }
  return affected.size === state.memoryIds.length && state.memoryIds.every(value => affected.has(value));
}

// ARCHITECTURE「有界记忆检索」: this port receives no writer, recovery or proof capability.
// Requires trusted synchronous all/get ports and the existing single-writer lifecycle.
// Two detached passes detect observed drift, not arbitrary driver/ABA/concurrent-writer attacks.
// Receipt/outbox/forgetting history is uncapped here: cost is proportional to retained history.
function createMemoryContextReader({ readHandle, ownerId, now, readLedgerState, isPending } = {}) {
  let portsValid = false;
  try {
    portsValid = id(ownerId) && typeof now === 'function' && typeof readLedgerState === 'function'
      && typeof isPending === 'function' && readHandle && Object.isFrozen(readHandle)
      && Object.getPrototypeOf(readHandle) === Object.prototype && Reflect.ownKeys(readHandle).length === 2
      && ['all', 'get'].every(key => typeof Object.getOwnPropertyDescriptor(readHandle, key)?.value === 'function');
  } catch (_) { /* An unavailable port cannot grant read authority. */ }
  function pending() {
    const value = isPending();
    if (value !== false) throw new Error(value === true ? 'memory-commit-outcome-unknown' : 'memory-authority-unavailable');
  }
  function ledger() {
    const state = copy(readLedgerState());
    if (state?.outcome === 'unknown') throw new Error('memory-commit-outcome-unknown');
    if (!contextLedgerValid(state, ownerId)) throw new Error('forgetting-ledger-unavailable');
    return state;
  }
  function marker(reader, state) {
    const value = memoryAuthorityState(reader);
    if (!value.ok || !value.initialized || value.ownerId !== ownerId || value.ledgerId !== state.ledgerId
      || state.sequence < value.ledgerSequence) throw new Error('forgetting-ledger-mismatch');
    if (state.sequence > value.ledgerSequence) throw new Error('memory-forgetting-cleanup-pending');
    return value;
  }
  function capture() {
    pending();
    const state = ledger(), tables = {};
    for (const table of CONTEXT_TABLES) tables[table] = copy(readHandle.all(`SELECT * FROM ${table}`));
    const reader = { all: sql => tables[sql.slice('SELECT * FROM '.length)] };
    const identity = marker(reader, state);
    pending();
    if (!isDeepStrictEqual(state, ledger()) || !isDeepStrictEqual(identity, marker(readHandle, state))) {
      throw new Error('memory-context-changed');
    }
    pending();
    return { state, tables };
  }
  function inspect(captured) {
    const { tables, state } = captured;
    uniqueContextRows(tables.memory_records, 'id');
    uniqueContextRows(tables.memory_sources, 'memory_id');
    uniqueContextRows(tables.memory_undo, 'memory_id');
    uniqueContextRows(tables.memory_undo, 'receipt_id');
    for (const key of ['receipt_id', 'command_id']) uniqueContextRows(tables.memory_receipts, key);
    for (const key of ['event_id', 'receipt_id']) uniqueContextRows(tables.memory_outbox, key);
    const reader = { all: sql => tables[sql.slice('SELECT * FROM '.length)] };
    const records = readRecords(reader), lineage = readLineage(reader, records), undo = undoRows(reader);
    if (lineage.some(record => blocked(record, state)) || undo.some(row => blocked(row.record, state))) {
      throw new Error('memory-forgetting-cleanup-pending');
    }
    const receipts = tables.memory_receipts.map(row => parsedReceipt(row, ownerId));
    uniqueContextRows(receipts, 'eventId');
    const receiptsById = new Map(receipts.map(value => [value.receiptId, value]));
    const receiptRowsByCommand = new Map(tables.memory_receipts.map(row => [row.command_id, row]));
    const recordsById = new Map(records.map(value => [value.id, value]));
    // Validate writer-shaped undo metadata without expiring or repairing it.
    for (const row of undo) {
      const receipt = receiptsById.get(row.receipt_id), current = recordsById.get(row.memory_id);
      if (row.post_version < 1 || !receipt || !current || current.version !== row.post_version
        || receipt.memoryId !== row.memory_id || receipt.afterVersion !== row.post_version
        || receipt.beforeVersion !== row.record.version || row.post_version !== row.record.version + 1
        || receipt.undoExpiresAt !== row.expires_at || receipt.permanent || ['add', 'undo'].includes(receipt.operation)) {
        throw new Error('memory-authority-invalid');
      }
    }
    const origins = receipts.filter(value => value.candidateOrigin).map(value =>
      JSON.stringify([value.candidateOrigin.conversationId, value.candidateOrigin.proposalId]));
    if (new Set(origins).size !== origins.length) throw new Error('memory-authority-invalid');
    const events = tables.memory_outbox.map(row => {
      const event = JSON.parse(row.event), receipt = receiptsById.get(row.receipt_id);
      if (!eventValid(event) || event.ownerId !== ownerId || event.id !== row.event_id || event.receiptId !== row.receipt_id
        || event.kind !== (event.operation === 'undo' ? 'memory.reverted' : 'memory.changed')
        || row.delivered_at !== null && !time(row.delivered_at) || !receipt || receipt.eventId !== event.id
        || receipt.commandId !== event.commandId || receipt.memoryId !== event.memoryId
        || receipt.operation !== event.operation || receipt.afterVersion !== event.entityVersion
        || receipt.committedAt !== event.occurredAt || !isDeepStrictEqual(receipt.affectedIds, event.affectedIds)) {
        throw new Error('memory-authority-invalid');
      }
      return event;
    });
    if (events.length !== receipts.length) throw new Error('memory-authority-invalid');
    const eventsById = new Map(events.map(value => [value.id, value]));
    for (const removal of state.removals) {
      verifyRemovalReceipt(receiptRowsByCommand.get(removal.commandId), removal, ownerId);
      const event = eventsById.get(removal.eventId);
      if (!event || !isDeepStrictEqual({ timezone: event.timezone, utcOffsetMinutes: event.utcOffsetMinutes,
        localDayKey: event.localDayKey }, removal.eventTimeContext)) throw new Error('memory-authority-invalid');
    }
    return records;
  }
  function read(ids, forgetting) {
    if (!portsValid) return fail('memory-authority-unavailable');
    try {
      const sampledAt = now();
      if (!time(sampledAt)) return fail('memory-clock-invalid');
      const first = capture(), records = inspect(first);
      const qualified = records.map(record => projection(record, records, sampledAt)).filter(item => memoryEligible(item, sampledAt));
      const selected = ids === null ? qualified : qualified.filter(item => ids.includes(item.id));
      const items = selected.sort((a, b) => a.id.localeCompare(b.id))
        .map(item => Object.fromEntries(CONTEXT_FIELDS.map(key => [key, item[key]])));
      const second = capture();
      inspect(second);
      if (!isDeepStrictEqual(first, second)) return fail('memory-context-changed');
      if (ids !== null && items.length !== ids.length) return fail('memory-context-invalid-selection');
      const { state } = first;
      if (forgetting) return { ok: true, ownerId, ledgerId: state.ledgerId, sequence: state.sequence,
        memoryIds: copy(state.memoryIds), sourceRefs: copy(state.sourceRefs) };
      return { ok: true, items, sampledAt, authority: { ownerId, ledgerId: state.ledgerId, sequence: state.sequence } };
    } catch (error) {
      const reasons = ['memory-authority-invalid', 'memory-commit-outcome-unknown', 'forgetting-ledger-unavailable',
        'forgetting-ledger-mismatch', 'memory-forgetting-cleanup-pending', 'memory-context-changed'];
      let reason;
      try { reason = Object.getOwnPropertyDescriptor(error, 'message')?.value; } catch (_) { /* Untrusted exception metadata. */ }
      return fail(reasons.includes(reason) ? reason : 'memory-authority-unavailable');
    }
  }
  return Object.freeze({
    readContextSnapshot(request) {
      try {
        if (!contextSelection(request)) return fail('memory-context-invalid-selection');
        return read(copy(request.ids), false);
      } catch (_) { return fail('memory-context-invalid-selection'); }
    },
    readContextForgettingState() { return read([], true); }
  });
}

// This repository is the sole versioned-memory writer. Every commit owns both its
// versioned memory change and its content-free receipt/outbox in this database.
function openVersionedMemoryAuthority({ handle, ownerId, forgettingLedger, now, timeContextFor = localEventContext, readFresh }) {
  if (!id(ownerId) || !forgettingLedger?.state || !forgettingLedger?.invalidate || typeof now !== 'function' || typeof timeContextFor !== 'function') return fail('memory-authority-ports-invalid');
  if (!time(now())) return fail('memory-clock-invalid');
  let opened = false;
  const durability = createMemoryDurability({ handle, kind: 'memory', readFresh, validate(reader) {
    verifyMemorySchema(reader);
    const marker = memoryAuthorityState(reader);
    if (!marker.ok || marker.initialized && marker.ownerId !== ownerId) throw new Error('memory-authority-invalid');
    readLineage(reader, readRecords(reader)); undoRows(reader);
    for (const row of reader.all('SELECT * FROM memory_receipts')) parsedReceipt(row, ownerId);
    for (const row of reader.all('SELECT * FROM memory_outbox')) {
      const event = JSON.parse(row.event);
      if (!eventValid(event) || event.ownerId !== ownerId || event.id !== row.event_id
        || event.receiptId !== row.receipt_id) throw new Error('memory-authority-invalid');
    }
  } });
  function gate(identity = null) {
    if (durability.isPending()) {
      if (!identity) return fail('memory-commit-outcome-unknown');
      try { durability.recover(identity); } catch (_) { return fail('memory-commit-outcome-unknown'); }
    }
    let state, marker;
    try { state = forgettingLedger.state(); marker = memoryAuthorityState(handle); }
    catch (_) { return fail('forgetting-ledger-unavailable'); }
    if (state?.outcome === 'unknown' && identity && forgettingLedger.recover) {
      try { state = forgettingLedger.recover(identity); } catch (_) { return fail('memory-commit-outcome-unknown'); }
    }
    if (!state?.ok) return fail(state?.reason || 'forgetting-ledger-unavailable');
    if (!marker.ok) return marker;
    if (!marker.initialized || marker.ownerId !== ownerId || state.ownerId !== ownerId || marker.ledgerId !== state.ledgerId
      || state.sequence < marker.ledgerSequence) return fail('forgetting-ledger-mismatch');
    try {
      if (!time(now())) return fail('memory-clock-invalid');
      for (const row of handle.all('SELECT * FROM memory_receipts')) parsedReceipt(row, ownerId);
      const removal = state.removals?.at(-1);
      const cleanupIdentity = removal && { previewId: removal.commandId, previewHash: removal.previewHash,
        expectedVersion: removal.beforeVersion, receiptId: removal.receiptId };
      if (state.sequence > marker.ledgerSequence) durability.run(() => scrub(handle, state), cleanupIdentity);
      // Equal sequence is not proof that either stored copy retained its exact identity.
      for (const removal of state.removals || []) {
        verifyRemovalReceipt(handle.get('SELECT * FROM memory_receipts WHERE command_id=?', [removal.commandId]), removal, ownerId);
        const storedEvent = handle.get('SELECT event FROM memory_outbox WHERE event_id=?', [removal.eventId]);
        const event = storedEvent && JSON.parse(storedEvent.event);
        if (!eventValid(event) || event.occurredAt !== removal.committedAt || event.receiptId !== removal.receiptId
          || !isDeepStrictEqual({ timezone: event.timezone, utcOffsetMinutes: event.utcOffsetMinutes,
            localDayKey: event.localDayKey }, removal.eventTimeContext)) throw new Error('memory-authority-invalid');
      }
      const records = readLineage(handle, readRecords(handle));
      if (records.some(record => blocked(record, state)) || undoRows(handle).some(row => blocked(row.record, state))) {
        durability.run(() => scrub(handle, state), cleanupIdentity);
      }
      if (handle.get('SELECT memory_id FROM memory_undo WHERE expires_at<=? LIMIT 1', [now()])) {
        durability.run(() => handle.run('DELETE FROM memory_undo WHERE expires_at<=?', [now()]));
      }
      return { ok: true, state };
    } catch (error) { return fail(error?.outcome === 'unknown' ? 'memory-commit-outcome-unknown'
      : error?.message === 'memory-authority-invalid' ? 'memory-authority-invalid' : 'memory-forgetting-cleanup-pending'); }
  }
  try {
    const state = forgettingLedger.state(), marker = memoryAuthorityState(handle);
    if (!state?.ok || state.ownerId !== ownerId) return fail(state?.outcome === 'unknown' ? 'memory-commit-outcome-unknown' : 'forgetting-ledger-unavailable');
    if (!marker.ok) return marker;
    if (!marker.initialized) {
      durability.run(() => {
        if (readRecords(handle).length || undoRows(handle).length || handle.get('SELECT COUNT(*) AS count FROM memory_sources').count
          || handle.get('SELECT COUNT(*) AS count FROM memory_receipts').count) throw new Error('memory-cutover-invalid');
        const legacy = handle.all('SELECT * FROM agent_memories');
        if (legacy.length > 500) throw new Error('memory-cutover-capacity');
        for (const row of legacy) {
          const record = importedRecord(row);
          if (!recordValid(record)) throw new Error('memory-legacy-invalid');
          if (!blocked(record, state)) writeRecord(handle, record);
        }
        handle.run('INSERT INTO memory_authority VALUES(1,?,?,?,?,0)', [ownerId, state.ledgerId, state.sequence, now()]);
        scrub(handle, state);
      });
    }
    const initialized = memoryAuthorityState(handle);
    if (!initialized.ok || initialized.ownerId !== ownerId || initialized.ledgerId !== state.ledgerId
      || state.sequence < initialized.ledgerSequence) return fail('forgetting-ledger-mismatch');
    try { durability.proof(); } catch (_) { return fail('memory-commit-outcome-unknown'); }
    const ready = gate(); if (!ready.ok) return ready;
    opened = true;
  } catch (error) { return fail(error?.outcome === 'unknown' ? 'memory-commit-outcome-unknown' : 'memory-cutover-failed'); }

  function list({ status, limit = 100, cursor = null } = {}) {
    const ready = gate(); if (!ready.ok) return { ...ready, items: [], nextCursor: null };
    if (![undefined, 'candidate', 'active', 'paused', 'removed'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 100
      || cursor !== null && !id(cursor)) return fail('memory-list-invalid');
    try {
      const records = readRecords(handle), at = now();
      const items = records.filter(record => (!status || record.status === status) && (cursor === null || record.id > cursor))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const page = items.slice(0, limit).map(record => projection(record, records, at));
      return { ok: true, availability: 'available', items: page, nextCursor: items.length > limit ? page.at(-1).id : null };
    } catch (_) { return fail('memory-read-failed'); }
  }
  function build(request, at) {
    const records = readRecords(handle);
    const result = planMutation(request, records, at);
    if (!result.ok) return result;
    if (result.after) {
      const priorSources = handle.get('SELECT source_refs FROM memory_sources WHERE memory_id=?', [result.after.id]);
      const lineage = priorSources ? JSON.parse(priorSources.source_refs) : [];
      if (new Set([...lineage, ...result.after.sourceRefs].map(sourceKey)).size > 50) return fail('memory-source-capacity');
    }
    if (result.after?.status === 'active') {
      const conflicts = records.filter(record => record.id !== result.after.id && record.status === 'active'
        && topicKey(record) === topicKey(result.after));
      result.invalidatedSourceRefs = sourceRefs([result.before, ...conflicts]);
    }
    if (request.operation === 'permanent-remove') {
      const versions = [...readLineage(handle, records), ...undoRows(handle).map(row => row.record)];
      const affected = new Set(result.affectedIds);
      let refs = sourceRefs(versions.filter(record => affected.has(record.id))), changed = true;
      while (changed) {
        changed = false;
        const keys = new Set(refs.map(sourceKey));
        for (const record of versions) if (!affected.has(record.id) && record.sourceRefs.some(ref => keys.has(sourceKey(ref)))) {
          affected.add(record.id); changed = true;
        }
        refs = sourceRefs(versions.filter(record => affected.has(record.id)));
      }
      result.affectedIds = [...affected].sort(); result.invalidatedSourceRefs = refs;
      result.affectedVersions = records.filter(record => affected.has(record.id)).map(record => ({ id: record.id, version: record.version }));
    }
    return result;
  }
  function preview(request) {
    const ready = gate(); if (!ready.ok) return ready;
    try {
      if (!closed(request, ['operation', 'targetId', 'expectedVersion', 'input', 'resolution', 'allocatedId', 'previewId', 'createdAt', 'undoRecord', 'undoReceiptId', 'candidateOrigin'])
        || !id(request.previewId) || !time(request.createdAt)
        || (request.candidateOrigin !== undefined && !candidateOriginValid(request.candidateOrigin))) return fail('memory-mutation-invalid');
      const result = build(request, request.createdAt); if (!result.ok) return result;
      if (result.after && blocked(result.after, ready.state)) return fail('memory-source-forgotten');
      return { ok: true, preview: { ...copy(request), ...result, ok: undefined, expiresAt: request.createdAt + PREVIEW_TTL_MS,
        undoExpiresAt: result.before && !result.permanent ? request.createdAt + UNDO_TTL_MS : null } };
    } catch (_) { return fail('memory-preview-failed'); }
  }
  function receipt({ receiptId }) {
    const ready = gate({ receiptId }); if (!ready.ok) return ready;
    try {
      const row = handle.get('SELECT * FROM memory_receipts WHERE receipt_id=?', [receiptId]);
      if (!row) return fail('memory-receipt-missing');
      const pending = handle.get('SELECT event_id FROM memory_outbox WHERE receipt_id=? AND delivered_at IS NULL', [receiptId]);
      return { ok: true, receipt: parsedReceipt(row, ownerId), historyStatus: pending ? 'pending' : 'synced' };
    }
    catch (_) { return fail('memory-read-failed'); }
  }
  function lookupConfirmation({ previewId, previewHash, expectedVersion }) {
    const ready = gate({ previewId, previewHash, expectedVersion }); if (!ready.ok) return ready;
    try {
      const row = handle.get('SELECT * FROM memory_receipts WHERE command_id=?', [previewId]);
      if (!row) return { ok: true, receipt: null };
      const value = parsedReceipt(row, ownerId);
      if (row.preview_hash !== previewHash || value.beforeVersion !== expectedVersion) return fail('memory-confirmation-conflict');
      const pending = handle.get('SELECT event_id FROM memory_outbox WHERE receipt_id=? AND delivered_at IS NULL', [value.receiptId]);
      return { ok: true, receipt: value, historyStatus: pending ? 'pending' : 'synced' };
    } catch (_) { return fail('memory-read-failed'); }
  }
  function undo({ receiptId }) {
    const ready = gate(); if (!ready.ok) return ready;
    try {
      const row = undoRows(handle).find(item => item.receipt_id === receiptId && item.expires_at > now());
      const current = row && readRecords(handle).find(item => item.id === row.memory_id);
      if (!row || current?.version !== row.post_version) return fail('memory-undo-unavailable');
      return { ok: true, targetId: row.memory_id, expectedVersion: row.post_version, undoRecord: row.record, undoReceiptId: receiptId };
    } catch (_) { return fail('memory-read-failed'); }
  }
  function commit({ preview: proposed, previewHash, receiptId, eventId }) {
    const ready = gate(); if (!ready.ok) return ready;
    let invalidation = null;
    const identity = { previewId: proposed?.previewId, previewHash, expectedVersion: proposed?.expectedVersion, receiptId };
    try {
      if (!id(receiptId) || !id(eventId) || entityFingerprint(proposed) !== previewHash) return fail('memory-confirmation-invalid');
      const prior = handle.get('SELECT * FROM memory_receipts WHERE command_id=?', [proposed.previewId]);
      if (prior) return prior.preview_hash === previewHash ? { ok: true, receipt: parsedReceipt(prior, ownerId), replayed: true, historyStatus: 'pending' }
        : fail('memory-confirmation-conflict');
      const at = now(), eventTimeContext = timeContextFor(at);
      if (!eventTimeContextValid(eventTimeContext, at)) return fail('memory-clock-invalid');
      if (at < proposed.createdAt || at >= proposed.expiresAt) return fail('memory-preview-expired');
      if (proposed.before?.status === 'removed' && at >= proposed.before.recycleUntil
        && proposed.operation !== 'permanent-remove') return fail('memory-recycle-expired');
      const validate = () => {
        if (proposed.candidateOrigin && handle.get('SELECT receipt_id FROM memory_receipts WHERE origin_conversation_id=? AND origin_proposal_id=?',
          [proposed.candidateOrigin.conversationId, proposed.candidateOrigin.proposalId])) throw new Error('memory-candidate-already-reviewed');
        const rebuilt = build(proposed, proposed.createdAt);
        if (!rebuilt.ok) throw new Error(rebuilt.reason);
        for (const key of ['before', 'after', 'affectedIds', 'invalidatedSourceRefs', 'affectedVersions']) {
          const project = ['before', 'after'].includes(key) ? withoutUsage : value => value;
          if (!isDeepStrictEqual(project(rebuilt[key]), project(proposed[key]))) throw new Error('memory-preview-drift');
        }
        if (rebuilt.after && blocked(rebuilt.after, ready.state)) throw new Error('memory-source-forgotten');
        if (proposed.operation === 'undo' && !undoRows(handle).some(row => row.receipt_id === proposed.undoReceiptId && row.expires_at > at
          && row.post_version === proposed.expectedVersion && isDeepStrictEqual(row.record, proposed.undoRecord))) throw new Error('memory-undo-unavailable');
        return rebuilt;
      };
      validate();
      if (proposed.permanent) {
        invalidation = forgettingLedger.invalidate({ commandId: proposed.previewId, memoryIds: proposed.affectedIds,
          sourceRefs: proposed.invalidatedSourceRefs, at, receiptId, eventId, previewHash,
          targetId: proposed.before.id, beforeVersion: proposed.before.version, candidateOrigin: proposed.candidateOrigin || null, eventTimeContext });
        if (!invalidation.ok) return fail(invalidation.reason);
        const permanentReceipt = durability.run(() => {
          scrub(handle, invalidation);
          return JSON.parse(handle.get('SELECT receipt FROM memory_receipts WHERE command_id=?', [proposed.previewId]).receipt);
        }, identity);
        return { ok: true, receipt: permanentReceipt, replayed: invalidation.replayed, historyStatus: 'pending',
          invalidatedSourceRefs: proposed.invalidatedSourceRefs };
      }
      const result = durability.run(() => {
        const rebuilt = validate();
        if (handle.get('SELECT COUNT(*) AS count FROM memory_receipts').count >= 2000) throw new Error('memory-receipt-capacity');
        const memoryId = proposed.after?.id || proposed.before.id;
        if (proposed.permanent) scrub(handle, invalidation);
        else {
          writeRecord(handle, stampCommittedRecord(rebuilt.after, proposed.operation, at));
          handle.run('DELETE FROM memory_undo WHERE memory_id=? OR expires_at<=?', [memoryId, at]);
          if (proposed.before && proposed.operation !== 'undo') handle.run('INSERT INTO memory_undo VALUES(?,?,?,?,?)',
            [memoryId, proposed.after.version, at + UNDO_TTL_MS, receiptId, JSON.stringify(proposed.before)]);
        }
        if (proposed.candidateOrigin && handle.get('SELECT receipt_id FROM memory_receipts WHERE origin_conversation_id=? AND origin_proposal_id=?',
          [proposed.candidateOrigin.conversationId, proposed.candidateOrigin.proposalId])) throw new Error('memory-candidate-already-reviewed');
        const value = { version: 1, receiptId, commandId: proposed.previewId, ownerId, store: 'memory', candidateOrigin: proposed.candidateOrigin || null,
          operation: proposed.operation, memoryId, beforeVersion: proposed.before?.version || null,
          afterVersion: proposed.after?.version || null, affectedIds: proposed.affectedIds, previewHash, committedAt: at,
          undoExpiresAt: proposed.before && !proposed.permanent && proposed.operation !== 'undo' ? at + UNDO_TTL_MS : null,
          revertsReceiptId: proposed.undoReceiptId || null, permanent: proposed.permanent, eventId };
        const event = { version: 1, id: eventId, kind: proposed.operation === 'undo' ? 'memory.reverted' : 'memory.changed',
          ownerId, receiptId, commandId: proposed.previewId, occurredAt: at, ...eventTimeContext, memoryId, operation: proposed.operation,
          entityVersion: value.afterVersion, affectedIds: value.affectedIds, permanent: value.permanent };
        handle.run('INSERT INTO memory_receipts VALUES(?,?,?,?,?,?,?)', [receiptId, proposed.previewId, memoryId, previewHash, JSON.stringify(value),
          proposed.candidateOrigin?.conversationId || null, proposed.candidateOrigin?.proposalId || null]);
        handle.run('INSERT INTO memory_outbox VALUES(?,?,?,NULL)', [eventId, receiptId, JSON.stringify(event)]);
        return value;
      }, identity);
      return { ok: true, receipt: result, replayed: false, historyStatus: 'pending', invalidatedSourceRefs: proposed.invalidatedSourceRefs };
    } catch (error) {
      return { ...fail(/^memory-[a-z-]+$/.test(error?.message || '') ? error.message : 'memory-commit-failed'),
        ...(invalidation?.ok ? { forgettingCommitted: true, cleanupPending: true, receiptId, eventId,
          invalidatedSourceRefs: proposed.invalidatedSourceRefs } : {}) };
    }
  }
  function usage({ references, at = now() }) {
    const ready = gate(); if (!ready.ok) return ready;
    if (!Array.isArray(references) || references.length > 8 || !time(at) || at > now() || references.some(ref => !closed(ref, ['id', 'version'])
      || !id(ref.id) || !Number.isInteger(ref.version))) return fail('memory-usage-invalid');
    try {
      return durability.run(() => {
        const records = readRecords(handle), used = [];
        for (const ref of references) {
          const record = records.find(item => item.id === ref.id && item.version === ref.version);
          if (!record || record.createdAt > at || !projection(record, records, at).contextAllowed
            || record.useCount >= Number.MAX_SAFE_INTEGER) throw new Error('memory-usage-stale');
          if (!used.includes(record.id)) { record.useCount++; record.lastUsedAt = at; writeRecord(handle, record); used.push(record.id); }
        }
        return { ok: true, updated: used.length };
      });
    } catch (error) { return fail(error?.outcome === 'unknown' ? 'memory-commit-outcome-unknown' : 'memory-usage-stale'); }
  }
  function outbox({ limit = 100 } = {}) {
    const ready = gate(); if (!ready.ok) return ready;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail('memory-outbox-invalid');
    try { return { ok: true, items: handle.all('SELECT event FROM memory_outbox WHERE delivered_at IS NULL ORDER BY rowid LIMIT ?', [limit]).map(row => {
      const value = JSON.parse(row.event); if (!eventValid(value) || value.ownerId !== ownerId) throw new Error('memory-authority-invalid'); return value;
    }) }; }
    catch (_) { return fail('memory-read-failed'); }
  }
  function acknowledgeOutbox({ eventId }) {
    const ready = gate(); if (!ready.ok) return ready;
    try { const result = durability.run(() => handle.run('UPDATE memory_outbox SET delivered_at=? WHERE event_id=? AND delivered_at IS NULL', [now(), eventId]));
      return { ok: true, updated: Number(result.changes) }; } catch (error) { return fail(error?.outcome === 'unknown' ? 'memory-commit-outcome-unknown' : 'memory-outbox-failed'); }
  }
  function forgettingState() {
    const ready = gate(); if (!ready.ok) return ready;
    return { ok: true, ownerId, ledgerId: ready.state.ledgerId, sequence: ready.state.sequence,
      memoryIds: copy(ready.state.memoryIds), sourceRefs: copy(ready.state.sourceRefs) };
  }
  function candidateStatus({ conversationId, proposalId }) {
    const ready = gate(); if (!ready.ok) return ready;
    if (!id(conversationId) || !id(proposalId)) return fail('memory-candidate-invalid');
    try {
      const row = handle.get('SELECT * FROM memory_receipts WHERE origin_conversation_id=? AND origin_proposal_id=?', [conversationId, proposalId]);
      if (!row) return { ok: true, receipt: null };
      const receipt = parsedReceipt(row, ownerId);
      if (receipt.candidateOrigin?.conversationId !== conversationId || receipt.candidateOrigin?.proposalId !== proposalId) return fail('memory-authority-invalid');
      const record = readRecords(handle).find(item => item.id === receipt.memoryId);
      const reverted = handle.all('SELECT * FROM memory_receipts WHERE memory_id=?', [receipt.memoryId])
        .map(item => parsedReceipt(item, ownerId)).some(item => item.operation === 'undo'
          && item.revertsReceiptId === receipt.receiptId && item.beforeVersion === receipt.afterVersion
          && item.afterVersion === item.beforeVersion + 1);
      const pending = handle.get('SELECT event_id FROM memory_outbox WHERE receipt_id=? AND delivered_at IS NULL', [receipt.receiptId]);
      return { ok: true, receipt, status: reverted ? 'reverted' : !record || record.status === 'removed' ? 'removed' : 'applied',
        currentVersion: record?.version || null, memoryStatus: record?.status || 'removed', historyStatus: pending ? 'pending' : 'synced' };
    } catch (_) { return fail('memory-read-failed'); }
  }
  function findBySource(reference) {
    const ready = gate(); if (!ready.ok) return ready;
    if (!sourceRefsValid([{ ...reference, revision: null }])) return fail('memory-source-invalid');
    try {
      const records = readLineage(handle, readRecords(handle));
      return { ok: true, memoryIds: records.filter(record => record.sourceRefs.some(ref => sourceKey(ref) === sourceKey(reference))).map(record => record.id) };
    } catch (_) { return fail('memory-read-failed'); }
  }
  function getVersion({ id: memoryId }) {
    const ready = gate(); if (!ready.ok) return ready;
    try {
      const records = readRecords(handle), record = records.find(item => item.id === memoryId);
      if (!record) return fail('memory-missing');
      return { ok: true, id: record.id, version: record.version, status: record.status,
        contextAllowed: projection(record, records, now()).contextAllowed };
    } catch (_) { return fail('memory-read-failed'); }
  }
  const contextReader = createMemoryContextReader({ ownerId, now,
    readHandle: Object.freeze({ all: (...args) => handle.all(...args), get: (...args) => handle.get(...args) }),
    readLedgerState: () => forgettingLedger.state(), isPending: () => durability.isPending() });
  return { ok: opened, repository: Object.freeze({ available: true, contextReader, list, preview, commit, receipt, lookupConfirmation,
    undo, usage, outbox, acknowledgeOutbox, forgettingState, getVersion, findBySource, candidateStatus }) };
}
module.exports = { memoryAuthorityState, openVersionedMemoryAuthority, createMemoryContextReader };
