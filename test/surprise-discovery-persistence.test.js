'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUnitOfWork } = require('../src/application');
const { persistSurpriseState } = require('../src/capabilities/companion');
const { SurpriseDirector } = require('../src/core/surprise-director');
const { DatabaseSync } = require('node:sqlite');
const { LIMITS } = require('../src/core/companion-state');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { localDayKey } = require('../src/core/calendar');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');

const START = Date.parse('2026-10-07T12:00:00Z');
const DISCOVERY = 'discovery.persistence';
const CONTEXT = { visible: true, activityMode: 'balanced' };
const MANIFEST = { version: 1, packId: 'builtin-core', assets: [], cues: [{
  id: 'egg.persistence', familyId: 'ambient.persistence', kind: 'ambient', weight: 1, priority: 10, cost: 1,
  globalCooldownMs: 0, familyCooldownMs: 0, cooldownMs: 0, focusAllowed: true, discoveryId: DISCOVERY,
  variants: [
    { id: 'default', animationId: 'workout', message: 'hi', durationMs: 1000, assetIds: [], static: false },
    { id: 'static', animationId: 'static-pose', message: 'hi', durationMs: 1000, assetIds: [], static: true }
  ]
}] };

function authorityWithFault(onSql) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
    makeHandle: ({ db, filePath }) => ({
      exec(sql) { onSql(sql, filePath); return db.exec(sql); },
      run: (sql, args = []) => db.prepare(sql).run(...args),
      get: (sql, args = []) => db.prepare(sql).get(...args),
      all: (sql, args = []) => db.prepare(sql).all(...args),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
    })
  });
}

function sqlRow(directory) {
  const db = new DatabaseSync(path.join(directory, 'config.sqlite'), { readOnly: true });
  try { return { ...db.prepare('SELECT revision, payload_json, payload_hash FROM config_snapshot').get() }; }
  finally { db.close(); }
}

function harness(t, { onSql, manifest = MANIFEST } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surprise-discovery-'));
  let now = START, repository, director, sequence = 0, beforeSave = null;
  const deliveries = [], writes = [], timers = new Map();
  const options = { userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => now, driver: 'node:sqlite',
    ...(onSql ? { authorityFactory: authorityWithFault(onSql) } : {}) };
  function open() {
    repository = createSqliteStateAdapter(options);
    const unitOfWork = createUnitOfWork({ repository });
    const command = persistSurpriseState.createPersistSurpriseStateCommand({ unitOfWork: {
      run(request) { writes.push([...request.writes]); return unitOfWork.run(request); }
    } });
    director = new SurpriseDirector({
      manifest, loadState: () => repository.get('companion'),
      saveState: companion => {
        const interleave = beforeSave;
        beforeSave = null;
        interleave?.(repository);
        const result = command.execute({ companion });
        if (!result.ok) throw new Error(`surprise state persistence rejected: ${result.reason}`);
        return result;
      },
      clock: { now: () => now, dayKey: localDayKey }, monotonicClock: { now: () => now - START },
      rng: () => 0, idFactory: () => `decision-persistence-${++sequence}`,
      deliver: envelope => deliveries.push(envelope),
      setTimeout: callback => { const id = Symbol('timer'); timers.set(id, callback); return id; },
      clearTimeout: id => timers.delete(id)
    });
  }
  open();
  t.after(() => {
    director?.dispose(); repository?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    deliveries, writes, directory,
    get repository() { return repository; }, get director() { return director; },
    setNow: value => { now = value; },
    beforeNextSave: callback => { beforeSave = callback; },
    reopen() { director.dispose(); repository.close(); open(); },
    start() {
      const issued = director.tick(CONTEXT);
      assert.equal(issued.issued, true);
      const decisionId = issued.envelope.decisionId;
      for (const status of ['received', 'started']) {
        assert.deepEqual(director.acknowledge({ decisionId, status }), { ok: true, status });
      }
      return decisionId;
    }
  };
}

test('Director completion persists one discovery through the command and SQL reopen', t => {
  const h = harness(t), decisionId = h.start();
  h.setNow(START + 1000);
  assert.deepEqual(h.director.acknowledge({ decisionId, status: 'completed' }), { ok: true, status: 'completed' });
  h.reopen();
  assert.deepEqual(h.repository.get('companion').collection.discoveries, { [DISCOVERY]: START + 1000 });
  assert.equal(fs.existsSync(path.join(h.directory, 'config.json')), false);
  assert.ok(h.writes.length >= 4);
  for (const writes of h.writes) assert.deepEqual(writes, ['companion']);
});


test('completion replay and a later performance preserve the first discovery across reopen', t => {
  const manifest = structuredClone(MANIFEST);
  manifest.cues.push({ ...structuredClone(manifest.cues[0]), id: 'egg.persistence-again' });
  const h = harness(t, { manifest }), first = h.start();
  h.setNow(START + 1000);
  h.director.acknowledge({ decisionId: first, status: 'completed' });
  const saved = h.repository.snapshot(), revision = h.repository.revision();
  assert.deepEqual(h.director.acknowledge({ decisionId: first, status: 'completed' }),
    { ok: true, duplicate: true, status: 'completed' });
  assert.equal(h.repository.revision(), revision);
  h.reopen();
  assert.deepEqual(h.director.acknowledge({ decisionId: first, status: 'completed' }),
    { ok: true, duplicate: true, status: 'completed' });
  assert.equal(h.repository.revision(), revision);
  assert.deepEqual(h.repository.snapshot(), saved);
  h.setNow(START + 6 * 60_000);
  const second = h.start();
  assert.notEqual(second, first);
  h.setNow(START + 6 * 60_000 + 1000);
  assert.equal(h.director.acknowledge({ decisionId: second, status: 'completed' }).status, 'completed');
  h.reopen();
  assert.deepEqual(h.repository.get('companion').collection.discoveries, { [DISCOVERY]: START + 1000 });
  assert.equal(h.repository.get('companion').surprise.recent.length, 2);
});

for (const outcome of ['cancelled', 'rejected', 'out-of-order', 'policy-cancelled', 'restart-cancelled']) {
  test(`${outcome} performance earns no discovery after SQL reopen`, t => {
    const h = harness(t);
    let decisionId;
    if (outcome === 'out-of-order') {
      decisionId = h.director.tick(CONTEXT).envelope.decisionId;
      const before = h.repository.snapshot(), revision = h.repository.revision();
      assert.equal(h.director.acknowledge({ decisionId, status: 'completed' }).reason, 'out-of-order');
      assert.equal(h.repository.revision(), revision);
      assert.deepEqual(h.repository.snapshot(), before);
    } else {
      decisionId = h.start();
      if (outcome === 'policy-cancelled') {
        assert.equal(h.director.updateContext({ ...CONTEXT, dnd: true }).cancelled, true);
      } else if (outcome === 'restart-cancelled') {
        h.reopen();
        assert.equal(h.director.recoverAfterRestart().cleaned, true);
        assert.equal(h.deliveries.length, 1, 'reopen cleanup must not replay the cue');
      } else {
        assert.equal(h.director.acknowledge({ decisionId, status: outcome }).status, outcome);
      }
    }
    h.reopen();
    const state = h.repository.get('companion');
    assert.deepEqual(state.collection.discoveries, {});
    if (outcome !== 'out-of-order') {
      assert.equal(state.surprise.pending, null);
      assert.equal(state.surprise.recent.at(-1).outcome, outcome === 'rejected' ? 'rejected' : 'cancelled');
      const revision = h.repository.revision();
      assert.equal(h.director.acknowledge({ decisionId, status: 'completed' }).duplicate, true);
      assert.equal(h.repository.revision(), revision);
      assert.deepEqual(h.repository.get('companion').collection.discoveries, {});
    }
  });
}

test('completion merges a stale Director snapshot with concurrent relationship and equipment writes', t => {
  const h = harness(t), decisionId = h.start();
  let canonical;
  h.beforeNextSave(repository => {
    repository.update(state => {
      state.companion.relationships.dango.bondPoints = 12;
      state.companion.relationships.dango.counters.interaction = 4;
      state.companion.appearance = { equipped: { hat: null, scarf: 'scarf' }, updatedAt: START + 500 };
      state.companion.collection.discoveries = { 'discovery.other': START + 400 };
      state.companion.collection.activePackIds = ['builtin-core', 'second-pack'];
      state.companion.collection.completedArcIds = ['arc.completed'];
      state.pet.satiation = 40;
    }, { now: START + 500 });
    canonical = repository.snapshot();
  });
  h.setNow(START + 1000);
  assert.equal(h.director.acknowledge({ decisionId, status: 'completed' }).status, 'completed');
  const expected = structuredClone(canonical);
  expected.companion.surprise.pending = null;
  expected.companion.surprise.recent.push({ decisionId, cueId: 'egg.persistence', familyId: 'ambient.persistence',
    finishedAt: START + 1000, outcome: 'completed' });
  expected.companion.collection.discoveries[DISCOVERY] = START + 1000;
  h.reopen();
  assert.deepEqual(h.repository.snapshot(), expected);
});

test('concurrent discovery union overflow rejects completion atomically through SQL reopen', t => {
  const h = harness(t), decisionId = h.start();
  let before, revision, row;
  h.beforeNextSave(repository => {
    repository.update(state => {
      state.companion.collection.discoveries = Object.fromEntries(
        Array.from({ length: LIMITS.discoveries }, (_, index) => [`concurrent-${index}`, START])
      );
    }, { now: START });
    before = repository.snapshot(); revision = repository.revision(); row = sqlRow(h.directory);
  });
  h.setNow(START + 1000);
  assert.throws(() => h.director.acknowledge({ decisionId, status: 'completed' }), /discoveries exceeds capacity 512/);
  assert.equal(h.repository.revision(), revision);
  assert.deepEqual(h.repository.snapshot(), before);
  assert.deepEqual(sqlRow(h.directory), row);
  h.reopen();
  assert.equal(h.repository.revision(), revision);
  assert.deepEqual(h.repository.snapshot(), before);
});

test('real SQL COMMIT failure persists neither discovery nor completion and permits an exact retry', t => {
  let armed = false, failures = 0;
  const h = harness(t, { onSql(sql, filePath) {
    if (armed && path.basename(filePath) === 'config.sqlite' && sql === 'COMMIT') {
      armed = false; failures++;
      throw new Error('Synthetic discovery pre-COMMIT failure');
    }
  } });
  const decisionId = h.start(), before = h.repository.snapshot(), revision = h.repository.revision();
  const row = sqlRow(h.directory);
  h.setNow(START + 1000); armed = true;
  assert.throws(() => h.director.acknowledge({ decisionId, status: 'completed' }), /Synthetic discovery pre-COMMIT failure/);
  assert.equal(failures, 1, 'fault must reach the real SQL COMMIT');
  assert.equal(h.repository.revision(), revision);
  assert.deepEqual(h.repository.snapshot(), before);
  assert.deepEqual(sqlRow(h.directory), row);
  h.reopen();
  assert.equal(h.repository.revision(), revision);
  assert.deepEqual(h.repository.snapshot(), before);
  assert.equal(h.director.acknowledge({ decisionId, status: 'completed' }).status, 'completed');
  assert.equal(h.repository.revision(), revision + 1);
  h.reopen();
  assert.deepEqual(h.repository.get('companion').collection.discoveries, { [DISCOVERY]: START + 1000 });
  assert.equal(h.repository.get('companion').surprise.recent.length, 1);
});
