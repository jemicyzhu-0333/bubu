'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuidancePreviewStore, PREVIEW_TTL_MS, MAX_PREVIEWS } = require('../src/application/ai/guidance-preview-store');
const { createPlanEnergyPreferenceWorkflow } = require('../src/application/workflows/plan-energy-preference');
const { createConsentEnergyHistoryWorkflow } = require('../src/application/workflows/consent-energy-history');
const { createTrialEnergyCurveWorkflow } = require('../src/application/workflows/trial-energy-curve');
const { NOW, planningFixture, repositoryFixture, sourceFor } = require('../test-support/planning-guidance-fixture');
const preferenceInput = { id: null, startMinute: 600, endMinute: 1080, demand: 'high', scope: 'today' };

test('exact cancellation releases capacity, cannot resurrect IDs and never removes completed recovery results', () => {
  const store = createGuidancePreviewStore({ clock: { now: () => NOW }, idFactory: () => 'repeated-seed' });
  const ids = [];
  for (let index = 0; index < 80; index++) {
    const preview = store.put({ ok: true, index }); ids.push(preview.previewId);
    assert.equal(store.cancel(preview.previewId).cancelled, true);
    assert.equal(store.get(preview.previewId), null);
  }
  assert.equal(new Set(ids).size, ids.length, 'cancelled IDs can never address a later preview');
  const kept = store.put({ ok: true }); store.complete(kept.previewId, { ok: true, changed: true, receiptId: kept.previewId });
  assert.equal(store.cancel(kept.previewId).reason, 'guidance-preview-already-confirmed');
  assert.equal(store.get(kept.previewId).result.receiptId, kept.previewId);
  assert.equal(store.cancel(ids[0]).cancelled, false);
});

test('all three workflows reject confirmation after cancellation without a UoW write', () => {
  const f = repositoryFixture(planningFixture({ sufficient: true }));
  const workflows = [
    [createPlanEnergyPreferenceWorkflow(f), preferenceInput],
    [createConsentEnergyHistoryWorkflow(f), { enabled: false, clearHistory: true }],
    [createTrialEnergyCurveWorkflow({ ...f, sourceFor, comparisonFor: () => ({}) }), { parameter: 'chronotypeShift', to: 6, scope: 'today' }]
  ];
  const before = f.snapshot();
  for (const [workflow, input] of workflows) {
    const preview = workflow.preview(input); assert.equal(preview.ok, true);
    assert.equal(workflow.cancel({ previewId: preview.previewId }).cancelled, true);
    assert.equal(workflow.confirm({ previewId: preview.previewId }).reason, 'guidance-preview-expired');
  }
  assert.equal(f.commits(), 0); assert.deepEqual(f.snapshot(), before);
});

test('completed outcomes survive expiry cleanup while bounded eviction never proves zero writes', () => {
  let now = NOW;
  const store = createGuidancePreviewStore({ clock: { now: () => now }, idFactory: () => 'bounded-recovery' });
  const first = store.put({ ok: true });
  store.start(first.previewId); store.complete(first.previewId, { ok: true, changed: true });
  now += PREVIEW_TTL_MS;
  const second = store.put({ ok: true });
  assert.equal(store.get(first.previewId), null);
  assert.deepEqual(store.outcome(first.previewId), { ok: true, changed: true });
  store.cancel(second.previewId);
  let latest;
  for (let index = 0; index < MAX_PREVIEWS * 3; index++) {
    latest = store.put({ ok: true }); assert.equal(latest.ok, true);
    store.start(latest.previewId); store.complete(latest.previewId, { ok: true, index });
    now += PREVIEW_TTL_MS;
  }
  assert.equal(store.outcome(first.previewId), null, 'old proof is evicted without becoming a no-commit claim');
  assert.equal(store.outcome(latest.previewId).ok, true);
  assert.equal(store.outcome('unknown-identity'), null);
});

test('only a known never-attempted expired preview proves no commit; unknown attempts remain protected', () => {
  let now = NOW;
  const store = createGuidancePreviewStore({ clock: { now: () => now }, idFactory: () => 'uncertain-recovery' });
  const untouched = store.put({ ok: true });
  const attempted = store.put({ ok: true });
  assert.equal(store.start(attempted.previewId).attempted, false);
  now += PREVIEW_TTL_MS;
  assert.deepEqual(store.outcome(untouched.previewId), { ok: false, reason: 'guidance-preview-expired', committed: false });
  assert.equal(store.outcome(attempted.previewId).uncertain, true);
  assert.equal(store.cancel(attempted.previewId).uncertain, true);
  store.put({ ok: true });
  assert.equal(store.outcome(untouched.previewId), null, 'pruned identity is now unknown');
  assert.equal(store.outcome(attempted.previewId).uncertain, true, 'cleanup preserves an unknown attempt');
});

test('all planning workflows preserve unknown commit outcomes through retry, expiry and cancellation', () => {
  for (const kind of ['preference', 'history', 'trial']) {
    const f = repositoryFixture(planningFixture({ sufficient: true }));
    let attempts = 0;
    const ports = { ...f, unitOfWork: { run(request) {
      attempts++;
      const result = f.unitOfWork.run(request);
      if (attempts === 1) throw new Error('fixture commit outcome not returned');
      return result;
    } } };
    const [workflow, input] = kind === 'preference' ? [createPlanEnergyPreferenceWorkflow(ports), preferenceInput]
      : kind === 'history' ? [createConsentEnergyHistoryWorkflow(ports), { enabled: false, clearHistory: true }]
        : [createTrialEnergyCurveWorkflow({ ...ports, sourceFor, comparisonFor: () => ({}) }), { parameter: 'chronotypeShift', to: 6, scope: 'today' }];
    const preview = workflow.preview(input);
    assert.throws(() => workflow.confirm({ previewId: preview.previewId }), /outcome not returned/);
    assert.equal(f.commits(), 1);
    const retried = workflow.confirm({ previewId: preview.previewId });
    assert.equal(retried.uncertain, true);
    assert.notEqual(retried.committed, false);
    f.setTime(NOW + PREVIEW_TTL_MS);
    assert.equal(workflow.confirm({ previewId: preview.previewId }).uncertain, true);
    assert.equal(workflow.cancel({ previewId: preview.previewId }).uncertain, true);
    assert.equal(attempts, 2, 'expiry cannot authorize another transition');
    assert.equal(f.commits(), 1);
  }
});

test('expired interrupted tickets need verified unchanged versions for every planning slice', () => {
  const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
  for (const kind of ['preference', 'history', 'trial']) for (const proof of ['same', 'changed', 'missing', 'failed']) {
    const f = repositoryFixture(planningFixture({ sufficient: true })), routes = new Map();
    let attempts = 0;
    createPlanningPreferences({ ...f, readSnapshot: f.snapshot,
      unitOfWork: { run() { attempts++; throw new Error('fixture interrupted before write'); } },
      durability: proof === 'missing' ? null : { verify: () => ({ ok: proof !== 'failed' }) }
    }).register((channel, handler) => routes.set(channel, handler));
    const input = kind === 'preference' ? preferenceInput : kind === 'history' ? { enabled: false, clearHistory: true }
      : { parameter: 'chronotypeShift', to: 6, scope: 'today' };
    const preview = routes.get(`planning:${kind}-preview`)({}, input);
    assert.equal(preview.ok, true);
    assert.throws(() => routes.get(`planning:${kind}-confirm`)({}, { previewId: preview.previewId }), /interrupted/);
    if (proof === 'changed') f.mutate(state => {
      state[{ preference: 'planningPreferences', history: 'energySelfReports', trial: 'energyCurveTrials' }[kind]].version++;
    });
    f.setTime(NOW + PREVIEW_TTL_MS);
    const result = routes.get(`planning:${kind}-confirm`)({}, { previewId: preview.previewId });
    if (proof === 'same') assert.deepEqual(result, { ok: false, reason: 'guidance-preview-expired', committed: false });
    else { assert.equal(result.uncertain, true); assert.notEqual(result.committed, false); }
    assert.equal(attempts, 1); assert.equal(f.commits(), 0);
  }
});

test('real SQL rollback is recoverable but unavailable authority cannot prove noncommit from a stale snapshot', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
  const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
  const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
  const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
  const { createUnitOfWork } = require('../src/application/state/unit-of-work');
  for (const unknown of [false, true]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-confirm-proof-'));
    const database = path.join(directory, 'config.sqlite');
    let at = NOW, armed = false, denyRead = false, serial = 0;
    const initial = normalizePersistedState(planningFixture({ sufficient: true }), { now: at });
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(initial));
    function fault({ type, filePath, sql, readOnly }) {
      if (denyRead && type === 'open' && readOnly && filePath === database) throw new Error('fixture readback unavailable');
      if (armed && filePath === database && sql === 'COMMIT' && type === (unknown ? 'after' : 'before')) {
        armed = false; denyRead = unknown; throw new Error('fixture SQL commit fault');
      }
    }
    const repository = createElectronStoreAdapter({ userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION,
      normalize: normalizePersistedState, now: () => at, authorityFactory: options => openSqliteConfigAuthority(options, {
        selectDriver: () => ({ open(filePath, settings = {}) {
          fault({ type: 'open', filePath, readOnly: settings.readOnly === true });
          return { db: new DatabaseSync(filePath, settings), filePath, readOnly: settings.readOnly === true };
        } }),
        makeHandle: ({ db, filePath, readOnly }) => ({
          exec(sql) { fault({ type: 'before', sql, filePath, readOnly }); const result = db.exec(sql); fault({ type: 'after', sql, filePath, readOnly }); return result; },
          run: (sql, params = []) => db.prepare(sql).run(...params),
          get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
          userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
          setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
        })
      }) });
    t.after(() => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const cached = repository.snapshot(), routes = new Map();
    createPlanningPreferences({ unitOfWork: createUnitOfWork({ repository }),
      readSnapshot: unknown ? () => structuredClone(cached) : repository.snapshot,
      clock: { now: () => at }, idFactory: () => `sql-recovery-${++serial}`, durability: repository.authoritativeWrites
    }).register((channel, handler) => routes.set(channel, handler));
    const preview = routes.get('planning:history-preview')({}, { enabled: false, clearHistory: true });
    armed = true;
    assert.throws(() => routes.get('planning:history-confirm')({}, { previewId: preview.previewId }),
      unknown ? /config-commit-outcome-unknown/ : /fixture SQL commit fault/);
    at += PREVIEW_TTL_MS;
    const proof = repository.authoritativeWrites.verify();
    assert.equal(proof.ok, !unknown);
    const result = routes.get('planning:history-confirm')({}, { previewId: preview.previewId });
    if (unknown) { assert.equal(result.uncertain, true); assert.notEqual(result.committed, false); }
    else {
      assert.equal(result.committed, false);
      assert.equal(proof.revision, 0);
      assert.deepEqual(repository.snapshot().energySelfReports, initial.energySelfReports);
    }
  }
});
