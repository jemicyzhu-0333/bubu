'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, assertCanonicalPersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const NOW = Date.parse('2026-10-07T09:00:00Z');
const canonical = () => normalizePersistedState({}, { now: NOW });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical18-only-')), handles = [];
  t.after(() => { handles.forEach(handle => handle.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const open = options => { const repo = createSqliteStateAdapter({ userDataPath: directory, now: () => NOW, ...options }); handles.push(repo); return repo; };
  // Historical adapter is intentionally used only to manufacture synthetic,
  // established SQL payloads; production can never choose this admission path.
  function seed(state, { holdOpen = false } = {}) {
    const repo = createElectronStoreAdapter({ userDataPath: directory, schemaVersion: state.schemaVersion,
      normalize: () => structuredClone(state), now: () => NOW, jsonMirror: false });
    if (holdOpen) handles.push(repo); else repo.close();
  }
  const files = () => Object.fromEntries(fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name))]));
  function sqlFacts(captured = files()) {
    // Diagnostic SQL also creates/changes WAL/SHM. Inspect an exact tuple copy,
    // never warm the original before or after its byte-preservation assertion.
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical18-facts-'));
    for (const [name, bytes] of Object.entries(captured)) fs.writeFileSync(path.join(probe, name), bytes);
    const db = new DatabaseSync(path.join(probe, 'config.sqlite'), { readOnly: true });
    try { return { snapshot: { ...db.prepare('SELECT * FROM config_snapshot').get() },
      evidence: db.prepare('SELECT * FROM config_evidence ORDER BY backup_id').all(),
      version: db.prepare('PRAGMA user_version').get().user_version,
      mode: db.prepare('PRAGMA journal_mode').get().journal_mode }; }
    finally { db.close(); fs.rmSync(probe, { recursive: true, force: true }); }
  }
  return { directory, open, seed, files, sqlFacts };
}
function historical17() {
  const state = canonical(); state.schemaVersion = 17; delete state.settings.aiPetMealsEnabled;
  state.pet = { satiation: 60, lastSatiationTick: null, foodInventory: { ...state.pet.foodInventory },
    dailyFeedXp: 0, dailyFeedXpDate: null, totalFeeds: 0, lastFoodRegenDate: null,
    satiationDecayRemainder: 0, coffeeBonusUntil: null };
  state.companion = { relationship: state.companion.relationships.dango,
    surprise: state.companion.surprise, collection: state.companion.collection, appearance: state.companion.appearance };
  return state;
}
function tracedFactory(events) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open(filePath, settings = {}) {
      events.push({ kind: 'open', readOnly: settings.readOnly === true });
      return { db: new DatabaseSync(filePath, settings) };
    } }),
    makeHandle: ({ db }) => ({
      exec(sql) { events.push({ kind: 'exec', sql }); return db.exec(sql); },
      run(sql, params = []) { events.push({ kind: 'run', sql }); return db.prepare(sql).run(...params); },
      get: (sql, params = []) => db.prepare(sql).get(...params),
      all: (sql, params = []) => db.prepare(sql).all(...params),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
    })
  });
}
function assertRefusedUntouched(f, options = {}) {
  const before = f.files(), beforeFacts = f.sqlFacts(before), events = [];
  let calls = 0, backups = 0;
  assert.throws(() => f.open({ normalize: () => { calls++; return canonical(); },
    migration: { detectCurrentSchemaMigration() { backups++; return 'additive-food-roster'; },
      prepareCurrentSchemaMigrationBackup() { backups++; } },
    authorityFactory: tracedFactory(events), ...options }));
  assert.equal(calls, 0, 'raw admission must reject before the configured normalizer');
  assert.equal(backups, 0, 'no generic repair detector or backup can run');
  assert.ok(events.every(event => event.kind === 'open' && event.readOnly), 'no write handle, proof or mutation');
  const after = f.files();
  assert.deepEqual(after, before, 'database, identity and any WAL/SHM retained byte-for-byte');
  assert.deepEqual(f.sqlFacts(after), beforeFacts, 'revision, identity binding, hash, evidence and proof counter unchanged');
}

test('production SQL admits fresh canonical18 only and preserves fractional/economic/role fields across reopen', t => {
  assert.equal(PERSISTED_SCHEMA_VERSION, 18);
  const f = fixture(t), repo = f.open();
  const fresh = repo.snapshot();
  assert.equal(fresh.pet.satiation, 65); assert.equal(fresh.pet.foodTickets, 6); assert.equal(fresh.pet.foodInventory.berry, 2);
  assert.equal(Object.hasOwn(fresh.pet.foodInventory, 'basic'), false); assert.equal(fresh.settings.aiPetMealsEnabled, false);
  assert.deepEqual(fresh.companion.bondClaims, { advance: false, close: false, care: false });
  assert.deepEqual(fresh.companion.relationships.dango, fresh.companion.relationships.usagi);
  const expected = structuredClone(fresh);
  expected.pet.satiation = 44.9; expected.pet.foodTickets = Number.MAX_SAFE_INTEGER;
  expected.pet.foodInventory.fish = 999; expected.pet.totalFeeds = Number.MAX_SAFE_INTEGER;
  expected.settings.autoCheckUpdates = false; expected.companion.relationships.usagi.bondPoints = 40;
  expected.companion.bondDay = '2026-10-07'; expected.companion.bondClaims.advance = true;
  repo.commit(expected, { now: NOW }); const revision = repo.revision(); repo.close();
  const reopened = f.open({ now: () => NOW + 365 * 86400000 });
  assert.deepEqual(reopened.snapshot(), expected); assert.equal(reopened.revision(), revision);
  assert.equal(reopened.migration.backupCreated, false); assert.equal(f.sqlFacts().version, 1);
  assert.equal(f.sqlFacts().mode, 'wal'); assert.equal(fs.existsSync(path.join(f.directory, 'config.json')), false);
  const facts = f.sqlFacts(); reopened.close();
  f.open().close(); const next = f.sqlFacts();
  assert.deepEqual({ ...next.snapshot, verification_count: facts.snapshot.verification_count }, facts.snapshot);
  assert.equal(next.snapshot.verification_count, facts.snapshot.verification_count + 1);
  assert.deepEqual(next.evidence, facts.evidence);
});

for (const version of [8, 16, 17, 19]) test(`established payload${version} rejects before normalization, backup and proof`, t => {
  const f = fixture(t), state = historical17(); state.schemaVersion = version; f.seed(state); assertRefusedUntouched(f);
});

const malformed = {
  'missing meal opt-in': state => { delete state.settings.aiPetMealsEnabled; },
  'missing updater opt-in': state => { delete state.settings.autoCheckUpdates; },
  'missing food key (old additive repair)': state => { delete state.pet.foodInventory.berry; },
  'missing wallet': state => { delete state.pet.foodTickets; },
  'unknown top-level key': state => { state.unowned = true; },
  'unknown retired pet key': state => { state.pet.coffeeBonusUntil = null; },
  'unknown inventory key': state => { state.pet.foodInventory.unlisted = 2; },
  'unknown care key': state => { state.pet.care.hidden = true; },
  'missing care key': state => { delete state.pet.care.nextMealAt; },
  'care observation outside Date range': state => { state.pet.care.lastObservedAt = 8.64e15 + 1; },
  'care last meal outside Date range': state => { state.pet.care.lastMealAt = 8.64e15 + 1; },
  'care next meal outside Date range': state => { state.pet.care.nextMealAt = 8.64e15 + 1; },
  'decision expiry outside Date range': state => { state.pet.care.decision = { id: '0:1', expiresAt: 8.64e15 + 1, slot: null }; },
  'plan expiry outside Date range': state => { state.pet.care.plan = { foodId: 'berry', reactionIndex: 0, expiresAt: 8.64e15 + 1, slot: null }; },
  'unsafe wallet': state => { state.pet.foodTickets = Number.MAX_SAFE_INTEGER + 1; },
  'fractional wallet': state => { state.pet.foodTickets = 6.5; },
  'overflow inventory': state => { state.pet.foodInventory.fish = 1000; },
  'unsafe feed counter': state => { state.pet.totalFeeds = Number.MAX_SAFE_INTEGER + 1; },
  'legacy singular relationship': state => { state.companion.relationship = state.companion.relationships.dango; delete state.companion.relationships; },
  'missing role': state => { delete state.companion.relationships.usagi; },
  'nonboolean bond claim': state => { state.companion.bondClaims.advance = 1; },
  'basic taste': state => { state.companion.relationships.dango.foodAffinity.basic = 1; },
  'old AI settings repair': state => { state.settings.aiProvider = 'api'; },
  'noncanonical satiation': state => { state.pet.satiation = '44.9'; },
  'unknown receipt result': state => { state.pet.foodCommands = [{ commandId: `${NOW}-x`, issuedAt: NOW,
    kind: 'buy', foodId: 'berry', result: { ok: true, foodId: 'berry', price: 1, foodTickets: 5, inventory: 3, extra: true } }]; }
};
for (const [label, mutate] of Object.entries(malformed)) test(`malformed18 ${label} remains untouched`, t => {
  const f = fixture(t), state = canonical(); mutate(state); f.seed(state); assertRefusedUntouched(f);
});

test('caller options cannot turn production into historical/mirror admission', t => {
  const f = fixture(t); f.seed(historical17());
  assertRefusedUntouched(f, { schemaVersion: 17, jsonMirror: true, currentOnly: false, assertCanonical() {} });
});

test('canonical raw validator and failed production writes never sanitize malformed18', t => {
  const f = fixture(t), repo = f.open(), before = repo.snapshot(), revision = repo.revision();
  for (const mutate of Object.values(malformed)) {
    const value = structuredClone(before); mutate(value); const unchanged = structuredClone(value);
    assert.throws(() => assertCanonicalPersistedState(value)); assert.deepEqual(value, unchanged);
    assert.throws(() => repo.commit(value, { now: NOW }));
    assert.deepEqual(repo.snapshot(), before); assert.equal(repo.revision(), revision);
  }
});

test('closed food receipts, fractional satiety and valid pending/free landing identity round-trip', t => {
  const f = fixture(t), repo = f.open();
  for (const taskId of ['already-completed-task', 'missing-linked-task', null]) {
    repo.update(state => {
      state.focusLandingPrompt = { sessionId: `focus-${taskId || 'free'}`, taskId, completedAt: NOW, status: 'pending' };
      state.pet.satiation = 45.5;
      state.pet.foodCommands = [{ commandId: `${NOW}-buy`, issuedAt: NOW, kind: 'buy', foodId: 'berry',
        result: { ok: true, foodId: 'berry', price: 1, foodTickets: 5, inventory: 3 } }];
    }, { now: NOW });
    const saved = repo.snapshot(); const again = f.open(); assert.deepEqual(again.snapshot(), saved); again.close();
    assert.equal(saved.focusLandingPrompt.taskId, taskId);
  }
});


for (const malformedCurrent of [false, true]) test(`refusal retains live WAL and SHM for ${malformedCurrent ? 'malformed18' : 'legacy17'}`, t => {
  const f = fixture(t), state = malformedCurrent ? canonical() : historical17();
  if (malformedCurrent) delete state.settings.aiPetMealsEnabled;
  f.seed(state, { holdOpen: true });
  const names = Object.keys(f.files());
  for (const name of ['config.sqlite-wal', 'config.sqlite-shm', 'config.sqlite.identity.sqlite-wal', 'config.sqlite.identity.sqlite-shm']) {
    assert.ok(names.includes(name), `${name} must exist so this exercises live sidecars`);
  }
  assertRefusedUntouched(f);
});
