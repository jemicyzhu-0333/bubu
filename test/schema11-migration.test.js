'use strict';

// Schema 11 is additive: two bounded, local-only records (the wake time reported for a day, and the
// mood notes the person chose to keep). A schema-10 file must open with both empty, leave every other
// field exactly as it was, keep a byte-for-byte backup, and reopen without rewriting anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PERSISTED_SCHEMA_VERSION,
  normalizePersistedState
} = require('../src/platform/persistence/persisted-schema');
const { createElectronStoreAdapter: productionAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { trackStateAdapters } = require('../test-support/tracked-state-adapters');
const adapters = trackStateAdapters(productionAdapter);
function createElectronStoreAdapter(options) { return adapters.open(options); }
const storeMigration = require('../src/core/store-migration');
const {
  MAX_WAKE_DAYS, MAX_MOOD_NOTES, MAX_MOOD_TEXT, normalizeWakeTimes, normalizeMoodNotes
} = require('../src/core/wellbeing');

const NOW = 1_764_000_000_000;

function tempStore(t, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuspix-schema11-'));
  t.after(() => { adapters.closeDirectory(directory); fs.rmSync(directory, { recursive: true, force: true }); });
  const storePath = path.join(directory, 'config.json');
  fs.writeFileSync(storePath, `${JSON.stringify(contents, null, 2)}\n`);
  return storePath;
}

// The adapter assigns `driver.store = …`; an accessor over the file makes a byte comparison meaningful.
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

function schema10Snapshot() {
  const canonical = normalizePersistedState({
    tasks: [{ id: 'task-1', title: '写周报', createdAt: NOW - 1000 }],
    impulses: [{ id: 'imp-1', text: '好困', createdAt: NOW - 500 }],
    energySignals: [],
    xp: 42
  }, { now: NOW });
  const snapshot = structuredClone(canonical);
  snapshot.schemaVersion = 10;
  delete snapshot.wakeTimes;
  delete snapshot.moodNotes;
  return { canonical, snapshot };
}

test('schema 10 opens with the schema-11 records empty, everything else untouched, and a byte-for-byte backup', t => {
  const { canonical, snapshot } = schema10Snapshot();
  const storePath = tempStore(t, snapshot);
  const original = fs.readFileSync(storePath);

  const first = openStore(storePath);
  assert.equal(first.migration.sourceVersion, 10);
  assert.equal(first.migration.backupPath, `${storePath}.schema-10-to-${PERSISTED_SCHEMA_VERSION}.backup`);
  assert.equal(first.migration.backupCreated, true);
  assert.deepEqual(fs.readFileSync(first.migration.backupPath), original);

  const migrated = first.snapshot();
  assert.equal(migrated.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.deepEqual(migrated.wakeTimes, {});
  assert.deepEqual(migrated.moodNotes, []);
  assert.deepEqual(migrated, canonical, 'no field other than the two new ones may change');
  assert.equal(migrated.impulses[0].text, '好困');
  assert.equal(migrated.xp, 42);

  const bytes = fs.readFileSync(storePath);
  const second = openStore(storePath);
  assert.equal(second.migration.sourceVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(second.migration.backupCreated, false);
  assert.deepEqual(fs.readFileSync(storePath), bytes, 'reopening must not rewrite the file');
});

test('a current-schema file with malformed records is refused, not silently rewritten', t => {
  const { canonical } = schema10Snapshot();
  for (const [label, patch] of [
    ['a mood note without text', { moodNotes: [{ id: 'm1', at: NOW, text: '' }] }],
    ['a wake time after 14:00', { wakeTimes: { '2026-09-29': 900 } }],
    ['a wake time that is not a whole number', { wakeTimes: { '2026-09-29': 7.5 } }]
  ]) {
    const storePath = tempStore(t, { ...structuredClone(canonical), ...patch });
    const original = fs.readFileSync(storePath);
    assert.throws(() => openStore(storePath), /refusing to rewrite|failed validation/, label);
    assert.deepEqual(fs.readFileSync(storePath), original, `${label}: source bytes are the only copy`);
  }
});

test('wake times keep the newest 14 days, allow an explicit skip, and drop values that cannot be a wake time', () => {
  const raw = {};
  for (let day = 1; day <= 20; day += 1) raw[`2026-09-${String(day).padStart(2, '0')}`] = 6 * 60 + day;
  raw['2026-09-25'] = null;
  raw['not-a-day'] = 480;
  raw['2026-09-26'] = -5;
  raw['2026-09-27'] = 24 * 60;
  const kept = normalizeWakeTimes(raw);
  const days = Object.keys(kept);
  assert.equal(days.length, MAX_WAKE_DAYS);
  // 20 天里的 1–20 号加上 25 号（值为 null），按日期最新的 14 个：08–20 号和 25 号。
  assert.deepEqual([days[0], days[days.length - 2], days[days.length - 1]], ['2026-09-08', '2026-09-20', '2026-09-25']);
  assert.equal(kept['2026-09-25'], null, 'a skip is remembered so the question is not asked twice');
  assert.equal(kept['2026-09-26'], undefined);
  assert.equal(kept['2026-09-27'], undefined);
  assert.equal(kept['not-a-day'], undefined);
  assert.deepEqual(normalizeWakeTimes('nope'), {});
});

test('mood notes are bounded, deduplicated by id, ordered by time, and never longer than the limit', () => {
  const notes = [];
  for (let index = 0; index < MAX_MOOD_NOTES + 20; index += 1) notes.push({ id: `m${index}`, at: 1000 + index, text: `第 ${index} 条` });
  notes.push({ id: 'm5', at: 9999, text: '重复的 id' });
  notes.push({ id: 'too-long', at: 1, text: 'x'.repeat(MAX_MOOD_TEXT + 1) });
  notes.push({ id: '', at: 1, text: '没有 id' });
  notes.push({ id: 'bad-time', at: -1, text: '负时间' });
  const kept = normalizeMoodNotes(notes);
  assert.equal(kept.length, MAX_MOOD_NOTES);
  assert.equal(kept[kept.length - 1].id, `m${MAX_MOOD_NOTES + 19}`);
  assert.ok(kept.every((note, index) => index === 0 || note.at >= kept[index - 1].at));
  assert.equal(kept.filter(note => note.id === 'm5').length, 0, 'm5 fell out of the newest 100, and the duplicate did not resurrect it');
  assert.equal(normalizeMoodNotes([{ id: ' a ', at: 5, text: '  留着  ' }])[0].text, '留着');
});
