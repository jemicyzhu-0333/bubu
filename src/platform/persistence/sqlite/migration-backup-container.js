'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const SUFFIXES = Object.freeze(['', '-wal', '-shm']);
const SQL = Object.freeze([
  `CREATE TABLE backup_manifest (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), source_path TEXT NOT NULL,
    authority_kind TEXT NOT NULL CHECK(authority_kind IN ('facts','collaboration')),
    source_version INTEGER NOT NULL, target_version INTEGER NOT NULL, manifest_hash TEXT NOT NULL, verification_count INTEGER NOT NULL CHECK(verification_count>0)
  )`,
  `CREATE TABLE backup_files (
    suffix TEXT PRIMARY KEY CHECK(suffix IN ('','-wal','-shm')), byte_length INTEGER NOT NULL,
    sha256 TEXT NOT NULL, bytes BLOB NOT NULL
  )`
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalSql = sql => String(sql).replace(/\s+/g, ' ').trim();
function fail(reason) { throw new Error(`migration-backup-${reason}`); }
function captureMigrationSource(filePath, io = fs) {
  if (filePath === ':memory:') return [];
  let total = 0;
  return SUFFIXES.filter(suffix => io.existsSync(filePath + suffix)).map(suffix => {
    const size = io.statSync(filePath + suffix).size;
    if (!Number.isSafeInteger(size) || size < 0 || (total += size) > MAX_BACKUP_BYTES) fail('size-limit');
    const bytes = io.readFileSync(filePath + suffix);
    if (bytes.length !== size) fail('source-changed');
    return { suffix, bytes };
  });
}
function manifestFor({ filePath, authorityKind, sourceVersion, targetVersion, originals, auditPath = false }) {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 32768 || filePath.includes('\0') || filePath === ':memory:'
    || !['facts', 'collaboration'].includes(authorityKind)
    || !Number.isSafeInteger(sourceVersion) || sourceVersion < 0
    || !Number.isSafeInteger(targetVersion) || targetVersion <= sourceVersion
    || !Array.isArray(originals) || originals.length < 1 || originals.length > 3) fail('options-invalid');
  const files = SUFFIXES.flatMap(suffix => originals.filter(item => item.suffix === suffix));
  if (files.length !== originals.length || files[0]?.suffix !== ''
    || new Set(files.map(item => item.suffix)).size !== files.length
    || files.some(item => !Buffer.isBuffer(item.bytes))
    || files.reduce((sum, item) => sum + item.bytes.length, 0) > MAX_BACKUP_BYTES) fail('files-invalid');
  const metadata = { authorityKind, sourceVersion, targetVersion,
    files: files.map(item => ({ suffix: item.suffix, byteLength: item.bytes.length, sha256: digest(item.bytes) })) };
  return { sourcePath: auditPath ? filePath : path.resolve(filePath), ...metadata, fileManifest: metadata.files, manifestHash: digest(JSON.stringify(metadata)), files };
}
function configure(handle) {
  handle.exec('PRAGMA journal_mode=WAL');
  handle.exec('PRAGMA synchronous=FULL');
  handle.exec('PRAGMA foreign_keys=ON');
  handle.exec('PRAGMA busy_timeout=2000');
  if (handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal'
    || Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2
    || Number(handle.get('PRAGMA foreign_keys')?.foreign_keys) !== 1) fail('durability-unavailable');
}
function inspect(handle) {
  if (handle.userVersion() > BACKUP_VERSION) fail('future-version');
  if (handle.userVersion() !== BACKUP_VERSION) fail('incomplete');
  if (Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok') fail('corrupt');
  const objects = handle.all("SELECT type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (objects.length !== SQL.length || objects.some(row => row.type !== 'table'
    || !SQL.some(sql => canonicalSql(sql) === canonicalSql(row.sql)))) fail('schema-invalid');
  const rows = handle.all('SELECT * FROM backup_manifest');
  if (rows.length !== 1 || rows[0].singleton !== 1 || !Number.isSafeInteger(rows[0].verification_count) || rows[0].verification_count < 1) fail('manifest-invalid');
  const stored = rows[0];
  const sizes = handle.all('SELECT suffix,byte_length,length(bytes) AS actual_length FROM backup_files');
  if (sizes.length < 1 || sizes.length > 3 || sizes.some(row => !Number.isSafeInteger(row.byte_length)
    || row.byte_length < 0 || row.byte_length !== row.actual_length)
    || sizes.reduce((sum, row) => sum + row.byte_length, 0) > MAX_BACKUP_BYTES) fail('files-invalid');
  const files = handle.all('SELECT * FROM backup_files').map(row => {
    const bytes = Buffer.from(row.bytes);
    if (row.sha256 !== digest(bytes)) fail('checksum-mismatch');
    return { suffix: row.suffix, bytes };
  });
  const manifest = manifestFor({ filePath: stored.source_path, authorityKind: stored.authority_kind,
    sourceVersion: stored.source_version, targetVersion: stored.target_version, originals: files, auditPath: true });
  if (manifest.manifestHash !== stored.manifest_hash) fail('manifest-mismatch');
  return { ...manifest, verificationCount: stored.verification_count };
}
function readBackupContainer({ backupPath, io = fs }, { driver, makeHandle }) {
  if (typeof backupPath !== 'string' || !io.existsSync(backupPath)) fail('missing');
  let handle;
  try { handle = makeHandle(driver.open(backupPath, { readOnly: true })); return inspect(handle); }
  finally { handle?.close(); }
}
function verifyMatches(actual, expected) {
  if (actual.manifestHash !== expected.manifestHash || actual.files.length !== expected.files.length
    || actual.files.some((item, index) => item.suffix !== expected.files[index].suffix
      || !item.bytes.equals(expected.files[index].bytes))) fail('mismatch');
}
function verifyLegacyFiles(root, originals, io) {
  for (const suffix of SUFFIXES) if (io.existsSync(root + suffix)) {
    const original = originals.find(item => item.suffix === suffix);
    if (!original || !io.readFileSync(root + suffix).equals(original.bytes)) fail('legacy-mismatch');
  }
}

// One immutable source snapshot per explicit schema upgrade. The container is
// evidence, never a live data authority. SQLite FULL commits replace the former
// POSIX directory-flush gate; no universal physical power-loss claim is made.
function verifyBackupContainer(options, ports) {
  if (!ports?.driver?.open || typeof ports.makeHandle !== 'function') fail('ports-invalid');
  const { filePath, sourceVersion, targetVersion, originals, io = fs } = options;
  const expected = manifestFor(options);
  const root = `${filePath}.schema-${sourceVersion}-to-${targetVersion}.backup`;
  const backupPath = `${root}.sqlite`;
  verifyLegacyFiles(root, originals, io);
  const existing = io.existsSync(backupPath);
  if (!existing && ['-wal', '-shm'].some(suffix => io.existsSync(backupPath + suffix))) fail('main-missing');
  if (existing) {
    const previous = readBackupContainer({ backupPath, io }, ports);
    verifyMatches(previous, expected);
    if (previous.verificationCount === Number.MAX_SAFE_INTEGER) fail('verification-limit');
  }
  else {
    // A crash before the transaction leaves an explicitly incomplete file.
    // Never overwrite/remint that evidence on a later attempt.
    const fd = io.openSync(backupPath, 'wx', 0o600);
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
  }
  let handle, commitError;
  try {
    handle = ports.makeHandle(ports.driver.open(backupPath));
    configure(handle);
    handle.exec('BEGIN IMMEDIATE');
    if (existing) {
      const previous = inspect(handle);
      verifyMatches(previous, expected);
      if (previous.verificationCount === Number.MAX_SAFE_INTEGER) fail('verification-limit');
      // Reaffirm a previously uncertain backup with an actual FULL commit.
      handle.exec('UPDATE backup_manifest SET verification_count=verification_count+1 WHERE singleton=1');
    } else {
      for (const sql of SQL) handle.exec(sql);
      handle.run('INSERT INTO backup_manifest VALUES(1,?,?,?,?,?,1)', [expected.sourcePath,
        expected.authorityKind, sourceVersion, targetVersion, expected.manifestHash]);
      for (const { suffix, bytes } of expected.files) handle.run('INSERT INTO backup_files VALUES(?,?,?,?)', [suffix, bytes.length, digest(bytes), bytes]);
      handle.setUserVersion(BACKUP_VERSION);
    }
    handle.exec('COMMIT');
  } catch (error) {
    commitError = error;
    try { handle?.exec('ROLLBACK'); } catch (_) {}
  } finally { handle?.close(); }
  // Readable bytes after an I/O exception prove logical state, not a completed
  // FULL flush. Refuse this attempt even if COMMIT landed. A later retry must
  // make its own successful FULL counter transaction before source migration.
  const verified = readBackupContainer({ backupPath, io }, ports);
  verifyMatches(verified, expected);
  if (commitError) throw commitError;
  return backupPath;
}

module.exports = { BACKUP_VERSION, MAX_BACKUP_BYTES, captureMigrationSource, verifyBackupContainer, readBackupContainer };
