'use strict';
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');

const FACT_IDENTITY_SCHEMA = `CREATE TABLE fact_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), authority_id TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL CHECK(application_id > 0 AND application_id < 2147483647),
  phase TEXT NOT NULL CHECK(phase IN ('INITIALIZING', 'READY'))
)`;
const canonical = sql => sql.replace(/\s+/g, ' ').trim();
const markerPath = filePath => `${filePath}.identity.sqlite`;
function verify(handle) {
  if (handle.userVersion() !== 1 || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok') throw new Error('history-identity-invalid');
  const schema = handle.all("SELECT type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  const rows = handle.all('SELECT * FROM fact_identity');
  if (schema.length !== 1 || schema[0].type !== 'table' || canonical(schema[0].sql) !== canonical(FACT_IDENTITY_SCHEMA)
    || rows.length !== 1 || rows[0].singleton !== 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(rows[0].authority_id)
    || !Number.isInteger(rows[0].application_id) || rows[0].application_id < 1 || rows[0].application_id >= 2147483647
    || !['INITIALIZING', 'READY'].includes(rows[0].phase)) throw new Error('history-identity-invalid');
  return { authorityId: rows[0].authority_id, applicationId: rows[0].application_id, phase: rows[0].phase };
}
function durability(handle) {
  handle.exec('PRAGMA journal_mode=WAL'); handle.exec('PRAGMA synchronous=FULL');
  if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal' || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2) {
    throw new Error('history-identity-durability-unavailable');
  }
}
function readFactIdentity({ filePath, driver, makeHandle, io }) {
  if (filePath === ':memory:') return null;
  const target = markerPath(filePath);
  if (!io.existsSync(target)) {
    if (['-wal', '-shm'].some(suffix => io.existsSync(target + suffix))) throw new Error('history-identity-missing');
    return null;
  }
  let handle;
  try { handle = makeHandle(driver.open(target, { readOnly: true })); return verify(handle); }
  catch (_) { throw new Error('history-identity-invalid'); }
  finally { if (handle) handle.close(); }
}

// The marker commits before first DB creation, then becomes READY only after
// the complete main schema is verified. SQLite FULL uses the native VFS on
// Windows as well as POSIX; this path never assumes directory fsync support.
function initializeFactIdentity({ filePath, driver, makeHandle, io }) {
  if (filePath === ':memory:') return null;
  const target = markerPath(filePath), authorityId = randomUUID(), applicationId = randomInt(1, 2147483647);
  io.mkdirSync(path.dirname(target), { recursive: true });
  const fd = io.openSync(target, 'wx', 0o600);
  try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
  let handle;
  try {
    handle = makeHandle(driver.open(target)); durability(handle);
    handle.exec('BEGIN IMMEDIATE');
    try {
      handle.exec(FACT_IDENTITY_SCHEMA);
      handle.run("INSERT INTO fact_identity VALUES(1,?,?,'INITIALIZING')", [authorityId, applicationId]);
      handle.setUserVersion(1); handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
    handle.close(); handle = makeHandle(driver.open(target, { readOnly: true }));
    const checked = verify(handle);
    if (checked.authorityId !== authorityId) throw new Error('history-identity-invalid');
    return checked;
  } finally { if (handle) handle.close(); }
}
function readyFactIdentity({ filePath, driver, makeHandle, identity }) {
  if (filePath === ':memory:' || identity.phase === 'READY') return;
  let handle;
  try {
    handle = makeHandle(driver.open(markerPath(filePath))); durability(handle);
    handle.exec('BEGIN IMMEDIATE');
    try {
      const current = verify(handle);
      if (current.authorityId !== identity.authorityId) throw new Error('history-identity-invalid');
      handle.run("UPDATE fact_identity SET phase='READY' WHERE singleton=1 AND authority_id=?", [identity.authorityId]);
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
    handle.close(); handle = makeHandle(driver.open(markerPath(filePath), { readOnly: true }));
    const result = verify(handle);
    if (result.authorityId !== identity.authorityId || result.phase !== 'READY') throw new Error('history-identity-invalid');
  } finally { if (handle) handle.close(); }
}
module.exports = { FACT_IDENTITY_SCHEMA, markerPath, readFactIdentity, initializeFactIdentity, readyFactIdentity };
