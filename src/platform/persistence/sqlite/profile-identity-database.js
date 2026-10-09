'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const IDENTITY_USER_VERSION = 1;
const IDENTITY_SCHEMA = `CREATE TABLE profile_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner_id TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK(phase IN ('INITIALIZING', 'READY'))
)`;
const canonicalSql = sql => sql.replace(/\s+/g, ' ').trim();
const ownerValid = ownerId => typeof ownerId === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(ownerId);

function verifyIdentity(handle) {
  const version = handle.userVersion();
  if (version > IDENTITY_USER_VERSION) throw new Error('profile-identity-future-version');
  if (version === 0) throw new Error('profile-identity-uninitialized');
  if (version !== IDENTITY_USER_VERSION || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok') {
    throw new Error('profile-identity-invalid');
  }
  const schema = handle.all("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (schema.length !== 1 || schema[0].name !== 'profile_identity' || schema[0].type !== 'table'
    || canonicalSql(schema[0].sql) !== canonicalSql(IDENTITY_SCHEMA)) throw new Error('profile-identity-invalid');
  const rows = handle.all('SELECT singleton, owner_id, phase FROM profile_identity');
  if (rows.length !== 1 || rows[0].singleton !== 1 || !ownerValid(rows[0].owner_id)
    || !['INITIALIZING', 'READY'].includes(rows[0].phase)) throw new Error('profile-identity-invalid');
  return { ownerId: rows[0].owner_id, phase: rows[0].phase };
}

// ARCHITECTURE「持久化与迁移」: existing empty/corrupt/future identity is evidence,
// never a request to mint a replacement. WAL + FULL delegates platform commit
// durability to SQLite's native VFS, including Windows. No JSONL or JSON fallback.
function openSqliteProfileIdentity({ filePath, databasePath, lockAcquired, driver = 'auto',
  idFactory = randomUUID, io = fs } = {}, { selectDriver, makeHandle }) {
  if (lockAcquired !== true) return { status: 'unavailable', reason: 'profile-lock-required' };
  if (typeof filePath !== 'string' || !filePath || filePath === ':memory:'
    || typeof databasePath !== 'string' || !databasePath || path.resolve(filePath) === path.resolve(databasePath)) {
    return { status: 'unavailable', reason: 'profile-path-invalid' };
  }
  let handle;
  try {
    const existing = io.existsSync(filePath);
    if (!existing && (['', '-wal', '-shm'].some(suffix => io.existsSync(`${databasePath}${suffix}`))
      || ['-wal', '-shm'].some(suffix => io.existsSync(`${filePath}${suffix}`)))) {
      return { status: 'recovery-required', reason: 'profile-identity-missing' };
    }
    const selected = selectDriver(driver);
    if (!selected) return { status: 'unavailable', reason: 'sqlite-unavailable' };
    if (existing) {
      handle = makeHandle(selected.open(filePath, { readOnly: true }));
      return { status: 'available', ...verifyIdentity(handle) };
    }
    const ownerId = idFactory();
    if (!ownerValid(ownerId)) return { status: 'unavailable', reason: 'profile-identity-invalid' };
    io.mkdirSync(path.dirname(filePath), { recursive: true });
    // Exclusive file creation prevents a second writer from adopting an identity
    // created between the existence check and transaction. A crash before commit
    // leaves an empty authority that the next startup correctly refuses to reset.
    const fd = io.openSync(filePath, 'wx', 0o600);
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    handle = makeHandle(selected.open(filePath));
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = FULL');
    if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal'
      || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2) throw new Error('profile-durability-unavailable');
    handle.exec('BEGIN IMMEDIATE');
    try {
      handle.exec(IDENTITY_SCHEMA);
      handle.run("INSERT INTO profile_identity(singleton, owner_id, phase) VALUES (1, ?, 'INITIALIZING')", [ownerId]);
      handle.setUserVersion(IDENTITY_USER_VERSION);
      handle.exec('COMMIT');
    } catch (error) {
      try { handle.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    handle.close();
    handle = makeHandle(selected.open(filePath, { readOnly: true }));
    const identity = verifyIdentity(handle);
    if (identity.ownerId !== ownerId || identity.phase !== 'INITIALIZING') throw new Error('profile-identity-verification-failed');
    return { status: 'available', ...identity };
  } catch (error) {
    return identityFailure(error);
  } finally {
    if (handle) handle.close();
  }
}

function identityFailure(error) {
  const message = String(error?.message || '');
  const refusal = ['profile-identity-future-version', 'profile-identity-uninitialized',
    'profile-identity-invalid', 'profile-identity-verification-failed', 'profile-identity-owner-mismatch']
    .find(reason => reason === message);
  if (refusal || /not a database|malformed|file is encrypted|disk image/i.test(message)) {
    return { status: 'recovery-required', reason: refusal || 'profile-identity-invalid' };
  }
  return { status: 'unavailable', reason: message === 'profile-durability-unavailable'
    ? message : 'profile-identity-unavailable' };
}

// READY is a durable commitment that the separate conversation authority has
// been initialized and owner-verified. There is no transition back to INITIALIZING.
function markSqliteProfileIdentityReady({ filePath, ownerId, lockAcquired, driver = 'auto', io = fs } = {},
  { selectDriver, makeHandle }) {
  if (lockAcquired !== true) return { status: 'unavailable', reason: 'profile-lock-required' };
  if (typeof filePath !== 'string' || !filePath || !ownerValid(ownerId)) return { status: 'unavailable', reason: 'profile-path-invalid' };
  let handle;
  try {
    if (!io.existsSync(filePath)) return { status: 'recovery-required', reason: 'profile-identity-missing' };
    const selected = selectDriver(driver);
    if (!selected) return { status: 'unavailable', reason: 'sqlite-unavailable' };
    handle = makeHandle(selected.open(filePath, { readOnly: true }));
    const current = verifyIdentity(handle);
    if (current.ownerId !== ownerId) throw new Error('profile-identity-owner-mismatch');
    if (current.phase === 'READY') return { status: 'available', ...current };
    handle.close();
    handle = makeHandle(selected.open(filePath));
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = FULL');
    if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal'
      || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2) throw new Error('profile-durability-unavailable');
    handle.exec('BEGIN IMMEDIATE');
    try {
      const result = handle.run("UPDATE profile_identity SET phase='READY' WHERE singleton=1 AND owner_id=? AND phase='INITIALIZING'", [ownerId]);
      if (Number(result.changes) !== 1) throw new Error('profile-identity-verification-failed');
      handle.exec('COMMIT');
    } catch (error) {
      try { handle.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    handle.close();
    handle = makeHandle(selected.open(filePath, { readOnly: true }));
    const verified = verifyIdentity(handle);
    if (verified.ownerId !== ownerId || verified.phase !== 'READY') throw new Error('profile-identity-verification-failed');
    return { status: 'available', ...verified };
  } catch (error) {
    return identityFailure(error);
  } finally {
    if (handle) handle.close();
  }
}

module.exports = { IDENTITY_USER_VERSION, IDENTITY_SCHEMA, openSqliteProfileIdentity, markSqliteProfileIdentityReady };
