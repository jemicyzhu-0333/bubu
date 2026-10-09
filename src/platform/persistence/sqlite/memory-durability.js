'use strict';
const { entityFingerprint } = require('../../../application/ai/entity-fingerprint');

const SCOPES = Object.freeze({
  memory: ['memory_authority', 'memory_records', 'memory_sources', 'memory_undo', 'memory_receipts', 'memory_outbox', 'agent_memories'],
  forgetting: ['forgetting_identity', 'forgetting_entries']
});
const unknown = kind => Object.assign(new Error(`${kind}-commit-outcome-unknown`), { retrySameIdentity: true, outcome: 'unknown' });

// ARCHITECTURE「事务、投影与 IPC」: readability after COMMIT throws is
// not a durability proof. Change only a bounded marker, never business versions,
// receipts, outbox identities or the independent forgetting sequence.
function createMemoryDurability({ handle, kind, readFresh = action => action(handle), validate = () => {} }) {
  const tables = SCOPES[kind], marker = tables[0];
  let pending = null;
  function snapshot(reader) {
    validate(reader);
    const values = tables.map(table => reader.all(`SELECT * FROM ${table} ORDER BY rowid`));
    const row = values[0][0];
    if (!values[0].length) return { hash: entityFingerprint(values), verificationCount: null };
    if (values[0].length !== 1 || row.singleton !== 1 || !Number.isSafeInteger(row.verification_count)
      || row.verification_count < 0) throw new Error(`${kind}-authority-invalid`);
    const verificationCount = row.verification_count;
    delete row.verification_count;
    return { hash: entityFingerprint(values), verificationCount };
  }
  function ensureDurability() {
    handle.exec('PRAGMA synchronous=FULL');
    if (Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2 || handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal') throw unknown(kind);
  }
  function proof(expected = readFresh(snapshot)) {
    if (!Number.isSafeInteger(expected.verificationCount)) throw unknown(kind);
    const next = expected.verificationCount + 1;
    if (!Number.isSafeInteger(next)) throw unknown(kind);
    ensureDurability();
    handle.exec('BEGIN IMMEDIATE');
    try {
      const before = snapshot(handle);
      if (before.hash !== expected.hash || before.verificationCount !== expected.verificationCount) throw unknown(kind);
      const changed = handle.run(`UPDATE ${marker} SET verification_count=? WHERE singleton=1 AND verification_count=?`, [next, expected.verificationCount]);
      if (Number(changed.changes) !== 1) throw unknown(kind);
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
    const after = readFresh(snapshot);
    if (after.hash !== expected.hash || after.verificationCount !== next) throw unknown(kind);
    return after;
  }
  function recover(identity) {
    if (!pending) return true;
    const binding = pending.identity;
    if (binding && !(identity?.receiptId === binding.receiptId || identity?.previewId === binding.previewId
      && identity?.previewHash === binding.previewHash && identity?.expectedVersion === binding.expectedVersion)) throw unknown(kind);
    try {
      const current = readFresh(snapshot);
      if (![pending.before?.hash, pending.after?.hash].includes(current.hash)) throw unknown(kind);
      proof(current);
      const committed = current.hash === pending.after?.hash;
      pending = null;
      return committed;
    } catch (_) { throw unknown(kind); }
  }
  function run(action, identity = null) {
    if (pending) throw unknown(kind);
    const before = snapshot(handle);
    ensureDurability();
    let result, after, commitAttempted = false, rolledBack = false;
    handle.exec('BEGIN IMMEDIATE');
    try {
      result = action(); after = snapshot(handle); commitAttempted = true;
      handle.exec('COMMIT'); return result;
    } catch (error) {
      try { handle.exec('ROLLBACK'); rolledBack = true; } catch (_) {}
      if (!commitAttempted && rolledBack) throw error;
      pending = { before, after, identity };
      if (recover(identity)) return result;
      throw error;
    }
  }
  return Object.freeze({ snapshot: () => readFresh(snapshot), proof, run, recover, isPending: () => Boolean(pending) });
}
module.exports = { createMemoryDurability };
