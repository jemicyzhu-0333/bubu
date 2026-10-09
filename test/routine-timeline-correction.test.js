'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { timelineFacts, recordTimeline } = require('../src/capabilities/progress');
const { localDayKey } = require('../src/core/calendar');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-correction-'));
  const store = openDatabase({ filePath: path.join(dir, 'facts.sqlite'), driver: 'node:sqlite' });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(store.healthy, true);
  return store.timeline;
}
function fact(revision, status = 'done', at = new Date(2026, 9, 7, 0, 2).getTime()) {
  return timelineFacts.routineLoggedFacts({ revision, routineId: 'r', kind: 'movement',
    occurrenceId: 'r:2026-10-06:23:45', status, scheduled: true, loggedAt: at })[0];
}
test('routine correction atomically replaces status and reported time on one stable row', t => {
  const timeline = fixture(t), recorder = recordTimeline.createTimelineRecorder({ timeline });
  const first = fact(9), second = fact(10, 'skipped', first.occurredAt - 300000);
  assert.equal(timeline.upsertRoutineLogged(first).ok, true);
  assert.equal(timeline.upsertRoutineLogged(second).ok, true);
  assert.equal(timeline.readDay(first.dayKey).length, 0);
  const rows = timeline.readDay(second.dayKey);
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.status, 'skipped');
  assert.equal(rows[0].occurredAt, second.occurredAt); assert.equal(rows[0].entityVersion, '10');
  assert.equal(timeline.upsertRoutineLogged(first).ok, false);
  assert.equal(timeline.upsertRoutineLogged(second).verifiedDuplicate, true);
  assert.equal(timeline.upsertRoutineLogged(fact(10, 'done', second.occurredAt)).ok, false);
  assert.equal(recorder.recordRoutineLogUndone({ occurrenceId: first.payload.occurrenceId }).removed, 1);
  assert.equal(timeline.readDay(second.dayKey).length, 0);
});
test('correction is exclusive to valid routine identities and preserves ordinary first-write-wins', t => {
  const timeline = fixture(t), valid = fact(1);
  for (const invalid of [ { ...valid, kind: 'ai.change.confirmed' }, { ...valid, id: 'other' },
    { ...valid, payload: () => {} }, { ...valid, payload: Symbol('invalid') },
    { ...valid, entityVersion: null }, { ...valid, entityVersion: '1.2' },
    { ...valid, payload: { ...valid.payload, title: 'must not store' } } ]) {
    assert.equal(timeline.upsertRoutineLogged(invalid).ok, false);
  }
  assert.equal(timeline.append({ ...valid, kind: 'other' }).inserted, true);
  assert.equal(timeline.upsertRoutineLogged(valid).ok, false);
  assert.equal(timeline.append({ ...valid, payload: { status: 'changed' } }).inserted, false);
  assert.equal(timeline.readDay(localDayKey(valid.occurredAt))[0].kind, 'other');
});

test('real committed corrections move day markers while retaining canonical occurrence ownership', t => {
  const timeline = fixture(t);
  const { createUnitOfWork, createTimelineDayQuery } = require('../src/application');
  const { logRoutineOccurrence } = require('../src/capabilities/routines');
  const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
  const { createRoutineTimelineEffects } = require('../src/application/effects/routine-timeline-effects');
  let now = new Date(2026, 9, 6, 23, 50).getTime(), revision = 0;
  let state = normalizePersistedState({ routines: [{ id: 'r', title: 'Synthetic title never copied', kind: 'movement', active: true,
    createdAt: now - 3600000, updatedAt: now - 3600000,
    schedule: { frequency: 'daily', timesOfDay: ['23:45'], weekdays: [], windowMinutes: 120 } }] }, { now });
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: (candidate, context) => { state = normalizePersistedState(candidate, context); revision++; return structuredClone(state); } };
  const snapshots = [];
  const effects = createRoutineTimelineEffects({ timelineRecorder: recordTimeline.createTimelineRecorder({ timeline }),
    publish: dirty => snapshots.push({ dirty, rows: timeline.readDay(localDayKey(now)) }) });
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({ unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => now, dayKey: localDayKey }, publish: effects.publishCommitted });
  const request = { routineId: 'r', occurrenceId: 'r:2026-10-06:23:45' };
  assert.equal(command.log({ ...request, status: 'done' }).ok, true);
  now = new Date(2026, 9, 7, 0, 5).getTime();
  assert.equal(command.log({ ...request, status: 'skipped' }).ok, true);
  assert.equal(state.routineLog.days[0].dayKey, '2026-10-06');
  assert.equal(timeline.readDay('2026-10-06').length, 0);
  const query = createTimelineDayQuery({ timeline });
  const view = query.execute({ dayKey: '2026-10-07' });
  assert.equal(view.ok, true); assert.equal(view.day.markers[0].status, 'skipped');
  assert.equal(snapshots.at(-1).rows[0].payload.status, 'skipped');
  assert.equal(snapshots.at(-1).rows[0].entityVersion, '2');
  assert.equal(command.log({ ...request, status: 'done' }).ok, true);
  assert.equal(timeline.readDay('2026-10-07').length, 1);
  assert.equal(timeline.readDay('2026-10-07')[0].payload.status, 'done');
  assert.equal(command.undo({ occurrenceId: request.occurrenceId }).ok, true);
  assert.equal(timeline.readDay('2026-10-07').length, 0);
  assert.equal(command.log({ ...request, status: 'skipped' }).ok, true);
  assert.equal(timeline.readDay('2026-10-07')[0].entityVersion, '5');
  assert.equal(JSON.stringify(timeline.readDay('2026-10-07')).includes('Synthetic title'), false);
  assert.equal(state.xp, 0);
});

test('legacy null versions upgrade but malformed versions and private fields fail closed', t => {
  const timeline = fixture(t), first = fact(1);
  assert.equal(timeline.append({ ...first, entityVersion: null }).ok, true);
  assert.equal(timeline.upsertRoutineLogged(fact(2, 'skipped')).updated, true);
  timeline.remove(first.id);
  assert.equal(timeline.append({ ...first, entityVersion: 'not-a-number' }).ok, true);
  assert.equal(timeline.upsertRoutineLogged(fact(3)).ok, false);
  assert.equal(timeline.readDay(first.dayKey)[0].entityVersion, 'not-a-number');
  for (const invalid of [{ ...first, source: 'private note' },
    { ...first, payload: { ...first.payload, routineId: 'different' } },
    { ...first, payload: { ...first.payload, kind: { private: 'text' } } }]) {
    assert.equal(timeline.upsertRoutineLogged(invalid).ok, false);
  }
});

test('SQL update failure and a competing revision cannot partially replace a routine point', t => {
  const { DatabaseSync } = require('node:sqlite');
  const { runMigrations } = require('../src/platform/persistence/sqlite/migrations');
  const { createSqlTimelineRepository } = require('../src/platform/persistence/sqlite/timeline-repository');
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let fault = null;
  const handle = { exec: sql => db.exec(sql), userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
    setUserVersion: value => db.exec(`PRAGMA user_version=${value}`),
    get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => {
      if (sql.startsWith('UPDATE timeline_events SET occurred_at')) {
        if (fault === 'throw') throw new Error('injected write failure');
        if (fault === 'race') db.prepare('UPDATE timeline_events SET entity_version = ? WHERE id = ?').run('3', fact(1).id);
      }
      return db.prepare(sql).run(...params);
    } };
  runMigrations(handle);
  const timeline = createSqlTimelineRepository({ handle });
  const first = fact(1), next = fact(2, 'skipped', first.occurredAt + 60000);
  timeline.upsertRoutineLogged(first);
  fault = 'throw'; assert.equal(timeline.upsertRoutineLogged(next).ok, false);
  assert.equal(timeline.readDay(first.dayKey)[0].entityVersion, '1');
  assert.equal(timeline.readDay(first.dayKey)[0].payload.status, 'done');
  fault = 'race'; assert.equal(timeline.upsertRoutineLogged(next).reason, 'event-revision-conflict');
  assert.equal(timeline.readDay(first.dayKey)[0].entityVersion, '3');
  assert.equal(timeline.readDay(first.dayKey)[0].occurredAt, first.occurredAt);
});
