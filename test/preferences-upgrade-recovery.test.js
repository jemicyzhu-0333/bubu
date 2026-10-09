'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { fixture, ports, NOW, tree } = require('../test-support/preferences-upgrade-fixture');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { extractProfileUpgradeBackup } = require('../src/platform/persistence/sqlite/profile-upgrade-backup-extraction');
const { inspectProfileUpgradeBackup, validRelative } = require('../src/platform/persistence/sqlite/profile-upgrade-backup-container');
const { hashBytes } = require('../src/platform/persistence/sqlite/config-authority-schema');
function snapshot(file) { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare('SELECT * FROM config_snapshot').get(); } finally { db.close(); } }
for (const stage of ['backup-copied', 'backup-verified', 'evidence-written', 'payload-written', 'before-commit', 'after-commit']) {
  test(`process exits at ${stage}: reopening establishes old or complete new authority`, t => {
    const f = fixture(t), modulePath = path.resolve(__dirname, '../src/platform/persistence/sqlite/sqlite-database');
    const result = spawnSync(process.execPath, ['-e', `
      const {prepareConfigPreferencesUpgrade} = require(process.argv[1]);
      const upgrade=prepareConfigPreferencesUpgrade({userDataPath:process.argv[2],checkpoint(stage){if(stage===process.argv[3])process.exit(73);}});
      upgrade.execute(upgrade.confirmation);
    `, modulePath, f.directory, stage], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 73, result.stderr);
    // Inspect a copy: a live crash WAL must never be repaired by this assertion.
    const copied = path.join(f.root, 'inspection'); fs.cpSync(f.directory, copied, { recursive: true });
    const current = snapshot(path.join(copied, 'config.sqlite'));
    if (stage === 'after-commit') {
      assert.equal(current.payload_version, 19); assert.equal(current.revision, f.original.revision + 1);
      const r = createSqliteStateAdapter({ userDataPath: f.directory, now: () => NOW });
      assert.equal(r.snapshot().schemaVersion, 19); r.close();
      assert.throws(() => f.prepare(), /source-invalid/);
    } else {
      assert.equal(current.payload_version, 18); assert.equal(current.payload_json, f.original.payload_json);
      assert.throws(() => createSqliteStateAdapter({ userDataPath: f.directory }), /current-schema-required/);
      const retry = f.prepare(); assert.equal(retry.status, 'verified-upgrade-required');
      const upgraded = retry.execute(retry.confirmation); assert.equal(upgraded.status, 'upgraded');
    }
  });
}
test('uncertain COMMIT plus failed durability proof blocks acknowledgment; later normal startup proves exact19', t => {
  const f = fixture(t); let committed = false;
  const u = f.prepare({ checkpoint(stage) { if (stage === 'after-commit') { committed = true; throw Error('ack-lost'); } } }, event => {
    if (committed && event.filePath === f.database && event.sql?.startsWith('UPDATE config_snapshot SET verification_count=')) throw Error('proof-IO');
  });
  assert.throws(() => u.execute(u.confirmation), /config-commit-outcome-unknown/);
  const current = snapshot(f.database); assert.equal(current.payload_version, 19); assert.equal(current.revision, f.original.revision + 1);
  const reopened = createSqliteStateAdapter({ userDataPath: f.directory, now: () => NOW });
  assert.equal(reopened.snapshot().schemaVersion, 19); reopened.close();
});
test('tampered backup after validation refuses before writer', t => {
  const f = fixture(t); let u;
  u = f.prepare({ checkpoint(stage) {
    if (stage === 'before-writer') {
      const db = new DatabaseSync(path.join(u.backupPath, 'profile-backup.sqlite'));
      db.prepare("UPDATE upgrade_files SET bytes=? WHERE relative_path='credentials.enc'").run(Buffer.from('changed')); db.close();
    }
  } });
  const before = f.capture(); assert.throws(() => u.execute(u.confirmation), /backup-/); assert.deepEqual(f.capture(), before);
});
test('denied source writer open preserves exact bytes and mtimes with verified backup', t => {
  const f = fixture(t), before = f.capture();
  const u = f.prepare({}, event => { if (event.type === 'open' && !event.readOnly && event.filePath === f.database) throw Error('EACCES'); });
  assert.throws(() => u.execute(u.confirmation), /EACCES/);
  assert.deepEqual(f.capture(), before);
  assert.ok(fs.existsSync(path.join(u.backupPath, 'profile-backup.sqlite')));
});
test('backup extraction is explicit, complete and never overwrites an existing directory', t => {
  const f = fixture(t, { live: true }), before = f.capture(), u = f.prepare();
  const result = u.execute(u.confirmation), destination = path.join(f.root, 'recovery-copy');
  const output = extractProfileUpgradeBackup({ backupFile: result.backupFile, destination }, ports());
  assert.equal(output.status, 'extracted');
  const extracted = tree(destination);
  for (const [name, entry] of Object.entries(before)) if (entry.bytes) assert.deepEqual(extracted[name].bytes, entry.bytes);
  assert.equal(snapshot(path.join(destination, 'config.sqlite')).payload_json, f.original.payload_json);
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile, destination }, ports()), /destination-exists/);
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile, destination: f.directory }, ports()), /destination-exists/);
});
test('restoration rejects malicious paths and unverified backup', t => {
  for (const bad of ['/absolute', '../escape', 'a/../../escape', 'a\\b', 'C:/profile', 'a//b', '.', 'a/..']) assert.equal(validRelative(bad, false), false);
  const f = fixture(t), u = f.prepare(), result = u.execute(u.confirmation);
  const db = new DatabaseSync(result.backupFile); db.exec('UPDATE upgrade_backup SET verification_count=0'); db.close();
  const destination = path.join(f.root, 'refused');
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile, destination }, ports()), /backup-unverified/);
  assert.equal(fs.existsSync(destination), false);
});

test('malicious relative path with a recomputed manifest still cannot escape extraction', t => {
  const f = fixture(t), u = f.prepare(), result = u.execute(u.confirmation), db = new DatabaseSync(result.backupFile);
  const row = db.prepare('SELECT manifest_json FROM upgrade_backup').get(); const manifest = JSON.parse(row.manifest_json);
  const entry = manifest.entries.find(value => value.relative_path === 'credentials.enc'); entry.relative_path = '../escaped';
  manifest.entries.sort((a, b) => Buffer.compare(Buffer.from(a.relative_path), Buffer.from(b.relative_path)));
  db.prepare("UPDATE upgrade_files SET relative_path='../escaped' WHERE relative_path='credentials.enc'").run();
  const json = JSON.stringify(manifest); db.prepare('UPDATE upgrade_backup SET manifest_json=?,manifest_hash=?').run(json, hashBytes(json)); db.close();
  const destination = path.join(f.root, 'restore-denied');
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile, destination }, ports()), /members-invalid/);
  assert.equal(fs.existsSync(destination), false); assert.equal(fs.existsSync(path.join(f.root, 'escaped')), false);
});
test('extraction cannot follow a symbolic-link parent', t => {
  const f = fixture(t), u = f.prepare(), result = u.execute(u.confirmation), actual = path.join(f.root, 'real');
  fs.mkdirSync(actual); fs.symlinkSync(actual, path.join(f.root, 'linked'));
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile,
    destination: path.join(f.root, 'linked', 'restore') }, ports()), /destination-invalid/);
  assert.deepEqual(fs.readdirSync(actual), []);
});
