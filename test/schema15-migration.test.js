'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
function createElectronStoreAdapter(options) { return productionAdapter(options); }
const NOW = 1790827200000;

function schema14File(directory) {
  const old = normalizePersistedState({ settings: { petActivityMode: 'quiet' } }, { now: NOW });
  old.schemaVersion = 14;
  delete old.settings.activityMirrorEnabled;
  const file = path.join(directory, 'config.json');
  const original = JSON.stringify(old, null, 2);
  fs.writeFileSync(file, original);
  return { file, original };
}

test('schema 14 upgrades byte-for-byte backed up, with the activity mirror off, and reopens as a fixed point', () => {
  assert.equal(PERSISTED_SCHEMA_VERSION, 18);
  fs.mkdirSync(path.resolve('dist'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('dist/schema15-'));
  const { file, original } = schema14File(directory);
  class Store {
    get store() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    set store(value) { fs.writeFileSync(file, JSON.stringify(value)); }
    get(key) { return this.store[key]; }
  }
  const open = () => createElectronStoreAdapter({ userDataPath: directory, Store, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW });
  const first = open();
  assert.equal(fs.readFileSync(first.migration.backupPath, 'utf8'), original);
  const settings = first.snapshot().settings;
  assert.equal(settings.activityMirrorEnabled, false, 'reading the desktop is never switched on by an upgrade');
  assert.equal(settings.petActivityMode, 'quiet', 'existing settings are untouched');
  const bytes = fs.readFileSync(file, 'utf8');
  open();
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'second startup is a byte fixed point');
  const damaged = { ...JSON.parse(bytes), settings: { ...JSON.parse(bytes).settings, activityMirrorEnabled: 'yes' } };
  const damagedBytes = JSON.stringify(damaged);
  fs.writeFileSync(file, damagedBytes);
  const rejectedDirectory = fs.mkdtempSync(path.join(directory, 'unadopted-'));
  fs.writeFileSync(path.join(rejectedDirectory, 'config.json'), JSON.stringify(damaged));
  assert.throws(() => createElectronStoreAdapter({ userDataPath: rejectedDirectory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW }), /failed validation/i);
  const conflicted = open();
  assert.equal(conflicted.snapshot().settings.activityMirrorEnabled, false);
  assert.equal(conflicted.mirror.status().reason, 'config-mirror-conflict');
  assert.equal(fs.readFileSync(file, 'utf8'), damagedBytes, 'a corrupt current-schema file is never overwritten');
});

test('schema 15 refuses a conflicting upgrade backup before touching the source', () => {
  const directory = fs.mkdtempSync(path.resolve('dist/schema15-failure-'));
  const { file, original } = schema14File(directory);
  fs.writeFileSync(`${file}.schema-14-to-15.backup`, 'wrong bytes');
  let constructed = false;
  assert.throws(() => createElectronStoreAdapter({ userDataPath: directory, schemaVersion: 15, normalize: normalizePersistedState,
    Store: class { constructor() { constructed = true; } } }), /backup/i);
  assert.equal(constructed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
