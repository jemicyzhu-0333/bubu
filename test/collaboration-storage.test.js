'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openCollaborationDatabase, verifySqliteMigrationBackup, readSqliteMigrationBackup } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openProfileIdentity } = require('../src/platform/persistence/profile-identity');
const { COLLABORATION_USER_VERSION } = require('../src/platform/persistence/sqlite/collaboration-migrations');
const verifyMigrationBackup = options => verifySqliteMigrationBackup({ ...options, targetVersion: COLLABORATION_USER_VERSION, authorityKind: 'collaboration' });
const backupBytes = (root, suffix = '') => readSqliteMigrationBackup({ backupPath: root + '.sqlite' }).files.find(item => item.suffix === suffix).bytes;
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');

const OWNER = 'synthetic-owner-0001';
const directories = [];
function location() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-authority-test-'));
  directories.push(directory);
  return { directory, filePath: path.join(directory, 'conversations.sqlite'), identityPath: path.join(directory, 'profile-identity.sqlite') };
}
test.after(() => { for (const directory of directories) fs.rmSync(directory, { force: true, recursive: true }); });
function saveConversation(store, { at = 1000, days = 30, pinned = false, count = 0 } = {}) {
  let index = count * 100;
  const sessions = createCollaborationSessions({ ownerId: OWNER, repository: store.repository, now: () => at, idFactory: () => `fixture-${++index}` });
  const conversationId = sessions.start().conversation.id;
  const saved = sessions.setRetention({ conversationId, mode: 'saved', retentionDays: days, pinned });
  assert.equal(saved.ok, true, saved.reason);
  return { sessions, conversationId, saved };
}

test('identity is created only after lock and is stable across restarts', () => {
  const { filePath: databasePath, identityPath: filePath } = location();
  assert.equal(openProfileIdentity({ filePath, databasePath }).reason, 'profile-lock-required');
  assert.equal(fs.existsSync(filePath), false);
  const identity = openProfileIdentity({ filePath, databasePath, lockAcquired: true, idFactory: () => OWNER });
  assert.deepEqual(identity, { status: 'available', ownerId: OWNER, phase: 'INITIALIZING' });
  const original = fs.readFileSync(filePath);
  assert.deepEqual(openProfileIdentity({ filePath, databasePath, lockAcquired: true, idFactory: () => 'different-owner-0001' }), identity);
  assert.deepEqual(fs.readFileSync(filePath), original);
  // Node mode bits on Windows do not describe the file DACL.
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('missing identity for an existing database, WAL, or malformed identity fails closed', () => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = location();
    fs.writeFileSync(`${f.filePath}${suffix}`, 'synthetic bytes');
    const result = openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true, idFactory: () => OWNER });
    assert.equal(result.status, 'recovery-required');
    assert.equal(result.reason, 'profile-identity-missing');
    assert.equal(fs.existsSync(f.identityPath), false);
  }
  const f = location();
  fs.writeFileSync(f.identityPath, '{not JSON');
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true }).status, 'recovery-required');
  assert.equal(fs.readFileSync(f.identityPath, 'utf8'), '{not JSON');
});

test('identity uses exclusive creation, file fsync and SQLite transaction; directory handles are not needed', () => {
  const f = location();
  let fileSyncs = 0;
  const io = { ...fs, openSync: (name, flags, ...rest) => {
    if (fs.statSync(path.dirname(name)).isDirectory() && name === f.directory) {
      throw Object.assign(new Error('synthetic Windows directory open refusal'), { code: 'EPERM' });
    }
    assert.equal(flags, 'wx');
    return fs.openSync(name, flags, ...rest);
  }, fsyncSync: fd => { fileSyncs += 1; fs.fsyncSync(fd); } };
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true,
    idFactory: () => OWNER, io }).status, 'available');
  assert.equal(fileSyncs, 1);
  const second = location();
  const failing = { ...fs, fsyncSync: () => { throw Object.assign(new Error('synthetic file flush failure'), { code: 'EIO' }); } };
  assert.equal(openProfileIdentity({ filePath: second.identityPath, databasePath: second.filePath,
    lockAcquired: true, idFactory: () => OWNER, io: failing }).status, 'unavailable');
  assert.equal(fs.existsSync(second.identityPath), true);
  let retries = 0;
  assert.equal(openProfileIdentity({ filePath: second.identityPath, databasePath: second.filePath,
    lockAcquired: true, idFactory: () => { retries += 1; return 'must-not-reassign'; } }).status, 'recovery-required');
  assert.equal(retries, 0);
});

test('authority has FULL durability, foreign keys and WAL; closed repository persists exact snapshots', () => {
  const f = location();
  const store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  assert.equal(store.status, 'available');
  assert.deepEqual(Object.keys(store.repository).sort(), ['delete', 'listPage', 'load', 'pruneRetention', 'reconcileSave', 'saveSnapshot']);
  const { conversationId } = saveConversation(store);
  const before = store.repository.load({ ownerId: OWNER, conversationId }).conversation;
  assert.equal(store.repository.load({ ownerId: 'other', conversationId }).reason, 'conversation-owner-mismatch');
  store.close();
  const raw = new DatabaseSync(f.filePath);
  assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  const foreignKeys = raw.prepare('PRAGMA foreign_key_list(conversations)').all();
  assert.equal(foreignKeys[0].table, 'collaboration_identity');
  raw.close();
  const reopened = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  assert.equal(reopened.status, 'available');
  assert.deepEqual(reopened.repository.load({ ownerId: OWNER, conversationId }).conversation, before);
  reopened.close();
});

test('compare-and-swap guards snapshots and explicit deletion without rewriting logical revision', () => {
  const store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  const { conversationId } = saveConversation(store);
  const old = store.repository.load({ ownerId: OWNER, conversationId }).conversation;
  const changed = { ...old, revision: old.revision + 10, inputDraft: 'exact latest draft' };
  assert.equal(store.repository.saveSnapshot({ ownerId: OWNER, snapshot: changed, expectedRevision: 0 }).reason, 'conversation-revision-conflict');
  assert.deepEqual(store.repository.load({ ownerId: OWNER, conversationId }).conversation, old);
  assert.equal(store.repository.saveSnapshot({ ownerId: OWNER, snapshot: changed, expectedRevision: old.revision }).revision, changed.revision);
  assert.equal(store.repository.delete({ ownerId: OWNER, conversationId, expectedRevision: old.revision }).reason, 'conversation-revision-conflict');
  assert.equal(store.repository.delete({ ownerId: OWNER, conversationId, expectedRevision: changed.revision }).removed, 1);
  assert.equal(store.repository.load({ ownerId: OWNER, conversationId }).reason, 'conversation-not-found');
  store.close();
});

test('retention is explicit, owner-scoped and separate from timeline; pinned sessions survive', () => {
  const store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  const expiring = saveConversation(store, { days: 1, count: 1 });
  const pinned = saveConversation(store, { days: 1, pinned: true, count: 2 });
  const longer = saveConversation(store, { days: 30, count: 3 });
  assert.equal(store.repository.pruneRetention({ ownerId: 'other', now: 1000 + 86400000 }).ok, false);
  assert.equal(store.repository.pruneRetention({ ownerId: OWNER, now: 999 + 86400000 }).removed, 0);
  assert.equal(store.repository.pruneRetention({ ownerId: OWNER, now: 1000 + 86400000 }).removed, 1);
  assert.equal(store.repository.load({ ownerId: OWNER, conversationId: expiring.conversationId }).ok, false);
  assert.equal(store.repository.load({ ownerId: OWNER, conversationId: pinned.conversationId }).ok, true);
  assert.equal(store.repository.load({ ownerId: OWNER, conversationId: longer.conversationId }).ok, true);
  store.close();
});

test('bounded keyset pages are stable across equal timestamps and reject malformed cursors', () => {
  const store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  for (let count = 1; count <= 31; count += 1) saveConversation(store, { count });
  const first = store.repository.listPage({ ownerId: OWNER, limit: 20 });
  const second = store.repository.listPage({ ownerId: OWNER, limit: 20, cursor: first.nextCursor });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 11);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 31);
  assert.equal(store.repository.listPage({ ownerId: OWNER, limit: 51 }).ok, false);
  assert.equal(store.repository.listPage({ ownerId: OWNER, cursor: 'not-a-cursor' }).ok, false);
  store.close();
});

test('corrupt, future, wrong-owner and malformed authority never resets or falls back', () => {
  const corrupt = location();
  fs.writeFileSync(corrupt.filePath, 'synthetic not a sqlite database');
  const original = fs.readFileSync(corrupt.filePath);
  assert.equal(openCollaborationDatabase({ filePath: corrupt.filePath, ownerId: OWNER }).status, 'corrupt');
  assert.deepEqual(fs.readFileSync(corrupt.filePath), original);
  assert.deepEqual(fs.readdirSync(corrupt.directory), ['conversations.sqlite']);
  const future = location();
  const raw = new DatabaseSync(future.filePath);
  raw.exec('PRAGMA user_version=999'); raw.close();
  const futureBytes = fs.readFileSync(future.filePath);
  assert.equal(openCollaborationDatabase({ filePath: future.filePath, ownerId: OWNER }).reason, 'collaboration-future-version');
  assert.deepEqual(fs.readFileSync(future.filePath), futureBytes);
  const valid = location();
  const db = openCollaborationDatabase({ filePath: valid.filePath, ownerId: OWNER });
  const { conversationId } = saveConversation(db); db.close();
  const validBytes = fs.readFileSync(valid.filePath);
  assert.equal(openCollaborationDatabase({ filePath: valid.filePath, ownerId: 'wrong-owner' }).reason, 'collaboration-owner-mismatch');
  assert.deepEqual(fs.readFileSync(valid.filePath), validBytes);
  const tamper = new DatabaseSync(valid.filePath);
  tamper.prepare('UPDATE conversations SET snapshot=? WHERE id=?').run('{"version":999}', conversationId); tamper.close();
  const malformedBytes = fs.readFileSync(valid.filePath);
  assert.equal(openCollaborationDatabase({ filePath: valid.filePath, ownerId: OWNER }).status, 'corrupt');
  assert.deepEqual(fs.readFileSync(valid.filePath), malformedBytes);
  assert.equal(openCollaborationDatabase({ filePath: valid.filePath, ownerId: OWNER, driver: 'jsonl' }).status, 'unavailable');
  assert.equal(fs.existsSync(valid.filePath.replace('.sqlite', '.jsonl.d')), false);
});

test('migration backs up exact bytes and reopening changes only the durability marker', () => {
  const f = location();
  const raw = new DatabaseSync(f.filePath);
  raw.exec('PRAGMA user_version=0'); raw.close();
  const original = fs.readFileSync(f.filePath);
  const store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  assert.equal(store.status, 'available');
  store.close();
  assert.deepEqual(backupBytes(`${f.filePath}.schema-0-to-4.backup`), original);
  const state = () => {
    const reader = new DatabaseSync(f.filePath, { readOnly: true });
    try { return {
      rows: reader.prepare('SELECT * FROM conversations ORDER BY id').all(),
      owner: reader.prepare('SELECT * FROM collaboration_identity').all(),
      schema: reader.prepare('SELECT name, type, sql FROM sqlite_master ORDER BY name').all(),
      version: reader.prepare('PRAGMA user_version').get(),
      marker: reader.prepare('SELECT verification_count FROM collaboration_durability').get().verification_count
    }; } finally { reader.close(); }
  };
  const migrated = state();
  const reopened = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER });
  assert.equal(reopened.status, 'available'); reopened.close();
  assert.deepEqual(state(), { ...migrated, marker: migrated.marker + 1 });
});

test('backup failure or mismatched backup leaves original bytes and version untouched', () => {
  for (const kind of ['write-failure', 'mismatch']) {
    const f = location();
    const raw = new DatabaseSync(f.filePath); raw.exec('PRAGMA user_version=0'); raw.close();
    const original = fs.readFileSync(f.filePath);
    if (kind === 'mismatch') fs.writeFileSync(`${f.filePath}.schema-0-to-4.backup`, 'conflicting old backup');
    const io = kind === 'write-failure' ? { ...fs, openSync: (name, ...args) => {
      if (name.includes('.backup')) throw new Error('synthetic write failure');
      return fs.openSync(name, ...args);
    } } : fs;
    const result = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, io });
    assert.equal(result.status, 'recovery-required');
    assert.equal(result.reason, 'collaboration-backup-failed');
    assert.deepEqual(fs.readFileSync(f.filePath), original);
    const check = new DatabaseSync(f.filePath, { readOnly: true });
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 0); check.close();
  }
});

test('migration backup includes byte-exact WAL and shared-memory siblings, and detects read-back mismatch', () => {
  const f = location();
  const originals = [{ suffix: '', bytes: Buffer.from('synthetic db') },
    { suffix: '-wal', bytes: Buffer.from('synthetic WAL') }, { suffix: '-shm', bytes: Buffer.from('synthetic SHM') }];
  verifyMigrationBackup({ filePath: f.filePath, sourceVersion: 0, originals });
  for (const original of originals) assert.deepEqual(backupBytes(`${f.filePath}.schema-0-to-4.backup`, original.suffix), original.bytes);
  assert.doesNotThrow(() => verifyMigrationBackup({ filePath: f.filePath, sourceVersion: 0, originals }));
  const wrong = originals.map(item => ({ ...item, bytes: Buffer.from('wrong bytes') }));
  assert.throws(() => verifyMigrationBackup({ filePath: f.filePath, sourceVersion: 0, originals: wrong }), /backup-mismatch/);
});

test('future-schema refusal does not checkpoint an existing WAL', () => {
  const f = location();
  const writer = new DatabaseSync(f.filePath);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE future_data(id TEXT); PRAGMA user_version=999; INSERT INTO future_data VALUES(\'synthetic\')');
  const dbBytes = fs.readFileSync(f.filePath);
  const walBytes = fs.readFileSync(`${f.filePath}-wal`);
  assert.equal(openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER }).reason, 'collaboration-future-version');
  assert.deepEqual(fs.readFileSync(f.filePath), dbBytes);
  assert.deepEqual(fs.readFileSync(`${f.filePath}-wal`), walBytes);
  writer.close();
});

test('snapshot CAS cannot rewrite canonical message history or resurrect withdrawn context', () => {
  const store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  const { sessions, conversationId } = saveConversation(store);
  const begun = sessions.beginTurn({ conversationId, message: 'original synthetic text', providerId: 'fixture-provider', authorizationGeneration: 0,
    sourceRefs: [{ kind: 'task', id: 'fixture-task', revision: 'v1' }] });
  sessions.completeTurn({ token: begun.token, providerId: 'fixture-provider', content: 'source dependent answer' });
  sessions.revoke({ conversationId });
  const before = store.repository.load({ ownerId: OWNER, conversationId }).conversation;
  for (const mutation of ['rewrite', 'truncate', 'restore-context', 'creation-time']) {
    const next = JSON.parse(JSON.stringify(before));
    next.revision += 1;
    if (mutation === 'rewrite') next.messages[0].content = 'rewritten synthetic text';
    if (mutation === 'truncate') next.messages = [];
    if (mutation === 'restore-context') next.messages[1].contextAllowed = true;
    if (mutation === 'creation-time') next.createdAt -= 1;
    next.segment.turns = next.messages.filter(message => message.role === 'user').length;
    next.segment.bytes = next.messages.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message)), 0);
    assert.equal(store.repository.saveSnapshot({ ownerId: OWNER, snapshot: next, expectedRevision: before.revision }).reason, 'conversation-history-conflict');
  }
  assert.deepEqual(store.repository.load({ ownerId: OWNER, conversationId }).conversation, before);
  store.close();
});

test('orphan WAL is never adopted into a newly created authority', () => {
  const f = location();
  fs.writeFileSync(`${f.filePath}-wal`, 'synthetic orphan');
  assert.equal(openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER }).reason, 'collaboration-database-missing');
  assert.equal(fs.existsSync(f.filePath), false);
  assert.equal(fs.readFileSync(`${f.filePath}-wal`, 'utf8'), 'synthetic orphan');
});

test('existing empty, uninitialized, future, or empty-row identity SQLite never mints another owner', () => {
  for (const kind of ['empty-file', 'uninitialized', 'future', 'empty-row']) {
    const f = location();
    if (kind === 'empty-file') fs.writeFileSync(f.identityPath, '');
    if (kind === 'uninitialized' || kind === 'future') {
      const raw = new DatabaseSync(f.identityPath);
      raw.exec(`PRAGMA user_version=${kind === 'future' ? 999 : 0}`); raw.close();
    }
    if (kind === 'empty-row') {
      assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true,
        idFactory: () => OWNER }).status, 'available');
      const raw = new DatabaseSync(f.identityPath);
      raw.exec('DELETE FROM profile_identity'); raw.close();
    }
    const before = fs.readFileSync(f.identityPath);
    let mints = 0;
    const result = openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true,
      idFactory: () => { mints += 1; return OWNER; } });
    assert.equal(result.status, 'recovery-required', kind);
    assert.equal(mints, 0, kind);
    assert.deepEqual(fs.readFileSync(f.identityPath), before, kind);
  }
});

test('identity has no JSONL fallback and validates owner by an independent read-only reopen', () => {
  const f = location();
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, driver: 'jsonl' }).reason, 'sqlite-unavailable');
  assert.equal(fs.existsSync(f.identityPath), false);
  const identity = openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, idFactory: () => OWNER });
  assert.equal(identity.status, 'available');
  assert.equal(fs.readFileSync(f.identityPath).subarray(0, 16).toString(), 'SQLite format 3\u0000');
  const raw = new DatabaseSync(f.identityPath, { readOnly: true });
  assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual({ ...raw.prepare('SELECT singleton, owner_id FROM profile_identity').get() }, { singleton: 1, owner_id: OWNER });
  raw.close();
});

test('unsupported Windows directory operations do not block verified SQLite migration backups', () => {
  for (const [operation, code] of [['open', 'EPERM'], ['open', 'EISDIR'], ['flush', 'EINVAL'], ['flush', 'EBADF']]) {
    const f = location();
    const raw = new DatabaseSync(f.filePath); raw.exec('PRAGMA user_version=0'); raw.close();
    const before = fs.readFileSync(f.filePath);
    const io = { ...fs, openSync: (name, ...args) => {
      if (operation === 'open' && name === f.directory) throw Object.assign(new Error('synthetic Windows directory refusal'), { code });
      return fs.openSync(name, ...args);
    }, fsyncSync: fd => {
      if (operation === 'flush' && fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('synthetic Windows directory flush refusal'), { code });
      fs.fsyncSync(fd);
    } };
    const result = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, platform: 'win32', io });
    assert.equal(result.status, 'available'); result.close();
    assert.deepEqual(backupBytes(`${f.filePath}.schema-0-to-4.backup`), before);
  }
});

test('regular-file backup creation flush failures remain fail-closed', () => {
  for (const kind of ['file']) {
    const f = location();
    const raw = new DatabaseSync(f.filePath); raw.exec('PRAGMA user_version=0'); raw.close();
    const before = fs.readFileSync(f.filePath);
    const io = { ...fs, fsyncSync: fd => {
      if (fs.fstatSync(fd).isDirectory() === (kind === 'directory')) throw Object.assign(new Error('synthetic flush failure'), { code: 'EIO' });
      fs.fsyncSync(fd);
    } };
    const result = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, platform: 'win32', io });
    assert.equal(result.status, 'recovery-required');
    assert.equal(result.reason, 'collaboration-backup-failed');
    assert.deepEqual(fs.readFileSync(f.filePath), before);
  }
});

test('matching legacy backup is retained while a verified SQL container establishes backup proof', () => {
  const f = location();
  const raw = new DatabaseSync(f.filePath); raw.exec('PRAGMA user_version=0'); raw.close();
  const original = fs.readFileSync(f.filePath);
  const backup = `${f.filePath}.schema-0-to-4.backup`;
  fs.writeFileSync(backup, original);
  let fileFlushes = 0;
  const io = { ...fs, fsyncSync: fd => {
    if (fs.fstatSync(fd).isFile()) fileFlushes += 1;
    fs.fsyncSync(fd);
  } };
  const store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, io });
  assert.equal(store.status, 'available'); store.close();
  assert.equal(fileFlushes > 0, true);
  assert.deepEqual(fs.readFileSync(backup), original);
});

function identityTestPorts({ beforeOpen = () => {}, beforeExec = () => {}, getOverride = () => undefined } = {}) {
  const opens = [];
  return {
    opens,
    selectDriver: () => ({ name: 'synthetic-node-sqlite', open(filePath, options = {}) {
      opens.push(options);
      beforeOpen(opens.length, options);
      return new DatabaseSync(filePath, options);
    } }),
    makeHandle: raw => ({
      exec(sql) { beforeExec(sql); return raw.exec(sql); },
      get(sql) { const override = getOverride(sql); return override === undefined ? raw.prepare(sql).get() : override; },
      all: sql => raw.prepare(sql).all(),
      run: (sql, values = []) => raw.prepare(sql).run(...values),
      userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => raw.exec(`PRAGMA user_version=${version}`),
      close: () => { try { raw.close(); } catch (_) {} }
    })
  };
}

test('identity verifies FULL before transactional schema/owner creation and then reopens read-only', () => {
  const { openSqliteProfileIdentity } = require('../src/platform/persistence/sqlite/profile-identity-database');
  const f = location();
  const statements = [];
  const ports = identityTestPorts({ beforeExec: sql => statements.push(sql) });
  const result = openSqliteProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, idFactory: () => OWNER }, ports);
  assert.equal(result.status, 'available');
  assert.equal(statements.indexOf('PRAGMA synchronous = FULL') < statements.indexOf('BEGIN IMMEDIATE'), true);
  assert.equal(statements.includes('COMMIT'), true);
  assert.deepEqual(ports.opens, [{}, { readOnly: true }]);
});

test('identity transaction and durability-port failures never publish success or remint on retry', () => {
  const { openSqliteProfileIdentity } = require('../src/platform/persistence/sqlite/profile-identity-database');
  for (const kind of ['full-unavailable', 'commit-failure']) {
    const f = location();
    const ports = identityTestPorts({
      beforeExec: sql => { if (kind === 'commit-failure' && sql === 'COMMIT') throw new Error('synthetic commit failure'); },
      getOverride: sql => kind === 'full-unavailable' && sql === 'PRAGMA synchronous' ? { synchronous: 1 } : undefined
    });
    const result = openSqliteProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
      lockAcquired: true, idFactory: () => OWNER }, ports);
    assert.equal(result.status, 'unavailable');
    let mints = 0;
    assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true,
      idFactory: () => { mints += 1; return OWNER; } }).status, 'recovery-required');
    assert.equal(mints, 0);
  }
});

test('identity readback failure reports unavailable; later recovery reads the committed owner unchanged', () => {
  const { openSqliteProfileIdentity } = require('../src/platform/persistence/sqlite/profile-identity-database');
  const f = location();
  const ports = identityTestPorts({ beforeOpen: count => { if (count === 2) throw new Error('synthetic readback I/O failure'); } });
  assert.equal(openSqliteProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, idFactory: () => OWNER }, ports).status, 'unavailable');
  let mints = 0;
  const recovered = openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, idFactory: () => { mints += 1; return 'must-not-mint-owner'; } });
  assert.deepEqual(recovered, { status: 'available', ownerId: OWNER, phase: 'INITIALIZING' });
  assert.equal(mints, 0);
});

test('READY marker commit failure preserves INITIALIZING and permits a later verified retry', () => {
  const { markSqliteProfileIdentityReady } = require('../src/platform/persistence/sqlite/profile-identity-database');
  const { markProfileIdentityReady } = require('../src/platform/persistence/profile-identity');
  const f = location();
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath,
    lockAcquired: true, idFactory: () => OWNER }).phase, 'INITIALIZING');
  openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER }).close();
  const ports = identityTestPorts({ beforeExec: sql => { if (sql === 'COMMIT') throw new Error('synthetic marker commit failure'); } });
  assert.equal(markSqliteProfileIdentityReady({ filePath: f.identityPath, ownerId: OWNER, lockAcquired: true }, ports).status, 'unavailable');
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true }).phase, 'INITIALIZING');
  assert.equal(markProfileIdentityReady({ filePath: f.identityPath, ownerId: OWNER, lockAcquired: true }).phase, 'READY');
  assert.equal(openProfileIdentity({ filePath: f.identityPath, databasePath: f.filePath, lockAcquired: true }).phase, 'READY');
});

test('genuine v1 authority upgrades to SQL4 with byte backup, identity and records unchanged', () => {
  const f = location();
  let store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  const saved = saveConversation(store); saved.sessions.dispose();
  const original = store.repository.load({ ownerId: OWNER, conversationId: saved.conversationId }).conversation; store.close();
  const raw = new DatabaseSync(f.filePath);
  const { MIGRATIONS } = require('../src/platform/persistence/sqlite/collaboration-migrations');
  for (const sql of MIGRATIONS[0].statements) raw.exec(sql);
  raw.prepare('INSERT INTO collaboration_identity VALUES(1,?)').run(OWNER);
  raw.prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?,?)').run(original.id, OWNER, original.revision,
    original.createdAt, original.updatedAt, original.updatedAt + original.retention.days * 86400000, JSON.stringify(original));
  raw.exec('PRAGMA user_version=1'); raw.close();
  const before = fs.readFileSync(f.filePath);
  store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, requireInitialized: true });
  assert.equal(store.status, 'available'); assert.equal(store.userVersion, 4);
  assert.deepEqual(backupBytes(`${f.filePath}.schema-1-to-4.backup`), before);
  assert.deepEqual(store.repository.load({ ownerId: OWNER, conversationId: saved.conversationId }).conversation, original);
  store.close();
  store = openCollaborationDatabase({ filePath: f.filePath, ownerId: OWNER, requireInitialized: true });
  assert.equal(store.status, 'available'); assert.equal(store.userVersion, 4); store.close();
});
