'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PERSISTED_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  normalizePersistedState
} = require('../src/platform/persistence/persisted-schema');
const storeMigration = require('../src/core/store-migration');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { trackStateAdapters } = require('../test-support/tracked-state-adapters');
const adapters = trackStateAdapters(productionAdapter);
function createElectronStoreAdapter(options) { return adapters.open(options); }
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');

// Schema 9 is additive: it opens slots (worn accessories, routines and their
// two-day log, the energy calibration profile, six new switches under
// `settings`) without touching a single field schema 8 already had. Every test
// below exists to keep that claim true, because "additive" is the entire reason
// this bump is allowed to run on live data with only a backup behind it.
const NOW = 1_764_000_000_000;

// Declared as literals, not read from `DEFAULT_SETTINGS` / `defaultCompanionState()`.
// Reading them from the code would only prove the code agrees with itself; the
// design doc's field table is the authority a migration has to answer to, so it
// is transcribed here and a drift in either direction fails.
const SCHEMA_9_DEFAULTS = Object.freeze([
  { path: ['companion', 'appearance', 'equipped'], value: {} },
  { path: ['companion', 'appearance', 'updatedAt'], value: null },
  { path: ['routines'], value: [] },
  { path: ['routineLog'], value: { days: [] } },
  { path: ['energyProfile'], value: null },
  { path: ['settings', 'quickPanelShortcut'], value: 'Alt+Shift+Space' },
  { path: ['settings', 'quickPanelEnabled'], value: true },
  { path: ['settings', 'aiClarifyEnabled'], value: false },
  { path: ['settings', 'aiMemoryEnabled'], value: false },
  { path: ['settings', 'timelineRetentionDays'], value: 400 },
  { path: ['settings', 'routineRemindersEnabled'], value: true },
  { path: ['settings', 'energyCurveEnabled'], value: true }
]);

// The leaf paths the migration is allowed to introduce. `routineLog` appears as
// `routineLog.days` because the comparison below walks to leaves — an empty
// array is a leaf, an object holding one is not.
const ALLOWED_NEW_PATHS = Object.freeze([
  'companion.appearance.equipped',
  'companion.appearance.updatedAt',
  'energyProfile',
  'routineLog.days',
  'routines',
  'schemaVersion',
  'settings.aiClarifyEnabled',
  'settings.aiMemoryEnabled',
  'settings.energyCurveEnabled',
  'settings.quickPanelEnabled',
  'settings.quickPanelShortcut',
  'settings.routineRemindersEnabled',
  'settings.timelineRetentionDays'
]);

// A schema-8 store with something in every corner the migration could plausibly
// disturb: an orthogonal-task-model task carrying the fields schema 8 added, a
// recurring series with its single open occurrence, an archived task, a reward
// ledger that already holds a lifetime step budget, and settings the user moved
// off the defaults.
function looseSchema8Store() {
  return {
    schemaVersion: 8,
    tasks: [
      {
        id: 'task-weekly-report',
        title: '写周报',
        tags: ['报告', '收尾'],
        description: '把这周做完的事列出来',
        estimateMinutes: 45,
        estimateSource: 'user',
        energy: 'medium',
        steps: [
          { id: 'step-collect', title: '收集素材', done: true },
          { id: 'step-write', title: '写正文', done: false }
        ]
      },
      {
        id: 'task-medication-today',
        title: '吃药',
        seriesId: 'series-medication',
        occurrenceDate: '2026-09-10',
        energy: 'low'
      },
      { id: 'task-finished', title: '已完成的事', done: true, focusedMs: 900_000 }
    ],
    archivedTasks: [{ id: 'task-archived', title: '归档掉的事', done: true }],
    recurrenceSeries: [
      {
        id: 'series-medication',
        state: 'active',
        openTaskId: 'task-medication-today',
        rule: { frequency: 'daily', interval: 1, strategy: 'fixed', anchorDate: '2026-09-01' },
        template: { title: '吃药', energy: 'low' }
      }
    ],
    impulses: [{ id: 'impulse-idea', text: '想到一个点子', createdAt: NOW - 60_000 }],
    nowTaskId: 'task-weekly-report',
    xp: 320,
    level: 4,
    streak: 6,
    lastCompletedDate: '2026-09-16',
    stats: { totalFocusMs: 7_200_000, dailyFocus: { '2026-09-16': 3_600_000 } },
    unlockedSkins: ['pink', 'mint'],
    currentSkin: 'mint',
    achievements: { 'first-focus': true },
    lastResetDate: '2026-09-17',
    lastWorkEndNotifyDate: '2026-09-16',
    settings: {
      pomodoroMinutes: 30,
      breakMinutes: 8,
      workStartHour: 9,
      workEndHour: 19,
      motionMode: 'reduced',
      petActivityMode: 'quiet',
      aiBreakdownEnabled: true
    },
    pet: { satiation: 72, foodInventory: { fish: 2, bone: 1 } },
    // Left at `null` on purpose: a live session would drag `now` into the
    // comparison and make this a test about session recovery instead of a test
    // about schema 8 to 9.
    focusSession: null,
    energyCheckIn: { level: 3, at: NOW - 1_200_000 },
    rewardLedger: {
      version: 3,
      events: [],
      seenEventIds: ['reward-weekly-report'],
      dailyBucketTotals: { '2026-09-16': 20 },
      stepBudgets: { 'task-weekly-report|lifetime': 4 }
    },
    strategyFeedback: {},
    reviews: { pending: [] },
    migrationNotices: []
  };
}

// Walks to leaves so the comparison is genuinely key by key, including nested
// `settings` and `companion.appearance`. An empty array or object is itself a
// leaf: `routines: []` has to compare as one value rather than as no values,
// otherwise a field that arrives empty would look like a field that never
// arrived at all.
function flattenLeaves(value, prefix = '', into = new Map()) {
  const branch = value !== null && typeof value === 'object'
    && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);
  if (!branch) {
    into.set(prefix, JSON.stringify(value) ?? 'undefined');
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenLeaves(item, `${prefix}[${index}]`, into));
  } else {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, into);
    }
  }
  return into;
}

function differingLeafPaths(left, right) {
  const before = flattenLeaves(left);
  const after = flattenLeaves(right);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(leaf => before.get(leaf) !== after.get(leaf))
    .sort();
}

function valueAtPath(source, keys) {
  return keys.reduce((cursor, key) => (cursor === null || cursor === undefined ? cursor : cursor[key]), source);
}

// Removes the key and then any ancestor it just emptied: a real pre-wardrobe
// store has no `companion.appearance` object at all, and leaving `{}` behind
// would quietly hand the migration a hint that the field is expected.
function removeAtPath(source, keys) {
  const parents = [];
  let cursor = source;
  for (const key of keys.slice(0, -1)) {
    if (cursor === null || typeof cursor !== 'object') return;
    parents.push([cursor, key]);
    cursor = cursor[key];
  }
  if (cursor === null || typeof cursor !== 'object') return;
  delete cursor[keys[keys.length - 1]];
  for (const [parent, key] of parents.reverse()) {
    if (Object.keys(parent[key]).length === 0) delete parent[key];
  }
}

// The schema-8 snapshot is derived rather than hand-written, and that is the
// point: normalizing the loose store above yields a canonical *schema 9* state,
// and stripping exactly the twelve documented paths from it yields the canonical
// *schema 8* state — because 8 to 9 is supposed to be purely additive. If it
// ever stops being additive, the round trip below no longer closes and these
// tests fail instead of the user's data.
//
// Nothing else about the two reads differs: schema 8 and 9 take the same
// transformation path (`predatesOrthogonalTaskModel` is false for both), they
// differ only in how strictly the result is checked.
function schema8Snapshot() {
  const canonical = normalizePersistedState(looseSchema8Store(), { now: NOW });
  const snapshot = structuredClone(canonical);
  for (const { path: keys } of SCHEMA_9_DEFAULTS) removeAtPath(snapshot, keys);
  snapshot.schemaVersion = 8;
  return { canonical, snapshot };
}

function withTempStore(t, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'im-adhder-schema9-'));
  t.after(() => { adapters.closeDirectory(directory); fs.rmSync(directory, { recursive: true, force: true }); });
  const storePath = path.join(directory, 'config.json');
  if (contents !== undefined) fs.writeFileSync(storePath, `${JSON.stringify(contents, null, 2)}\n`);
  return { directory, storePath };
}

// Stands in for electron-store's only behaviour this test depends on: `store`
// reads and writes the file on disk. The adapter assigns `driver.store = …`, so
// an accessor is what makes a byte comparison across two runs meaningful.
function fileStoreClass(storePath) {
  return class FileStore {
    get store() {
      return fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : {};
    }

    set store(value) {
      fs.writeFileSync(storePath, `${JSON.stringify(value, null, 2)}\n`);
    }

    get(key) {
      return this.store[key];
    }
  };
}

function openStore(storePath) {
  return createElectronStoreAdapter({
    userDataPath: path.dirname(storePath),
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState,
    now: () => NOW,
    Store: fileStoreClass(storePath),
    migration: storeMigration
  });
}

test('migrating a schema 8 file twice produces identical bytes', t => {
  const { snapshot } = schema8Snapshot();
  const { storePath } = withTempStore(t, snapshot);

  const first = openStore(storePath);
  assert.equal(first.migration.sourceVersion, 8);
  const afterFirst = fs.readFileSync(storePath, 'utf8');
  assert.equal(JSON.parse(afterFirst).schemaVersion, PERSISTED_SCHEMA_VERSION);

  // The second open finds a current-schema file. It reaches the byte-for-byte
  // validation instead of the migration path, so "no error" already means the
  // normalizer is a fixed point here; the byte comparison additionally proves
  // nothing was rewritten.
  const second = openStore(storePath);
  assert.equal(second.migration.sourceVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(second.migration.backupCreated, false);
  assert.equal(fs.readFileSync(storePath, 'utf8'), afterFirst);
});

test('a schema 8 store without any new field survives the upgrade key for key', () => {
  const { canonical, snapshot } = schema8Snapshot();
  const before = structuredClone(snapshot);
  const migrated = normalizePersistedState(snapshot, { now: NOW });

  // Both directions: an unexpected change fails, and so does a documented
  // default that silently stopped being written.
  assert.deepEqual(differingLeafPaths(before, migrated), [...ALLOWED_NEW_PATHS]);
  assert.equal(migrated.schemaVersion, PERSISTED_SCHEMA_VERSION);
  for (const { path: keys, value } of SCHEMA_9_DEFAULTS) {
    assert.equal(valueAtPath(before, keys), undefined, `${keys.join('.')} must be absent in schema 8`);
    assert.deepEqual(valueAtPath(migrated, keys), value, keys.join('.'));
  }

  // And the derivation itself has to close, which is what makes the fixture a
  // real schema-8 snapshot rather than a hopeful hand-written one.
  assert.deepEqual(migrated, canonical);
});

test('the orthogonal task model and its rewards are not rebuilt by the schema 9 upgrade', () => {
  const { snapshot } = schema8Snapshot();
  const migrated = normalizePersistedState(snapshot, { now: NOW });

  // `migrateTaskModel` looks for `legacy.category === 'daily'`, which schema 8
  // no longer has: running it here would return an empty series list and delete
  // every recurring routine the user owns.
  assert.equal(migrated.recurrenceSeries.length, 1);
  assert.equal(migrated.recurrenceSeries[0].id, 'series-medication');
  assert.equal(migrated.recurrenceSeries[0].openTaskId, 'task-medication-today');

  const report = migrated.tasks.find(task => task.id === 'task-weekly-report');
  assert.deepEqual(report.tags, ['报告', '收尾']);
  assert.equal(report.description, '把这周做完的事列出来');
  assert.equal(report.estimateMinutes, 45);
  assert.equal(report.estimateSource, 'user');

  // The lifetime step budget arrived with schema 8. Backfilling it again would
  // add keys the file never held, and the store would then read as corrupt.
  assert.deepEqual(migrated.rewardLedger.stepBudgets, { 'task-weekly-report|lifetime': 4 });
  assert.deepEqual(migrated.rewardLedger.seenEventIds, ['reward-weekly-report']);
  assert.deepEqual(migrated.migrationNotices, []);
});

test('the schema 8 to current upgrade leaves a backup equal to the original file', t => {
  const { snapshot } = schema8Snapshot();
  const { storePath } = withTempStore(t, snapshot);
  const original = fs.readFileSync(storePath);

  const store = openStore(storePath);
  const backupPath = `${storePath}.schema-8-to-${PERSISTED_SCHEMA_VERSION}.backup`;

  assert.equal(store.migration.backupPath, backupPath);
  assert.equal(store.migration.backupCreated, true);
  assert.equal(fs.existsSync(backupPath), true);
  assert.deepEqual(fs.readFileSync(backupPath), original);
  assert.notDeepEqual(fs.readFileSync(storePath), original);
});

function schema9Snapshot() {
  const canonical = normalizePersistedState(looseSchema8Store(), { now: NOW });
  const snapshot = structuredClone(canonical);
  snapshot.schemaVersion = 9;
  delete snapshot.energySignals;
  delete snapshot.settings.aiImpulseEnergyEnabled;
  return { canonical, snapshot };
}

test('schema 9 to the current schema is backed up byte-for-byte and is idempotent on reopen', t => {
  const { snapshot } = schema9Snapshot();
  const { storePath } = withTempStore(t, snapshot);
  const original = fs.readFileSync(storePath);

  const first = openStore(storePath);
  const backupPath = `${storePath}.schema-9-to-${PERSISTED_SCHEMA_VERSION}.backup`;
  assert.equal(first.migration.sourceVersion, 9);
  assert.equal(first.migration.backupPath, backupPath);
  assert.equal(first.migration.backupCreated, true);
  assert.deepEqual(fs.readFileSync(backupPath), original);
  assert.deepEqual(first.snapshot().energySignals, []);
  assert.equal(first.snapshot().settings.aiImpulseEnergyEnabled, false);

  const migratedBytes = fs.readFileSync(storePath);
  const second = openStore(storePath);
  assert.equal(second.migration.sourceVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(second.migration.backupCreated, false);
  assert.deepEqual(fs.readFileSync(storePath), migratedBytes);
});

test('current schema refuses malformed energy signals without rewriting source bytes', t => {
  const { canonical } = schema9Snapshot();
  const malformed = structuredClone(canonical);
  malformed.energySignals = [{
    id: 'impulse-1',
    source: 'impulse-ai',
    referenceId: 'impulse-1',
    at: NOW,
    delta: 99,
    confidence: 90,
    reason: '越界修正'
  }];
  const { storePath } = withTempStore(t, malformed);
  const original = fs.readFileSync(storePath);

  assert.throws(
    () => openStore(storePath),
    /refusing to rewrite it without a migration backup/
  );
  assert.deepEqual(fs.readFileSync(storePath), original);
});

test('a current-schema file with an illegal field fails closed instead of being quietly repaired', t => {
  const { canonical } = schema8Snapshot();
  const refuses = /refusing to rewrite it without a migration backup/;

  const tampered = structuredClone(canonical);
  tampered.settings.hydrationEvery = 0;
  const withOldFieldBroken = withTempStore(t, tampered);
  assert.throws(() => openStore(withOldFieldBroken.storePath), refuses);
  // Refusing is only worth anything if it also refuses to write: the file the
  // user can still recover from must be exactly the file they had.
  assert.deepEqual(
    JSON.parse(fs.readFileSync(withOldFieldBroken.storePath, 'utf8')).settings.hydrationEvery,
    0
  );

  // Same gate, reached through one of the fields schema 9 introduced. A routine
  // window of 999 minutes normalizes away, and that difference has to be loud
  // rather than absorbed into a default.
  const brokenRoutine = structuredClone(canonical);
  brokenRoutine.routines = [{
    id: 'routine-medication',
    title: '吃药',
    kind: 'medication',
    schedule: {
      rule: { frequency: 'daily', interval: 1, weekdays: null, strategy: 'fixed', anchorDate: '2026-09-01' },
      timesOfDay: ['08:30'],
      windowMinutes: 999
    },
    effect: null,
    maxLevel: 2,
    active: true,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000
  }];
  const withNewFieldBroken = withTempStore(t, brokenRoutine);
  assert.throws(() => openStore(withNewFieldBroken.storePath), refuses);

  // Duplicate identities are the one class of corruption the normalizer refuses
  // outright rather than by comparison, because there is no honest repair: the
  // two rows disagree and nothing in the file says which one is real.
  const duplicated = structuredClone(canonical);
  duplicated.tasks = [...duplicated.tasks, structuredClone(duplicated.tasks[0])];
  const withDuplicateIds = withTempStore(t, duplicated);
  assert.throws(() => openStore(withDuplicateIds.storePath), /Duplicate persisted task id/);
});

test('a store from a newer schema is refused rather than downgraded', t => {
  const { canonical } = schema8Snapshot();
  const fromTheFuture = { ...structuredClone(canonical), schemaVersion: PERSISTED_SCHEMA_VERSION + 1 };
  const { storePath } = withTempStore(t, fromTheFuture);
  const original = fs.readFileSync(storePath);

  assert.throws(() => openStore(storePath), /newer than this app supports/);
  assert.throws(
    () => storeMigration.prepareStoreMigration(storePath, PERSISTED_SCHEMA_VERSION),
    /newer than this app supports/
  );
  assert.deepEqual(fs.readFileSync(storePath), original);
});

test('every default setting is a value the preferences codec accepts', () => {
  // The codec's terminal branch exists because a new default used to be
  // accepted, dropped from the decoded patch, and turn the whole update into a
  // silent no-op. This is the test that branch was written for: a key added to
  // `DEFAULT_SETTINGS` without a validator fails here, at the moment it is added.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const result = validateIpcPayload('settings:update', { [key]: value });
    assert.equal(result.ok, true, `${key}: ${result.ok ? '' : result.error.message}`);
    assert.deepEqual(result.value, { [key]: value }, key);
  }
});
