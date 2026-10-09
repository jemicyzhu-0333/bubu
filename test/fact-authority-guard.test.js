'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { MIGRATIONS, LATEST_USER_VERSION } = require('../src/platform/persistence/sqlite/migrations');
const { initializeFactIdentity, markerPath } = require('../src/platform/persistence/sqlite/fact-identity-guard');
const directories = [];
test.after(() => directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
function location() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-authority-')); directories.push(directory);
  return path.join(directory, 'facts.sqlite');
}
function legacy(filePath, version = 3, rewrite = value => value) {
  const raw = new DatabaseSync(filePath);
  for (const migration of MIGRATIONS.filter(item => item.version <= version)) for (const sql of migration.up) raw.exec(rewrite(sql));
  raw.exec(`PRAGMA user_version=${version}`); raw.close();
}
function createPending(filePath) {
  const driver = { open: (name, options = {}) => new DatabaseSync(name, options) };
  const makeHandle = raw => ({ exec: sql => raw.exec(sql), run: (sql, params = []) => raw.prepare(sql).run(...params),
    get: (sql, params = []) => raw.prepare(sql).get(...params), all: (sql, params = []) => raw.prepare(sql).all(...params),
    userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
    setUserVersion: version => raw.exec(`PRAGMA user_version=${version}`), close: () => raw.close() });
  return initializeFactIdentity({ filePath, driver, makeHandle, io: fs });
}

test('established missing main without sidecars never recreates empty SQL or JSONL authority', () => {
  const filePath = location(); const first = openDatabase({ filePath }); assert.equal(first.healthy, true);
  first.memories.upsert({ kind: 'preference', subject: 'fixture', body: 'original fixture', source: 'user-confirmed' }); first.close();
  fs.renameSync(filePath, `${filePath}.retained-fixture`);
  assert.equal(fs.existsSync(`${filePath}-wal`), false); assert.equal(fs.existsSync(`${filePath}-shm`), false);
  for (const driver of ['auto', 'jsonl']) {
    const reopened = openDatabase({ filePath, driver }); assert.equal(reopened.healthy, false);
    assert.equal(fs.existsSync(filePath), false); assert.equal(fs.existsSync(filePath.replace('.sqlite', '.jsonl.d')), false);
  }
});

test('READY rejects zero/schema0 and another established DB without changing original bytes', () => {
  for (const state of ['zero', 'schema0', 'wrong-database']) {
    const filePath = location(); openDatabase({ filePath }).close();
    if (state === 'wrong-database') {
      const other = location(); openDatabase({ filePath: other }).close(); fs.copyFileSync(other, filePath);
    } else {
      fs.writeFileSync(filePath, '');
      if (state === 'schema0') { const raw = new DatabaseSync(filePath); raw.exec('PRAGMA application_id=123'); raw.close(); }
    }
    const before = fs.readFileSync(filePath), identity = fs.readFileSync(markerPath(filePath));
    const result = openDatabase({ filePath });
    assert.equal(result.healthy, false); assert.deepEqual(fs.readFileSync(filePath), before);
    assert.deepEqual(fs.readFileSync(markerPath(filePath)), identity);
  }
});

test('INITIALIZING can resume absent, empty and committed same-authority main', () => {
  for (const state of ['absent', 'empty', 'committed']) {
    const filePath = location(), identity = createPending(filePath);
    if (state === 'empty') fs.writeFileSync(filePath, '');
    if (state === 'committed') {
      legacy(filePath, LATEST_USER_VERSION);
      const raw = new DatabaseSync(filePath); raw.exec(`PRAGMA application_id=${identity.applicationId}`); raw.close();
    }
    const result = openDatabase({ filePath }); assert.equal(result.healthy, true, `${state}: ${result.degradedReason}`); result.close();
    const marker = new DatabaseSync(markerPath(filePath));
    assert.equal(marker.prepare('SELECT phase FROM fact_identity').get().phase, 'READY'); marker.close();
    const main = new DatabaseSync(filePath); assert.equal(main.prepare('PRAGMA application_id').get().application_id, identity.applicationId); main.close();
  }
});

test('pending marker rejects a replaced bound DB, malformed marker never mints replacement', () => {
  const filePath = location(), identity = createPending(filePath); legacy(filePath, LATEST_USER_VERSION);
  const raw = new DatabaseSync(filePath); raw.exec(`PRAGMA application_id=${identity.applicationId === 1 ? 2 : 1}`); raw.close();
  const original = fs.readFileSync(filePath); assert.equal(openDatabase({ filePath }).healthy, false);
  assert.deepEqual(fs.readFileSync(filePath), original);
  const missing = location(); fs.writeFileSync(markerPath(missing), '');
  assert.equal(openDatabase({ filePath: missing }).healthy, false); assert.equal(fs.existsSync(missing), false);
});

test('a bound main with its marker removed fails closed without silently adopting a new identity', () => {
  const filePath = location(); openDatabase({ filePath }).close();
  fs.renameSync(markerPath(filePath), `${markerPath(filePath)}.retained-fixture`);
  const original = fs.readFileSync(filePath);
  const result = openDatabase({ filePath }); assert.equal(result.degradedReason, 'history-identity-missing');
  assert.deepEqual(fs.readFileSync(filePath), original); assert.equal(fs.existsSync(markerPath(filePath)), false);
});

test('complete known schema rejects truncated inbox, missing memory uniqueness/default, changed indexes and extra triggers', () => {
  const variants = [
    sql => sql.startsWith('CREATE TABLE IF NOT EXISTS inbox_records') ? 'CREATE TABLE inbox_records(id TEXT PRIMARY KEY)' : sql.startsWith('CREATE INDEX IF NOT EXISTS idx_inbox') ? 'SELECT 1' : sql,
    sql => sql.replace('unique_key   TEXT NOT NULL UNIQUE', 'unique_key   TEXT NOT NULL'),
    sql => sql.replace('use_count    INTEGER NOT NULL DEFAULT 0', 'use_count    INTEGER NOT NULL DEFAULT 1'),
    sql => sql.replace('inbox_records(category, created_at DESC, id)', 'inbox_records(category, created_at, id)'),
    sql => sql.replace('text            TEXT NOT NULL', 'text            TEXT')
  ];
  for (const rewrite of variants) {
    const filePath = location(); legacy(filePath, 3, rewrite); const before = fs.readFileSync(filePath);
    const result = openDatabase({ filePath }); assert.equal(result.healthy, false); assert.equal(result.degradedReason, 'history-schema-invalid');
    assert.deepEqual(fs.readFileSync(filePath), before); assert.equal(fs.existsSync(markerPath(filePath)), false);
  }
  const filePath = location(); legacy(filePath);
  const raw = new DatabaseSync(filePath); raw.exec('CREATE TRIGGER extra AFTER DELETE ON agent_memories BEGIN SELECT 1; END'); raw.close();
  assert.equal(openDatabase({ filePath }).degradedReason, 'history-schema-invalid');
});

test('all known legacy schemas migrate, and backup failure leaves the original plus identity state unchanged', () => {
  for (const version of [1, 2, 3]) {
    const filePath = location(); legacy(filePath, version); const before = fs.readFileSync(filePath);
    if (version < LATEST_USER_VERSION) {
      const io = { ...fs, openSync(name, ...args) { if (String(name).includes('.backup')) throw new Error('backup failure'); return fs.openSync(name, ...args); } };
      const failed = openDatabase({ filePath, io }); assert.equal(failed.healthy, false); assert.equal(failed.degradedReason, 'history-backup-failed');
      assert.deepEqual(fs.readFileSync(filePath), before); assert.equal(fs.existsSync(markerPath(filePath)), false);
    }
    const result = openDatabase({ filePath }); assert.equal(result.healthy, true, result.degradedReason); result.close();
  }
});

test('marker creation and migration backups remain available without directory sync', () => {
  const filePath = location();
  const io = { ...fs, openSync(name, ...args) {
    if (fs.existsSync(name) && fs.statSync(name).isDirectory()) { const error = new Error('directory sync unavailable'); error.code = 'EPERM'; throw error; }
    return fs.openSync(name, ...args);
  } };
  const fresh = openDatabase({ filePath, io }); assert.equal(fresh.healthy, true); fresh.close();
  const old = location(); legacy(old, 1); const before = fs.readFileSync(old);
  const migrated = openDatabase({ filePath: old, io }); assert.equal(migrated.healthy, true); migrated.close();
  const { readSqliteMigrationBackup } = require('../src/platform/persistence/sqlite/sqlite-database');
  assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${old}.schema-1-to-${LATEST_USER_VERSION}.backup.sqlite` }).files[0].bytes, before);
});

test('file flush failure leaves a visibly unavailable marker and never remints over its partial identity', () => {
  const filePath = location();
  const io = { ...fs, fsyncSync() { throw new Error('file sync unavailable'); } };
  assert.equal(openDatabase({ filePath, io }).healthy, false); assert.equal(fs.existsSync(filePath), false);
  const original = fs.readFileSync(markerPath(filePath));
  assert.equal(openDatabase({ filePath }).degradedReason, 'history-identity-invalid');
  assert.deepEqual(fs.readFileSync(markerPath(filePath)), original); assert.equal(fs.existsSync(filePath), false);
});

test('existing JSONL-only history requires explicit import instead of silently creating a second SQL authority', () => {
  const filePath = location(), old = openDatabase({ filePath, driver: 'jsonl' });
  old.memories.upsert({ kind: 'preference', subject: 'legacy JSONL', body: 'Retained fixture', source: 'user-confirmed' }); old.close();
  const result = openDatabase({ filePath }); assert.equal(result.degradedReason, 'history-jsonl-import-required');
  assert.equal(fs.existsSync(filePath), false); assert.equal(fs.existsSync(markerPath(filePath)), false);
  const original = openDatabase({ filePath, driver: 'jsonl' }); assert.equal(original.memories.list().length, 1); original.close();
});
