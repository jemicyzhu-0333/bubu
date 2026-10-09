'use strict';
const { MEMORY_MIGRATION } = require('./versioned-memory-schema');

// Ordered table migrations for the fact store, advanced by PRAGMA user_version.
//
// This version is deliberately kept separate from the document store's
// schemaVersion (see ARCHITECTURE「事实流与长期记忆」): this database owns timeline,
// archived inbox and memory records independently of the configuration snapshot.
// Tying the counters together would force a configuration migration every time
// a table changes shape, so they never reference each other.
//
// Each entry's `up` runs inside one transaction and must be idempotent-safe only
// in the sense that it is applied exactly once per database, gated by
// user_version. Never rewrite an existing entry after release — append a new one.

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    // Two append-only sequences the document model does the poorest job on:
    // unbounded, time-ranged event history and long-term memory (ARCHITECTURE「事实流与长期记忆」).
    up: [
      `CREATE TABLE IF NOT EXISTS timeline_events (
        id           TEXT PRIMARY KEY,
        occurred_at  INTEGER NOT NULL,
        day_key      TEXT NOT NULL,
        kind         TEXT NOT NULL,
        task_id      TEXT,
        session_id   TEXT,
        duration_ms  INTEGER,
        payload      TEXT NOT NULL DEFAULT '{}'
      )`,
      'CREATE INDEX IF NOT EXISTS idx_timeline_day  ON timeline_events(day_key, occurred_at)',
      'CREATE INDEX IF NOT EXISTS idx_timeline_task ON timeline_events(task_id, occurred_at)',
      `CREATE TABLE IF NOT EXISTS agent_memories (
        id           TEXT PRIMARY KEY,
        unique_key   TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        subject      TEXT NOT NULL,
        body         TEXT NOT NULL,
        source       TEXT NOT NULL,
        confidence   REAL NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        use_count    INTEGER NOT NULL DEFAULT 0,
        expires_at   INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS idx_memory_kind ON agent_memories(kind, updated_at)'
    ]
  },
  {
    version: 2,
    // Resolved inbox captures leave config.json once they are copied here
    // (ARCHITECTURE「收件分类与原文历史」). Only the fields history shows are kept:
    // the original text, the confirmed label and the outcome — the AI suggestion
    // that preceded the decision is not.
    up: [
      `CREATE TABLE IF NOT EXISTS inbox_records (
        id              TEXT PRIMARY KEY,
        text            TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        category        TEXT NOT NULL,
        routine_kind    TEXT,
        level           INTEGER,
        action          TEXT NOT NULL,
        resolved_at     INTEGER NOT NULL,
        target_id       TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_records(created_at DESC, id)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_category ON inbox_records(category, created_at DESC, id)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_target ON inbox_records(action, target_id)'
    ]
  },
  {
    version: 3,
    // Nullable columns retain honest provenance for pre-envelope history.
    up: [
      'ALTER TABLE timeline_events ADD COLUMN schema_version INTEGER',
      'ALTER TABLE timeline_events ADD COLUMN received_at INTEGER',
      'ALTER TABLE timeline_events ADD COLUMN timezone TEXT',
      'ALTER TABLE timeline_events ADD COLUMN utc_offset_minutes INTEGER',
      'ALTER TABLE timeline_events ADD COLUMN local_day_key TEXT',
      'ALTER TABLE timeline_events ADD COLUMN actor TEXT',
      'ALTER TABLE timeline_events ADD COLUMN source TEXT',
      'ALTER TABLE timeline_events ADD COLUMN correlation_id TEXT',
      'ALTER TABLE timeline_events ADD COLUMN causation_id TEXT',
      'ALTER TABLE timeline_events ADD COLUMN command_id TEXT',
      'ALTER TABLE timeline_events ADD COLUMN entity_version TEXT',
      'ALTER TABLE timeline_events ADD COLUMN visibility TEXT',
      'ALTER TABLE timeline_events ADD COLUMN redaction_state TEXT',
      'CREATE INDEX idx_timeline_command ON timeline_events(command_id, occurred_at)'
    ]
  },
  MEMORY_MIGRATION
]);

const LATEST_USER_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

/**
 * Advance a handle from its current PRAGMA user_version to LATEST_USER_VERSION.
 *
 * The handle is the tiny driver-neutral surface built in sqlite-database.js
 * (exec / userVersion / setUserVersion), so the same migration list runs
 * unchanged on node:sqlite and better-sqlite3. Returns the version it reached.
 */
function runMigrations(handle) {
  let current = handle.userVersion();
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    // One transaction per step. The opener verifies a durable byte backup
    // first; failed schema changes roll back and never rebuild original data.
    handle.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.up) handle.exec(statement);
      handle.setUserVersion(migration.version);
      handle.exec('COMMIT');
    } catch (error) {
      handle.exec('ROLLBACK');
      throw error;
    }
    current = migration.version;
  }
  return current;
}

module.exports = { MIGRATIONS, LATEST_USER_VERSION, runMigrations };
