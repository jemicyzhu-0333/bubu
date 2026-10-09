'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStateDelta, applyStateDelta } = require('../src/core/state-channel.mjs');
const { pageTaskHistory, HISTORY_RETENTION_POLICY } = require('../src/core/history-page');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUnitOfWork } = require('../src/application');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openConfigAuthority } = require('../src/platform/persistence/sqlite/sqlite-database');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const NOW = Date.parse('2026-10-07T01:00:00Z');
function repositoryFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-boundary-'));
  const repositories = [];
  t.after(() => {
    for (const repository of repositories) repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, open(factory, options) {
    const repository = factory({ userDataPath: directory, now: () => NOW, ...options });
    repositories.push(repository);
    return repository;
  } };
}

test('state updates carry monotonic revisions and only the declared projection delta', () => {
  const full = { revision: 1, tasks: [{ id: 'a' }], stats: { total: 1 }, settings: { dnd: false }, serverNow: 10 };
  const delta = buildStateDelta(full, { tasks: true });
  assert.deepEqual(Object.keys(delta).sort(), ['serverNow', 'tasks']);
  const applied = applyStateDelta({ revision: 1, tasks: [], stats: full.stats }, { revision: 2, dirty: { tasks: true }, delta });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.state.tasks, full.tasks);
  assert.deepEqual(applied.state.stats, full.stats);
  assert.equal(applyStateDelta(applied.state, { revision: 2, dirty: {}, delta: {} }).reason, 'stale-revision');
  assert.equal(applyStateDelta(applied.state, { revision: 4, dirty: {}, delta: {} }).reason, 'revision-gap');
  assert.throws(() => buildStateDelta(full, { misspelledBoundary: true }), /unknown state dirty flag/);
  assert.deepEqual(
    buildStateDelta({ companionProjection: { bond: 2 }, serverNow: 11 }, { companion: true }),
    { companionProjection: { bond: 2 }, serverNow: 11 }
  );
});

test('a timeline-only fact signals a refresh without pretending canonical state changed', () => {
  const delta = buildStateDelta({ serverNow: 10, routines: { items: [] } }, { timeline: true });
  assert.deepEqual(delta, { serverNow: 10 });
  const next = applyStateDelta({ revision: 2, routines: { items: [] } }, {
    revision: 3, dirty: { timeline: true }, delta
  });
  assert.equal(next.applied, true);
  assert.equal(next.state.revision, 3);
});

test('the wardrobe travels with every write that can change what the companion wears', () => {
  const full = {
    revision: 4, appearance: { choices: [], wornIds: ['sprout'] }, level: 3, xp: 40, stats: { total: 1 },
    skins: [], currentSkin: 'pink', theme: 'day', serverNow: 12
  };
  // Equipping writes one field, so a level-up cannot be mistaken for it and vice versa.
  assert.deepEqual(Object.keys(buildStateDelta(full, { appearance: true })).sort(), ['appearance', 'serverNow']);
  // A level-up unlocks items and a skin switch changes the automatic fallback, so both
  // must carry the wardrobe in the same message the level or skin arrives in.
  for (const flag of ['stats', 'skin']) {
    assert.ok(Object.keys(buildStateDelta(full, { [flag]: true })).includes('appearance'),
      `the ${flag} boundary must refresh the wardrobe`);
  }
  assert.throws(() => buildStateDelta(full, { wardrobe: true }), /unknown state dirty flag/);
});

test('the energy curve travels with both of the things that can change its shape', () => {
  const full = {
    revision: 5, energy: { level: 60 }, energyCheckIn: { level: 70 },
    energyCurve: { dayKey: '2026-09-20', levels: [] },
    routines: { items: [], today: [] }, serverNow: 13
  };
  // Logging a coffee changes the rest of today's shape, so the curve has to ride the
  // routines boundary too. Leaving it off looks like "the curve does not move when I
  // check in, it only jumps at the next self-report" — a stale reading, not an error.
  for (const flag of ['energy', 'routines']) {
    assert.ok(Object.keys(buildStateDelta(full, { [flag]: true })).includes('energyCurve'),
      `the ${flag} boundary must refresh the energy curve`);
  }
  // And it is not its own boundary: nothing recomputes the curve without also
  // recomputing one of those two, so a third flag would only add a way to drift.
  assert.throws(() => buildStateDelta(full, { energyCurve: true }), /unknown state dirty flag/);
});

test('history is retained but sent to renderers in stable bounded pages', () => {
  const history = Array.from({ length: 75 }, (_, index) => ({ id: `task-${index}`, archivedAt: index }));
  const first = pageTaskHistory(history, { limit: 30 });
  assert.equal(first.items.length, 30);
  assert.equal(first.items[0].id, 'task-74');
  assert.equal(first.nextCursor, 'offset:30');
  assert.equal(first.retention, HISTORY_RETENTION_POLICY);
  const last = pageTaskHistory(history, { cursor: 'offset:60', limit: 30 });
  assert.equal(last.items.length, 15);
  assert.equal(last.nextCursor, null);
  assert.throws(() => pageTaskHistory(history, { cursor: '75' }), /cursor/);
});

test('the commit boundary validates idempotently and increments once per canonical write', t => {
  const fixture = repositoryFixture(t);
  let writes = 0;
  const normalizedCounts = [];
  // The original fractional-count scenario uses the retained compatibility
  // adapter's schema8 fixture. Both its SQL writer and the UoW are real; the
  // current-only18 production entry is exercised separately below.
  const repository = fixture.open(createElectronStoreAdapter, {
    schemaVersion: 8,
    jsonMirror: false,
    normalize: value => {
      normalizedCounts.push(value.count);
      return { schemaVersion: 8, count: Math.max(0, Math.floor(Number(value.count) || 0)) };
    },
    authorityFactory: options => {
      const authority = openConfigAuthority(options);
      return { ...authority, write(candidate) {
        const result = authority.write(candidate);
        writes += 1;
        return result;
      } };
    }
  });
  const boundary = createUnitOfWork({ repository });
  assert.deepEqual(repository.snapshot(), { schemaVersion: 8, count: 0 });
  assert.equal(repository.revision(), 0);
  assert.equal(writes, 0);
  normalizedCounts.length = 0;
  const result = boundary.run({ writes: ['count'], expectedRevision: 0,
    transition: draft => { draft.count = 2.8; } });
  assert.deepEqual({ state: { count: result.state.count }, revision: result.revision }, { state: { count: 2 }, revision: 1 });
  assert.equal(writes, 1);
  assert.equal(repository.revision(), 1);
  assert.equal(result.committed, true);
  assert.deepEqual(result.changedPaths, ['count']);
  assert.deepEqual(normalizedCounts, [2.8, 2]);
  assert.deepEqual(repository.snapshot(), { schemaVersion: 8, count: 2 });
  repository.close();
  const reopened = fixture.open(createElectronStoreAdapter, { schemaVersion: 8, jsonMirror: false,
    normalize: value => ({ schemaVersion: 8, count: Math.max(0, Math.floor(Number(value.count) || 0)) }) });
  assert.deepEqual(reopened.snapshot(), { schemaVersion: 8, count: 2 });
  assert.equal(reopened.revision(), 1);
  assert.equal(fs.existsSync(path.join(fixture.directory, 'config.json')), false);
});

test('the real current-only SQL boundary rejects non-idempotent normalization and write faults without revision advance', t => {
  const fixture = repositoryFixture(t);
  let drift = false;
  let failWrite = false;
  let attemptedWrites = 0;
  const repository = fixture.open(createSqliteStateAdapter, {
    normalize: value => {
      const normalized = normalizePersistedState(value, { now: NOW });
      if (drift) normalized.settings.dnd = !normalized.settings.dnd;
      return normalized;
    },
    authorityFactory: options => {
      const authority = openConfigAuthority(options);
      return { ...authority, write(candidate) {
        attemptedWrites += 1;
        if (failWrite) throw new Error('injected-authority-write-fault');
        return authority.write(candidate);
      } };
    }
  });
  const boundary = createUnitOfWork({ repository });
  const initial = repository.snapshot();
  const change = () => boundary.run({ writes: ['settings'], expectedRevision: 0,
    transition: draft => { draft.settings.dnd = true; } });
  drift = true;
  assert.throws(change, /canonical state normalization is not idempotent/);
  assert.equal(attemptedWrites, 0);
  assert.equal(repository.revision(), 0);
  assert.deepEqual(repository.snapshot(), initial);
  drift = false;
  failWrite = true;
  assert.throws(change, /injected-authority-write-fault/);
  assert.equal(attemptedWrites, 1);
  assert.equal(repository.revision(), 0);
  assert.deepEqual(repository.snapshot(), initial);
  failWrite = false;
  const committed = change();
  assert.equal(committed.committed, true);
  assert.equal(committed.revision, 1);
  assert.equal(attemptedWrites, 2);
  assert.equal(repository.get('settings').dnd, true);
  const unchanged = boundary.run({ writes: ['settings'], expectedRevision: 1,
    transition: draft => { draft.settings.dnd = true; } });
  assert.equal(unchanged.committed, false);
  assert.equal(unchanged.revision, 1);
  assert.equal(attemptedWrites, 2);
  assert.deepEqual(change(), { ok: false, reason: 'state-revision-conflict', expectedRevision: 0,
    actualRevision: 1, committed: false, revision: 1 });
  assert.equal(attemptedWrites, 2);
  repository.close();
  const reopened = fixture.open(createSqliteStateAdapter, {
    normalize: value => normalizePersistedState(value, { now: NOW })
  });
  assert.equal(reopened.revision(), 1);
  assert.equal(reopened.get('settings').dnd, true);
  assert.equal(fs.existsSync(path.join(fixture.directory, 'config.json')), false);
});

test('historical commit helper cannot become a runtime dependency', () => {
  const root = path.resolve(__dirname, '..');
  // Inject a source read only in the child checker; leave the checkout intact.
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const original = fs.readFileSync;
    const target = path.join(process.cwd(), 'src/application/state/unit-of-work.js');
    fs.readFileSync = function(file, ...args) {
      const result = original.call(this, file, ...args);
      return file === target && typeof result === 'string'
        ? result + "\\nrequire('../../core/state-commit');\\n" : result;
    };
    require('./scripts/check-architecture');
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imports historical state-commit; use the canonical unit of work/);
});
