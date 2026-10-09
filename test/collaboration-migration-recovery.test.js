'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const { openCollaborationDatabase, readSqliteMigrationBackup } = require(path.join(ROOT, 'src/platform/persistence/sqlite/sqlite-database'));
const { MIGRATIONS } = require(path.join(ROOT, 'src/platform/persistence/sqlite/collaboration-migrations'));
const EXPECTED = 4;
const OWNER = 'synthetic-migration-owner';
function oldFixture(t, version) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-migration-audit-'));
  const filePath = path.join(directory, 'collaboration.sqlite');
  const writer = new DatabaseSync(filePath);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0; BEGIN IMMEDIATE');
  for (const migration of MIGRATIONS.filter(m => m.version <= 3)) for (const sql of migration.statements) writer.exec(sql);
  writer.prepare('INSERT INTO collaboration_identity(singleton, owner_id) VALUES(1,?)').run(OWNER);
  const snapshot = { version: 1, id: 'synthetic-old-conversation', ownerId: OWNER, revision: 2, purpose: 'task', mode: 'talk', relatedEntity: null,
    createdAt: 1000, updatedAt: 1000, status: 'paused', retention: { mode: 'saved', days: 30, pinned: false }, messages: [], summaries: [],
    inputDraft: `old-${version}-synthetic-content`, selectedProposalId: null, scrollTop: 0, segment: { index: 0, turns: 0, bytes: 0 }, softNoticeShown: false };
  writer.prepare('INSERT INTO conversations(id,owner_id,revision,created_at,updated_at,expires_at,snapshot) VALUES(?,?,?,?,?,?,?)')
    .run(snapshot.id, OWNER, 2, 1000, 1000, 1000 + 30 * 86400000, JSON.stringify(snapshot));
  writer.exec(`PRAGMA user_version=${version}; COMMIT`);
  const capture = () => ['', '-wal', '-shm'].filter(s => fs.existsSync(filePath+s)).map(suffix => ({ suffix, bytes: fs.readFileSync(filePath+suffix) }));
  const originals = capture();
  assert.deepEqual(originals.map(f => f.suffix), ['', '-wal', '-shm']);
  t.after(() => { try { writer.close(); } catch (_) {} fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, filePath, writer, snapshot, originals, capture };
}
for (const version of [1, 2, 3]) test(`real v${version} schema preserves owner and exact business rows through open/reopen`, t => {
  const f = oldFixture(t, version);
  const store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  t.after(() => store.close());
  assert.equal(store.status, 'available'); assert.equal(store.userVersion, EXPECTED);
  assert.deepEqual(store.repository.load({ ownerId: OWNER, conversationId: f.snapshot.id }).conversation, f.snapshot);
  if (version < EXPECTED) {
    const backup = readSqliteMigrationBackup({ backupPath: `${f.filePath}.schema-${version}-to-${EXPECTED}.backup.sqlite` });
    assert.equal(backup.authorityKind, 'collaboration'); assert.equal(backup.sourceVersion, version); assert.equal(backup.targetVersion, EXPECTED);
    for (const before of f.originals) assert.deepEqual(backup.files.find(item => item.suffix === before.suffix).bytes, before.bytes);
  }
  const beforeRows = f.writer.prepare('SELECT * FROM conversations').all();
  const beforeIdentity = f.writer.prepare('SELECT * FROM collaboration_identity').all();
  const marker = () => EXPECTED >= 4 ? f.writer.prepare('SELECT verification_count FROM collaboration_durability WHERE singleton=1').get().verification_count : null;
  const firstMarker = marker(); store.close();
  const reopened = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  try {
    assert.equal(reopened.status, 'available');
    assert.deepEqual(f.writer.prepare('SELECT * FROM conversations').all(), beforeRows);
    assert.deepEqual(f.writer.prepare('SELECT * FROM collaboration_identity').all(), beforeIdentity);
    if (EXPECTED >= 4) assert.equal(marker(), firstMarker + 1, 'restart changes proof metadata only');
  } finally { reopened.close(); }
});
for (const refusal of ['owner', 'future', 'backup']) test(`${refusal} refusal preserves DB/WAL and retains SHM without treating SQLite read marks as business mutation`, t => {
  const f = oldFixture(t, refusal === 'backup' ? 1 : 3);
  if (refusal === 'future') f.writer.exec('PRAGMA user_version=999');
  const originals = f.capture();
  const io = refusal === 'backup' ? { ...fs, openSync(name, ...args) { if (name.includes('.backup')) throw new Error('synthetic backup creation fault'); return fs.openSync(name, ...args); } } : fs;
  const result = openCollaborationDatabase({ filePath: f.filePath, ownerId: refusal === 'owner' ? 'different-synthetic-owner' : OWNER, io });
  assert.notEqual(result.status, 'available');
  assert.equal(result.reason, refusal === 'owner' ? 'collaboration-owner-mismatch' : refusal === 'future' ? 'collaboration-future-version' : 'collaboration-backup-failed');
  const after = f.capture();
  const changes = originals.map(before => { const current = after.find(item => item.suffix === before.suffix);
    assert.ok(current, 'refusal must retain each original file');
    const offsets = [...before.bytes.keys()].filter(i => before.bytes[i] !== current.bytes[i]);
    if (before.suffix !== '-shm') assert.equal(before.bytes.equals(current.bytes), true, `${before.suffix || 'main'} bytes changed`);
    return { suffix: before.suffix, beforeLength: before.bytes.length, afterLength: current.bytes.length, changedOffsets: offsets }; });
  console.log(JSON.stringify({ refusal, files: changes }));
});
