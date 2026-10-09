'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { fixture, ports, NOW } = require('../test-support/preferences-upgrade-fixture');
const { encodePayload } = require('../src/platform/persistence/sqlite/config-authority-schema');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { inspectProfileUpgradeBackup } = require('../src/platform/persistence/sqlite/profile-upgrade-backup-container');
function read(filePath, sql) { const db = new DatabaseSync(filePath, { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } }
function inspectBackup(backupPath) {
  const p = ports(), handle = p.makeHandle(p.driver.open(path.join(backupPath, 'profile-backup.sqlite'), { readOnly: true }));
  try { return inspectProfileUpgradeBackup(handle); } finally { handle.close(); }
}
for (const live of [false, true]) test(`explicit branded18 upgrade preserves all data and backup bytes; live WAL=${live}`, t => {
  const f = fixture(t, { live });
  fs.symlinkSync('synthetic-process-lock', path.join(f.directory, 'SingletonLock'));
  const before = f.capture(), events = [];
  const upgrade = f.prepare({}, event => events.push(event));
  assert.equal(upgrade.status, 'verified-upgrade-required');
  assert.deepEqual(f.capture(), before);
  assert.ok(events.every(event => event.readOnly && path.dirname(event.filePath) !== f.directory));
  assert.throws(() => upgrade.execute('wrong-token'), /confirmation-required/);
  assert.deepEqual(f.capture(), before);
  const result = upgrade.execute(upgrade.confirmation);
  assert.equal(result.status, 'upgraded'); assert.equal(result.revision, f.original.revision + 1);
  const after = read(f.database, 'SELECT * FROM config_snapshot')[0];
  const expected = structuredClone(f.state); expected.schemaVersion = 19; expected.settings.locale = 'system'; expected.settings.theme = 'system';
  assert.deepEqual(JSON.parse(after.payload_json), expected);
  assert.equal(after.authority_id, f.original.authority_id); assert.equal(after.mirror_base_hash, f.original.mirror_base_hash);
  assert.deepEqual(read(f.identity, 'SELECT * FROM config_identity')[0], f.originalIdentity);
  const evidence = read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'");
  assert.equal(evidence.length, 1); assert.equal(Buffer.from(evidence[0].source_bytes).toString(), f.original.payload_json);
  const verified = inspectBackup(result.backupPath);
  assert.equal(verified.verificationCount, 1); assert.equal(verified.manifest.binding.sourceHash, f.original.payload_hash);
  assert.deepEqual(verified.manifest.omittedRuntimeLocks, ['SingletonLock']);
  const files = read(result.backupFile, "SELECT relative_path,bytes FROM upgrade_files WHERE kind='file'");
  for (const row of files) {
    assert.ok(Object.hasOwn(before, row.relative_path), `snapshot lacks ${row.relative_path}`);
    assert.deepEqual(Buffer.from(row.bytes), before[row.relative_path].bytes);
  }
  assert.ok(files.some(row => row.relative_path === 'nested/SingletonLock'));
  if (live) assert.ok(files.some(row => row.relative_path === 'config.sqlite-wal'));
  assert.equal(fs.readFileSync(path.join(f.directory, 'credentials.enc')).toString(), 'SYNTHETIC-OPAQUE-ENCRYPTED-BYTES');
  assert.throws(() => upgrade.execute(upgrade.confirmation), /confirmation-required/);
  assert.throws(() => f.prepare(), /source-invalid/);
  const reopened = createSqliteStateAdapter({ userDataPath: f.directory, now: () => NOW });
  assert.deepEqual(reopened.snapshot(), expected); reopened.close();
  assert.equal(read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'").length, 1);
});
for (const corrupt of ['old17', 'future20', 'missing-key', 'partial-locale', 'partial-theme', 'foreign', 'unmarked', 'wrong-binding', 'initializing', 'bad-evidence']) {
  test(`refuses ${corrupt} without original byte or mtime changes`, t => {
    const f = fixture(t), db = new DatabaseSync(f.database), id = new DatabaseSync(f.identity);
    const state = structuredClone(f.state);
    if (corrupt === 'old17') state.schemaVersion = 17;
    if (corrupt === 'future20') state.schemaVersion = 20;
    if (corrupt === 'missing-key') delete state.pet.foodTickets;
    if (corrupt === 'partial-locale') state.settings.locale = 'en';
    if (corrupt === 'partial-theme') state.settings.theme = 'system';
    const e = encodePayload(state);
    db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?').run(e.version, e.hash, e.json, e.mirrorHash);
    if (corrupt === 'foreign') id.exec('PRAGMA application_id=123');
    if (corrupt === 'unmarked') id.exec('PRAGMA application_id=0');
    if (corrupt === 'wrong-binding') db.exec('PRAGMA application_id=123');
    if (corrupt === 'initializing') id.prepare("UPDATE config_identity SET phase='INITIALIZING'").run();
    if (corrupt === 'bad-evidence') db.prepare("UPDATE config_evidence SET source_hash=?").run('1'.repeat(64));
    db.close(); id.close();
    const before = f.capture(), events = [];
    assert.throws(() => f.prepare({}, event => events.push(event)));
    assert.deepEqual(f.capture(), before);
    assert.ok(events.every(event => event.readOnly && path.dirname(event.filePath) !== f.directory));
  });
}
for (const stage of ['admitted', 'backup-copied', 'backup-verified', 'candidate-validated', 'before-writer']) {
  test(`failure at ${stage} preserves original bytes and mtimes`, t => {
    const f = fixture(t, { live: true }), before = f.capture(), events = [];
    const upgrade = f.prepare({ checkpoint(current) { if (current === stage) throw Error(`fault-${stage}`); } }, event => events.push(event));
    assert.throws(() => upgrade.execute(upgrade.confirmation), new RegExp(`fault-${stage}`));
    assert.deepEqual(f.capture(), before);
    assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory));
  });
}
for (const stage of ['writer-open', 'evidence-written', 'payload-written', 'before-commit']) {
  test(`writer failure at ${stage} rolls back payload and receipt with backup retained`, t => {
    const f = fixture(t), upgrade = f.prepare({ checkpoint(current) { if (current === stage) throw Error(`fault-${stage}`); } });
    assert.throws(() => upgrade.execute(upgrade.confirmation), new RegExp(`fault-${stage}`));
    assert.deepEqual(read(f.database, 'SELECT * FROM config_snapshot')[0], f.original);
    assert.deepEqual(read(f.identity, 'SELECT * FROM config_identity')[0], f.originalIdentity);
    assert.equal(read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'").length, 0);
    assert.equal(inspectBackup(upgrade.backupPath).verificationCount, 1);
  });
}
test('COMMIT acknowledgement loss reconciles exact state without replaying migration', t => {
  const f = fixture(t), upgrade = f.prepare({ checkpoint(stage) { if (stage === 'after-commit') throw Error('lost-ack'); } });
  const result = upgrade.execute(upgrade.confirmation);
  assert.equal(result.status, 'upgraded'); assert.equal(result.reconciled, true);
  assert.equal(read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'").length, 1);
  assert.equal(read(f.database, 'SELECT revision FROM config_snapshot')[0].revision, f.original.revision + 1);
});
test('consent does not authorize a changed source revision', t => {
  const f = fixture(t), upgrade = f.prepare();
  const db = new DatabaseSync(f.database); db.exec('UPDATE config_snapshot SET revision=revision+1'); db.close();
  const before = f.capture();
  assert.throws(() => upgrade.execute(upgrade.confirmation), /source-drift/);
  assert.deepEqual(f.capture(), before); assert.equal(fs.existsSync(upgrade.backupPath), false);
});
test('symlink in any non-lock member refuses backup without touching source', t => {
  const f = fixture(t), upgrade = f.prepare();
  fs.symlinkSync('../credentials.enc', path.join(f.directory, 'nested', 'linked'));
  const before = f.capture(); assert.throws(() => upgrade.execute(upgrade.confirmation), /member-invalid/); assert.deepEqual(f.capture(), before);
});
test('permission verifier rejection and backup SQLite quota failures cannot open source writer', t => {
  for (const kind of ['permissions', 'quota']) {
    const f = fixture(t), before = f.capture(), events = [];
    let injected = 0;
    const upgrade = f.prepare({ verifyPermissions(directory) {
      if (kind === 'permissions' && directory.endsWith('.backup')) { injected++; throw Error('ACL denied'); }
    } }, event => {
      events.push(event);
      if (kind === 'quota' && path.dirname(event.filePath).endsWith('.backup') && event.sql?.startsWith('INSERT INTO upgrade_files')) {
        injected++; throw Error('SQLITE_FULL');
      }
    });
    assert.throws(() => upgrade.execute(upgrade.confirmation), /ACL denied|SQLITE_FULL/);
    assert.equal(injected, 1, `${kind} fault must reach the actual backup on every platform`);
    assert.deepEqual(f.capture(), before);
    assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory));
  }
});

test('backup limits reject oversized files, total bytes and excessive depth before source writes', t => {
  for (const kind of ['file', 'total', 'depth']) {
    const f = fixture(t), u = f.prepare();
    if (kind === 'depth') {
      let directory = f.directory;
      for (let i = 0; i < 34; i++) { directory = path.join(directory, `d${i}`); fs.mkdirSync(directory); }
    } else {
      const count = kind === 'file' ? 1 : 9, size = kind === 'file' ? 64 * 1024 * 1024 + 1 : 60 * 1024 * 1024;
      for (let i = 0; i < count; i++) {
        const fd = fs.openSync(path.join(f.directory, `synthetic-sparse-${i}`), 'wx');
        try { fs.ftruncateSync(fd, size); } finally { fs.closeSync(fd); }
      }
    }
    const config = fs.readFileSync(f.database), identity = fs.readFileSync(f.identity);
    assert.throws(() => u.execute(u.confirmation), /capacity/);
    assert.deepEqual(fs.readFileSync(f.database), config); assert.deepEqual(fs.readFileSync(f.identity), identity);
    assert.equal(fs.existsSync(u.backupPath), false);
  }
});
test('ordinary fresh19 path remains current-only and a schema18 runtime rejects upgraded19', t => {
  const f = fixture(t), u = f.prepare(); u.execute(u.confirmation);
  const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
  const before = f.capture(); let normalizations = 0;
  assert.throws(() => createElectronStoreAdapter({ userDataPath: f.directory, schemaVersion: 18, jsonMirror: false,
    currentOnly: true, normalize() { normalizations++; throw Error('must not normalize future19'); }, assertCanonical() {} }), /future-schema/);
  assert.equal(normalizations, 0); assert.deepEqual(f.capture(), before);
  const fresh = path.join(f.root, 'fresh');
  const r = createSqliteStateAdapter({ userDataPath: fresh, now: () => NOW });
  assert.equal(r.snapshot().schemaVersion, 19); assert.equal(r.snapshot().settings.locale, 'system'); r.close();
});
test('missing tuple members and symlink profiles cannot receive an upgrade session', t => {
  for (const member of ['config.sqlite', 'config.sqlite.identity.sqlite']) {
    const f = fixture(t); fs.unlinkSync(path.join(f.directory, member));
    const before = f.capture(); assert.throws(() => f.prepare()); assert.deepEqual(f.capture(), before);
  }
  const f = fixture(t), linked = path.join(f.root, 'linked'); fs.symlinkSync(f.directory, linked);
  const before = f.capture();
  assert.throws(() => f.prepare({ userDataPath: linked }), /invalid/); assert.deepEqual(f.capture(), before);
});
test('source or authority changes while creating backup revoke the prior consent', t => {
  for (const mutation of ['file', 'authority']) {
    const f = fixture(t); let changed;
    const u = f.prepare({ checkpoint(stage) {
      if (stage === 'backup-copied') {
        if (mutation === 'file') fs.writeFileSync(path.join(f.directory, 'credentials.enc'), 'NEW SYNTHETIC OPAQUE BYTES');
        else { const db = new DatabaseSync(f.identity); db.prepare('UPDATE config_identity SET application_id=application_id+1').run(); db.close(); }
        changed = f.capture();
      }
    } });
    assert.throws(() => u.execute(u.confirmation), /source-drift/); assert.deepEqual(f.capture(), changed);
  }
});

test('actual backup WAL and SHM are permission-verified before private INSERT and proof writes', t => {
  const f = fixture(t); let checked = [], insertObserved = false, proofObserved = false;
  const u = f.prepare({ verifyPermissions(directory, files = []) {
    if (directory.endsWith('.backup')) checked = [...files];
  } }, event => {
    if (path.dirname(event.filePath).endsWith('.backup') && event.type === 'before'
      && (event.sql?.startsWith('INSERT INTO upgrade_files') || event.sql?.startsWith('UPDATE upgrade_backup SET verification_count'))) {
      if (event.sql.startsWith('INSERT INTO upgrade_files')) insertObserved = true;
      if (event.sql.startsWith('UPDATE upgrade_backup SET verification_count')) proofObserved = true;
      assert.ok(checked.includes(event.filePath + '-wal'), `WAL missing before ${event.sql}`);
      assert.ok(checked.includes(event.filePath + '-shm'), `SHM missing before ${event.sql}`);
    }
  });
  assert.equal(u.execute(u.confirmation).status, 'upgraded');
  assert.equal(insertObserved, true, 'must check actual private INSERT sidecars');
  assert.equal(proofObserved, true, 'must check actual proof-write sidecars');
});
test('rejecting a newly materialized backup sidecar cannot publish any private source bytes', t => {
  const f = fixture(t), before = f.capture();
  const u = f.prepare({ verifyPermissions(directory, files = []) {
    if (directory.endsWith('.backup') && files.some(file => file.endsWith('-wal'))) throw Error('sidecar-ACL-denied');
  } });
  assert.throws(() => u.execute(u.confirmation), /sidecar-ACL-denied/); assert.deepEqual(f.capture(), before);
  for (const file of fs.readdirSync(u.backupPath)) {
    assert.ok(!fs.readFileSync(path.join(u.backupPath, file)).includes(Buffer.from('SYNTHETIC-OPAQUE-ENCRYPTED-BYTES')));
  }
});
