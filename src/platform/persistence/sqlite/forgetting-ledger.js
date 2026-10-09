'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryDurability } = require('./memory-durability');
const { randomUUID } = require('node:crypto');
const { id, sourceKey, sourceRefsValid, time, candidateOriginValid, eventTimeContextValid } = require('../../../core/memory-protocol');

const LEDGER_SCHEMA = [
  `CREATE TABLE forgetting_identity (singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    owner_id TEXT NOT NULL, ledger_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    verification_count INTEGER NOT NULL CHECK(verification_count >= 0 AND verification_count <= 9007199254740991))`,
  `CREATE TABLE forgetting_entries (command_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,
    memory_ids TEXT NOT NULL, source_refs TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    receipt_id TEXT NOT NULL, event_id TEXT NOT NULL, preview_hash TEXT NOT NULL,
    target_id TEXT NOT NULL, before_version INTEGER NOT NULL, candidate_origin TEXT, event_time_context TEXT NOT NULL)`
];
const canonical = sql => sql.replace(/\s+/g, ' ').trim();
const fail = reason => ({ ok: false, reason, ...(reason === 'forgetting-commit-outcome-unknown'
  ? { retrySameIdentity: true, outcome: 'unknown' } : {}) });
function validateLedger(handle, ownerId, expectedLedgerId) {
  if (handle.userVersion() > 1) throw new Error('forgetting-ledger-future-version');
  if (handle.userVersion() !== 1 || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok') throw new Error('forgetting-ledger-invalid');
  const schema = handle.all("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (schema.length !== LEDGER_SCHEMA.length || LEDGER_SCHEMA.some(sql => !schema.some(row => row.type === 'table' && canonical(row.sql) === canonical(sql)))) {
    throw new Error('forgetting-ledger-invalid');
  }
  const identities = handle.all('SELECT * FROM forgetting_identity');
  const identity = identities[0];
  if (identities.length !== 1 || identity.singleton !== 1 || identity.owner_id !== ownerId || !id(identity.ledger_id)
    || expectedLedgerId && expectedLedgerId !== identity.ledger_id || !Number.isSafeInteger(identity.sequence) || identity.sequence < 0
    || !Number.isSafeInteger(identity.verification_count) || identity.verification_count < 0) {
    throw new Error('forgetting-ledger-mismatch');
  }
  const entries = handle.all('SELECT * FROM forgetting_entries ORDER BY sequence');
  if (entries.length !== identity.sequence) throw new Error('forgetting-ledger-invalid');
  const memoryIds = new Set(), sourceRefs = new Map(), removals = [], origins = new Set();
  for (const [index, entry] of entries.entries()) {
    const ids = JSON.parse(entry.memory_ids), refs = JSON.parse(entry.source_refs);
    const eventTimeContext = JSON.parse(entry.event_time_context);
    if (!eventTimeContextValid(eventTimeContext, entry.recorded_at)) throw new Error('forgetting-ledger-invalid');
    const origin = entry.candidate_origin === null ? null : JSON.parse(entry.candidate_origin);
    const originKey = origin && JSON.stringify([origin.conversationId, origin.proposalId]);
    if (origin !== null && (!candidateOriginValid(origin) || origins.has(originKey))) throw new Error('forgetting-ledger-invalid');
    if (originKey) origins.add(originKey);
    if (entry.sequence !== index + 1 || !id(entry.command_id) || !time(entry.recorded_at)
      || !Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(id)
      || !Array.isArray(refs) || refs.length > 25000 || refs.some(ref => !sourceRefsValid([ref]))
      || !id(entry.receipt_id) || !id(entry.event_id) || !id(entry.target_id) || !ids.includes(entry.target_id)
      || !/^[a-f0-9]{64}$/.test(entry.preview_hash) || !Number.isSafeInteger(entry.before_version) || entry.before_version < 1) throw new Error('forgetting-ledger-invalid');
    ids.forEach(value => memoryIds.add(value));
    refs.forEach(ref => sourceRefs.set(sourceKey(ref), ref));
    removals.push({ commandId: entry.command_id, receiptId: entry.receipt_id, eventId: entry.event_id,
      previewHash: entry.preview_hash, targetId: entry.target_id, beforeVersion: entry.before_version,
      affectedIds: ids, committedAt: entry.recorded_at, candidateOrigin: origin, eventTimeContext });
  }
  return { ok: true, ownerId, ledgerId: identity.ledger_id, sequence: identity.sequence,
    memoryIds: [...memoryIds], sourceRefs: [...sourceRefs.values()], removals };
}

// This authority must live outside ordinary restorable memory backups. An
// explicitly unknown/imported restore is never considered a current ledger.
// Simultaneous rollback of both stores needs that external restore signal.
function openSqliteForgettingLedger({ filePath, ownerId, expectedLedgerId = null, create = false,
  restoreState = 'unknown', lockAcquired, driver = 'auto', io = fs, idFactory = randomUUID } = {}, { selectDriver, makeHandle }) {
  const unavailable = reason => ({ status: 'unavailable', reason, ledger: null, close() {} });
  if (lockAcquired !== true) return unavailable('profile-lock-required');
  if (restoreState !== 'current-local') return unavailable('forgetting-review-required');
  if (!id(ownerId) || typeof filePath !== 'string' || !filePath || filePath === ':memory:') return unavailable('forgetting-ledger-path-invalid');
  let handle, closed = false;
  try {
    const selected = selectDriver(driver);
    if (!selected) return unavailable('sqlite-unavailable');
    const exists = io.existsSync(filePath);
    if (!exists && (!create || expectedLedgerId || ['-wal', '-shm'].some(suffix => io.existsSync(filePath + suffix)))) return unavailable('forgetting-ledger-missing');
    if (exists) {
      handle = makeHandle(selected.open(filePath, { readOnly: true }));
      validateLedger(handle, ownerId, expectedLedgerId); handle.close();
    } else {
      io.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = io.openSync(filePath, 'wx', 0o600);
      try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    }
    handle = makeHandle(selected.open(filePath));
    handle.exec('PRAGMA journal_mode=WAL'); handle.exec('PRAGMA synchronous=FULL');
    if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal' || handle.get('PRAGMA synchronous')?.synchronous !== 2) throw new Error('forgetting-ledger-durability-unavailable');
    const readFresh = action => {
      const reader = makeHandle(selected.open(filePath, { readOnly: true }));
      try { return action(reader); } finally { reader.close(); }
    };
    if (!exists) {
      const ledgerId = idFactory();
      if (!id(ledgerId)) throw new Error('forgetting-ledger-identity-invalid');
      handle.exec('BEGIN IMMEDIATE');
      let commitAttempted = false;
      try {
        LEDGER_SCHEMA.forEach(sql => handle.exec(sql));
        handle.run('INSERT INTO forgetting_identity VALUES(1,?,?,0,0)', [ownerId, ledgerId]);
        handle.setUserVersion(1); commitAttempted = true; handle.exec('COMMIT');
      } catch (error) {
        try { handle.exec('ROLLBACK'); } catch (_) {}
        if (!commitAttempted) throw error;
        try { readFresh(reader => validateLedger(reader, ownerId, ledgerId)); }
        catch (_) { throw new Error('forgetting-commit-outcome-unknown'); }
      }
    }
    const identity = validateLedger(handle, ownerId, expectedLedgerId);
    const ledgerId = identity.ledgerId;
    const durability = createMemoryDurability({ handle, kind: 'forgetting', readFresh,
      validate: reader => validateLedger(reader, ownerId, ledgerId) });
    try { durability.proof(); } catch (_) { throw new Error('forgetting-commit-outcome-unknown'); }
    function state() {
      if (durability.isPending()) return fail('forgetting-commit-outcome-unknown');
      if (closed || !io.existsSync(filePath)) return fail('forgetting-ledger-unavailable');
      try { return validateLedger(handle, ownerId, ledgerId); }
      catch (_) { return fail('forgetting-ledger-unavailable'); }
    }
    function recover(identity) {
      try { durability.recover(identity); return state(); }
      catch (_) { return fail('forgetting-commit-outcome-unknown'); }
    }
    function invalidate({ commandId, memoryIds, sourceRefs, at, receiptId, eventId, previewHash, targetId, beforeVersion, candidateOrigin = null, eventTimeContext }) {
      if (!eventTimeContextValid(eventTimeContext, at)) return fail('forgetting-ledger-input-invalid');
      if (candidateOrigin !== null && !candidateOriginValid(candidateOrigin)) return fail('forgetting-ledger-input-invalid');
      if (!id(commandId) || !Array.isArray(memoryIds) || !memoryIds.length || memoryIds.length > 500 || !memoryIds.every(id)
        || !Array.isArray(sourceRefs) || sourceRefs.length > 25000 || sourceRefs.some(ref => !sourceRefsValid([ref])) || !time(at)
        || !id(receiptId) || !id(eventId) || !id(targetId) || !memoryIds.includes(targetId)
        || !/^[a-f0-9]{64}$/.test(previewHash) || !Number.isSafeInteger(beforeVersion) || beforeVersion < 1) return fail('forgetting-ledger-input-invalid');
      const current = state(); if (!current.ok) return current;
      const timeJson = JSON.stringify({ timezone: eventTimeContext.timezone, utcOffsetMinutes: eventTimeContext.utcOffsetMinutes, localDayKey: eventTimeContext.localDayKey });
      const originJson = candidateOrigin === null ? null : JSON.stringify({ conversationId: candidateOrigin.conversationId,
        proposalId: candidateOrigin.proposalId, messageId: candidateOrigin.messageId });
      const idsJson = JSON.stringify([...new Set(memoryIds)].sort());
      const refsJson = JSON.stringify([...new Map(sourceRefs.map(ref => [sourceKey(ref), { ...ref, revision: null }])).values()]
        .sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))));
      try {
        return durability.run(() => {
        const prior = handle.get('SELECT * FROM forgetting_entries WHERE command_id=?', [commandId]);
        if (prior) {
          if (prior.memory_ids !== idsJson || prior.source_refs !== refsJson || prior.preview_hash !== previewHash || prior.target_id !== targetId
            || prior.before_version !== beforeVersion || prior.candidate_origin !== originJson || prior.event_time_context !== timeJson) throw new Error('forgetting-ledger-conflict');
          return { ...validateLedger(handle, ownerId, ledgerId), replayed: true };
        }
        const verified = validateLedger(handle, ownerId, ledgerId);
        if (candidateOrigin && verified.removals.some(removal => removal.candidateOrigin?.conversationId === candidateOrigin.conversationId
          && removal.candidateOrigin?.proposalId === candidateOrigin.proposalId)) throw new Error('forgetting-ledger-conflict');
        if (verified.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('forgetting-ledger-capacity');
        handle.run('INSERT INTO forgetting_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [commandId, verified.sequence + 1, idsJson, refsJson, at,
          receiptId, eventId, previewHash, targetId, beforeVersion, originJson, timeJson]);
        handle.run('UPDATE forgetting_identity SET sequence=? WHERE singleton=1', [verified.sequence + 1]);
        return { ...validateLedger(handle, ownerId, ledgerId), replayed: false };
        }, { previewId: commandId, previewHash, expectedVersion: beforeVersion, receiptId });
      } catch (error) { return fail(error?.outcome === 'unknown' ? 'forgetting-commit-outcome-unknown' : 'forgetting-ledger-write-failed'); }
    }
    return { status: 'available', ownerId, ledgerId, ledger: Object.freeze({ state, invalidate, recover }),
      close() { closed = true; handle.close(); } };
  } catch (error) {
    if (handle) handle.close();
    return unavailable(/^forgetting-[a-z-]+$/.test(error?.message || '') ? error.message : 'forgetting-ledger-unavailable');
  }
}
module.exports = { LEDGER_SCHEMA, openSqliteForgettingLedger };
