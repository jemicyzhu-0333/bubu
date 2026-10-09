'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { prepareStoreMigration } = require('../src/core/store-migration');
const {
  LIMITS,
  normalizeCompanionState,
  relationshipStage,
  companionRole,
  relationshipFor,
  incrementRelationship,
  addMilestone,
  addDiscovery,
  completeArc,
  appendRecent,
  setLastByFamily
} = require('../src/core/companion-state');

test('schema 6 migrates to the canonical current schema with the specified defaults', () => {
  const migrated = normalizePersistedState({ schemaVersion: 6, settings: {} }, { now: 1234 });
  assert.equal(PERSISTED_SCHEMA_VERSION, 18);
  // schema 11 的两份个人记录：老数据里没有，就是空的，不是缺字段。
  assert.deepEqual(migrated.wakeTimes, {});
  assert.deepEqual(migrated.moodNotes, []);
  assert.equal(migrated.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(migrated.settings.petActivityMode, 'balanced');
  assert.deepEqual(migrated.companion.relationships.dango, {
    firstMetAt: null, lastSeenAt: null, lastInteractionAt: null,
    bondPoints: 0, counters: {}, foodAffinity: {}, milestones: []
  });
  assert.deepEqual(migrated.companion.collection.activePackIds, ['builtin-core']);
  assert.deepEqual(normalizePersistedState(migrated, { now: 9999 }), migrated);
});

test('schema 6 is backed up byte-for-byte before schema 7 migration and backup failures stop startup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuspix-schema7-'));
  try {
    const storePath = path.join(directory, 'config.json');
    const bytes = '{\n  "schemaVersion": 6,\n  "xp": 9\n}\n';
    fs.writeFileSync(storePath, bytes);
    const migration = prepareStoreMigration(storePath, 7);
    assert.equal(migration.backupPath, `${storePath}.schema-6-to-7.backup`);
    assert.equal(fs.readFileSync(migration.backupPath, 'utf8'), bytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const fakeFs = {
    existsSync: target => !target.endsWith('.schema-6-to-7.backup'),
    readFileSync: () => JSON.stringify({ schemaVersion: 6 }),
    copyFileSync: () => { const error = new Error('read only'); error.code = 'EROFS'; throw error; }
  };
  assert.throws(() => prepareStoreMigration('/data/config.json', 7, { fs: fakeFs }), /Cannot back up/);
  assert.throws(() => prepareStoreMigration('/data/config.json', 7, {
    fs: { ...fakeFs, readFileSync: () => JSON.stringify({ schemaVersion: 8 }) }
  }), /newer than this app supports/);
});

test('current companion state rejects unknown keys, invalid IDs, bounds, and capacities', () => {
  const canonical = normalizeCompanionState();
  assert.throws(() => normalizeCompanionState({ ...canonical, extra: true }, { strict: true }), /unknown key/);
  assert.throws(() => normalizeCompanionState({
    ...canonical,
    relationships: { ...canonical.relationships, dango: { ...canonical.relationships.dango, counters: { 'Bad ID': 1 } } }
  }, { strict: true }), /invalid entry/);
  assert.throws(() => normalizeCompanionState({
    ...canonical,
    relationships: { ...canonical.relationships, dango: { ...canonical.relationships.dango, bondPoints: LIMITS.counters * 100_000 } }
  }, { strict: true }), /not canonical/);
  const tooMany = Object.fromEntries(Array.from({ length: LIMITS.counters + 1 }, (_, index) => [`counter-${index}`, index]));
  assert.throws(() => normalizeCompanionState({
    ...canonical,
    relationships: { ...canonical.relationships, dango: { ...canonical.relationships.dango, counters: tooMany } }
  }, { strict: true }), /exceeds capacity/);
});

test('recent remains an oldest-to-newest queue while maps and sets are canonical', () => {
  let companion = normalizeCompanionState({
    surprise: { recent: [
      { decisionId: 'decision-b', cueId: 'cue-b', familyId: 'family-a', finishedAt: 20, outcome: 'completed' },
      { decisionId: 'decision-a', cueId: 'cue-a', familyId: 'family-a', finishedAt: 10, outcome: 'cancelled' }
    ] },
    relationships: { dango: { milestones: ['z', 'a', 'z'], counters: { z: 1, a: 2 } } }
  });
  assert.deepEqual(companion.surprise.recent.map(item => item.decisionId), ['decision-b', 'decision-a']);
  assert.deepEqual(companion.relationships.dango.milestones, ['a', 'z']);
  assert.deepEqual(Object.keys(companion.relationships.dango.counters), ['a', 'z']);
  for (let index = 0; index < LIMITS.recent + 2; index++) {
    companion = appendRecent(companion, {
      decisionId: `d-${index}`, cueId: `c-${index}`, familyId: 'family-a',
      finishedAt: index, outcome: 'completed'
    });
  }
  assert.equal(companion.surprise.recent.length, LIMITS.recent);
  assert.equal(companion.surprise.recent[0].decisionId, 'd-2');
});

test('family cooldown eviction is timestamp-first and ID-deterministic', () => {
  let companion = normalizeCompanionState();
  for (let index = 0; index < LIMITS.lastByFamily; index++) {
    companion = setLastByFamily(companion, `family-${String(index).padStart(3, '0')}`, 100);
  }
  companion = setLastByFamily(companion, 'family-new', 200);
  assert.equal(companion.surprise.lastByFamily['family-000'], undefined);
  assert.equal(companion.surprise.lastByFamily['family-001'], 100);
  assert.equal(companion.surprise.lastByFamily['family-new'], 200);
});

test('durable records reject overflow and relationship progression is monotonic and derived', () => {
  let companion = normalizeCompanionState();
  companion = incrementRelationship(companion, { points: 12, counterId: 'tap', foodId: 'fish', at: 100 });
  companion = incrementRelationship(companion, { points: 28, counterId: 'tap', at: 90 });
  assert.equal(companion.relationships.dango.bondPoints, 40);
  assert.equal(companion.relationships.dango.firstMetAt, 90);
  assert.equal(companion.relationships.dango.lastInteractionAt, 100);
  assert.equal(relationshipStage(companion.relationships.dango.bondPoints), 'familiar');
  assert.throws(() => incrementRelationship(companion, { points: -1 }), /only increase/);

  companion.relationships.dango.milestones = Array.from({ length: LIMITS.milestones }, (_, index) => `m-${index}` ).sort();
  assert.throws(() => addMilestone(companion, 'another'), /capacity reached/);
  companion = normalizeCompanionState();
  companion.collection.completedArcIds = Array.from({ length: LIMITS.completedArcIds }, (_, index) => `arc-${index}`).sort();
  assert.throws(() => completeArc(companion, 'another'), /capacity reached/);
  companion = normalizeCompanionState();
  companion.collection.discoveries = Object.fromEntries(Array.from({ length: LIMITS.discoveries }, (_, index) => [`discovery-${index}`, index]));
  assert.throws(() => addDiscovery(companion, 'another', 999), /capacity reached/);
});

test('food affinity counts every feeding and milestones stay idempotent per stage', () => {
  let companion = normalizeCompanionState();
  for (const foodId of ['fish', 'cake', 'fish', 'milk', 'fish', 'cake']) {
    companion = incrementRelationship(companion, { points: 2, counterId: 'feed', foodId, at: 1_000 });
  }
  assert.deepEqual(companion.relationships.dango.foodAffinity, { cake: 2, fish: 3, milk: 1 });
  assert.equal(companion.relationships.dango.counters.feed, 6);
  assert.equal(companion.relationships.dango.bondPoints, 12);

  const ranked = Object.entries(companion.relationships.dango.foodAffinity)
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .slice(0, 3)
    .map(([id]) => id);
  assert.deepEqual(ranked, ['fish', 'cake', 'milk'], 'ties must break deterministically by identifier');

  companion = addMilestone(companion, 'bond-warming');
  const once = companion.relationships.dango.milestones.slice();
  companion = addMilestone(companion, 'bond-warming');
  assert.deepEqual(companion.relationships.dango.milestones, once, 'crossing the same stage twice records one milestone');

  // 默契只增不减：0 点累积合法（只记计数），负数直接报错
  const before = companion.relationships.dango.bondPoints;
  companion = incrementRelationship(companion, { points: 0, counterId: 'interaction', at: 2_000 });
  assert.equal(companion.relationships.dango.bondPoints, before);
  assert.equal(companion.relationships.dango.counters.interaction, 1);
  assert.throws(() => incrementRelationship(companion, { points: -5 }), /only increase/);
});

test('relationship stages use the thresholds the panel advertises', () => {
  assert.equal(relationshipStage(0), 'new');
  assert.equal(relationshipStage(11), 'new');
  assert.equal(relationshipStage(12), 'warming');
  assert.equal(relationshipStage(39), 'warming');
  assert.equal(relationshipStage(40), 'familiar');
  assert.equal(relationshipStage(99), 'familiar');
  assert.equal(relationshipStage(100), 'trusted');
  assert.equal(relationshipStage(10_000), 'trusted');
});


test('role relationships stay independent while shared claims survive role selection', () => {
  let state = normalizeCompanionState();
  state.bondDay = '2026-10-07'; state.bondClaims.advance = true;
  state = incrementRelationship(state, { role: 'usagi', points: 12, counterId: 'feed', foodId: 'carrot', at: 100 });
  state = addMilestone(state, 'bond-warming', 'usagi');
  assert.equal(relationshipFor(state, 'usagi').bondPoints, 12);
  assert.equal(relationshipFor(state, 'forest').bondPoints, 0);
  assert.deepEqual(state.relationships.usagi.milestones, ['bond-warming']);
  assert.deepEqual(state.relationships.dango.milestones, []);
  assert.equal(state.bondClaims.advance, true); assert.equal(state.bondDay, '2026-10-07');
  assert.equal(companionRole('usagi'), 'usagi'); assert.equal(companionRole('forest'), 'dango');
  assert.throws(() => incrementRelationship(state, { role: 'other' }), /role/);
  assert.throws(() => addMilestone(state, 'other', 'other'), /role/);
  assert.throws(() => incrementRelationship(state, { foodId: 'basic' }), /no affinity/);
  assert.deepEqual(normalizeCompanionState(state, { strict: true }), state);
});

test('a legacy singular relationship is never distributed into current roles', () => {
  const state = normalizeCompanionState({ relationship: { bondPoints: 100, milestones: ['legacy'] } });
  for (const role of ['dango', 'usagi']) {
    assert.equal(state.relationships[role].bondPoints, 0); assert.deepEqual(state.relationships[role].milestones, []);
  }
  assert.throws(() => normalizeCompanionState({ ...state, relationship: { bondPoints: 100 } }, { strict: true }), /unknown key/);
});
