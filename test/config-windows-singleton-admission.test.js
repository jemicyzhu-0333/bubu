'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { admitConfigCopy } = require('../src/platform/persistence/sqlite/config-admission-copy');
const { createApplication } = require('../src/bootstrap/create-application');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { fixture, NOW } = require('../test-support/config-admission-fixture');

function admit(f, platform) {
  return admitConfigCopy({ filePath: f.database, identityPath: f.identity,
    prepareInitial: () => assert.fail('fresh admission must not initialize data'),
    validateCurrent: () => assert.fail('fresh admission has no snapshot') }, {
    platform,
    driver: { open: () => assert.fail('fresh admission must not open a database') },
    makeHandle: () => assert.fail('fresh admission must not create a handle'),
    verifyPermissions: () => assert.fail('fresh admission must not allocate a copy')
  });
}
function fingerprint(f) {
  return fs.readdirSync(f.directory).sort().map(name => {
    const target = path.join(f.directory, name), stat = fs.lstatSync(target, { bigint: true });
    return { name, size: stat.size, mode: stat.mode, mtime: stat.mtimeNs,
      value: stat.isSymbolicLink() ? fs.readlinkSync(target) : stat.isFile() ? fs.readFileSync(target) : 'directory' };
  });
}

test('Windows fresh admission accepts its empty regular singleton lock without touching it', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, 'lockfile'), '');
  const before = fingerprint(f);
  assert.equal(admit(f, 'win32'), null);
  assert.deepEqual(fingerprint(f), before);
});

for (const platform of ['linux', 'darwin']) test(`${platform} never treats a Windows lockfile as its runtime lock`, t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, 'lockfile'), '');
  const before = fingerprint(f);
  assert.throws(() => admit(f, platform), { code: 'config-profile-brand-required' });
  assert.deepEqual(fingerprint(f), before);
});

for (const kind of ['nonempty', 'directory', 'symlink', 'dangling-symlink']) {
  test(`Windows refuses a ${kind} lockfile without rewriting it`, { skip: process.platform === 'win32' && kind.includes('symlink') }, t => {
    const f = fixture(t), lock = path.join(f.directory, 'lockfile');
    if (kind === 'nonempty') fs.writeFileSync(lock, 'retained user data');
    if (kind === 'directory') fs.mkdirSync(lock);
    if (kind === 'symlink') {
      const target = path.join(fixture(t).directory, 'empty-target'); fs.writeFileSync(target, ''); fs.symlinkSync(target, lock);
    }
    if (kind === 'dangling-symlink') fs.symlinkSync(path.join(f.directory, 'absent'), lock);
    const before = fingerprint(f);
    assert.throws(() => admit(f, 'win32'), { code: 'config-profile-brand-required' });
    assert.deepEqual(fingerprint(f), before);
  });
}

for (const name of ['Preferences', 'Local State', 'foreign.sqlite', 'ai-credential.bin', 'lockfile-wal', 'Lockfile']) {
  test(`an empty Windows singleton does not excuse unbound ${name}`, t => {
    const f = fixture(t); fs.writeFileSync(path.join(f.directory, 'lockfile'), '');
    // Windows is case-insensitive; the mixed-case fixture is a distinct-name test on POSIX only.
    if (name === 'Lockfile' && process.platform === 'win32') return t.skip('case-insensitive filesystem');
    fs.writeFileSync(path.join(f.directory, name), 'retained data');
    const before = fingerprint(f);
    assert.throws(() => admit(f, 'win32'), { code: 'config-profile-brand-required' });
    assert.deepEqual(fingerprint(f), before);
  });
}

test('native Windows production composition locks before fresh admission and reopens the branded current schema', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), calls = [];
  const appHost = {
    userDataPath: () => f.directory, hasExplicitUserDataPath: () => true,
    setDataDirectory: () => assert.fail('explicit profile must remain exact'),
    acquireSingleInstanceLock: () => { calls.push('lock'); fs.writeFileSync(path.join(f.directory, 'lockfile'), ''); return true; },
    isPackaged: () => true, isReady: () => false, whenReady: () => Promise.resolve(),
    hideDock() {}, openAtLogin: () => false, setOpenAtLogin() {}, quit() {}, subscribeLifecycle() {}
  };
  function launch() {
    return createApplication({ argv: [], schemaVersion: PERSISTED_SCHEMA_VERSION, normalizePersistedState: value => value, appHost,
      createStateRepository: options => {
        calls.push('admission');
        assert.equal(fs.statSync(path.join(f.directory, 'lockfile')).size, 0);
        return createSqliteStateAdapter({ ...options, now: () => NOW });
      },
      createCredentialStore: () => { calls.push('credentials'); return {}; },
      openCollaborationStorage: () => ({ status: 'unavailable', close() {} }),
      openFactStore: () => ({ tier: 'unavailable', close() {} })
    });
  }
  const first = launch();
  const state = first.stateRepository.snapshot(), revision = first.stateRepository.revision();
  first.closeStorage();
  assert.deepEqual(calls, ['lock', 'admission', 'credentials']);
  assert.equal(state.schemaVersion, PERSISTED_SCHEMA_VERSION);
  const identity = new DatabaseSync(f.identity, { readOnly: true });
  try { assert.equal(identity.prepare('PRAGMA application_id').get().application_id, 0x42554255); }
  finally { identity.close(); }
  const reopened = launch();
  try { assert.deepEqual(reopened.stateRepository.snapshot(), state); assert.equal(reopened.stateRepository.revision(), revision); }
  finally { reopened.closeStorage(); }
});
