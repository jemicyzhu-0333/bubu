'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/bootstrap/create-application');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { IDENTITY_APPLICATION_ID } = require('../src/platform/persistence/sqlite/config-authority-identity');
const { fixture, seed, tracedFactory, NOW } = require('../test-support/config-admission-fixture');

function fingerprint(directory) {
  const entries = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name), stat = fs.lstatSync(file, { bigint: true });
    entries[name] = { mtime: stat.mtimeNs, mode: stat.mode,
      value: stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? fs.readFileSync(file) : 'directory' };
  }
  return { entries, mtime: fs.statSync(directory, { bigint: true }).mtimeNs };
}

test('fresh bubu profiles brand the identity database while preserving random authority binding and payload18', t => {
  const f = fixture(t), first = f.open();
  const before = first.snapshot(), revision = first.revision(); first.close();
  const identity = new DatabaseSync(f.identity, { readOnly: true });
  const main = new DatabaseSync(f.database, { readOnly: true });
  try {
    assert.equal(identity.prepare('PRAGMA application_id').get().application_id, 0x42554255);
    assert.equal(IDENTITY_APPLICATION_ID, 0x42554255);
    const binding = identity.prepare('SELECT application_id FROM config_identity').get().application_id;
    assert.ok(Number.isInteger(binding) && binding > 0 && binding < 2147483647);
    assert.equal(main.prepare('PRAGMA application_id').get().application_id, binding);
    assert.equal(before.schemaVersion, 19);
  } finally { identity.close(); main.close(); }
  const reopened = f.open();
  try { assert.deepEqual(reopened.snapshot(), before); assert.equal(reopened.revision(), revision); }
  finally { reopened.close(); }
});

for (const marker of [0, 0x464f524e]) test(`unmarked or foreign identity ${marker} refuses on its copy without touching originals`, t => {
  const f = fixture(t); seed(f.directory);
  const identity = new DatabaseSync(f.identity);
  identity.exec(`PRAGMA application_id=${marker}`); identity.close();
  const before = fingerprint(f.directory), events = [];
  assert.throws(() => f.open({ authorityFactory: tracedFactory(events) }), error => {
    assert.equal(error.code, 'config-profile-brand-mismatch');
    assert.match(error.message, /new empty profile directory/);
    return true;
  });
  assert.ok(events.length > 0, 'the private identity copy must be validated');
  assert.ok(events.every(event => !event.filePath.startsWith(f.directory + path.sep)), 'original databases must not be connected');
  assert.deepEqual(fingerprint(f.directory), before, 'all original names, bytes and mtimes survive refusal');
});

test('brand refusal precedes every credential, collaboration and facts factory even for an explicit profile', t => {
  const f = fixture(t); seed(f.directory);
  const identity = new DatabaseSync(f.identity); identity.exec('PRAGMA application_id=0'); identity.close();
  fs.writeFileSync(path.join(f.directory, 'ai-credential.bin'), 'synthetic encrypted bytes');
  const before = fingerprint(f.directory), reached = [];
  const appHost = {
    userDataPath: () => f.directory, hasExplicitUserDataPath: () => true,
    setDataDirectory: () => assert.fail('explicit path must remain exact'), acquireSingleInstanceLock: () => true,
    isPackaged: () => false, isReady: () => false, whenReady: () => Promise.resolve(),
    hideDock() {}, openAtLogin: () => false, setOpenAtLogin() {}, quit() {}, subscribeLifecycle() {}
  };
  const blocked = createApplication({ argv: [], schemaVersion: 18, normalizePersistedState: value => value, appHost,
    createStateRepository: options => createSqliteStateAdapter({ ...options, now: () => NOW }),
    createCredentialStore: () => reached.push('credential'),
    openCollaborationStorage: () => reached.push('collaboration'), openFactStore: () => reached.push('facts'),
    beginRejection({ error, userDataPath }) {
      assert.equal(error.code, 'config-profile-brand-mismatch'); assert.equal(userDataPath, f.directory);
      return { status: 'startup-blocked' };
    }
  });
  assert.equal(blocked.status, 'startup-blocked');
  assert.deepEqual(reached, []);
  assert.deepEqual(fingerprint(f.directory), before);
});

for (const name of ['foreign.sqlite', 'foreign.sqlite-wal', 'foreign.sqlite-shm', 'foreign.sqlite-journal',
  'ai-credential.bin', 'history.jsonl', 'unexpected-data', 'Preferences', 'Local State']) {
  test(`a partial unbound profile containing ${name} never becomes a new empty profile`, t => {
    const f = fixture(t); fs.writeFileSync(path.join(f.directory, name), 'synthetic retained bytes');
    const before = fingerprint(f.directory), events = [];
    assert.throws(() => f.open({ authorityFactory: tracedFactory(events) }), error => {
      assert.equal(error.code, 'config-profile-brand-required');
      assert.match(error.message, /new empty profile directory/);
      return true;
    });
    assert.deepEqual(events, [], 'no database may be opened for an unbound partial profile');
    assert.deepEqual(fingerprint(f.directory), before);
  });
}

test('a dangling credential symlink also refuses without following or replacing it', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.directory, 'absent-target'), path.join(f.directory, 'ai-credential.bin'));
  const before = fingerprint(f.directory);
  assert.throws(() => f.open(), /config-profile-brand-required/);
  assert.deepEqual(fingerprint(f.directory), before);
});

test('a READY identity without its config database is refused rather than initialized again', t => {
  const f = fixture(t); seed(f.directory); fs.unlinkSync(f.database);
  const before = fingerprint(f.directory);
  assert.throws(() => f.open(), /config-authority-missing/);
  assert.deepEqual(fingerprint(f.directory), before);
});

test('only the acquired Electron singleton lock entries may precede fresh database creation', t => {
  const f = fixture(t), names = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const name of names) fs.writeFileSync(path.join(f.directory, name), 'synthetic lock');
  const before = names.map(name => fs.readFileSync(path.join(f.directory, name)));
  const repo = f.open(); repo.close();
  for (let index = 0; index < names.length; index++) assert.deepEqual(fs.readFileSync(path.join(f.directory, names[index])), before[index]);
  const identity = new DatabaseSync(f.identity, { readOnly: true });
  try { assert.equal(identity.prepare('PRAGMA application_id').get().application_id, IDENTITY_APPLICATION_ID); }
  finally { identity.close(); }
});

test('a live profile loses access if its bubu identity marker is changed', t => {
  const f = fixture(t), repo = f.open();
  const identity = new DatabaseSync(f.identity); identity.exec('PRAGMA application_id=0'); identity.close();
  assert.throws(() => repo.snapshot(), /config-identity-mismatch/);
  repo.close();
});
