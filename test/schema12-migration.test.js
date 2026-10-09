'use strict';

// Schema 12 removes the consecutive-day counter. A schema-11 file that still carries `streak` and
// `stats.longestStreak` must open with both gone, keep every other field (including lastCompletedDate,
// which is the monotonic reward-day guard) exactly as it was, leave a byte-for-byte backup, and reopen
// without rewriting anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PERSISTED_SCHEMA_VERSION, normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
function createElectronStoreAdapter(options) { return productionAdapter(options); }
const storeMigration = require('../src/core/store-migration');

const NOW = 1_764_000_000_000;

function tempStore(t, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuspix-schema12-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'config.json');
  fs.writeFileSync(storePath, `${JSON.stringify(contents, null, 2)}\n`);
  return storePath;
}

function fileStoreClass(storePath) {
  return class FileStore {
    get store() { return fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : {}; }
    set store(value) { fs.writeFileSync(storePath, `${JSON.stringify(value, null, 2)}\n`); }
    get(key) { return this.store[key]; }
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

function schema11Snapshot() {
  const canonical = normalizePersistedState({
    xp: 120,
    level: 4,
    lastCompletedDate: '2026-09-27',
    tasks: [{ id: 'task-1', title: '写周报', createdAt: NOW - 1000 }],
    wakeTimes: { '2026-09-29': 540 },
    moodNotes: [{ id: 'mood-1', at: NOW - 500, text: '烦' }],
    stats: { totalTasksDone: 31, dailyCompletions: { '2026-09-27': 2 } }
  }, { now: NOW });
  const snapshot = structuredClone(canonical);
  snapshot.schemaVersion = 11;
  snapshot.streak = 9;
  snapshot.stats.longestStreak = 12;
  return { canonical, snapshot };
}

test('schema 11 drops the streak counters, keeps everything else, backs up byte for byte and is stable on reopen', t => {
  const { canonical, snapshot } = schema11Snapshot();
  const storePath = tempStore(t, snapshot);
  const original = fs.readFileSync(storePath);

  const first = openStore(storePath);
  assert.equal(first.migration.sourceVersion, 11);
  assert.equal(first.migration.backupPath, `${storePath}.schema-11-to-${PERSISTED_SCHEMA_VERSION}.backup`);
  assert.deepEqual(fs.readFileSync(first.migration.backupPath), original, 'the backup still holds the streak the person had');

  const migrated = first.snapshot();
  assert.equal(migrated.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal('streak' in migrated, false);
  assert.equal('longestStreak' in migrated.stats, false);
  assert.equal(migrated.lastCompletedDate, '2026-09-27', 'the reward-day guard is not a streak and stays');
  assert.deepEqual(migrated, canonical, 'nothing but the two counters may change');
  assert.equal(migrated.stats.totalTasksDone, 31);
  assert.deepEqual(migrated.wakeTimes, { '2026-09-29': 540 });

  const bytes = fs.readFileSync(storePath);
  const second = openStore(storePath);
  assert.equal(second.migration.sourceVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(second.migration.backupCreated, false);
  assert.deepEqual(fs.readFileSync(storePath), bytes, 'reopening must not rewrite the file');
});

test('a schema-10 file goes straight to 12 in one step with one backup', t => {
  const { canonical, snapshot } = schema11Snapshot();
  snapshot.schemaVersion = 10;
  delete snapshot.wakeTimes;
  delete snapshot.moodNotes;
  const storePath = tempStore(t, snapshot);
  const first = openStore(storePath);
  assert.equal(first.migration.sourceVersion, 10);
  assert.equal(first.migration.backupPath, `${storePath}.schema-10-to-${PERSISTED_SCHEMA_VERSION}.backup`);
  const migrated = first.snapshot();
  assert.equal('streak' in migrated, false);
  assert.deepEqual(migrated.wakeTimes, {});
  assert.deepEqual(migrated.moodNotes, []);
  assert.equal(migrated.xp, canonical.xp);
});

test('no source file outside the migration and its tests still reads or writes the removed counters', () => {
  const ROOT = path.resolve(__dirname, '..');
  const offenders = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      // 只看代码，不看解释它为什么被删的注释。
      const text = fs.readFileSync(full, 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
      if (/\b(?:state|snapshot|persisted|store)\.streak\b|\bcurrentStreakDays\b|\blongestStreak\b|store\.get\('streak'\)/.test(text)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'tools'));
  assert.deepEqual(offenders, []);
});
