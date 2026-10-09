'use strict';

const fs = require('node:fs');
const { verifyBackupContainer, captureMigrationSource } = require('./migration-backup-container');

// Version 2 adds routine source references and closed operation proposal bodies.
// No table rewrite is needed; older readers must refuse the newer record semantics.
const COLLABORATION_USER_VERSION = 4;
const MIGRATIONS = Object.freeze([Object.freeze({ version: 1, statements: Object.freeze([
  `CREATE TABLE collaboration_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner_id TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE conversations (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES collaboration_identity(owner_id),
    revision INTEGER NOT NULL CHECK(revision > 0), created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, expires_at INTEGER, snapshot TEXT NOT NULL
  )`,
  'CREATE INDEX conversations_owner_updated ON conversations(owner_id, updated_at DESC, id)',
  'CREATE INDEX conversations_retention ON conversations(owner_id, expires_at)'
]) }), Object.freeze({ version: 2, statements: Object.freeze([]) }),
Object.freeze({ version: 3, statements: Object.freeze([]) }),
Object.freeze({ version: 4, statements: Object.freeze([
  `CREATE TABLE collaboration_durability (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    verification_count INTEGER NOT NULL CHECK(verification_count >= 0)
  )`
]) })]);

const captureDatabaseBytes = captureMigrationSource;

function verifyMigrationBackup({ filePath, sourceVersion, originals, io = fs }, ports) {
  return verifyBackupContainer({ filePath, sourceVersion, targetVersion: COLLABORATION_USER_VERSION,
    authorityKind: 'collaboration', originals, io }, ports);
}
function runCollaborationMigrations({ handle, filePath, ownerId, originals = [], io = fs, backupVerified = false, backupPorts }) {
  const current = handle.userVersion();
  if (current > COLLABORATION_USER_VERSION) throw new Error('collaboration-future-version');
  if (current === COLLABORATION_USER_VERSION) return current;
  // The dedicated database must never adopt an unrelated schema or fact store.
  if (current === 0 && handle.all("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").length) {
    throw new Error('collaboration-schema-unrecognized');
  }
  if (originals.length && !backupVerified) {
    try { verifyMigrationBackup({ filePath, sourceVersion: current, originals, io }, backupPorts); }
    catch (error) {
      throw new Error('collaboration-backup-failed');
    }
  }
  handle.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      for (const sql of migration.statements) handle.exec(sql);
      handle.setUserVersion(migration.version);
    }
    if (current < 4) handle.run('INSERT INTO collaboration_durability(singleton, verification_count) VALUES (1, 0)');
    if (current === 0) handle.run('INSERT INTO collaboration_identity(singleton, owner_id) VALUES (1, ?)', [ownerId]);
    handle.exec('COMMIT');
  } catch (error) {
    try { handle.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  return COLLABORATION_USER_VERSION;
}

module.exports = { COLLABORATION_USER_VERSION, MIGRATIONS, captureDatabaseBytes,
  verifyMigrationBackup, runCollaborationMigrations };
