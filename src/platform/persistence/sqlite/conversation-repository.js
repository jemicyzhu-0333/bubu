'use strict';

const { validateConversationSnapshot, isConversationSuccessor, MAX_SNAPSHOT_BYTES, id, time, immutable } = require('../../../application/ai/conversation-record');
const { conversationListMetadata } = require('../../../application/ai/conversation-catalog');
const DAY_MS = 86400000;

function createConversationRepository({ handle, ownerId, prove = null }) {
  const pending = new Map();
  let transactionOpen = false;
  const unknown = () => ({ ok: false, reason: 'conversation-save-unknown', durability: 'unknown' });
  function settleTransaction() {
    if (!transactionOpen) return true;
    try { handle.exec('ROLLBACK'); transactionOpen = false; }
    catch (error) {
      // SQLite reports this only after the connection has left its transaction,
      // including a COMMIT which completed before its wrapper threw.
      if (/no transaction is active/i.test(String(error?.message || ''))) transactionOpen = false;
    }
    return !transactionOpen;
  }
  function reconcileSave({ ownerId: caller, snapshot, expectedRevision } = {}) {
    if (caller !== ownerId || snapshot?.ownerId !== ownerId) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (!validateConversationSnapshot(snapshot) || !time(expectedRevision)) return { ok: false, reason: 'conversation-snapshot-invalid' };
    const attempt = pending.get(snapshot.id);
    if (!attempt || attempt.expectedRevision !== expectedRevision || attempt.after.snapshot !== JSON.stringify(snapshot)) return unknown();
    try {
      if (!settleTransaction() || typeof prove !== 'function') return unknown();
      const outcome = prove(attempt);
      if (!['committed', 'rolled-back'].includes(outcome)) return unknown();
      pending.delete(snapshot.id);
      return { ok: true, outcome, revision: outcome === 'committed' ? snapshot.revision : expectedRevision };
    } catch (_) { return unknown(); }
  }
  function owner(request) { return request?.ownerId === ownerId; }
  function readFailure(error) {
    const corrupt = error instanceof SyntaxError || /conversation-corrupt|malformed|not a database|disk image/i.test(String(error?.message || ''));
    return { ok: false, reason: corrupt ? 'conversation-storage-corrupt' : 'conversation-storage-unavailable' };
  }
  function decode(row) {
    if (typeof row.snapshot !== 'string' || Buffer.byteLength(row.snapshot, 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('conversation-corrupt');
    const snapshot = JSON.parse(row.snapshot);
    const expiry = snapshot.retention.pinned ? null : snapshot.updatedAt + snapshot.retention.days * DAY_MS;
    if (!validateConversationSnapshot(snapshot) || snapshot.retention.mode !== 'saved'
      || snapshot.ownerId !== ownerId || snapshot.id !== row.id || snapshot.revision !== row.revision
      || snapshot.createdAt !== row.created_at || snapshot.updatedAt !== row.updated_at
      || expiry !== row.expires_at) throw new Error('conversation-corrupt');
    return immutable(snapshot);
  }
  function load(request = {}) {
    if (!owner(request)) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (pending.has(request.conversationId) || transactionOpen) return unknown();
    if (request.now !== undefined && !time(request.now)) return { ok: false, reason: 'conversation-retention-invalid' };
    if (!id(request.conversationId)) return { ok: false, reason: 'conversation-id-invalid' };
    try {
      const row = handle.get('SELECT * FROM conversations WHERE owner_id = ? AND id = ?', [ownerId, request.conversationId]);
      if (row && request.now !== undefined && row.expires_at !== null && row.expires_at <= request.now) {
        return { ok: false, reason: 'conversation-expired' };
      }
      return row ? { ok: true, conversation: decode(row) } : { ok: false, reason: 'conversation-not-found' };
    } catch (error) { return readFailure(error); }
  }
  function listPage({ ownerId: caller, limit = 20, cursor = null, now } = {}) {
    if (caller !== ownerId) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (pending.size || transactionOpen) return unknown();
    if (now !== undefined && !time(now)) return { ok: false, reason: 'conversation-retention-invalid' };
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return { ok: false, reason: 'conversation-page-invalid' };
    let position = null;
    if (cursor !== null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 1000) throw new Error('cursor');
        position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!position || Object.keys(position).length !== 2 || !time(position.updatedAt) || !id(position.id)) throw new Error('cursor');
      } catch (_) { return { ok: false, reason: 'conversation-cursor-invalid' }; }
    }
    try {
      const expiry = now === undefined ? '' : ' AND (expires_at IS NULL OR expires_at > ?)';
      const where = expiry + (position ? ' AND (updated_at < ? OR (updated_at = ? AND id > ?))' : '');
      const params = [ownerId, ...(now === undefined ? [] : [now]),
        ...(position ? [position.updatedAt, position.updatedAt, position.id] : []), limit + 1];
      const rows = handle.all(`SELECT id, updated_at FROM conversations WHERE owner_id = ?${where} ORDER BY updated_at DESC, id ASC LIMIT ?`, params);
      const items = rows.slice(0, limit).map(row => {
        const value = decode(handle.get('SELECT * FROM conversations WHERE owner_id = ? AND id = ?', [ownerId, row.id]));
        return immutable(conversationListMetadata(value));
      });
      const last = items.at(-1);
      const nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString('base64url') : null;
      return { ok: true, items, nextCursor };
    } catch (error) { return readFailure(error); }
  }
  function saveSnapshot({ ownerId: caller, snapshot, expectedRevision, now } = {}) {
    if (caller !== ownerId || snapshot?.ownerId !== ownerId) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (!validateConversationSnapshot(snapshot) || snapshot.retention.mode !== 'saved'
      || (now !== undefined && !time(now)) || !time(expectedRevision) || snapshot.revision <= expectedRevision) return { ok: false, reason: 'conversation-snapshot-invalid' };
    if (pending.size || !settleTransaction()) return { ok: false, reason: 'conversation-save-blocked' };
    let attempted = null;
    try {
      transactionOpen = true;
      handle.exec('BEGIN IMMEDIATE');
      const existing = handle.get('SELECT * FROM conversations WHERE owner_id = ? AND id = ?', [ownerId, snapshot.id]);
      if (now !== undefined && existing?.expires_at !== null && existing?.expires_at <= now) {
        handle.exec('ROLLBACK'); transactionOpen = false;
        return { ok: false, reason: 'conversation-expired' };
      }
      if ((existing?.revision || 0) !== expectedRevision) {
        handle.exec('ROLLBACK'); transactionOpen = false;
        return { ok: false, reason: 'conversation-revision-conflict' };
      }
      if (existing && !isConversationSuccessor(decode(existing), snapshot)) {
        handle.exec('ROLLBACK'); transactionOpen = false;
        return { ok: false, reason: 'conversation-history-conflict' };
      }
      const expires = snapshot.retention.pinned ? null : snapshot.updatedAt + snapshot.retention.days * DAY_MS;
      if (now !== undefined && expires !== null && expires <= now) {
        handle.exec('ROLLBACK'); transactionOpen = false;
        return { ok: false, reason: 'conversation-expired' };
      }
      attempted = immutable({ expectedRevision, before: existing ? { ...existing } : null, after: { id: snapshot.id, owner_id: ownerId,
        revision: snapshot.revision, created_at: snapshot.createdAt, updated_at: snapshot.updatedAt,
        expires_at: expires, snapshot: JSON.stringify(snapshot) } });
      handle.run(`INSERT INTO conversations(id, owner_id, revision, created_at, updated_at, expires_at, snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
        updated_at=excluded.updated_at, expires_at=excluded.expires_at, snapshot=excluded.snapshot`,
      [snapshot.id, ownerId, snapshot.revision, snapshot.createdAt, snapshot.updatedAt, expires, JSON.stringify(snapshot)]);
      handle.exec('COMMIT'); transactionOpen = false;
      return { ok: true, revision: snapshot.revision };
    } catch (_) {
      settleTransaction();
      if (attempted) {
        pending.set(snapshot.id, attempted);
        const recovered = reconcileSave({ ownerId, snapshot, expectedRevision });
        if (!recovered.ok) return recovered;
        if (recovered.outcome === 'committed') return { ok: true, revision: recovered.revision };
      }
      return { ok: false, reason: 'conversation-save-failed' };
    }
  }
  function remove({ ownerId: caller, conversationId, expectedRevision } = {}) {
    if (caller !== ownerId) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (pending.size || !settleTransaction()) return unknown();
    if (!id(conversationId) || (expectedRevision !== undefined && !time(expectedRevision))) return { ok: false, reason: 'conversation-delete-invalid' };
    try {
      const where = expectedRevision === undefined ? '' : ' AND revision = ?';
      const params = expectedRevision === undefined ? [ownerId, conversationId] : [ownerId, conversationId, expectedRevision];
      const result = handle.run(`DELETE FROM conversations WHERE owner_id = ? AND id = ?${where}`, params);
      if (!Number(result.changes) && expectedRevision !== undefined && handle.get('SELECT id FROM conversations WHERE owner_id = ? AND id = ?', [ownerId, conversationId])) {
        return { ok: false, reason: 'conversation-revision-conflict' };
      }
      return { ok: true, removed: Number(result.changes) };
    } catch (_) { return { ok: false, reason: 'conversation-delete-failed' }; }
  }
  function pruneRetention({ ownerId: caller, now } = {}) {
    if (caller !== ownerId) return { ok: false, reason: 'conversation-owner-mismatch' };
    if (pending.size || !settleTransaction()) return unknown();
    if (!time(now)) return { ok: false, reason: 'conversation-retention-invalid' };
    try {
      const result = handle.run('DELETE FROM conversations WHERE owner_id = ? AND expires_at IS NOT NULL AND expires_at <= ?', [ownerId, now]);
      return { ok: true, removed: Number(result.changes) };
    } catch (_) { return { ok: false, reason: 'conversation-retention-failed' }; }
  }
  return Object.freeze({ load, listPage, saveSnapshot, reconcileSave, delete: remove, pruneRetention });
}

module.exports = { createConversationRepository };
