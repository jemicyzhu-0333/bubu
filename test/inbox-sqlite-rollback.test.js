'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { load, NOW, fixtureState, destination, normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../test-support/inbox-regression-fixture');
const { createSqliteStateAdapter } = load('src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = load('src/platform/persistence/sqlite/config-authority-database');
function authorityWithFault(onEvent) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open(filePath, settings = {}) {
      return { db: new DatabaseSync(filePath, settings), filePath };
    } }),
    makeHandle: ({ db, filePath }) => ({
      exec(sql) { onEvent({ sql, filePath, phase: 'before' }); const result = db.exec(sql); onEvent({ sql, filePath, phase: 'after' }); return result; },
      run(sql, params = []) { onEvent({ sql, filePath, phase: 'before' }); const result = db.prepare(sql).run(...params); onEvent({ sql, filePath, phase: 'after' }); return result; },
      get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
    })
  });
}
function sqlRow(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try { return { ...db.prepare('SELECT revision, payload_json, payload_hash FROM config_snapshot').get() }; }
  finally { db.close(); }
}
for (const action of ['promote', 'feeling']) {
  test(`real config SQLite COMMIT failure rolls back ${action} label, destination, source signal and publication`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-rollback-config-'));
    let repo, reopened, armed = false, failed = 0;
    t.after(() => { repo?.close(); reopened?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const database = path.join(directory, 'config.sqlite');
    const options = { userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState,
      now: () => NOW, driver: 'node:sqlite' };
    repo = createSqliteStateAdapter({ ...options, authorityFactory: authorityWithFault(event => {
      if (armed && event.filePath === database && event.sql === 'COMMIT' && event.phase === 'before') {
        armed = false; failed++; throw new Error('Synthetic inbox COMMIT failure');
      }
    }) });
    repo.commit(fixtureState(), { now: NOW });
    const before = repo.snapshot(), revision = repo.revision(), row = sqlRow(database), published = [];
    const execute = destination(repo, action, { publish: fact => published.push(fact) });
    armed = true;
    assert.throws(execute, /Synthetic inbox COMMIT failure/);
    assert.equal(failed, 1, 'failure must reach the actual SQLite COMMIT');
    assert.equal(repo.revision(), revision);
    assert.deepEqual(repo.snapshot(), before);
    assert.deepEqual(sqlRow(database), row, 'SQL business row and hash remain byte-identical');
    assert.deepEqual(published, [], 'failed business transaction publishes no effects');
    assert.equal(fs.existsSync(path.join(directory, 'config.json')), false);
    repo.close(); repo = null;
    reopened = createSqliteStateAdapter(options);
    assert.equal(reopened.revision(), revision);
    assert.deepEqual(reopened.snapshot(), before, 'reopen sees no partial label, target or signal withdrawal');
    const retryPublications = [];
    const retry = destination(reopened, action, { publish: fact => retryPublications.push(fact) });
    const result = retry();
    assert.equal(result.ok, true);
    assert.equal(reopened.revision(), revision + 1);
    const saved = reopened.snapshot(), source = saved.impulses.find(item => item.id === 'capture');
    assert.deepEqual(source.classification, { category: action === 'feeling' ? 'feeling' : 'task', routineKind: null, level: null });
    assert.equal(saved.energySignals.some(item => item.referenceId === 'capture'), false);
    assert.equal((action === 'feeling' ? saved.moodNotes : saved.tasks).length, 1);
    assert.equal(retryPublications.length, 1);
    assert.deepEqual(retry(), { ok: false, reason: 'impulse-not-found' });
    assert.equal(reopened.revision(), revision + 1);
    assert.deepEqual(reopened.snapshot(), saved);
  });
}
for (const action of ['promote', 'feeling']) {
  test(`real config adapter rejects ${action} completed candidate schema before committing any business state`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-rollback-schema-'));
    let repo, reopened, armed = false, rejected = 0;
    t.after(() => { repo?.close(); reopened?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const options = { userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION,
      normalize: normalizePersistedState, now: () => NOW, driver: 'node:sqlite' };
    repo = createSqliteStateAdapter({ ...options, normalize(candidate, context) {
      if (armed && candidate.impulses?.some(item => item.id === 'capture' && item.resolution)) {
        rejected++; throw new Error('Synthetic completed candidate schema rejection');
      }
      return normalizePersistedState(candidate, context);
    } });
    repo.commit(fixtureState(), { now: NOW });
    const before = repo.snapshot(), revision = repo.revision();
    const database = path.join(directory, 'config.sqlite'), row = sqlRow(database), effects = [];
    armed = true;
    assert.throws(destination(repo, action, { publish: fact => effects.push(fact) }), /Synthetic completed candidate schema rejection/);
    assert.equal(rejected, 1, 'validation fault is injected only after the complete business draft exists');
    assert.equal(repo.revision(), revision); assert.deepEqual(repo.snapshot(), before);
    assert.deepEqual(sqlRow(database), row); assert.deepEqual(effects, []);
    repo.close(); repo = null;
    reopened = createSqliteStateAdapter(options);
    assert.equal(reopened.revision(), revision); assert.deepEqual(reopened.snapshot(), before);
    assert.equal(fs.existsSync(path.join(directory, 'config.json')), false);
  });
}
