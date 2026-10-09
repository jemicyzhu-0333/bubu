'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const directories = [], repositories = [];
test.after(() => { repositories.forEach(repository => repository.close()); directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); });
function fixture(value = { schemaVersion: 8, count: 0 }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'config-adapter-')); directories.push(directory);
  const filePath = path.join(directory, 'config.json'); fs.writeFileSync(filePath, JSON.stringify(value));
  return { directory, filePath };
}
const normalize = value => { if (!Number.isInteger(value.count) || value.count < 0) throw new Error('invalid count'); return { schemaVersion: 8, count: value.count }; };
function open(f, options = {}) { const value = createElectronStoreAdapter({ userDataPath: f.directory, schemaVersion: 8, normalize, ...options }); repositories.push(value); return value; }
test('invalid construction inputs fail before touching authority or storage', () => {
  let touched = false; const authorityFactory = () => { touched = true; };
  assert.throws(() => createElectronStoreAdapter({ userDataPath: '', schemaVersion: 8, normalize, authorityFactory }), /userDataPath/);
  assert.throws(() => createElectronStoreAdapter({ userDataPath: '/data', schemaVersion: 0, normalize, authorityFactory }), /schemaVersion/);
  assert.throws(() => createElectronStoreAdapter({ userDataPath: '/data', schemaVersion: 8, normalize: null, authorityFactory }), /normalize/);
  assert.equal(touched, false);
});
test('the adapter validates every canonical SQL commit, persists revision and exposes no write escape hatch', () => {
  const f = fixture(), repository = open(f);
  assert.equal(Object.hasOwn(repository, 'store'), false); assert.equal(repository.get('count'), 0);
  assert.equal(repository.commit({ schemaVersion: 8, count: 1 }).count, 1);
  assert.equal(repository.update(state => { state.count++; }).count, 2); assert.equal(repository.revision(), 2);
  assert.throws(() => repository.commit({ schemaVersion: 8, count: -1 }), /invalid count/);
  assert.equal(repository.revision(), 2); repository.close(); assert.equal(open(f).revision(), 2);
});
test('legacy exact bytes are backed up before adoption without constructing Conf', () => {
  const f = fixture({ schemaVersion: 7, count: 3 }), original = fs.readFileSync(f.filePath); let constructed = false;
  const repository = open(f, { Store: class { constructor() { constructed = true; throw new Error('obsolete driver'); } } });
  assert.equal(constructed, false); assert.deepEqual(repository.snapshot(), { schemaVersion: 8, count: 3 });
  assert.equal(repository.migration.sourceVersion, 7); assert.deepEqual(fs.readFileSync(repository.migration.backupPath), original);
  const sql = new DatabaseSync(path.join(f.directory, 'config.sqlite'));
  assert.deepEqual(Buffer.from(sql.prepare("SELECT source_bytes FROM config_evidence WHERE kind='import'").get().source_bytes), original); sql.close();
});
test('approved current-schema correction needs its exact compatibility backup before SQL adoption', () => {
  const f = fixture({ schemaVersion: 8, count: '3' }), original = fs.readFileSync(f.filePath), calls = [];
  const repository = open(f, { normalize: value => ({ schemaVersion: 8, count: Number(value.count) }), migration: {
    detectCurrentSchemaMigration() { calls.push('detect'); return 'known-correction'; },
    prepareCurrentSchemaMigrationBackup(filePath) { calls.push('backup'); fs.copyFileSync(filePath, filePath + '.verified'); }
  } });
  assert.deepEqual(calls, ['detect', 'backup']); assert.deepEqual(fs.readFileSync(f.filePath + '.verified'), original);
  assert.equal(repository.migration.currentSchemaMigrationKind, 'known-correction'); assert.equal(repository.get('count'), 3);
});
test('unknown current-schema drift fails closed before creating an authority or changing original bytes', () => {
  const f = fixture({ schemaVersion: 8, count: '3' }), original = fs.readFileSync(f.filePath);
  assert.throws(() => open(f, { normalize: value => ({ schemaVersion: 8, count: Number(value.count) }) }), /refusing to rewrite/);
  assert.deepEqual(fs.readFileSync(f.filePath), original); assert.equal(fs.existsSync(path.join(f.directory, 'config.sqlite')), false);
});
