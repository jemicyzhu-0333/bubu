'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { COLLABORATION_USER_VERSION, captureDatabaseBytes, verifyMigrationBackup, runCollaborationMigrations } = require('./collaboration-migrations');
const { createConversationRepository } = require('./conversation-repository');
const { verifySchema } = require('./collaboration-schema');
const { createConversationCommitProof } = require('./conversation-commit-proof');

function failure(status, reason) { return Object.freeze({ status, reason, repository: null, close: () => {} }); }
// Drivers remain exclusively owned by sqlite-database.js. Unlike the disposable
// fact-store adapter, this opener never rebuilds, quarantines, or falls back.
function openAuthoritativeCollaborationDatabase({ filePath, ownerId, driver, io = fs, logger = () => {}, platform = process.platform, requireInitialized = false }, { selectDriver, makeHandle }) {
  if (typeof filePath !== 'string' || !filePath || typeof ownerId !== 'string' || !ownerId) {
    return failure('unavailable', 'collaboration-options-invalid');
  }
  const selected = selectDriver(driver);
  if (!selected) return failure('unavailable', 'sqlite-unavailable');
  let handle;
  try {
    const originals = captureDatabaseBytes(filePath, io);
    if ((originals.length || requireInitialized) && !originals.some(item => item.suffix === '')) throw new Error('collaboration-database-missing');
    if (filePath !== ':memory:') io.mkdirSync(path.dirname(filePath), { recursive: true });
    // Inspect existing authority read-only. Refusing a future or corrupt WAL
    // database must not checkpoint or rewrite the very bytes needed to recover.
    const existing = originals.some(item => item.suffix === '');
    handle = makeHandle(selected.open(filePath, existing ? { readOnly: true } : {}));
    const current = handle.userVersion();
    if (current > COLLABORATION_USER_VERSION) throw new Error('collaboration-future-version');
    if (requireInitialized && current === 0) throw new Error('collaboration-schema-uninitialized');
    if (current < 0 || (current === 0 && handle.all("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").length)) {
      throw new Error('collaboration-schema-unrecognized');
    }
    const check = handle.get('PRAGMA quick_check');
    if (!check || Object.values(check)[0] !== 'ok') throw new Error('collaboration-corrupt');
    if (current > 0) verifySchema(handle, ownerId);
    if (existing) {
      if (current < COLLABORATION_USER_VERSION) {
        try { verifyMigrationBackup({ filePath, sourceVersion: current, originals, io }, { driver: selected, makeHandle }); }
        catch (error) {
          throw new Error('collaboration-backup-failed');
        }
      }
      handle.close();
      handle = makeHandle(selected.open(filePath));
    }
    // The existing-file backup gate is above. Establish durable transaction
    // semantics before schema/owner creation, not only before transcript saves.
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = FULL');
    handle.exec('PRAGMA foreign_keys = ON');
    handle.exec('PRAGMA busy_timeout = 2000');
    if ((filePath !== ':memory:' && handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal')
      || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2
      || Number(handle.get('PRAGMA foreign_keys')?.foreign_keys) !== 1) throw new Error('collaboration-pragmas-unavailable');
    runCollaborationMigrations({ handle, filePath, ownerId, originals, io, platform, backupVerified: originals.length > 0 });
    verifySchema(handle, ownerId);
    const prove = createConversationCommitProof({ filePath, ownerId, driver: selected, makeHandle, handle,
      verify: reader => verifySchema(reader, ownerId) });
    prove();
    const repository = createConversationRepository({ handle, ownerId, prove });
    return Object.freeze({ status: 'available', reason: null, tier: selected.name,
      userVersion: COLLABORATION_USER_VERSION, repository, close: () => handle.close() });
  } catch (error) {
    if (handle) handle.close();
    const message = String(error?.message || '');
    const reason = ['collaboration-future-version', 'collaboration-owner-mismatch', 'collaboration-schema-unrecognized', 'collaboration-schema-uninitialized', 'collaboration-database-missing']
      .find(value => message === value);
    const corruption = /not a database|malformed|file is encrypted|disk image|collaboration-(corrupt|schema-invalid|record-invalid)/i.test(message);
    const backup = /backup/i.test(message) || error?.code === 'EEXIST';
    const status = reason || backup ? 'recovery-required' : corruption ? 'corrupt' : 'unavailable';
    const code = reason || (backup ? 'collaboration-backup-failed' : corruption ? 'collaboration-storage-corrupt' : 'collaboration-storage-unavailable');
    try { logger({ scope: 'collaboration-store', event: status, reason: code }); } catch (_) {}
    return failure(status, code);
  }
}

module.exports = { openAuthoritativeCollaborationDatabase };
