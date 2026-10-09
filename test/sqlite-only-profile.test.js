'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const NOW = Date.parse('2026-10-07T01:00:00Z');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-only-profile-')), handles = [];
  t.after(() => { handles.forEach(handle => handle.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const options = { userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: value => normalizePersistedState(value, { now: NOW }), now: () => NOW };
  const open = extra => { const handle = createSqliteStateAdapter({ ...options, ...extra }); handles.push(handle); return handle; };
  return { directory, options, open, json: path.join(directory, 'config.json'), database: path.join(directory, 'config.sqlite') };
}
test('fresh profile and subsequent writes create only SQL authority, never a JSON mirror', t => {
  const f = fixture(t), repo = f.open({ mirrorWriterFactory: () => assert.fail('JSON writer must not be constructed') });
  assert.equal(fs.existsSync(f.json), false);
  const state = repo.snapshot(); state.settings.dnd = true; repo.commit(state, { now: NOW });
  assert.equal(fs.existsSync(f.json), false); assert.equal(repo.authoritativeWrites.status().mirrorPending, false);
  assert.equal(repo.authoritativeWrites.verify().ok, true); repo.close();
  assert.equal(f.open().get('settings').dnd, true); assert.equal(fs.existsSync(f.json), false);
});
test('existing SQL state wins and unrelated old JSON bytes are neither read nor overwritten', t => {
  const f = fixture(t), original = createElectronStoreAdapter(f.options); original.close();
  const bytes = 'not a JSON profile anymore'; fs.writeFileSync(f.json, bytes);
  const repo = f.open(); const state = repo.snapshot(); state.settings.dnd = true; repo.commit(state, { now: NOW }); repo.close();
  assert.equal(fs.readFileSync(f.json, 'utf8'), bytes); assert.equal(f.open().get('settings').dnd, true);
});
test('JSON-only profiles fail closed and retain their original bytes', t => {
  const f = fixture(t), bytes = JSON.stringify(normalizePersistedState({}, { now: NOW })); fs.writeFileSync(f.json, bytes);
  assert.throws(() => f.open(), /legacy-json-profile-requires-explicit-import/);
  assert.equal(fs.readFileSync(f.json, 'utf8'), bytes);
});
test('lost or corrupt SQL authority never falls back to JSON', t => {
  for (const corrupt of [false, true]) {
    const f = fixture(t); f.open().close();
    fs.writeFileSync(f.json, JSON.stringify(normalizePersistedState({}, { now: NOW })));
    if (corrupt) fs.writeFileSync(f.database, 'corrupt database'); else fs.renameSync(f.database, f.database + '.preserved');
    assert.throws(() => f.open());
    if (!corrupt) assert.equal(fs.existsSync(f.database), false, 'must not create a replacement authority');
  }
});
test('SQL-only factory cannot be switched back to mirror mode by caller options', t => {
  const f = fixture(t); f.open({ jsonMirror: true }); assert.equal(fs.existsSync(f.json), false);
});
