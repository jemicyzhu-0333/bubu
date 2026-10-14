'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const { routineLogging, logRoutineOccurrence, dayPlan, ipcRoutes } = require('../src/capabilities/routines');
const { normalizePersistedState, assertCanonicalPersistedState } = require('../src/platform/persistence/persisted-schema');
const { localDayKey, addDaysToKey } = require('../src/core/calendar');
const { buildEnergyCurveView } = require('../src/application/queries/energy-curve-view');

const instant = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
function fixture({ publish = () => {} } = {}) {
  let now = instant(13, 12), revision = 0;
  let state = normalizePersistedState({ routines: [{ id: 'coffee', title: '咖啡', kind: 'stimulant', schedule: null,
    active: true, createdAt: instant(12, 0), updatedAt: instant(12, 0) }] }, { now });
  const facts = [], contexts = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: (candidate, context) => {
      assertCanonicalPersistedState(candidate);
      contexts.push(context); state = structuredClone(candidate); revision++; return structuredClone(state);
    } };
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({ unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => now, dayKey: localDayKey }, publish: fact => { facts.push(fact); publish(fact); } });
  return { command, facts, contexts, read: () => structuredClone(state), revision: () => revision,
    setNow: value => { now = value; } };
}
function correction(log, expectedAt, at) {
  return { routineId: 'coffee', occurrenceId: log.occurrenceId, status: 'done', expectedStatus: 'done', expectedAt, at };
}

test('time correction keeps occurrence identity, note and magnitude, commits once and is safely retryable', () => {
  const f = fixture(), at = instant(13, 11);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at, note: '本人备注', magnitude: 35 });
  f.command.log({ routineId: 'coffee', status: 'done', at: instant(13, 11, 30) });
  const request = correction(first, at, instant(13, 11, 45));
  assert.equal(f.command.log(request).ok, true);
  const entries = f.read().routineLog.days[0].entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1].occurrenceId, first.occurrenceId);
  assert.equal(entries[1].note, '本人备注'); assert.equal(entries[1].magnitude, 35);
  assert.equal(f.facts.at(-1).at, request.at);
  assert.equal(f.contexts.at(-1).now, instant(13, 12));
  const revision = f.revision();
  assert.equal(f.command.log(request).changed, false);
  assert.equal(f.revision(), revision); assert.equal(f.facts.length, revision);
  assert.equal(f.command.log({ ...request, at: instant(13, 10) }).reason, 'target-changed');
  assert.equal(f.revision(), revision);
});

test('cross-day corrections retain the owner bucket but move the day plan and energy marker', () => {
  const f = fixture(), at = instant(13, 0, 5), correctedAt = instant(12, 23, 30);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at });
  assert.equal(f.command.log(correction(first, at, correctedAt)).ok, true);
  const snapshot = f.read(), today = localDayKey(at), yesterday = localDayKey(correctedAt);
  assert.equal(snapshot.routineLog.days[0].dayKey, today);
  assert.equal(snapshot.routineLog.days[0].entries[0].occurrenceId, first.occurrenceId);
  const plan = key => dayPlan.buildDayPlan({ routines: snapshot.routines, routineLog: snapshot.routineLog,
    dayKey: key, now: instant(13, 12) });
  assert.equal(plan(today).counts.done, 0);
  assert.equal(plan(yesterday).counts.done, 1);
  const view = key => buildEnergyCurveView({ snapshot, settings: snapshot.settings, dayKey: key, now: instant(13, 12) });
  assert.equal(view(today).marks.length, 0);
  assert.equal(view(yesterday).marks.length, 1);
  assert.equal(view(yesterday).marks[0].minute, 23 * 60 + 30);
});

test('future, out-of-window, missing and stale answers are rejected without any commit', () => {
  const f = fixture(), at = instant(13, 11);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at });
  for (const [candidate, reason] of [[instant(13, 12, 1), 'occurrence-in-future'],
    [instant(11, 23, 59), 'occurrence-outside-window'], [NaN, 'invalid-occurrence-time']]) {
    assert.equal(f.command.log(correction(first, at, candidate)).reason, reason);
  }
  assert.equal(f.command.log({ ...correction(first, at, instant(13, 10)), occurrenceId: 'missing' }).reason, 'occurrence-not-found');
  assert.equal(f.command.log({ ...correction(first, at, instant(13, 10)), expectedStatus: 'skipped', status: 'skipped' }).reason, 'target-changed');
  assert.equal(f.revision(), 1);
  f.setNow(instant(15, 12));
  assert.equal(f.command.log(correction(first, at, instant(15, 11))).reason, 'occurrence-outside-window');
  assert.equal(f.revision(), 1);
});

test('corrections cannot forge machine statuses, replace note or omit the compare-and-swap identity', () => {
  const route = ipcRoutes.find(item => item.channel === 'routines:log');
  const valid = { routineId: 'coffee', occurrenceId: 'coffee:2026-10-13:free:0', status: 'done',
    at: instant(13, 10), expectedAt: instant(13, 11), expectedStatus: 'done' };
  assert.equal(route.decode(valid).ok, true);
  for (const bad of [{ expectedAt: undefined }, { expectedStatus: undefined }, { occurrenceId: undefined },
    { status: 'notified', expectedStatus: 'notified' }, { at: new Date(valid.at).toISOString() }, { note: 'overwrite' },
    { magnitude: 100 }, { recordedAt: valid.at }]) assert.equal(route.decode({ ...valid, ...bad }).ok, false);
});

test('scheduled corrections close the original slot without double-counting another actual day', () => {
  const now = instant(13, 12), today = localDayKey(now), yesterday = addDaysToKey(today, -1);
  const occurrenceId = `coffee:${today}:09:00`;
  const state = { routines: [{ id: 'coffee', kind: 'stimulant', active: true,
    schedule: { frequency: 'daily', timesOfDay: ['09:00'], windowMinutes: 60 } }],
  routineLog: { days: [{ dayKey: today, entries: [{ routineId: 'coffee', occurrenceId, status: 'done', at: instant(13, 9) }] }] } };
  assert.equal(routineLogging.correctOccurrenceTime(state, { ...correction({ occurrenceId }, instant(13, 9), instant(12, 23)),
    now, today, dayKey: yesterday }).ok, true);
  const todayPlan = dayPlan.buildDayPlan({ ...state, dayKey: today, now: instant(13, 9, 30) });
  assert.equal(todayPlan.counts.done, 0); assert.equal(todayPlan.counts.due, 0);
  const yesterdayPlan = dayPlan.buildDayPlan({ ...state, dayKey: yesterday, now });
  assert.equal(yesterdayPlan.counts.done, 1);
});

test('the two-local-day boundary handles DST without a fixed 24/48-hour approximation', () => {
  const timeZone = 'America/New_York';
  const dayKey = at => localDayKey(at, { timeZone });
  const validate = (nowText, atText) => {
    const now = Date.parse(nowText), at = Date.parse(atText);
    return routineLogging.validateOccurrenceTime({ now, at, today: dayKey(now), dayKey: dayKey(at) });
  };
  assert.equal(validate('2026-11-02T23:50:00-05:00', '2026-11-01T00:10:00-04:00').ok, true);
  assert.equal(validate('2026-03-09T00:10:00-04:00', '2026-03-07T23:50:00-05:00').reason, 'occurrence-outside-window');
});

test('a committed time correction CAS moves the SQLite timeline row and stale replay cannot move it back', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
  const { recordTimeline } = require('../src/capabilities/progress');
  const { createRoutineTimelineEffects } = require('../src/application/effects/routine-timeline-effects');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-time-'));
  const db = openDatabase({ filePath: path.join(dir, 'facts.sqlite'), driver: 'node:sqlite' });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const publications = [];
  const effects = createRoutineTimelineEffects({ timelineRecorder: recordTimeline.createTimelineRecorder({ timeline: db.timeline }),
    publish: dirty => publications.push(dirty) });
  const f = fixture({ publish: effects.publishCommitted });
  const at = instant(13, 0, 5), correctedAt = instant(12, 23, 45);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at });
  assert.equal(db.timeline.readDay(localDayKey(at)).length, 1);
  assert.equal(f.command.log(correction(first, at, correctedAt)).ok, true);
  assert.equal(db.timeline.readDay(localDayKey(at)).length, 0);
  const rows = db.timeline.readDay(localDayKey(correctedAt));
  assert.equal(rows.length, 1); assert.equal(rows[0].occurredAt, correctedAt);
  assert.equal(rows[0].payload.occurrenceId, first.occurrenceId); assert.equal(rows[0].entityVersion, '2');
  assert.equal(f.command.log(correction(first, at, instant(13, 0, 1))).reason, 'target-changed');
  assert.deepEqual(db.timeline.readDay(localDayKey(correctedAt)), rows);
  assert.equal(publications.length, 2); assert.equal(publications[1].energy, true);
  assert.equal(f.command.undo({ occurrenceId: first.occurrenceId }).ok, true);
  assert.equal(db.timeline.readDay(localDayKey(correctedAt)).length, 0);
});

test('schema20 strict commits preserve three owner buckets after correction, midnight, reopen and undo', () => {
  const f = fixture(), oldAt = instant(12, 23, 30);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at: oldAt });
  assert.equal(f.command.log(correction(first, oldAt, instant(13, 11))).ok, true);
  assert.equal(f.command.log({ routineId: 'coffee', status: 'done', at: instant(13, 11, 30) }).ok, true);
  f.setNow(instant(14, 0, 30));
  assert.equal(f.command.log({ routineId: 'coffee', status: 'done', at: instant(14, 0, 20) }).ok, true);
  const snapshot = f.read();
  assert.equal(snapshot.routineLog.days.length, 3);
  routineLogging.rollLogForward(snapshot, { today: localDayKey(instant(14, 12)) });
  assert.equal(snapshot.routineLog.days.length, 3);
  assertCanonicalPersistedState(snapshot);
  assert.deepEqual(normalizePersistedState(snapshot, { now: instant(14, 12) }), snapshot);
  // A new command on a reopened canonical snapshot still finds the old owner ID.
  let reopened = structuredClone(snapshot), revision = f.revision();
  const repository = { snapshot: () => structuredClone(reopened), revision: () => revision,
    commit: candidate => { assertCanonicalPersistedState(candidate); reopened = structuredClone(candidate); revision++;
      return structuredClone(reopened); } };
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({ unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => instant(14, 0, 30), dayKey: localDayKey } });
  assert.equal(command.log(correction(first, instant(13, 11), instant(14, 0, 25))).ok, true);
  assert.equal(command.log(correction(first, instant(14, 0, 25), instant(13, 23, 50))).ok, true);
  assert.equal(command.undo({ occurrenceId: first.occurrenceId }).ok, true);
  assert.equal(reopened.routineLog.days.flatMap(day => day.entries).some(item => item.occurrenceId === first.occurrenceId), false);
});

test('explicit at cannot bypass terminal-answer CAS while new records, reminder answers and exact replay remain valid', () => {
  const f = fixture(), at = instant(13, 11);
  const first = f.command.log({ routineId: 'coffee', status: 'done', at });
  const before = f.read(), revision = f.revision(), facts = f.facts.length;
  assert.equal(f.command.log({ routineId: 'coffee', occurrenceId: first.occurrenceId,
    status: 'done', at: instant(13, 10) }).reason, 'invalid-occurrence-correction');
  assert.deepEqual(f.read(), before); assert.equal(f.revision(), revision); assert.equal(f.facts.length, facts);
  assert.equal(f.command.log({ routineId: 'coffee', occurrenceId: first.occurrenceId, status: 'done', at }).changed, false);
  // Legacy status taps omit at and still let the user change their answer.
  assert.equal(f.command.log({ routineId: 'coffee', occurrenceId: first.occurrenceId, status: 'skipped' }).ok, true);
  const occurrenceId = 'coffee:2026-10-13:free:1';
  assert.equal(f.command.recordNotified({ routineId: 'coffee', occurrenceId, at: instant(13, 11, 30) }).ok, true);
  assert.equal(f.command.log({ routineId: 'coffee', occurrenceId, status: 'done', at: instant(13, 11, 45) }).ok, true);
});
