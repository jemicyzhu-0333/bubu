'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApplication } = require('../src/bootstrap/create-application');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

function createAppHostHarness({ lock = true } = {}) {
  const calls = [];
  let userDataPath = '/profiles/focuspix';
  const appHost = {
    userDataPath() {
      calls.push(['user-data', userDataPath]);
      return userDataPath;
    },
    setDataDirectory(directory) {
      calls.push(['set-data-directory', directory]);
      userDataPath = directory;
    },
    acquireSingleInstanceLock() {
      calls.push(['acquire-lock']);
      return lock;
    },
    isPackaged() { return false; },
    isReady() { return false; },
    whenReady() { return Promise.resolve(); },
    hideDock() { return false; },
    openAtLogin() { return false; },
    setOpenAtLogin() {},
    quit() { calls.push(['quit']); },
    subscribeLifecycle() { return () => {}; }
  };
  return { appHost, calls };
}

test('development profile selection precedes the lock and storage composition', () => {
  const harness = createAppHostHarness();
  const stateRepository = Object.freeze({ kind: 'state' });
  const credentialStore = Object.freeze({ kind: 'credential' });
  const factStore = Object.freeze({ kind: 'fact-store', tier: 'node:sqlite', close() {} });
  const result = createApplication({
    argv: ['electron', '.', '--dev'],
    schemaVersion: 8,
    openCollaborationStorage: () => ({ status: 'unavailable', close() {} }),
    normalizePersistedState: value => value,
    appHost: harness.appHost,
    makeDirectory: directory => harness.calls.push(['make-directory', directory]),
    createStateRepository: options => {
      harness.calls.push(['create-state', options.userDataPath, options.schemaVersion]);
      return stateRepository;
    },
    createCredentialStore: options => {
      harness.calls.push(['create-credential', options.userDataPath]);
      return credentialStore;
    },
    openFactStore: options => {
      harness.calls.push(['open-fact-store', options.userDataPath]);
      return factStore;
    }
  });

  assert.deepEqual(harness.calls, [
    ['user-data', '/profiles/focuspix'],
    ['make-directory', path.join('/profiles', 'focuspix-dev')],
    ['set-data-directory', path.join('/profiles', 'focuspix-dev')],
    ['acquire-lock'],
    ['user-data', path.join('/profiles', 'focuspix-dev')],
    ['create-state', path.join('/profiles', 'focuspix-dev'), 8],
    ['create-credential', path.join('/profiles', 'focuspix-dev')],
    ['open-fact-store', path.join('/profiles', 'focuspix-dev')]
  ]);
  assert.equal(result.status, 'primary-instance');
  assert.equal(result.profile, 'development');
  assert.equal(result.userDataPath, path.join('/profiles', 'focuspix-dev'));
  assert.equal(result.stateRepository, stateRepository);
  assert.equal(result.credentialStore, credentialStore);
  assert.equal(result.factStore, factStore);
  assert.equal(result.appHost, harness.appHost);
  assert.equal(Object.isFrozen(result), true);
  const pendingRequest = result.requestScope.begin();
  result.closeStorage();
  assert.equal(pendingRequest.signal.aborted, true);
  assert.throws(() => result.requestScope.begin(), /provider-request-aborted/);
});

test('a losing secondary instance quits before constructing either storage adapter', () => {
  const harness = createAppHostHarness({ lock: false });
  let storageCalls = 0;
  const result = createApplication({
    argv: ['electron', '.'],
    schemaVersion: 8,
    openCollaborationStorage: () => ({ status: 'unavailable', close() {} }),
    normalizePersistedState: value => value,
    appHost: harness.appHost,
    makeDirectory: () => { throw new Error('production must not create a profile directory'); },
    createStateRepository: () => { storageCalls += 1; },
    createCredentialStore: () => { storageCalls += 1; }
  });

  assert.deepEqual(harness.calls, [['acquire-lock'], ['quit']]);
  assert.equal(storageCalls, 0);
  assert.deepEqual(result, { status: 'secondary-instance', profile: 'production' });
  assert.equal(Object.isFrozen(result), true);
});

test('composition inputs fail before profile, lock or storage side effects', () => {
  const harness = createAppHostHarness();
  const base = {
    argv: [],
    schemaVersion: 8,
    openCollaborationStorage: () => ({ status: 'unavailable', close() {} }),
    normalizePersistedState: value => value,
    appHost: harness.appHost,
    makeDirectory: () => {},
    createStateRepository: () => ({}),
    createCredentialStore: () => ({}),
    openFactStore: () => ({ tier: 'test', close() {} })
  };

  assert.throws(() => createApplication({ ...base, argv: 'electron' }), /argv/);
  assert.throws(() => createApplication({ ...base, schemaVersion: 0 }), /schemaVersion/);
  assert.throws(() => createApplication({ ...base, normalizePersistedState: null }), /normalizer/);
  assert.throws(() => createApplication({ ...base, appHost: {} }), /complete app host/);
  assert.throws(() => createApplication({ ...base, createStateRepository: null }), /ports/);
  assert.deepEqual(harness.calls, []);
});

test('the runtime consumes the profile selected by the composition root', () => {
  assert.match(mainSource, /tooltip: application\.profile === 'development'/);
  assert.doesNotMatch(mainSource, /\bisDevRun\b/);
});
