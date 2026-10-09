'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createEmptyProfile } = require('./installed-first-launch');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { normalizePersistedState, assertCanonicalPersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { inspectProfileUpgradeBackup } = require('../src/platform/persistence/sqlite/profile-upgrade-backup-container');
const { verifyProbePermissions } = require('../src/platform/persistence/sqlite/config-admission-permissions');
const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const LOCKS = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']);
function captureFiles(directory) {
  const result = {};
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      if (!relative && LOCKS.has(name)) continue;
      const child = path.join(relative, name), file = path.join(directory, child);
      const stat = fs.lstatSync(file, { bigint: true });
      assert.equal(stat.isSymbolicLink(), false, 'synthetic profile must not contain links');
      if (stat.isDirectory()) walk(child);
      else {
        assert.ok(stat.isFile() && stat.size <= 32n * 1024n * 1024n);
        const bytes = fs.readFileSync(file);
        result[child.split(path.sep).join('/')] = { bytes, mtimeNs: String(stat.mtimeNs), sha256: HASH(bytes) };
      }
    }
  }
  walk(); return result;
}
function createUpgradeFixture() {
  assert.equal(PERSISTED_SCHEMA_VERSION, 19, 'this explicit upgrade fixture is only for reviewed 18 to 19');
  const fixture = createEmptyProfile(), now = Date.now();
  const repo = createSqliteStateAdapter({ userDataPath: fixture.userDataPath, now: () => now });
  try {
    const state = normalizePersistedState({ ...repo.snapshot(), tasks: [{ id: 'installed-upgrade-task', title: 'Preserve 中文 task',
      description: 'Preserve original description', steps: [{ id: 'installed-upgrade-step', title: 'Preserve step' }] }],
      impulses: [{ id: 'installed-upgrade-inbox', text: 'Preserve unmodified inbox content', createdAt: now }] }, { now });
    state.settings.autoCheckUpdates = false;
    repo.commit(state, { now });
  } finally { repo.close(); }
  // A separate owner exits without closing SQLite to retain real WAL/SHM bytes.
  // Only this newly allocated synthetic fixture is downgraded; no user path input.
  const result = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const { encodePayload } = require(process.argv[1]);
    const db = new DatabaseSync(process.argv[2]), identity = new DatabaseSync(process.argv[2] + '.identity.sqlite');
    db.exec('PRAGMA journal_mode=WAL'); identity.exec('PRAGMA journal_mode=WAL');
    const state = JSON.parse(db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
    state.schemaVersion = 18; delete state.settings.locale; delete state.settings.theme;
    const encoded = encodePayload(state);
    db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?')
      .run(encoded.version, encoded.hash, encoded.json, encoded.mirrorHash);
    identity.exec('UPDATE config_identity SET source_length=source_length');
    process.stdout.write(JSON.stringify({ original: db.prepare('SELECT * FROM config_snapshot').get(), identity: identity.prepare('SELECT * FROM config_identity').get() }));
    process.exit(0);
  `, require.resolve('../src/platform/persistence/sqlite/config-authority-schema'), path.join(fixture.userDataPath, 'config.sqlite')],
  { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, 'synthetic retained-WAL seeding failed');
  Object.assign(fixture, JSON.parse(result.stdout));
  fs.mkdirSync(path.join(fixture.userDataPath, 'nested'), { mode: 0o700 });
  fs.writeFileSync(path.join(fixture.userDataPath, 'nested', 'marker.bin'), 'SYNTHETIC OPAQUE MARKER; NOT A CREDENTIAL', { mode: 0o600 });
  fixture.before = captureFiles(fixture.userDataPath);
  for (const name of ['config.sqlite-wal', 'config.sqlite-shm', 'config.sqlite.identity.sqlite-wal', 'config.sqlite.identity.sqlite-shm']) {
    assert.ok(fixture.before[name], `retained synthetic ${name} required`);
  }
  fixture.childClosed = true;
  return fixture;
}
function copySnapshot(directory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-upgrade-read-'));
  try {
    for (const name of ['config.sqlite', 'config.sqlite.identity.sqlite']) for (const suffix of ['', '-wal', '-shm']) {
      const file = path.join(directory, name + suffix);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(root, name + suffix));
    }
    const db = new DatabaseSync(path.join(root, 'config.sqlite'), { readOnly: true });
    const identity = new DatabaseSync(path.join(root, 'config.sqlite.identity.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT * FROM config_snapshot').get();
      assert.equal(identity.prepare('PRAGMA application_id').get().application_id, 0x42554255);
      const binding = identity.prepare('SELECT * FROM config_identity').get();
      assert.equal(binding.authority_id, row.authority_id);
      assert.equal(db.prepare('PRAGMA application_id').get().application_id, binding.application_id);
      assert.equal(binding.phase, 'READY');
      assert.equal(HASH(row.payload_json), row.payload_hash);
      return { row, identity: { ...binding }, state: JSON.parse(row.payload_json), evidence: db.prepare("SELECT * FROM config_evidence WHERE kind='payload-migration'").all() };
    } finally { db.close(); identity.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function verifyUnchanged(fixture) {
  assert.deepEqual(captureFiles(fixture.userDataPath), fixture.before, 'consent/cancel must preserve source bytes and mtimes');
  assert.deepEqual(fs.readdirSync(fixture.root).filter(name => name.endsWith('.backup')), []);
}
function verifyApproved(fixture) {
  const snapshot = copySnapshot(fixture.userDataPath);
  const expected = JSON.parse(fixture.original.payload_json);
  expected.schemaVersion = 19; expected.settings.locale = 'system'; expected.settings.theme = 'system';
  assert.deepEqual(snapshot.state, expected, 'upgrade must be exactly additive before ordinary startup');
  assertCanonicalPersistedState(snapshot.state);
  assert.deepEqual(snapshot.identity, fixture.identity);
  assert.equal(snapshot.row.authority_id, fixture.original.authority_id);
  assert.equal(snapshot.row.revision, fixture.original.revision + 1);
  assert.equal(snapshot.evidence.length, 1);
  assert.equal(Buffer.from(snapshot.evidence[0].source_bytes).toString(), fixture.original.payload_json);
  const backups = fs.readdirSync(fixture.root).filter(name => name.endsWith('.backup'));
  assert.equal(backups.length, 1);
  const backupPath = path.join(fixture.root, backups[0]), file = path.join(backupPath, 'profile-backup.sqlite');
  verifyProbePermissions(backupPath, ['', '-wal', '-shm'].map(suffix => file + suffix).filter(value => fs.existsSync(value)));
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const handle = { get: (sql, args = []) => db.prepare(sql).get(...args), all: (sql, args = []) => db.prepare(sql).all(...args),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version };
    const verified = inspectProfileUpgradeBackup(handle);
    assert.equal(verified.verificationCount, 1);
    assert.equal(verified.manifest.binding.sourceHash, fixture.original.payload_hash);
    const rows = db.prepare("SELECT relative_path,bytes,mtime_ns FROM upgrade_files WHERE kind='file'").all();
    const originals = rows.filter(row => !LOCKS.has(row.relative_path));
    assert.deepEqual(originals.map(row => row.relative_path).sort(), Object.keys(fixture.before).sort());
    for (const row of originals) {
      assert.deepEqual(Buffer.from(row.bytes), fixture.before[row.relative_path].bytes);
      assert.equal(row.mtime_ns, fixture.before[row.relative_path].mtimeNs);
    }
    const restored = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-backup-verify-'));
    try {
      for (const row of originals) {
        const target = path.join(restored, row.relative_path);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, Buffer.from(row.bytes), { mode: 0o600, flag: 'wx' });
      }
      const restoredSnapshot = copySnapshot(restored);
      assert.deepEqual({ ...restoredSnapshot.row }, fixture.original);
      assert.deepEqual(restoredSnapshot.identity, fixture.identity);
      assert.equal(restoredSnapshot.state.schemaVersion, 18);
    } finally { fs.rmSync(restored, { recursive: true, force: true }); }
    return { exactAdditiveBeforeRestart: true, identityPreserved: true, oneMigrationReceipt: true, backupReopenedFromCopy: true,
      completePrivateBackup: true, originalBytesAndMtimesPreservedInBackup: true,
      nativePermissionVerification: process.platform === 'win32' ? 'Windows DACL' : 'POSIX mode', backupManifestSha256: verified.manifestHash };
  } finally { db.close(); }
}
function verifyReopened(fixture) {
  const result = copySnapshot(fixture.userDataPath), original = JSON.parse(fixture.original.payload_json);
  assertCanonicalPersistedState(result.state); assert.equal(result.state.schemaVersion, 19);
  assert.deepEqual(result.identity, fixture.identity); assert.equal(result.row.authority_id, fixture.original.authority_id);
  assert.deepEqual(result.state.tasks.map(task => [task.id, task.title, task.description, task.steps.map(step => [step.id, step.title])]),
    original.tasks.map(task => [task.id, task.title, task.description, task.steps.map(step => [step.id, step.title])]));
  assert.deepEqual(result.state.impulses, original.impulses);
  assert.equal(result.state.settings.locale, 'system'); assert.equal(result.state.settings.theme, 'system');
  assert.equal(result.evidence.length, 1);
  return { authorityId: result.row.authority_id, revision: result.row.revision, schemaVersion: 19,
    taskStepInboxPreserved: true, systemDefaultsPreserved: true, oneMigrationReceipt: true };
}
module.exports = { createUpgradeFixture, captureFiles, copySnapshot, verifyUnchanged, verifyApproved, verifyReopened };
