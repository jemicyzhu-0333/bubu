'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { fixture, ports, NOW, tree, openHistorical19 } = require('../test-support/preferences-upgrade-fixture');
const { normalizePersistedState, assertCanonicalPersistedState, assertCanonicalSchema19 } = require('../src/platform/persistence/persisted-schema');
const { encodePayload } = require('../src/platform/persistence/sqlite/config-authority-schema');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { extractProfileUpgradeBackup } = require('../src/platform/persistence/sqlite/profile-upgrade-backup-extraction');
function read(file, sql = 'SELECT * FROM config_snapshot') {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}
function fullLegacyLog() {
  return { days: ['2026-10-08', '2026-10-09'].map((dayKey, dayIndex) => ({ dayKey,
    entries: Array.from({ length: 60 }, (_, index) => ({ routineId: 'r', occurrenceId: `r:${dayKey}:free:${index}`,
      status: index % 2 ? 'done' : 'skipped', at: !index && !dayIndex ? null : NOW,
      note: `Preserve 原文 ${dayIndex}-${index}`, magnitude: 35 }))
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0) || a.occurrenceId.localeCompare(b.occurrenceId)) })) };
}
for (const live of [false, true]) test(`19→20 preserves all 120 legacy entries, null time and exact backup; live WAL=${live}`, t => {
  const f = fixture(t, { live, sourceVersion: 19, routineLog: fullLegacyLog() }), before = f.capture(), events = [];
  assertCanonicalSchema19(f.state);
  assert.throws(() => createSqliteStateAdapter({ userDataPath: f.directory }), /current-schema-required/);
  const u = f.prepare({}, event => events.push(event));
  assert.equal(u.sourceVersion, 19); assert.equal(u.targetVersion, 20);
  assert.deepEqual(f.capture(), before); assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory));
  assert.throws(() => u.execute('wrong-token'), /confirmation-required/); assert.deepEqual(f.capture(), before);
  const result = u.execute(u.confirmation), expected = { ...structuredClone(f.state), schemaVersion: 20 };
  assert.deepEqual(JSON.parse(read(f.database)[0].payload_json), expected);
  assert.deepEqual(read(f.identity, 'SELECT * FROM config_identity')[0], f.originalIdentity);
  const evidence = read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'");
  assert.equal(evidence.length, 1); assert.equal(evidence[0].source_version, 19); assert.equal(evidence[0].target_version, 20);
  assert.equal(Buffer.from(evidence[0].source_bytes).toString(), f.original.payload_json);
  for (const row of read(result.backupFile, "SELECT relative_path,bytes FROM upgrade_files WHERE kind='file'")) {
    assert.deepEqual(Buffer.from(row.bytes), before[row.relative_path].bytes);
  }
  const r = createSqliteStateAdapter({ userDataPath: f.directory, now: () => NOW });
  assert.deepEqual(r.snapshot(), expected); r.close();
  assert.throws(() => u.execute(u.confirmation), /confirmation-required/);
  assert.throws(() => f.prepare(), /source-invalid/);
  assert.throws(() => openHistorical19(f.directory), /future-schema/);
  const destination = path.join(f.root, 'restored19');
  const restored = extractProfileUpgradeBackup({ backupFile: result.backupFile, destination }, ports());
  assert.equal(restored.sourceVersion, 19);
  const extracted = tree(destination);
  for (const [name, entry] of Object.entries(before)) if (entry.bytes) assert.deepEqual(extracted[name].bytes, entry.bytes);
  const historical = openHistorical19(destination); assert.deepEqual(historical.snapshot(), f.state); historical.close();
  assert.throws(() => extractProfileUpgradeBackup({ backupFile: result.backupFile, destination: f.directory }, ports()), /destination-exists/);
});

test('schema20 keeps up to 120 stable owner buckets independent of current timezone, never admits expanded schema19', () => {
  const state = normalizePersistedState({}, { now: NOW });
  state.routineLog.days = Array.from({ length: 120 }, (_, index) => {
    const dayKey = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    return { dayKey, entries: [{ routineId: 'r', occurrenceId: `r:${dayKey}:free:0`, at: NOW,
      status: 'done', note: null, magnitude: null }] };
  });
  assertCanonicalPersistedState(state);
  assert.throws(() => assertCanonicalSchema19({ ...state, schemaVersion: 19 }), /not-canonical/);
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai', 'Pacific/Kiritimati']) {
    const script = "require('./src/platform/persistence/persisted-schema').assertCanonicalPersistedState(JSON.parse(process.argv[1]))";
    const result = spawnSync(process.execPath, ['-e', script, JSON.stringify(state)], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
    assert.equal(result.status, 0, result.stderr);
  }
  const overflow = structuredClone(state);
  overflow.routineLog.days[0].entries.push({ ...overflow.routineLog.days[0].entries[0], occurrenceId: 'r:2025-01-01:free:1' });
  assert.throws(() => assertCanonicalPersistedState(overflow), /capacity/);
  const duplicate = structuredClone(state); duplicate.routineLog.days[0].entries.push({ ...duplicate.routineLog.days[0].entries[0] });
  assert.throws(() => assertCanonicalPersistedState(duplicate), /not-canonical/);
  const mismatch = structuredClone(state); mismatch.routineLog.days[0].entries[0].occurrenceId = 'r:2025-02-01:free:0';
  assert.throws(() => assertCanonicalPersistedState(mismatch), /not-canonical/);
});

for (const corrupt of ['expanded-owner-days', 'missing-top-level', 'duplicate-id', 'unknown-setting', 'foreign']) {
  test(`19 source ${corrupt} is refused before backup/writer`, t => {
    const f = fixture(t, { sourceVersion: 19 }), db = new DatabaseSync(f.database), candidate = structuredClone(f.state);
    if (corrupt === 'expanded-owner-days') candidate.routineLog.days = ['2026-10-07', '2026-10-08', '2026-10-09'].map(dayKey => ({ dayKey, entries: [] }));
    if (corrupt === 'missing-top-level') delete candidate.routineLog;
    if (corrupt === 'duplicate-id') candidate.tasks.push(structuredClone(candidate.tasks[0]));
    if (corrupt === 'unknown-setting') candidate.settings.extra = true;
    const encoded = encodePayload(candidate);
    db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?')
      .run(encoded.version, encoded.hash, encoded.json, encoded.mirrorHash); db.close();
    if (corrupt === 'foreign') { const id = new DatabaseSync(f.identity); id.exec('UPDATE config_identity SET application_id=123'); id.close(); }
    const before = f.capture(), events = [];
    assert.throws(() => f.prepare({}, event => events.push(event)));
    assert.deepEqual(f.capture(), before); assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory));
  });
}

for (const stage of ['backup-copied', 'backup-verified', 'evidence-written', 'payload-written', 'before-commit', 'after-commit']) {
  test(`19→20 process exits at ${stage}: old19 or fully committed20 only`, t => {
    const f = fixture(t, { sourceVersion: 19, routineLog: fullLegacyLog() });
    const modulePath = path.resolve(__dirname, '../src/platform/persistence/sqlite/sqlite-database');
    const result = spawnSync(process.execPath, ['-e', `
      const u=require(process.argv[1]).prepareConfigPreferencesUpgrade({userDataPath:process.argv[2],
        checkpoint(stage){if(stage===process.argv[3])process.exit(73);}});u.execute(u.confirmation);
    `, modulePath, f.directory, stage], { encoding: 'utf8', timeout: process.platform === 'win32' ? 60000 : 15000 });
    assert.ifError(result.error); assert.equal(result.status, 73, result.stderr);
    const copied = path.join(f.root, 'inspection'); fs.cpSync(f.directory, copied, { recursive: true });
    const current = read(path.join(copied, 'config.sqlite'))[0];
    if (stage === 'after-commit') {
      assert.equal(current.payload_version, 20); assert.equal(current.revision, f.original.revision + 1);
      const r = createSqliteStateAdapter({ userDataPath: f.directory }); assert.deepEqual(r.snapshot().routineLog, f.state.routineLog); r.close();
    } else {
      assert.equal(current.payload_json, f.original.payload_json);
      const retry = f.prepare(); assert.equal(retry.execute(retry.confirmation).targetVersion, 20);
    }
  });
}

test('19→20 stale competing consent and source drift never overwrite another revision', t => {
  const f = fixture(t, { sourceVersion: 19 }), first = f.prepare(), competing = f.prepare();
  first.execute(first.confirmation);
  const before = f.capture(); assert.throws(() => competing.execute(competing.confirmation));
  assert.deepEqual(f.capture(), before); assert.equal(read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'").length, 1);
});

test('19→20 uncertain commit is reconciled once; failed durability proof reports unknown without replay', t => {
  for (const failProof of [false, true]) {
    const f = fixture(t, { sourceVersion: 19 }); let committed = false;
    const u = f.prepare({ checkpoint(stage) { if (stage === 'after-commit') { committed = true; throw Error('ack-lost'); } } }, event => {
      if (failProof && committed && event.filePath === f.database && event.sql?.startsWith('UPDATE config_snapshot SET verification_count=')) throw Error('proof-IO');
    });
    if (failProof) assert.throws(() => u.execute(u.confirmation), /commit-outcome-unknown/);
    else assert.equal(u.execute(u.confirmation).reconciled, true);
    const r = createSqliteStateAdapter({ userDataPath: f.directory }); assert.equal(r.snapshot().schemaVersion, 20); r.close();
    assert.equal(read(f.database)[0].revision, f.original.revision + 1);
    assert.equal(read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration'").length, 1);
  }
});

test('19→20 verified backup precedes source writer; changed backup and denied writer preserve source', t => {
  for (const kind of ['tamper', 'denied']) {
    const f = fixture(t, { sourceVersion: 19 }), before = f.capture(); let u;
    u = f.prepare({ checkpoint(stage) {
      if (kind === 'tamper' && stage === 'before-writer') {
        const db = new DatabaseSync(path.join(u.backupPath, 'profile-backup.sqlite'));
        db.prepare("UPDATE upgrade_files SET bytes=? WHERE relative_path='credentials.enc'").run(Buffer.from('changed')); db.close();
      }
    } }, event => { if (kind === 'denied' && event.type === 'open' && !event.readOnly && event.filePath === f.database) throw Error('EACCES'); });
    assert.throws(() => u.execute(u.confirmation), /backup-|EACCES/); assert.deepEqual(f.capture(), before);
  }
});

test('18→19 and 19→20 remain separately confirmed and preserve each exact source backup', t => {
  const f = fixture(t), first = f.prepare();
  const a = first.execute(first.confirmation); assert.equal(a.sourceVersion, 18); assert.equal(a.targetVersion, 19);
  const interim = read(f.database)[0], second = f.prepare();
  assert.equal(second.sourceVersion, 19); assert.equal(second.targetVersion, 20);
  assert.notEqual(first.confirmation, second.confirmation);
  assert.throws(() => second.execute(first.confirmation), /confirmation-required/);
  const b = second.execute(second.confirmation); assert.notEqual(a.backupPath, b.backupPath);
  const evidence = read(f.database, "SELECT * FROM config_evidence WHERE kind='payload-migration' ORDER BY source_version");
  assert.equal(evidence.length, 2); assert.equal(Buffer.from(evidence[1].source_bytes).toString(), interim.payload_json);
  const r = createSqliteStateAdapter({ userDataPath: f.directory }); assert.equal(r.snapshot().schemaVersion, 20); r.close();
});
