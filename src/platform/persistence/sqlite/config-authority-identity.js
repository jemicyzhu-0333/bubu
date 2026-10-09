'use strict';
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const { hashValid } = require('./config-authority-schema');
const IDENTITY_APPLICATION_ID = 0x42554255; // BUBU; separate from each profile's random authority binding.
const SCHEMA = `CREATE TABLE config_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), authority_id TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL, source_exists INTEGER NOT NULL CHECK(source_exists IN (0, 1)),
  source_hash TEXT NOT NULL, source_length INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('INITIALIZING', 'READY'))
)`;
const canonical = sql => String(sql).replace(/\s+/g, ' ').trim();
function verify(handle) {
  if (Number(handle.get('PRAGMA application_id')?.application_id) !== IDENTITY_APPLICATION_ID) {
    throw Object.assign(new Error('config-profile-brand-mismatch: Select a new empty profile directory for bubu; this profile will not be imported automatically.'),
      { code: 'config-profile-brand-mismatch' });
  }
  if (handle.userVersion() !== 1 || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok') throw new Error('config-identity-invalid');
  const schema = handle.all("SELECT type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  const rows = handle.all('SELECT * FROM config_identity'), row = rows[0];
  if (schema.length !== 1 || schema[0].type !== 'table' || canonical(schema[0].sql) !== canonical(SCHEMA)
    || rows.length !== 1 || row.singleton !== 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(row.authority_id)
    || !Number.isInteger(row.application_id) || row.application_id < 1 || row.application_id >= 2147483647
    || ![0, 1].includes(row.source_exists) || !hashValid(row.source_hash) || !Number.isSafeInteger(row.source_length)
    || row.source_length < 0 || !['INITIALIZING', 'READY'].includes(row.phase)) throw new Error('config-identity-invalid');
  return { authorityId: row.authority_id, applicationId: row.application_id, sourceExists: row.source_exists === 1,
    sourceHash: row.source_hash, sourceLength: row.source_length, phase: row.phase };
}
function setDurability(handle) {
  handle.exec('PRAGMA journal_mode=WAL'); handle.exec('PRAGMA synchronous=FULL'); handle.exec('PRAGMA foreign_keys=ON');
  if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal' || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2
    || Number(handle.get('PRAGMA foreign_keys')?.foreign_keys) !== 1) throw new Error('config-authority-durability-unavailable');
}
function readIdentity({ identityPath, io, driver, makeHandle }) {
  if (!io.existsSync(identityPath)) {
    if (['-wal', '-shm'].some(suffix => io.existsSync(identityPath + suffix))) throw new Error('config-identity-missing');
    return null;
  }
  let handle;
  try { handle = makeHandle(driver.open(identityPath, { readOnly: true })); return verify(handle); }
  catch (error) {
    if (error.code === 'config-profile-brand-mismatch') throw error;
    throw new Error('config-identity-invalid');
  }
  finally { if (handle) handle.close(); }
}
function createIdentity(ports, source) {
  const { identityPath, io, driver, makeHandle } = ports;
  io.mkdirSync(path.dirname(identityPath), { recursive: true });
  const fd = io.openSync(identityPath, 'wx', 0o600); try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
  const authorityId = randomUUID(), applicationId = randomInt(1, 2147483647);
  let handle;
  try {
    handle = makeHandle(driver.open(identityPath)); setDurability(handle);
    handle.exec('BEGIN IMMEDIATE');
    try {
      handle.exec(`PRAGMA application_id=${IDENTITY_APPLICATION_ID}`);
      handle.exec(SCHEMA);
      handle.run("INSERT INTO config_identity VALUES(1,?,?,?,?,?,'INITIALIZING')",
        [authorityId, applicationId, source.exists ? 1 : 0, source.hash, source.bytes.length]);
      handle.setUserVersion(1); handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
  } finally { if (handle) handle.close(); }
  const result = readIdentity(ports);
  if (result.authorityId !== authorityId || result.applicationId !== applicationId) throw new Error('config-identity-invalid');
  return result;
}
function markReady(ports, identity) {
  if (identity.phase === 'READY') return;
  let handle;
  try {
    handle = ports.makeHandle(ports.driver.open(ports.identityPath)); setDurability(handle);
    handle.exec('BEGIN IMMEDIATE');
    try {
      const current = verify(handle);
      if (current.authorityId !== identity.authorityId || current.sourceHash !== identity.sourceHash) throw new Error('config-identity-mismatch');
      handle.run("UPDATE config_identity SET phase='READY' WHERE singleton=1 AND authority_id=?", [identity.authorityId]);
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
  } finally { if (handle) handle.close(); }
  if (readIdentity(ports).phase !== 'READY') throw new Error('config-identity-unavailable');
}
module.exports = { IDENTITY_APPLICATION_ID, readIdentity, createIdentity, markReady, setDurability };
