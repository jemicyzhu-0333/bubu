'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MIGRATIONS, LATEST_USER_VERSION } = require('../src/platform/persistence/sqlite/migrations');
const { openDatabase, readSqliteMigrationBackup } = require('../src/platform/persistence/sqlite/sqlite-database');
const dirs = [];
function file() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-migration-')); dirs.push(dir); return path.join(dir, 'facts.sqlite'); }
test.after(() => dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function versionTwo(filePath, leaveOpen = false) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode=WAL');
  for (const migration of MIGRATIONS.slice(0, 2)) for (const statement of migration.up) db.exec(statement);
  db.exec('PRAGMA user_version=2');
  db.prepare('INSERT INTO timeline_events(id,occurred_at,day_key,kind,payload) VALUES(?,?,?,?,?)').run('old', 100, '2026-10-04', 'task.completed', '{}');
  db.prepare('INSERT INTO inbox_records(id,text,created_at,category,action,resolved_at) VALUES(?,?,?,?,?,?)').run('source', 'Original archived note', 1, 'thought', 'keep', 2);
  if (leaveOpen) return db;
  db.close();
}

test('migration 3 backs up exact v2 bytes before changing schema and leaves legacy provenance unknown', () => {
  const filePath = file(); versionTwo(filePath);
  const original = fs.readFileSync(filePath);
  const store = openDatabase({ filePath, driver: 'node:sqlite' });
  assert.equal(store.userVersion, LATEST_USER_VERSION);
  assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${filePath}.schema-2-to-${LATEST_USER_VERSION}.backup.sqlite` }).files[0].bytes, original);
  const old = store.timeline.readDay('2026-10-04')[0];
  for (const field of ['timezone', 'utcOffsetMinutes', 'receivedAt', 'localDayKey', 'source', 'actor', 'schemaVersion', 'commandId']) assert.equal(old[field], null);
  store.close();
  const after = fs.readFileSync(filePath);
  const again = openDatabase({ filePath, driver: 'node:sqlite' }); again.close();
  assert.deepEqual(fs.readFileSync(filePath), after);
  assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${filePath}.schema-2-to-${LATEST_USER_VERSION}.backup.sqlite` }).files[0].bytes, original);
  const raw = new DatabaseSync(filePath);
  assert.equal(raw.prepare('SELECT text FROM inbox_records WHERE id=?').get('source').text, 'Original archived note');
  assert.equal(raw.prepare('PRAGMA synchronous').get().synchronous, 2);
  raw.close();
});

test('migration backup includes byte-verified WAL and SHM captured before opening for writes', () => {
  const filePath = file(), prior = versionTwo(filePath, true);
  const originals = ['', '-wal', '-shm'].map(suffix => ({ suffix, bytes: fs.readFileSync(`${filePath}${suffix}`) }));
  const store = openDatabase({ filePath, driver: 'node:sqlite' });
  assert.equal(store.userVersion, LATEST_USER_VERSION);
  for (const original of originals) assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${filePath}.schema-2-to-${LATEST_USER_VERSION}.backup.sqlite` }).files.find(item => item.suffix === original.suffix).bytes, original.bytes);
  store.close(); prior.close();
});

test('backup collision and write failure close before any schema change and never use JSONL', () => {
  for (const fail of ['collision', 'write']) {
    const filePath = file(); versionTwo(filePath);
    const original = fs.readFileSync(filePath);
    if (fail === 'collision') fs.writeFileSync(`${filePath}.schema-2-to-${LATEST_USER_VERSION}.backup`, 'wrong existing backup');
    const io = fail === 'write' ? { ...fs, openSync(fileName, ...args) {
      if (String(fileName).includes('.backup')) throw new Error('disk full');
      return fs.openSync(fileName, ...args);
    } } : fs;
    const store = openDatabase({ filePath, io });
    assert.equal(store.tier, 'none');
    assert.equal(store.degradedReason, 'history-backup-failed');
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.equal(fs.existsSync(filePath.replace('.sqlite', '.jsonl.d')), false);
    store.close();
  }
});

test('future or truncated fact databases fail closed with unchanged bytes', () => {
  for (const state of ['future', 'truncated']) {
    const filePath = file();
    if (state === 'future') { versionTwo(filePath); const raw = new DatabaseSync(filePath); raw.exec('PRAGMA user_version=99'); raw.close(); }
    else fs.writeFileSync(filePath, '');
    const original = fs.readFileSync(filePath);
    const store = openDatabase({ filePath });
    assert.equal(store.tier, 'none');
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.equal(store.timeline.queryRange().availability, 'unavailable');
    store.close();
  }
});

test('JSONL distinguishes empty successful reads from torn or inaccessible history', () => {
  const filePath = file();
  const store = openDatabase({ filePath, driver: 'jsonl' });
  const query = { fromDayKey: '2026-10-04', toDayKey: '2026-10-04' };
  assert.deepEqual(store.timeline.queryRange(query), { ok: true, availability: 'available', items: [] });
  const directory = path.join(filePath.replace('.sqlite', '.jsonl.d'), 'timeline');
  fs.writeFileSync(path.join(directory, '2026-10-04.jsonl'), '{torn');
  assert.equal(store.timeline.queryRange(query).availability, 'unavailable');
  fs.rmSync(directory, { recursive: true });
  assert.equal(store.timeline.queryRange(query).availability, 'unavailable');
  assert.equal(store.timeline.supportsConfirmedChanges, false);
  store.close();
});
