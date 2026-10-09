'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
// Exercise the production SQL authority; legacy Store fixtures must never be constructed.
const { trackStateAdapters } = require('../test-support/tracked-state-adapters');
const adapters = trackStateAdapters(productionAdapter);
function createElectronStoreAdapter(options) { return adapters.open(options); }
const { prepareStoreMigration } = require('../src/core/store-migration');
const { aiChangeLedger: ledger } = require('../src/capabilities/guidance');
const { NOW, appendFixture } = require('../test-support/ai-change-ledger-fixture');

function fixture(t, patch = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-schema16-'));
  t.after(() => { adapters.closeDirectory(directory); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'config.json');
  const canonical = normalizePersistedState({ tasks: [{ id: 'task-1', title: 'Existing task', createdAt: NOW }],
    impulses: [{ id: 'capture-1', text: 'Existing inbox capture', createdAt: NOW }], xp: 42,
    settings: { activityMirrorEnabled: false, aiBreakdownEnabled: false } }, { now: NOW });
  const old = { ...canonical, schemaVersion: 15, ...patch };
  delete old.aiCollaboration;
  const original = Buffer.from(`${JSON.stringify(old, null, 2)}\n`);
  fs.writeFileSync(file, original);
  let writes = 0, constructions = 0;
  class Store {
    constructor() { constructions += 1; }
    get store() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    set store(value) { writes += 1; fs.writeFileSync(file, JSON.stringify(value)); }
    get(key) { return this.store[key]; }
  }
  const open = (overrides = {}) => createElectronStoreAdapter({ userDataPath: directory,
    Store, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW, ...overrides });
  return { file, directory, canonical, old, original, open, writes: () => writes, constructions: () => constructions };
}

test('schema 15 upgrades to current schema with an empty guidance ledger', t => {
  assert.equal(PERSISTED_SCHEMA_VERSION, 19);
  const f = fixture(t);
  const opened = f.open();
  assert.equal(opened.migration.sourceVersion, 15);
  assert.equal(opened.migration.backupPath, `${f.file}.schema-15-to-${PERSISTED_SCHEMA_VERSION}.backup`);
  assert.deepEqual(fs.readFileSync(opened.migration.backupPath), f.original);
  assert.deepEqual(opened.snapshot(), f.canonical);
  assert.deepEqual(opened.snapshot().aiCollaboration, ledger.createLedger());
  assert.equal(opened.snapshot().settings.aiBreakdownEnabled, false);
  assert.equal(f.writes(), 0, 'obsolete Conf writer is never used');
  const bytes = fs.readFileSync(f.file);
  f.open({ now: () => NOW + 365 * 86400000 });
  assert.equal(f.writes(), 0, 'obsolete Conf writer is never used');
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});

test('current receipts and pending events are strict fixed points even after all TTLs elapse', t => {
  const f = fixture(t);
  f.canonical.aiCollaboration = appendFixture().ledger;
  fs.writeFileSync(f.file, JSON.stringify(f.canonical));
  const bytes = fs.readFileSync(f.file);
  const reopened = f.open({ now: () => NOW + 1000 * 86400000 });
  assert.deepEqual(reopened.snapshot().aiCollaboration, f.canonical.aiCollaboration);
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(f.writes(), 0, 'startup cannot expire authoritative receipts, undo details or undelivered events');
  assert.deepEqual(normalizePersistedState(f.canonical, { now: NOW + 1000 * 86400000 }), f.canonical);
});

test('missing, malformed, future and over-capacity ledger fields never cause current-schema repair', t => {
  const f = fixture(t);
  const mutations = [
    value => { delete value.aiCollaboration; }, value => { value.aiCollaboration = null; },
    value => { value.aiCollaboration.version = 2; }, value => { delete value.aiCollaboration.nextCommitSequence; },
    value => { value.aiCollaboration.nextCommitSequence = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.aiCollaboration.receipts = [null]; }, value => { value.aiCollaboration.outbox = [{}]; },
    value => { value.aiCollaboration.body = 'hidden'; },
    value => { value.aiCollaboration.receipts = Array(ledger.MAX_RECEIPTS + 1).fill({}); }
  ];
  for (const mutate of mutations) {
    const damaged = structuredClone(f.canonical); mutate(damaged);
    const bytes = JSON.stringify(damaged); fs.writeFileSync(f.file, bytes);
    assert.throws(() => f.open(), /failed validation/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  }
  assert.equal(f.constructions(), 0);
  assert.equal(f.writes(), 0);
});

test('backup mismatch or write failure stops migration before constructing a store or overwriting source', t => {
  const f = fixture(t);
  fs.writeFileSync(`${f.file}.schema-15-to-${PERSISTED_SCHEMA_VERSION}.backup`, 'wrong backup');
  assert.throws(() => f.open(), /backup/i);
  assert.equal(f.constructions(), 0);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
  fs.rmSync(`${f.file}.schema-15-to-${PERSISTED_SCHEMA_VERSION}.backup`);
  assert.throws(() => f.open({ migration: { prepareStoreMigration() { throw new Error('backup write failed'); } } }), /backup write failed/);
  assert.equal(f.constructions(), 0);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
});

test('failed canonical write leaves the verified migration backup available for rollback', t => {
  const f = fixture(t);
  class FailedStore {
    get store() { return JSON.parse(fs.readFileSync(f.file, 'utf8')); }
    set store(_) { throw new Error('disk write failure'); }
  }
  assert.throws(() => f.open({ authorityFactory(options) { options.prepareInitial(); throw new Error('disk write failure'); } }), /disk write failure/);
  assert.deepEqual(fs.readFileSync(`${f.file}.schema-15-to-${PERSISTED_SCHEMA_VERSION}.backup`), f.original);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
});

test('future schema and old-writer rollback both refuse to rewrite newer canonical state', t => {
  const f = fixture(t);
  const future = { ...f.canonical, schemaVersion: PERSISTED_SCHEMA_VERSION + 1 };
  const bytes = JSON.stringify(future); fs.writeFileSync(f.file, bytes);
  assert.throws(() => f.open(), /newer|future/i);
  assert.throws(() => normalizePersistedState(future, { now: NOW }), /future/i);
  assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  fs.writeFileSync(f.file, f.original);
  f.open();
  const upgraded = fs.readFileSync(f.file);
  assert.throws(() => prepareStoreMigration(f.file, 15), /newer/i);
  assert.deepEqual(fs.readFileSync(f.file), upgraded);
});

test('unexpected old-schema receipt data is validated and preserved, never silently dropped', () => {
  const old = normalizePersistedState({}, { now: NOW });
  old.schemaVersion = 15;
  old.aiCollaboration = appendFixture().ledger;
  assert.deepEqual(normalizePersistedState(old, { now: NOW }).aiCollaboration, old.aiCollaboration);
  old.aiCollaboration.receipts[0].details.transcript = 'private data';
  assert.throws(() => normalizePersistedState(old, { now: NOW }), /failed validation/);
});
