'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, OWNER, OLD_SQL, canonical, fixture, capture, ports, open, snapshot } = require('../test-support/conversation-migration/migration-fixture.cjs');
const { MIGRATIONS, COLLABORATION_USER_VERSION } = require(path.join(ROOT, 'src/platform/persistence/sqlite/collaboration-migrations'));
const { readSqliteMigrationBackup } = require(path.join(ROOT, 'src/platform/persistence/sqlite/sqlite-database'));
function unchanged(before, filePath) {
  for (const original of before) {
    assert.equal(fs.existsSync(filePath + original.suffix), true, `retained ${original.suffix || 'main'}`);
    if (original.suffix !== '-shm') assert.deepEqual(fs.readFileSync(filePath + original.suffix), original.bytes);
  }
}
function noWritableSource(p, filePath) {
  assert.equal(p.observed.events.some(e => e.phase === 'open' && e.filePath === filePath && !e.readOnly), false);
  assert.equal(p.observed.live, 0);
}
function refused(label, result, expectedReason) {
  assert.notEqual(result.status, 'available'); assert.equal(result.repository, null);
  if (expectedReason) assert.equal(result.reason, expectedReason);
  console.log(JSON.stringify({ case: label, status: result.status, reason: result.reason }));
}
function verifyBackup(f, sourceVersion) {
  const b = readSqliteMigrationBackup({ backupPath: `${f.filePath}.schema-${sourceVersion}-to-4.backup.sqlite` });
  assert.equal(b.authorityKind, 'collaboration'); assert.equal(b.sourceVersion, sourceVersion); assert.equal(b.targetVersion, 4);
  assert.deepEqual(b.files.map(file => file.suffix), f.original.map(file => file.suffix));
  for (const file of f.original) assert.equal(b.files.find(other => other.suffix === file.suffix).bytes.equals(file.bytes), true,
    `backup ${file.suffix || 'main'} is the exact pre-open capture`);
  return b;
}
test('SQL4 is additive; frozen historical v1 SQL and empty semantic v2/v3 migrations remain unchanged', () => {
  assert.equal(COLLABORATION_USER_VERSION, 4);
  assert.deepEqual(MIGRATIONS.map(m => m.version), [1, 2, 3, 4]);
  assert.deepEqual(MIGRATIONS[0].statements, OLD_SQL);
  assert.deepEqual(MIGRATIONS[1].statements, []); assert.deepEqual(MIGRATIONS[2].statements, []);
  assert.equal(MIGRATIONS[3].statements.filter(sql => /^CREATE TABLE/.test(sql)).length, 1);
  assert.equal(MIGRATIONS[3].statements.some(sql => /UPDATE conversations|DELETE FROM|DROP TABLE|ALTER TABLE/i.test(sql)), false);
});
for (const version of [0, 1, 2, 3]) test(`actual v${version} upgrades only after exact verified backup; reopening changes marker only`, t => {
  const f = fixture(t, version), p = ports();
  assert.deepEqual(f.original.map(x => x.suffix), ['', '-wal', '-shm']);
  const rows = version ? f.rows() : [], identity = version ? f.identity() : [{ singleton: 1, owner_id: OWNER }];
  f.original = capture(f.filePath);
  const store = open(f.filePath, p); assert.equal(store.status, 'available', store.reason);
  assert.equal(store.userVersion, 4); assert.equal(f.version(), 4); assert.equal(f.count(), 1);
  verifyBackup(f, version);
  const sourceWrite = p.observed.events.findIndex(e => e.phase === 'open' && e.filePath === f.filePath && !e.readOnly);
  const backupReadback = p.observed.events.findLastIndex(e => e.phase === 'after' && e.filePath.includes('.backup') && e.readOnly && e.kind === 'all');
  assert.ok(sourceWrite > backupReadback && backupReadback >= 0, 'verified backup precedes first writable source connection');
  assert.deepEqual(f.rows(), rows); assert.deepEqual(JSON.parse(JSON.stringify(f.identity())), JSON.parse(JSON.stringify(identity)));
  if (version) assert.deepEqual(store.repository.load({ ownerId: OWNER, conversationId: f.record.id }).conversation, f.record);
  store.close(); assert.equal(p.observed.live, 0);
  const schema = f.keeper.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const reopened = open(f.filePath); assert.equal(reopened.status, 'available', reopened.reason); reopened.close();
  assert.equal(f.count(), 2); assert.deepEqual(f.rows(), rows);
  assert.deepEqual(f.keeper.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), schema);
});
for (const version of [1, 2, 3, 4]) for (const kind of ['owner', 'extra-schema', 'record']) {
  test(`v${version} ${kind} refusal never opens source writable and preserves DB/WAL`, t => {
    const f = fixture(t, version, db => {
      if (kind === 'extra-schema') db.exec('CREATE VIEW foreign_view AS SELECT 1');
      if (kind === 'record') db.exec("UPDATE conversations SET snapshot='{}'");
    });
    const p = ports(), result = open(f.filePath, p, kind === 'owner' ? { ownerId: 'synthetic-other-owner' } : {});
    refused(`v${version}-${kind}`, result, kind === 'owner' ? 'collaboration-owner-mismatch' : 'collaboration-storage-corrupt');
    unchanged(f.original, f.filePath); noWritableSource(p, f.filePath);
    assert.equal(fs.existsSync(`${f.filePath}.schema-${version}-to-4.backup.sqlite`), false);
  });
}
test('future schema refuses before writable open or backup', t => {
  const f = fixture(t, 4, db => db.exec('PRAGMA user_version=999')), p = ports(), result = open(f.filePath, p);
  refused('future', result, 'collaboration-future-version'); unchanged(f.original, f.filePath); noWritableSource(p, f.filePath);
});
for (const mode of ['view-only', 'require-initialized', 'missing-required']) test(`v0 guard: ${mode} cannot initialize unrecognized or required authority`, t => {
  const f = fixture(t, 0, mode === 'view-only' ? db => db.exec('CREATE VIEW foreign_view AS SELECT 1') : null);
  const p = ports(), filePath = mode === 'missing-required' ? path.join(f.directory, 'missing.sqlite') : f.filePath;
  const result = open(filePath, p, { requireInitialized: mode !== 'view-only' });
  refused(`v0-${mode}`, result, mode === 'view-only' ? 'collaboration-schema-unrecognized' : mode === 'require-initialized' ? 'collaboration-schema-uninitialized' : 'collaboration-database-missing');
  noWritableSource(p, filePath);
  unchanged(f.original, f.filePath); assert.equal(f.version(), 0);
  if (mode === 'missing-required') assert.equal(fs.existsSync(filePath), false);
});
for (const kind of ['missing', 'negative', 'fractional', 'unsafe', 'maximum', 'weakened-constraint', 'extra-row']) {
  test(`SQL4 marker ${kind} fails closed without changing business rows`, t => {
    const f = fixture(t, 4, db => {
      if (kind === 'missing') db.exec('DELETE FROM collaboration_durability');
      if (kind === 'negative') db.exec('PRAGMA ignore_check_constraints=ON; UPDATE collaboration_durability SET verification_count=-1');
      if (kind === 'fractional') db.exec('UPDATE collaboration_durability SET verification_count=0.5');
      if (kind === 'unsafe') db.exec('UPDATE collaboration_durability SET verification_count=9007199254740992');
      if (kind === 'maximum') db.prepare('UPDATE collaboration_durability SET verification_count=?').run(Number.MAX_SAFE_INTEGER);
      if (kind === 'weakened-constraint') db.exec('DROP TABLE collaboration_durability; CREATE TABLE collaboration_durability (singleton INTEGER PRIMARY KEY, verification_count INTEGER NOT NULL); INSERT INTO collaboration_durability VALUES(1,0)');
      if (kind === 'extra-row') db.exec('PRAGMA ignore_check_constraints=ON; INSERT INTO collaboration_durability VALUES(2,0)');
    });
    const rows = f.rows(), p = ports(), result = open(f.filePath, p);
    refused(`marker-${kind}`, result, ['unsafe', 'maximum'].includes(kind) ? 'collaboration-storage-unavailable' : 'collaboration-storage-corrupt');
    assert.deepEqual(f.rows(), rows);
    unchanged(f.original, f.filePath); assert.equal(p.observed.live, 0);
    if (kind !== 'maximum') noWritableSource(p, f.filePath);
  });
}
for (const kind of ['create', 'flush', 'before-commit', 'after-commit', 'readback']) test(`backup ${kind} failure precedes every source write`, t => {
  const f = fixture(t, 3), p = ports(e => {
    if (!e.filePath.includes('.backup')) return;
    if (kind.endsWith('-commit') && e.sql === 'COMMIT' && e.phase === kind.split('-')[0]) throw new Error('synthetic backup commit failure');
    if (kind === 'readback' && e.phase === 'open' && e.readOnly) throw new Error('synthetic backup readback failure');
  });
  const io = { ...fs,
    openSync(file, ...args) { if (kind === 'create' && file.includes('.backup')) throw new Error('synthetic create failure'); return fs.openSync(file, ...args); },
    fsyncSync(fd) { if (kind === 'flush') throw new Error('synthetic flush failure'); return fs.fsyncSync(fd); }
  };
  const result = open(f.filePath, p, { io });
  refused(`backup-${kind}`, result, 'collaboration-backup-failed'); unchanged(f.original, f.filePath); noWritableSource(p, f.filePath);
  if (kind === 'after-commit' || kind === 'readback') verifyBackup(f, 3);
});
for (const phase of ['before', 'after']) test(`migration ${phase}-COMMIT throw cannot publish availability and leaves whole old/new schema`, t => {
  const f = fixture(t, 3), beforeRows = f.rows();
  f.original = capture(f.filePath);
  const p = ports(e => { if (e.stage === 'migration' && e.sql === 'COMMIT' && e.phase === phase) throw new Error('synthetic migration commit lost'); });
  const result = open(f.filePath, p); refused(`migration-${phase}`, result, 'collaboration-storage-unavailable');
  assert.equal(f.version(), phase === 'before' ? 3 : 4); assert.deepEqual(f.rows(), beforeRows); verifyBackup(f, 3);
  assert.equal(p.observed.live, 0);
  if (phase === 'before') assert.equal(f.keeper.prepare("SELECT count(*) n FROM sqlite_master WHERE name='collaboration_durability'").get().n, 0);
  else { assert.equal(f.count(), 0); const fresh = open(f.filePath); assert.equal(fresh.status, 'available', fresh.reason); fresh.close(); assert.equal(f.count(), 1); }
});
for (const failure of ['before-commit', 'after-commit', 'readback', 'count-reread', 'full', 'proof-full', 'proof-wal', 'initial-reader', 'cas-zero']) test(`startup proof ${failure} failure never exposes a repository`, t => {
  const f = fixture(t, 4), rows = f.rows();
  const p = ports((e, observed) => {
    const sourceOpens = observed.events.filter(event => event.phase === 'open' && event.filePath === f.filePath);
    if (failure === 'initial-reader' && e.phase === 'open' && e.readOnly && sourceOpens.filter(event => event.readOnly).length === 2)
      throw new Error('synthetic startup proof reader failure');
    if (failure.endsWith('-commit') && e.stage === 'proof' && e.sql === 'COMMIT' && e.phase === failure.split('-')[0]) throw new Error('synthetic proof commit failure');
    if (failure === 'readback' && observed.proofCommits && e.phase === 'open' && e.readOnly) throw new Error('synthetic final reread failed');
    if (failure === 'count-reread' && observed.proofCommits && e.readOnly && e.phase === 'before'
      && e.kind === 'get' && /SELECT verification_count/.test(e.sql)) return { verification_count: 2 };
    if (failure === 'full' && !e.readOnly && e.phase === 'before' && e.kind === 'get' && e.sql === 'PRAGMA synchronous') return { synchronous: 1 };
    if (sourceOpens.filter(event => !event.readOnly).length >= 2 && !e.readOnly && e.phase === 'before' && e.kind === 'get') {
      if (failure === 'proof-full' && e.sql === 'PRAGMA synchronous') return { synchronous: 1 };
      if (failure === 'proof-wal' && e.sql === 'PRAGMA journal_mode') return { journal_mode: 'delete' };
    }
    if (failure === 'cas-zero' && e.phase === 'before' && e.kind === 'run' && /UPDATE collaboration_durability/.test(e.sql)) return { changes: 0 };
  });
  const result = open(f.filePath, p); refused(`proof-${failure}`, result, 'collaboration-storage-unavailable');
  assert.deepEqual(f.rows(), rows); assert.equal(f.count(), ['after-commit', 'readback', 'count-reread'].includes(failure) ? 1 : 0);
  assert.equal(p.observed.live, 0);
  const fresh = open(f.filePath); assert.equal(fresh.status, 'available', fresh.reason); fresh.close();
  assert.deepEqual(f.rows(), rows); assert.equal(f.count(), ['after-commit', 'readback', 'count-reread'].includes(failure) ? 2 : 1);
});
test('last safe startup marker succeeds once and next startup refuses overflow without rewriting business rows', t => {
  const f = fixture(t, 4, db => db.prepare('UPDATE collaboration_durability SET verification_count=?').run(Number.MAX_SAFE_INTEGER - 1));
  const rows = f.rows(), first = open(f.filePath); assert.equal(first.status, 'available', first.reason); first.close();
  assert.equal(f.count(), Number.MAX_SAFE_INTEGER);
  const before = capture(f.filePath), next = open(f.filePath);
  refused('last-safe-marker', next, 'collaboration-storage-unavailable');
  unchanged(before, f.filePath); assert.deepEqual(f.rows(), rows); assert.equal(f.count(), Number.MAX_SAFE_INTEGER);
});
for (const kind of ['empty', 'invalid-bytes', 'sidecar-only', 'legacy-conflict']) test(`existing ${kind} backup evidence is retained and cannot authorize source writes`, t => {
  const f = fixture(t, 3), p = ports(), backupPath = `${f.filePath}.schema-3-to-4.backup.sqlite`;
  const target = kind === 'sidecar-only' ? backupPath + '-wal' : kind === 'legacy-conflict' ? `${f.filePath}.schema-3-to-4.backup` : backupPath;
  const bytes = Buffer.from(kind === 'empty' ? '' : `synthetic-${kind}`); fs.writeFileSync(target, bytes);
  const result = open(f.filePath, p); refused(`backup-${kind}`, result, 'collaboration-backup-failed');
  unchanged(f.original, f.filePath); noWritableSource(p, f.filePath); assert.deepEqual(fs.readFileSync(target), bytes);
  if (kind === 'sidecar-only') assert.equal(fs.existsSync(backupPath), false);
});
for (const version of [1, 2, 3]) test(`v${version} missing index refuses before backup and writes`, t => {
  const f = fixture(t, version, db => db.exec('DROP INDEX conversations_retention')), p = ports();
  const result = open(f.filePath, p); refused(`v${version}-missing-index`, result, 'collaboration-storage-corrupt');
  unchanged(f.original, f.filePath); noWritableSource(p, f.filePath);
  assert.equal(fs.existsSync(`${f.filePath}.schema-${version}-to-4.backup.sqlite`), false);
});
for (const stage of ['migration', 'proof']) for (const phase of ['before', 'after']) test(`isolated process exit ${phase} ${stage} COMMIT leaves only atomic durable state`, t => {
  const f = fixture(t, stage === 'migration' ? 3 : 4), rows = f.rows();
  f.original = capture(f.filePath);
  const child = spawnSync(process.execPath, [path.join(__dirname, '../test-support/conversation-migration/process-boundary.cjs'), f.filePath, stage, phase], { env: { ...process.env, SOURCE_ROOT: ROOT }, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 73, child.stderr || child.stdout); assert.equal(child.signal, null);
  assert.equal(f.version(), stage === 'migration' && phase === 'before' ? 3 : 4); assert.deepEqual(f.rows(), rows);
  const preservedBackup = stage === 'migration' ? verifyBackup(f, 3) : null;
  if (stage !== 'migration' || phase === 'after') assert.equal(f.count(), stage === 'proof' && phase === 'after' ? 1 : 0);
  const beforeReopen = capture(f.filePath), fresh = open(f.filePath);
  if (fresh.status !== 'available') {
    assert.equal(stage, 'migration'); assert.equal(phase, 'before');
    refused(`crash-${stage}-${phase}-reopen`, fresh, 'collaboration-backup-failed');
    assert.equal(fresh.status, 'recovery-required'); unchanged(beforeReopen, f.filePath);
    const afterBackup = verifyBackup(f, 3); assert.equal(afterBackup.verificationCount, preservedBackup.verificationCount);
    console.log('Crash before migration may require explicit recovery when immutable pre-open SHM backup no longer matches SQLite reader bookkeeping.');
  } else { assert.equal(f.version(), 4); assert.deepEqual(f.rows(), rows); fresh.close(); }
});
for (const mode of ['first', 'existing']) for (const phase of ['before', 'after']) test(`isolated process exit ${phase} ${mode} business COMMIT preserves exact old or attempted snapshot`, t => {
  const f = fixture(t, 4, mode === 'first' ? db => db.exec('DELETE FROM conversations') : null), rows = f.rows();
  const child = spawnSync(process.execPath, [path.join(__dirname, '../test-support/conversation-migration/process-boundary.cjs'), f.filePath, 'business', phase, mode],
    { env: { ...process.env, SOURCE_ROOT: ROOT }, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 73, child.stderr || child.stdout); assert.equal(child.signal, null);
  assert.equal(f.version(), 4); assert.equal(f.count(), 1, 'child startup proof completed before attempting business save');
  const attempt = snapshot();
  if (mode === 'existing') { attempt.revision++; attempt.updatedAt++; attempt.inputDraft += ' exact attempted successor'; }
  if (phase === 'before') assert.deepEqual(f.rows(), rows);
  else assert.deepEqual(JSON.parse(JSON.stringify(f.rows())), [{ id: attempt.id, owner_id: OWNER, revision: attempt.revision,
    created_at: attempt.createdAt, updated_at: attempt.updatedAt, expires_at: attempt.updatedAt + 30 * 86400000, snapshot: JSON.stringify(attempt) }]);
  const durableRows = f.rows(), fresh = open(f.filePath); assert.equal(fresh.status, 'available', fresh.reason);
  assert.equal(f.count(), 2); assert.deepEqual(f.rows(), durableRows, 'restarting adds proof metadata and never replays business save');
  const loaded = fresh.repository.load({ ownerId: OWNER, conversationId: f.record.id });
  if (phase === 'before' && mode === 'first') assert.equal(loaded.reason, 'conversation-not-found');
  else assert.deepEqual(loaded.conversation, phase === 'after' ? attempt : f.record);
  fresh.close();
});
