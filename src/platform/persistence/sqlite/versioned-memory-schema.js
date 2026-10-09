'use strict';

const MEMORY_TABLES = Object.freeze([
  `CREATE TABLE memory_authority (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner_id TEXT NOT NULL,
    ledger_id TEXT NOT NULL, ledger_sequence INTEGER NOT NULL, cutover_at INTEGER NOT NULL,
    verification_count INTEGER NOT NULL CHECK(verification_count >= 0 AND verification_count <= 9007199254740991)
  )`,
  `CREATE TABLE memory_records (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL, record TEXT NOT NULL
  )`,
  `CREATE TABLE memory_sources (
    memory_id TEXT PRIMARY KEY, source_refs TEXT NOT NULL
  )`,
  `CREATE TABLE memory_undo (
    memory_id TEXT PRIMARY KEY, post_version INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    receipt_id TEXT NOT NULL, record TEXT NOT NULL
  )`,
  `CREATE TABLE memory_receipts (
    receipt_id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, memory_id TEXT NOT NULL,
    preview_hash TEXT NOT NULL, receipt TEXT NOT NULL, origin_conversation_id TEXT, origin_proposal_id TEXT,
    UNIQUE(origin_conversation_id, origin_proposal_id)
  )`,
  `CREATE TABLE memory_outbox (
    event_id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES memory_receipts(receipt_id),
    event TEXT NOT NULL, delivered_at INTEGER
  )`
]);
const MEMORY_MIGRATION = Object.freeze({ version: 4, up: MEMORY_TABLES });
const canonicalSql = sql => sql.replace(/\s+/g, ' ').trim();
function verifyMemorySchema(handle) {
  for (const sql of MEMORY_TABLES) {
    const name = sql.match(/CREATE TABLE (\w+)/)[1];
    const row = handle.get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [name]);
    if (!row || canonicalSql(row.sql) !== canonicalSql(sql)) throw new Error('history-memory-schema-invalid');
  }
}
module.exports = { MEMORY_TABLES, MEMORY_MIGRATION, verifyMemorySchema };
