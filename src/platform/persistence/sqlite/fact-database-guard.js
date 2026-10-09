'use strict';

const fs = require('node:fs');
const { verifyBackupContainer, captureMigrationSource } = require('./migration-backup-container');
const { MIGRATIONS, LATEST_USER_VERSION } = require('./migrations');

// The fact database also contains original inbox archives. A migration or
// damaged file must not cause those bytes to be silently replaced by a new DB.
const captureFactDatabase = captureMigrationSource;

function verifyFactBackup({ filePath, sourceVersion, originals, io = fs }, ports) {
  return verifyBackupContainer({ filePath, sourceVersion, targetVersion: LATEST_USER_VERSION,
    authorityKind: 'facts', originals, io }, ports);
}
function verifyFactSchema(handle) {
  const current = handle.userVersion();
  if (current > LATEST_USER_VERSION) throw new Error('history-future-version');
  const check = handle.get('PRAGMA quick_check');
  if (!check || Object.values(check)[0] !== 'ok') throw new Error('history-corrupt');
  const expected = expectedFactSchema(current);
  const actual = handle.all("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (actual.length !== expected.size || actual.some(row => !expected.has(row.name)
    || expected.get(row.name).type !== row.type || canonicalSql(expected.get(row.name).sql) !== canonicalSql(row.sql))) {
    throw new Error('history-schema-invalid');
  }
  return current;
}
const canonicalSql = sql => String(sql).replace(/\s+/g, ' ').replace(/\s*([(),=])\s*/g, '$1').trim();
// Derive the complete expected SQL from the immutable migrations, including
// constraints, unique keys, defaults and indexes. A table name or column-only
// check would admit truncated inbox/memory authorities as healthy empty data.
function expectedFactSchema(version) {
  const expected = new Map();
  for (const migration of MIGRATIONS.filter(item => item.version <= version)) for (const original of migration.up) {
    const sql = original.replace(/ IF NOT EXISTS /i, ' ');
    const create = sql.match(/^CREATE (TABLE|INDEX) (\w+)/i);
    if (create) { expected.set(create[2], { type: create[1].toLowerCase(), sql }); continue; }
    const alter = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (.+)$/i);
    if (!alter || !expected.has(alter[1])) throw new Error('history-migration-unsupported');
    const table = expected.get(alter[1]);
    table.sql = table.sql.replace(/\)\s*$/, `, ${alter[2]})`);
  }
  return expected;
}
module.exports = { captureFactDatabase, verifyFactBackup, verifyFactSchema };
