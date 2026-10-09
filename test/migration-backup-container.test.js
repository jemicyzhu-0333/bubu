'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { verifySqliteMigrationBackup, readSqliteMigrationBackup, openDatabase, openCollaborationDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { verifyBackupContainer, readBackupContainer, captureMigrationSource, MAX_BACKUP_BYTES } = require('../src/platform/persistence/sqlite/migration-backup-container');
const { openAuthoritativeCollaborationDatabase } = require('../src/platform/persistence/sqlite/collaboration-database');
const { MIGRATIONS: FACT_MIGRATIONS, LATEST_USER_VERSION } = require('../src/platform/persistence/sqlite/migrations');
const { MIGRATIONS: COLLAB_MIGRATIONS, COLLABORATION_USER_VERSION } = require('../src/platform/persistence/sqlite/collaboration-migrations');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'authority.sqlite');
  return { dir, filePath, options: { filePath, authorityKind: 'facts', sourceVersion: 2, targetVersion: 3,
    originals: [{ suffix: '', bytes: Buffer.from('exact main\0') }, { suffix: '-wal', bytes: Buffer.from('exact WAL') }, { suffix: '-shm', bytes: Buffer.from('exact SHM') }] } };
}
function ports(fault = () => {}) {
  const observed = { handles: 0, opens: [] };
  const driver = { name: 'node:sqlite', open(filePath, options = {}) {
    fault({ type: 'open', filePath, readOnly: options.readOnly === true });
    const db = new DatabaseSync(filePath, options); observed.handles++; observed.opens.push({ filePath, readOnly: options.readOnly === true });
    return { db, filePath, readOnly: options.readOnly === true };
  } };
  const makeHandle = ({ db, filePath, readOnly }) => {
    const call = (type, sql, action) => { const change = fault({ type, sql, filePath, readOnly }); return change === undefined ? action() : change; };
    return {
      exec(sql) { call('before', sql, () => db.exec(sql)); fault({ type: 'after', sql, filePath, readOnly }); },
      run: (sql, params = []) => call('run', sql, () => db.prepare(sql).run(...params)),
      get: (sql, params = []) => call('get', sql, () => db.prepare(sql).get(...params)),
      all: (sql, params = []) => call('all', sql, () => db.prepare(sql).all(...params)),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`),
      close() { db.close(); observed.handles--; }
    };
  };
  return { driver, makeHandle, observed, selectDriver: () => driver };
}
const windowsIo = { ...fs, openSync(name, ...args) {
  if (fs.existsSync(name) && fs.statSync(name).isDirectory()) throw Object.assign(new Error('Windows directory EPERM'), { code: 'EPERM' });
  return fs.openSync(name, ...args);
}, fsyncSync(fd) { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('directory flush unavailable'), { code: 'EINVAL' }); fs.fsyncSync(fd); } };
function mutate(filePath, callback) { const db = new DatabaseSync(filePath); try { callback(db); } finally { db.close(); } }

test('portable container commits exact main/WAL/SHM and recovery metadata with FULL before independent readback', t => {
  const f = fixture(t), p = ports();
  const backupPath = verifyBackupContainer({ ...f.options, io: windowsIo }, p);
  const recovered = readSqliteMigrationBackup({ backupPath });
  assert.deepEqual(recovered.files, f.options.originals);
  assert.deepEqual(recovered.fileManifest.map(item => [item.suffix, item.byteLength]), f.options.originals.map(item => [item.suffix, item.bytes.length]));
  assert.equal(recovered.fileManifest.every(item => /^[0-9a-f]{64}$/.test(item.sha256)), true);
  assert.equal(recovered.sourcePath, f.filePath); assert.equal(recovered.sourceVersion, 2); assert.equal(recovered.targetVersion, 3);
  assert.equal(p.observed.handles, 0); assert.equal(p.observed.opens.at(-1).readOnly, true);
  mutate(backupPath, db => { assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal'); assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2); });
  assert.equal(verifyBackupContainer(f.options, p), backupPath);
  mutate(backupPath, db => assert.equal(db.prepare('SELECT verification_count FROM backup_manifest').get().verification_count, 2));
});

test('existing flat backups are checked, including extra suffixes, and moved-profile evidence can be reused', t => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = fixture(t), root = `${f.filePath}.schema-2-to-3.backup`;
    fs.writeFileSync(root + suffix, 'conflict');
    assert.throws(() => verifySqliteMigrationBackup(f.options), /legacy-mismatch/); assert.equal(fs.existsSync(root + '.sqlite'), false);
  }
  const f = fixture(t), originalPath = verifySqliteMigrationBackup(f.options), moved = path.join(f.dir, 'moved.sqlite');
  const movedPath = `${moved}.schema-2-to-3.backup.sqlite`; fs.copyFileSync(originalPath, movedPath);
  assert.equal(verifySqliteMigrationBackup({ ...f.options, filePath: moved }), movedPath);
  assert.equal(readSqliteMigrationBackup({ backupPath: movedPath }).sourcePath, f.filePath);
  fs.writeFileSync(`${moved}.schema-2-to-3.backup-shm`, 'unexpected');
  assert.throws(() => verifySqliteMigrationBackup({ ...f.options, filePath: moved, originals: [f.options.originals[0]] }), /legacy-mismatch/);
});

test('same-path content, suffix, authority and version mismatches refuse without altering existing evidence', t => {
  const f = fixture(t), backupPath = verifySqliteMigrationBackup(f.options), before = fs.readFileSync(backupPath);
  for (const change of [{ originals: [f.options.originals[0]] }, { authorityKind: 'collaboration' },
    { originals: [{ suffix: '', bytes: Buffer.from('replaced main') }, ...f.options.originals.slice(1)] }]) {
    assert.throws(() => verifySqliteMigrationBackup({ ...f.options, ...change }), /mismatch/);
    assert.deepEqual(fs.readFileSync(backupPath), before);
  }
});

test('corrupt, future, malformed, empty and orphaned containers are preserved and never rebuilt', t => {
  for (const kind of ['corrupt', 'future', 'schema', 'blob', 'empty', 'orphan']) {
    const f = fixture(t), backupPath = `${f.filePath}.schema-2-to-3.backup.sqlite`;
    if (kind === 'empty') fs.writeFileSync(backupPath, '');
    else if (kind === 'corrupt') fs.writeFileSync(backupPath, 'not SQLite');
    else if (kind === 'orphan') fs.writeFileSync(backupPath + '-wal', 'orphan');
    else { verifySqliteMigrationBackup(f.options); mutate(backupPath, db => db.exec(kind === 'future' ? 'PRAGMA user_version=99' : kind === 'schema' ? 'CREATE TABLE extra(id)' : "UPDATE backup_files SET bytes=x'00' WHERE suffix='-wal'")); }
    const existing = fs.existsSync(backupPath) ? fs.readFileSync(backupPath) : null;
    assert.throws(() => verifySqliteMigrationBackup(f.options));
    assert.deepEqual(fs.existsSync(backupPath) ? fs.readFileSync(backupPath) : null, existing);
  }
});

test('transaction failures, unavailable FULL and failed independent readback never publish a backup proof', t => {
  for (const failure of ['before-commit', 'full', 'readback']) {
    const f = fixture(t), p = ports(event => {
      if (failure === 'before-commit' && event.type === 'before' && event.sql === 'COMMIT') throw new Error('failed COMMIT');
      if (failure === 'full' && event.type === 'get' && event.sql === 'PRAGMA synchronous') return { synchronous: 1 };
      if (failure === 'readback' && event.type === 'open' && event.readOnly) throw new Error('failed readback');
    });
    assert.throws(() => verifyBackupContainer(f.options, p)); assert.equal(p.observed.handles, 0);
    if (failure !== 'readback') assert.throws(() => verifySqliteMigrationBackup(f.options), /incomplete/);
    else assert.doesNotThrow(() => verifySqliteMigrationBackup(f.options));
  }
});

test('thrown post-commit response refuses until a fresh FULL verification commit succeeds', t => {
  const f = fixture(t), p = ports(event => { if (event.type === 'after' && event.sql === 'COMMIT') throw new Error('response lost'); });
  assert.throws(() => verifyBackupContainer(f.options, p), /response lost/);
  const backupPath = `${f.filePath}.schema-2-to-3.backup.sqlite`;
  assert.deepEqual(readSqliteMigrationBackup({ backupPath }).files, f.options.originals);
  assert.equal(verifySqliteMigrationBackup(f.options), backupPath);
  const failed = ports(event => { if (event.type === 'before' && event.sql === 'COMMIT') throw new Error('retry commit failed'); });
  assert.throws(() => verifyBackupContainer(f.options, failed), /retry commit failed/);
  assert.equal(p.observed.handles, 0); assert.equal(failed.observed.handles, 0);
});

test('readback mismatch and bounded capture reject safely', t => {
  const f = fixture(t), p = ports(event => {
    if (event.readOnly && event.type === 'all' && event.sql === 'SELECT * FROM backup_files') return [{ suffix: '', byte_length: 1, sha256: 'wrong', bytes: Buffer.from('x') }];
  });
  assert.throws(() => verifyBackupContainer(f.options, p), /checksum-mismatch/);
  let reads = 0;
  const io = { ...fs, existsSync: () => true, statSync: () => ({ size: MAX_BACKUP_BYTES + 1 }), readFileSync() { reads++; } };
  assert.throws(() => captureMigrationSource(f.filePath, io), /size-limit/); assert.equal(reads, 0);
});

test('all older supported facts and conversation versions upgrade with Windows directory EPERM and exact backup bytes', t => {
  for (const version of Array.from({ length: LATEST_USER_VERSION - 1 }, (_, i) => i + 1)) {
    const f = fixture(t); mutate(f.filePath, db => {
      for (const migration of FACT_MIGRATIONS.filter(item => item.version <= version)) for (const sql of migration.up) db.exec(sql);
      db.exec(`PRAGMA user_version=${version}`);
      if (version >= 2) db.prepare('INSERT INTO inbox_records(id,text,created_at,category,action,resolved_at) VALUES(?,?,?,?,?,?)').run('source', 'Preserved archive', 1, 'thought', 'keep', 2);
    });
    const originals = captureMigrationSource(f.filePath), opened = openDatabase({ filePath: f.filePath, io: windowsIo });
    assert.equal(opened.healthy, true, opened.degradedReason); opened.close();
    assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${f.filePath}.schema-${version}-to-${LATEST_USER_VERSION}.backup.sqlite` }).files, originals);
    if (version >= 2) mutate(f.filePath, db => assert.equal(db.prepare('SELECT text FROM inbox_records').get().text, 'Preserved archive'));
  }
  for (const version of Array.from({ length: COLLABORATION_USER_VERSION - 1 }, (_, i) => i + 1)) {
    const f = fixture(t); mutate(f.filePath, db => {
      for (const migration of COLLAB_MIGRATIONS.filter(item => item.version <= version)) for (const sql of migration.statements) db.exec(sql);
      db.prepare('INSERT INTO collaboration_identity VALUES(1,?)').run('owner'); db.exec(`PRAGMA user_version=${version}`);
    });
    const originals = captureMigrationSource(f.filePath), opened = openCollaborationDatabase({ filePath: f.filePath, ownerId: 'owner', platform: 'win32', io: windowsIo });
    assert.equal(opened.status, 'available', opened.reason); opened.close();
    assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${f.filePath}.schema-${version}-to-${COLLABORATION_USER_VERSION}.backup.sqlite` }).files, originals);
  }
});

test('source never opens writable when backup commit or verified readback fails', t => {
  for (const failure of ['commit', 'readback']) {
    const f = fixture(t); mutate(f.filePath, db => db.exec('PRAGMA user_version=0'));
    const before = fs.readFileSync(f.filePath), p = ports(event => {
      if (event.filePath.includes('.backup') && (failure === 'commit' && event.type === 'before' && event.sql === 'COMMIT'
        || failure === 'readback' && event.type === 'open' && event.readOnly)) throw new Error('backup proof failed');
    });
    const result = openAuthoritativeCollaborationDatabase({ filePath: f.filePath, ownerId: 'owner' }, p);
    assert.equal(result.reason, 'collaboration-backup-failed'); assert.deepEqual(fs.readFileSync(f.filePath), before);
    assert.equal(p.observed.opens.some(item => item.filePath === f.filePath && !item.readOnly), false);
    assert.equal(p.observed.handles, 0);
  }
});

test('audit paths from another OS stay opaque and verification count cannot overflow', t => {
  const f = fixture(t), backupPath = verifySqliteMigrationBackup(f.options), foreignPath = 'C:\\Users\\fixture\\profile\\facts.sqlite';
  mutate(backupPath, db => db.prepare('UPDATE backup_manifest SET source_path=?').run(foreignPath));
  assert.equal(readSqliteMigrationBackup({ backupPath }).sourcePath, foreignPath);
  assert.doesNotThrow(() => verifySqliteMigrationBackup(f.options));
  mutate(backupPath, db => db.prepare('UPDATE backup_manifest SET verification_count=?').run(Number.MAX_SAFE_INTEGER));
  const before = fs.readFileSync(backupPath);
  assert.throws(() => verifySqliteMigrationBackup(f.options), /verification-limit/);
  assert.deepEqual(fs.readFileSync(backupPath), before);
});
