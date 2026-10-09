'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { captureProfile, allocatePrivateBackup, LIMIT_BYTES, LIMIT_MEMBERS } = require('../profile-upgrade-backup');
const { hashBytes, hashValid } = require('./config-authority-schema');
const { setDurability } = require('./config-authority-identity');
const APP_ID = 0x4255424B; // BUBK: backup evidence, never a canonical authority.
const SCHEMA = [
  `CREATE TABLE upgrade_backup (singleton INTEGER PRIMARY KEY CHECK(singleton=1), manifest_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL, verification_count INTEGER NOT NULL CHECK(verification_count>=0))`,
  `CREATE TABLE upgrade_files (relative_path TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('directory','file')),
    byte_length INTEGER NOT NULL, mode INTEGER NOT NULL, mtime_ns TEXT NOT NULL, sha256 TEXT, bytes BLOB NOT NULL)`
];
const fail = reason => Object.assign(new Error(`config-upgrade-backup-${reason}`), { code: `config-upgrade-backup-${reason}` });
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonical = sql => sql.replace(/\s+/g, ' ').trim();
function validRelative(value, directory) {
  return typeof value === 'string' && value.length <= 4096 && (value === '' ? directory
    : !/[\\:\0]/.test(value) && !value.startsWith('/') && value.split('/').length <= 32
      && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'));
}
function inspect(handle) {
  const schema = handle.all("SELECT type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (handle.userVersion() !== 1 || handle.get('PRAGMA application_id')?.application_id !== APP_ID
    || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok' || schema.length !== SCHEMA.length
    || SCHEMA.some(sql => !schema.some(row => row.type === 'table' && canonical(row.sql) === canonical(sql)))) throw fail('schema-invalid');
  const rows = handle.all('SELECT * FROM upgrade_backup'), row = rows[0];
  if (rows.length !== 1 || row.singleton !== 1 || !Number.isSafeInteger(row.verification_count) || row.verification_count < 0
    || typeof row.manifest_json !== 'string' || Buffer.byteLength(row.manifest_json) > 16 * 1024 * 1024
    || hashBytes(row.manifest_json) !== row.manifest_hash) throw fail('manifest-invalid');
  let manifest;
  try { manifest = JSON.parse(row.manifest_json); } catch (_) { throw fail('manifest-invalid'); }
  if (!closed(manifest, ['format', 'version', 'binding', 'omittedRuntimeLocks', 'entries'])
    || manifest?.format !== 'bubu-profile-upgrade-backup' || manifest.version !== 1 || !Array.isArray(manifest.entries)
    || !Array.isArray(manifest.omittedRuntimeLocks) || !isDeepStrictEqual([...new Set(manifest.omittedRuntimeLocks)].sort(), manifest.omittedRuntimeLocks)
    || manifest.omittedRuntimeLocks.some(name => !['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(name))) throw fail('manifest-invalid');
  const binding = manifest.binding;
  if (!closed(binding, ['sourcePath', 'authorityId', 'applicationId', 'sourceRevision', 'sourceHash', 'sourceVersion', 'targetVersion', 'targetHash', 'token'])
    || typeof binding.sourcePath !== 'string' || !path.isAbsolute(binding.sourcePath) || binding.sourcePath.includes('\0')
    || !/^[a-zA-Z0-9_-]{16,128}$/.test(binding.authorityId) || !Number.isInteger(binding.applicationId)
    || binding.applicationId < 1 || binding.applicationId >= 2147483647 || !Number.isSafeInteger(binding.sourceRevision)
    || binding.sourceRevision < 0 || !hashValid(binding.sourceHash) || !hashValid(binding.targetHash)
    || binding.sourceVersion !== 18 || binding.targetVersion !== 19 || !/^[a-f0-9-]{36}$/.test(binding.token)) throw fail('binding-invalid');
  const entries = handle.all('SELECT relative_path,kind,byte_length,mode,mtime_ns,sha256,length(bytes) AS actual_length FROM upgrade_files ORDER BY relative_path');
  if (entries.length < 1 || entries.length > LIMIT_MEMBERS || entries.length !== manifest.entries.length
    || entries[0].relative_path !== '' || entries[0].kind !== 'directory') throw fail('members-invalid');
  let size = 0;
  const dirs = new Set();
  for (const [index, entry] of entries.entries()) {
    const directory = entry.kind === 'directory';
    if (!validRelative(entry.relative_path, directory) || !['directory', 'file'].includes(entry.kind)
      || !Number.isSafeInteger(entry.byte_length) || entry.byte_length < 0 || entry.byte_length > 64 * 1024 * 1024
      || entry.actual_length !== entry.byte_length || (size += entry.byte_length) > LIMIT_BYTES
      || !Number.isInteger(entry.mode) || entry.mode < 0 || !/^\d+$/.test(entry.mtime_ns)
      || directory && (entry.byte_length !== 0 || entry.sha256 !== null) || !directory && !hashValid(entry.sha256)) throw fail('members-invalid');
    const parent = entry.relative_path.split('/').slice(0, -1).join('/');
    if (entry.relative_path && !dirs.has(parent)) throw fail('members-invalid');
    if (directory) dirs.add(entry.relative_path);
    const { actual_length, ...metadata } = entry;
    if (!isDeepStrictEqual(metadata, manifest.entries[index])) throw fail('manifest-invalid');
    if (!directory && hashBytes(Buffer.from(handle.get('SELECT bytes FROM upgrade_files WHERE relative_path=?', [entry.relative_path]).bytes)) !== entry.sha256) throw fail('checksum');
  }
  return { manifest, manifestHash: row.manifest_hash, verificationCount: row.verification_count };
}
function createProfileUpgradeBackup({ sourcePath, backupPath, binding, io = fs, checkpoint = () => {}, verifyPermissions }, ports) {
  if (path.dirname(sourcePath) !== path.dirname(backupPath) || sourcePath === backupPath) throw fail('destination-invalid');
  const source = captureProfile(sourcePath, io);
  const allocated = allocatePrivateBackup(backupPath, io, verifyPermissions);
  const { driver, makeHandle } = ports;
  let handle;
  let expected;
  try {
    handle = makeHandle(driver.open(allocated.filePath)); setDurability(handle);
    // SQLite created its actual sidecars. Their privacy must be proved before
    // writing opaque credentials or any other private profile bytes.
    allocated.verifyPrivate(); handle.exec('BEGIN IMMEDIATE');
    try {
      SCHEMA.forEach(sql => handle.exec(sql));
      handle.exec(`PRAGMA application_id=${APP_ID}`); handle.setUserVersion(1);
      // BEGIN/schema setup materializes WAL/SHM; inspect those actual files
      // before the first source byte or identifying manifest is inserted.
      allocated.verifyPrivate();
      const metadata = [];
      for (const entry of source.entries) {
        const relative = entry.relative.split(path.sep).join('/');
        if (!validRelative(relative, entry.directory)) throw fail('member-invalid');
        const bytes = entry.directory ? Buffer.alloc(0) : source.capture(entry);
        const item = { relative_path: relative, kind: entry.directory ? 'directory' : 'file', byte_length: bytes.length,
          mode: Number(entry.stat.mode), mtime_ns: String(entry.stat.mtimeNs), sha256: entry.directory ? null : entry.hash };
        handle.run('INSERT INTO upgrade_files VALUES(?,?,?,?,?,?,?)', [...Object.values(item), bytes]); metadata.push(item);
      }
      metadata.sort((a, b) => Buffer.compare(Buffer.from(a.relative_path), Buffer.from(b.relative_path)));
      expected = { format: 'bubu-profile-upgrade-backup', version: 1, binding,
        omittedRuntimeLocks: source.omitted.sort(), entries: metadata };
      const json = JSON.stringify(expected);
      handle.run('INSERT INTO upgrade_backup VALUES(1,?,?,0)', [json, hashBytes(json)]);
      checkpoint('backup-copied'); source.verifySource(); handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
  } finally { handle?.close(); }
  function verifyBackup() {
    allocated.verifyPrivate();
    const reader = makeHandle(driver.open(allocated.filePath, { readOnly: true }));
    try {
      allocated.verifyPrivate();
      const result = inspect(reader);
      if (!isDeepStrictEqual(result.manifest, expected)) throw fail('manifest-drift');
      return result;
    } finally { reader.close(); }
  }
  const before = verifyBackup();
  // A second actual FULL commit confirms the exact evidence before source write.
  // Any exception refuses this attempt even when the backup is readable.
  handle = makeHandle(driver.open(allocated.filePath));
  try {
    setDurability(handle); handle.exec('BEGIN IMMEDIATE');
    try {
      allocated.verifyPrivate();
      if (inspect(handle).manifestHash !== before.manifestHash) throw fail('manifest-drift');
      handle.exec('UPDATE upgrade_backup SET verification_count=verification_count+1 WHERE singleton=1');
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
  } finally { handle.close(); }
  if (verifyBackup().verificationCount !== before.verificationCount + 1) throw fail('proof');
  source.verifySource(); checkpoint('backup-verified');
  return Object.freeze({ backupPath, filePath: allocated.filePath, manifest: expected,
    verifyBackup, verifySource: source.verifySource });
}
module.exports = { createProfileUpgradeBackup, inspectProfileUpgradeBackup: inspect, validRelative };
