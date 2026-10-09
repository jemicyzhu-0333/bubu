'use strict';

const ROW_FIELDS = ['id', 'owner_id', 'revision', 'created_at', 'updated_at', 'expires_at', 'snapshot'];
function sameRow(a, b) {
  if (!a || !b) return !a && !b;
  return ROW_FIELDS.every(key => a[key] === b[key]);
}

// ARCHITECTURE「持久化与迁移」: readable WAL is not a durable commit receipt.
// A marker-only FULL transaction proves the exact row without replaying business work.
function createConversationCommitProof({ filePath, ownerId, driver, makeHandle, handle, verify }) {
  const memory = filePath === ':memory:';
  let memoryTransactionOpen = false;
  const open = readOnly => memory ? handle : makeHandle(driver.open(filePath, readOnly ? { readOnly: true } : {}));
  const close = reader => { if (!memory) reader.close(); };
  function inspect(reader, pending, startupRows) {
    verify(reader);
    if (!pending) {
      const rows = reader.all('SELECT * FROM conversations ORDER BY id');
      if (startupRows && (rows.length !== startupRows.length || rows.some((row, i) => !sameRow(row, startupRows[i])))) {
        throw new Error('conversation-proof-conflict');
      }
      return rows;
    }
    const row = reader.get('SELECT * FROM conversations WHERE owner_id = ? AND id = ?', [ownerId, pending.after.id]);
    if (sameRow(row, pending.after)) return 'committed';
    if (sameRow(row, pending.before)) return 'rolled-back';
    throw new Error('conversation-proof-conflict');
  }
  function settleMemoryTransaction() {
    if (!memoryTransactionOpen) return;
    try { handle.exec('ROLLBACK'); memoryTransactionOpen = false; }
    catch (error) {
      if (/no transaction is active/i.test(String(error?.message || ''))) memoryTransactionOpen = false;
    }
    if (memoryTransactionOpen) throw new Error('conversation-proof-transaction-unknown');
  }
  return function prove(pending = null) {
    // In-memory fixtures have no independent connection. Never inspect a marker
    // left inside an unsettled transaction from an earlier failed proof.
    settleMemoryTransaction();
    const reader = open(true);
    let observed;
    try { observed = inspect(reader, pending); } finally { close(reader); }
    const writer = open(false);
    let count;
    try {
      writer.exec('PRAGMA synchronous = FULL');
      writer.exec('PRAGMA busy_timeout = 2000');
      if (Number(writer.get('PRAGMA synchronous')?.synchronous) !== 2
        || (!memory && writer.get('PRAGMA journal_mode')?.journal_mode !== 'wal')) throw new Error('conversation-proof-pragmas');
      if (memory) memoryTransactionOpen = true;
      try {
        writer.exec('BEGIN IMMEDIATE');
        const outcome = inspect(writer, pending, pending ? null : observed);
        if (pending && outcome !== observed) throw new Error('conversation-proof-conflict');
        const previous = writer.get('SELECT verification_count FROM collaboration_durability WHERE singleton = 1').verification_count;
        count = previous + 1;
        if (!Number.isSafeInteger(count)) throw new Error('conversation-proof-limit');
        const changed = writer.run('UPDATE collaboration_durability SET verification_count = ? WHERE singleton = 1 AND verification_count = ?', [count, previous]);
        if (Number(changed.changes) !== 1) throw new Error('conversation-proof-conflict');
        writer.exec('COMMIT');
        if (memory) memoryTransactionOpen = false;
      } catch (error) {
        try { writer.exec('ROLLBACK'); if (memory) memoryTransactionOpen = false; } catch (_) {}
        throw error;
      }
    } finally { close(writer); }
    const confirmation = open(true);
    try {
      const outcome = inspect(confirmation, pending, pending ? null : observed);
      if ((pending && outcome !== observed)
        || confirmation.get('SELECT verification_count FROM collaboration_durability WHERE singleton = 1').verification_count !== count) {
        throw new Error('conversation-proof-conflict');
      }
    } finally { close(confirmation); }
    return pending ? observed : 'startup';
  };
}

module.exports = { createConversationCommitProof, sameRow };
