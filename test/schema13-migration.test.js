'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
function createElectronStoreAdapter(options) { return productionAdapter(options); }
const { routineEditing } = require('../src/capabilities/routines');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const NOW = 1790827200000;
test('schema 12 upgrades with a byte-identical backup; custom types round trip, old inventory survives and corrupt current data fails closed', () => {
  fs.mkdirSync(path.resolve('dist'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('dist/schema13-'));
  const file = path.join(directory, 'config.json');
  const old = normalizePersistedState({ pet: { foodInventory: { fish: 3, cake: 1 } } }, { now: NOW });
  old.schemaVersion = 12;
  const original = JSON.stringify(old, null, 2);
  fs.writeFileSync(file, original);
  class Store {
    get store() { return JSON.parse(fs.readFileSync(file,'utf8')); }
    set store(value) { fs.writeFileSync(file, JSON.stringify(value)); }
    get(key) { return this.store[key]; }
  }
  const open = () => createElectronStoreAdapter({ userDataPath: directory, Store, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW });
  const first = open();
  assert.equal(fs.readFileSync(first.migration.backupPath,'utf8'), original);
  assert.deepEqual(first.snapshot(), { ...old, schemaVersion: PERSISTED_SCHEMA_VERSION });
  const draft = first.snapshot();
  const result = routineEditing.addRoutine(draft, { title: '浇花', kind: 'custom', customLabel: '植物', schedule: { frequency: 'weekly', weekdays: [2,6], timesOfDay: ['09:05','21:00'] }, profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'plants', now: NOW });
  assert.equal(result.ok, true);
  first.commit(draft, { now: NOW });
  const saved = fs.readFileSync(file,'utf8');
  assert.equal(open().snapshot().routines[0].customLabel, '植物');
  assert.equal(fs.readFileSync(file,'utf8'), saved);
  assert.equal(open().snapshot().routines[0].effect, null);
  const corrupt = JSON.parse(saved); corrupt.routines[0].customLabel = { invalid: true };
  fs.writeFileSync(file, JSON.stringify(corrupt));
  const rejectedDirectory = fs.mkdtempSync(path.join(directory, 'unadopted-'));
  fs.writeFileSync(path.join(rejectedDirectory, 'config.json'), JSON.stringify(corrupt));
  assert.throws(() => createElectronStoreAdapter({ userDataPath: rejectedDirectory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW }), /failed validation|normalization/i);
  const conflicted = open();
  assert.equal(conflicted.snapshot().routines[0].customLabel, '植物');
  assert.equal(conflicted.mirror.status().reason, 'config-mirror-conflict');
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')), corrupt);
  assert.equal(fs.readFileSync(first.migration.backupPath,'utf8'), original);
});
