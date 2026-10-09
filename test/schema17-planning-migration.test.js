'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePersistedState: normalizeCurrentState } = require('../src/platform/persistence/persisted-schema');
// A pinned generic-adapter fixture isolates the historical planning-slice bridge.
// Production current18 admission is covered independently in schema18-admission.
const PLANNING_SCHEMA_VERSION = 17;
const normalizePersistedState = (raw, options) => ({ ...normalizeCurrentState(raw, options), schemaVersion: PLANNING_SCHEMA_VERSION });
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
// Exercise the historical generic SQL adapter; legacy Store fixtures must never be constructed.
const { trackStateAdapters } = require('../test-support/tracked-state-adapters');
const adapters = trackStateAdapters(productionAdapter);
function createElectronStoreAdapter(options) { return adapters.open(options); }
const { planningState: v } = require('../src/capabilities/guidance');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createPlanEnergyPreferenceWorkflow } = require('../src/application/workflows/plan-energy-preference');
const { NOW, planningFixture } = require('../test-support/planning-guidance-fixture');
const FIELDS = ['planningPreferences', 'energySelfReports', 'energyCurveTrials'];
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hiadhd-planning-schema17-'));
  t.after(() => { adapters.closeDirectory(directory); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'config.json');
  const canonical = normalizePersistedState({ energyCheckIn: { level: 65, state: 'medium', timestamp: NOW },
    settings: { aiBreakdownEnabled: false, activityMirrorEnabled: false } }, { now: NOW });
  const old = { ...canonical, schemaVersion: 16 };
  for (const field of FIELDS) delete old[field];
  const original = Buffer.from(`${JSON.stringify(old, null, 2)}\n`);
  fs.writeFileSync(file, original);
  let writes = 0, constructions = 0;
  class Store {
    constructor() { constructions += 1; }
    get store() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    set store(value) { writes += 1; fs.writeFileSync(file, JSON.stringify(value)); }
    get(key) { return this.store[key]; }
  }
  const open = (overrides = {}) => createElectronStoreAdapter({ userDataPath: directory, Store,
    schemaVersion: PLANNING_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => NOW, ...overrides });
  return { file, old, canonical, original, open, writes: () => writes, constructions: () => constructions };
}

test('schema16 planning upgrade keeps byte-exact backup and starts with no historical self-reports or consent', t => {
  assert.equal(PLANNING_SCHEMA_VERSION, 17);
  const f = fixture(t);
  const opened = f.open();
  assert.equal(opened.migration.sourceVersion, 16);
  assert.deepEqual(fs.readFileSync(`${f.file}.schema-16-to-17.backup`), f.original);
  assert.deepEqual(opened.snapshot().planningPreferences, v.createPlanningPreferences());
  assert.deepEqual(opened.snapshot().planningPreferences.receipts, [], 'migration does not invent historical confirmations');
  assert.deepEqual(opened.snapshot().energySelfReports, v.createEnergySelfReports());
  assert.deepEqual(opened.snapshot().energyCurveTrials, v.createEnergyCurveTrials());
  assert.deepEqual(opened.snapshot().energyCheckIn, f.old.energyCheckIn);
  const expected = { ...f.old, schemaVersion: 17, planningPreferences: v.createPlanningPreferences(),
    energySelfReports: v.createEnergySelfReports(), energyCurveTrials: v.createEnergyCurveTrials() };
  assert.deepEqual(opened.snapshot(), expected);
  assert.equal(f.writes(), 0, 'obsolete Conf writer is never used');
  const bytes = fs.readFileSync(f.file);
  f.open({ now: () => NOW + 500 * 86400000 });
  assert.equal(f.writes(), 0, 'obsolete Conf writer is never used');
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});

test('current planning schema missing or corrupt slices fails before opening or overwriting the original', t => {
  const f = fixture(t);
  const canonical = { ...f.canonical, planningPreferences: v.createPlanningPreferences(),
    energySelfReports: v.createEnergySelfReports(), energyCurveTrials: v.createEnergyCurveTrials() };
  const mutations = [
    ...FIELDS.map(field => value => { delete value[field]; }),
    ...FIELDS.map(field => value => { value[field] = null; }),
    value => { value.energySelfReports.consentEnabled = 'yes'; },
    value => { value.energySelfReports.events = [{ source: 'predicted' }]; },
    value => { value.planningPreferences.items = Array(25).fill({}); },
    value => { delete value.planningPreferences.receipts; },
    value => { value.planningPreferences.receipts = Array(513).fill({}); },
    value => { value.planningPreferences.receipts = [{ receiptId: 'r', body: 'private historical body' }]; },
    value => { value.energyCurveTrials.active = { parameter: 'medication' }; }
  ];
  for (const mutation of mutations) {
    const damaged = structuredClone(canonical); mutation(damaged);
    const bytes = JSON.stringify(damaged); fs.writeFileSync(f.file, bytes);
    assert.throws(() => f.open(), /failed validation|planning-state-invalid/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  }
  assert.equal(f.writes(), 0); assert.equal(f.constructions(), 0);
});

test('retained real report samples remain fixed points across reopen, without wall-clock deletion or backfill', t => {
  const f = fixture(t);
  const real = planningFixture({ sufficient: true });
  const current = { ...f.canonical, planningPreferences: real.planningPreferences,
    energySelfReports: real.energySelfReports, energyCurveTrials: real.energyCurveTrials };
  fs.writeFileSync(f.file, JSON.stringify(current));
  const bytes = fs.readFileSync(f.file);
  const reopened = f.open({ now: () => NOW + 365 * 86400000 });
  assert.deepEqual(reopened.snapshot().energySelfReports, real.energySelfReports);
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(f.writes(), 0);
});

test('body-free preference receipts and undo state survive historical config authority reopen atomically', t => {
  const f = fixture(t), repository = f.open();
  let sequence = 0;
  const workflow = createPlanEnergyPreferenceWorkflow({ unitOfWork: createUnitOfWork({ repository }),
    snapshot: repository.snapshot, clock: { now: () => NOW }, idFactory: () => `receipt-reopen-${++sequence}` });
  const preview = workflow.preview({ id: null, startMinute: 600, endMinute: 720, demand: 'low', scope: 'saved' });
  const applied = workflow.confirm({ previewId: preview.previewId });
  assert.equal(applied.ok, true);
  const saved = repository.snapshot().planningPreferences;
  assert.equal(saved.items.length, 1); assert.equal(saved.receipts.length, 1);
  assert.equal(Object.hasOwn(saved.receipts[0], 'before'), false); assert.equal(Object.hasOwn(saved.receipts[0], 'after'), false);
  assert.deepEqual(f.open().snapshot().planningPreferences, saved);
  assert.equal(workflow.undo({ receiptId: applied.receiptId, expectedVersion: applied.version }).ok, true);
  const undone = f.open().snapshot().planningPreferences;
  assert.equal(undone.items.length, 0); assert.equal(undone.receipts.length, 1);
  assert.equal(undone.receipts[0].revertedAt, NOW); assert.equal(undone.undo, null);
  assert.deepEqual(fs.readFileSync(`${f.file}.schema-16-to-17.backup`), f.original);
});

test('planning migration backup mismatch and backup failure preserve original bytes and fail closed', t => {
  const f = fixture(t);
  const backup = `${f.file}.schema-16-to-17.backup`;
  fs.writeFileSync(backup, 'incorrect');
  assert.throws(() => f.open(), /backup/i);
  assert.equal(f.constructions(), 0); assert.equal(f.writes(), 0);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
  fs.rmSync(backup);
  assert.throws(() => f.open({ migration: { prepareStoreMigration() { throw new Error('backup failed'); } } }), /backup failed/);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
});

test('failed planning canonical write retains the exact rollback backup; a schema16 writer rejects schema17', t => {
  const f = fixture(t);
  class FailedStore {
    get store() { return JSON.parse(fs.readFileSync(f.file, 'utf8')); }
    set store(_) { throw new Error('write refused'); }
  }
  assert.throws(() => f.open({ authorityFactory(options) { options.prepareInitial(); throw new Error('write refused'); } }), /write refused/);
  assert.deepEqual(fs.readFileSync(`${f.file}.schema-16-to-17.backup`), f.original);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
  f.open();
  const current = fs.readFileSync(f.file);
  assert.throws(() => f.open({ schemaVersion: 16 }), /future|newer/i);
  assert.deepEqual(fs.readFileSync(f.file), current);
});
