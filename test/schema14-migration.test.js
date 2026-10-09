'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
function createElectronStoreAdapter(options) { return productionAdapter(options); }
const { inboxRecords } = require('../src/capabilities/work');
const NOW = 1790827200000;

test('schema 13 preserves original bytes and AI labels; resolved history survives reopening; corrupt metadata fails closed', () => {
  fs.mkdirSync(path.resolve('dist'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('dist/schema14-'));
  const file = path.join(directory, 'config.json');
  const old = normalizePersistedState({ impulses: [{ id: 'i1', text: '想记住的事情', createdAt: NOW,
    triage: { category: 'note', confidence: 90, title: null, routineKind: null, level: null, reason: '想法', at: NOW } }] }, { now: NOW });
  old.schemaVersion = 13;
  delete old.impulses[0].classification; delete old.impulses[0].resolution;
  const original = JSON.stringify(old, null, 2);
  fs.writeFileSync(file, original);
  class Store {
    get store() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    set store(value) { fs.writeFileSync(file, JSON.stringify(value)); }
    get(key) { return this.store[key]; }
  }
  const open = () => createElectronStoreAdapter({ userDataPath: directory, Store, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW });
  const first = open();
  assert.equal(fs.readFileSync(first.migration.backupPath, 'utf8'), original);
  assert.deepEqual(first.snapshot().impulses[0].triage, old.impulses[0].triage);
  const draft = first.snapshot();
  inboxRecords.classifyImpulse(draft, { id: 'i1', category: 'note' });
  inboxRecords.resolveRecord(draft, 'i1', { action: 'keep', category: 'note', at: NOW });
  first.commit(draft, { now: NOW });
  const bytes = fs.readFileSync(file, 'utf8');
  assert.equal(open().snapshot().impulses[0].resolution.action, 'keep');
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'second startup is a byte fixed point');
  for (const corrupt of [
    { ...JSON.parse(bytes).impulses[0], classification: { category: 'invented' } },
    { ...JSON.parse(bytes).impulses[0], resolution: { action: 'keep', category: 'note', at: -1 } }
  ]) {
    const damaged = { ...JSON.parse(bytes), impulses: [corrupt] };
    const damagedBytes = JSON.stringify(damaged); fs.writeFileSync(file, damagedBytes);
    const rejectedDirectory = fs.mkdtempSync(path.join(directory, 'unadopted-'));
    fs.writeFileSync(path.join(rejectedDirectory, 'config.json'), JSON.stringify(damaged));
    assert.throws(() => createElectronStoreAdapter({ userDataPath: rejectedDirectory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW }), /failed validation/i);
    const conflicted = open();
    assert.equal(conflicted.snapshot().impulses[0].resolution.action, 'keep');
    assert.equal(conflicted.mirror.status().reason, 'config-mirror-conflict');
    assert.equal(fs.readFileSync(file, 'utf8'), damagedBytes);
  }
  assert.equal(fs.readFileSync(first.migration.backupPath, 'utf8'), original);
});

test('schema 14 refuses a conflicting upgrade backup before touching the source', () => {
  const directory = fs.mkdtempSync(path.resolve('dist/schema14-failure-'));
  const file = path.join(directory, 'config.json');
  const original = JSON.stringify({ ...normalizePersistedState({}, { now: NOW }), schemaVersion: 13 });
  fs.writeFileSync(file, original);
  fs.writeFileSync(`${file}.schema-13-to-14.backup`, 'wrong bytes');
  let constructed = false;
  assert.throws(() => createElectronStoreAdapter({ userDataPath: directory, schemaVersion: 14, normalize: normalizePersistedState,
    Store: class { constructor() { constructed = true; } } }), /backup/i);
  assert.equal(constructed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
