'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routineLogging, dayPlan } = require('../src/capabilities/routines');
const { localDayKey } = require('../src/core/calendar');
const { buildEnergyCurveView } = require('../src/application/queries/energy-curve-view');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const at = (day, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const key = day => localDayKey(at(day));
function entry(owner, sequence, time, status = 'done') {
  return { routineId: 'r', occurrenceId: `r:${key(owner)}:free:${sequence}`, status, at: time, note: null, magnitude: null };
}
function state(days) {
  return { routines: [{ id: 'r', kind: 'stimulant', title: 'fixture', active: true, schedule: null, createdAt: at(10) }],
    routineLog: { days } };
}
function bucket(owner, size, actual = owner, start = 0) {
  return { dayKey: key(owner), entries: Array.from({ length: size }, (_, i) => entry(owner, i, at(actual, 10, start + i))) };
}
function correct(draft, occurrence, timestamp, now) {
  return routineLogging.correctOccurrenceTime(draft, { routineId: 'r', occurrenceId: occurrence.occurrenceId,
    status: occurrence.status, expectedStatus: occurrence.status, expectedAt: occurrence.at,
    at: timestamp, now, today: localDayKey(now), dayKey: localDayKey(timestamp) });
}

test('old owner identities survive bidirectional corrections, third-owner writes and next-day actual retention', () => {
  const draft = state([bucket(12, 1)]), id = draft.routineLog.days[0].entries[0].occurrenceId;
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(13, 23, 30), at(13, 23, 45)).ok, true);
  assert.equal(routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', at: at(13, 23, 40), dayKey: key(13) }).ok, true);
  assert.equal(routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', at: at(14, 0, 10), dayKey: key(14) }).ok, true);
  assert.equal(draft.routineLog.days.length, 3);
  routineLogging.rollLogForward(draft, { today: key(14) });
  assert.equal(draft.routineLog.days.length, 3);
  assert.equal(draft.routineLog.days[0].entries[0].occurrenceId, id);
  const plan = dayPlan.buildDayPlan({ ...draft, dayKey: key(13), now: at(14, 0, 20), includeCarryover: false });
  assert.equal(plan.occurrences.filter(item => item.occurrenceId === id).length, 1);
  const snapshot = { ...normalizePersistedState({}, { now: at(14) }), ...draft };
  const view = buildEnergyCurveView({ snapshot, settings: snapshot.settings, dayKey: key(14), now: at(14, 0, 20) });
  assert.equal(view.attribution.some(item => item.source === 'routine'), true);
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(14, 0, 15), at(14, 0, 20)).ok, true);
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(13, 23, 50), at(14, 0, 20)).ok, true);
  assert.equal(routineLogging.undoOccurrence(draft, { occurrenceId: id }).ok, true);
  assert.equal(draft.routineLog.days.flatMap(day => day.entries).some(item => item.occurrenceId === id), false);
});

test('rollover expires entries by actual day within each owner bucket, preserving unknown and future facts', () => {
  const draft = state([{ dayKey: key(10), entries: [entry(10, 0, at(13)), entry(10, 1, at(12)), entry(10, 2, null)] },
    bucket(11, 1, 12), bucket(15, 1, 15)]);
  const result = routineLogging.rollLogForward(draft, { today: key(14) });
  assert.equal(result.changed, true); assert.deepEqual(result.droppedDayKeys, [key(11)]);
  assert.deepEqual(draft.routineLog.days[0].entries.map(item => item.at), [at(13), null]);
  assert.equal(draft.routineLog.days.at(-1).entries[0].at, at(15, 10));
  assert.equal(routineLogging.rollLogForward(draft, { today: key(14) }).changed, false);
});

test('actual-day admission counts across owner buckets and rejected moves preserve all facts', () => {
  const draft = state([bucket(11, 30, 13), bucket(12, 30, 13), bucket(13, 1, 12)]);
  const before = structuredClone(draft);
  assert.equal(routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', dayKey: key(13), at: at(13) }).reason, 'day-full');
  assert.equal(correct(draft, draft.routineLog.days[2].entries[0], at(13), at(13, 13)).reason, 'day-full');
  assert.deepEqual(draft, before);
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(13, 11), at(13, 13)).ok, true);
});

test('global 120-entry capacity and existing legacy actual-day overflow never truncate records', () => {
  const draft = state([bucket(11, 40, 13), bucket(12, 40, 13), bucket(13, 40, 12)]);
  const beforeCount = draft.routineLog.days.flatMap(day => day.entries).length;
  assert.equal(routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', dayKey: key(14), at: at(14) }).reason, 'log-full');
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(13, 11), at(13, 13)).ok, true);
  assert.equal(draft.routineLog.days.flatMap(day => day.entries).length, beforeCount);
  assert.equal(draft.routineLog.days.length, 3);
});

test('new free records never reuse an existing identity after an actual-date correction', () => {
  const draft = state([bucket(13, 1, 12)]);
  const first = draft.routineLog.days[0].entries[0].occurrenceId;
  const result = routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', dayKey: key(13), at: at(13) });
  assert.equal(result.ok, true); assert.notEqual(result.occurrenceId, first);
  const ids = draft.routineLog.days.flatMap(day => day.entries).map(item => item.occurrenceId);
  assert.equal(new Set(ids).size, ids.length);
});

test('an expired actual fact cannot be revived simply because its owner date is still recent', () => {
  const draft = state([bucket(13, 1, 12)]), before = structuredClone(draft);
  assert.equal(correct(draft, draft.routineLog.days[0].entries[0], at(13), at(14)).reason, 'occurrence-outside-window');
  assert.deepEqual(draft, before);
});

test('a new write removes empty owner buckets without dropping any existing identity', () => {
  const draft = state(Array.from({ length: 120 }, (_, index) => {
    const date = new Date(2026, 0, 1 + index);
    return { dayKey: localDayKey(date.getTime()), entries: [] };
  }));
  const result = routineLogging.logOccurrence(draft, { routineId: 'r', status: 'done', dayKey: key(13), at: at(13) });
  assert.equal(result.ok, true); assert.equal(draft.routineLog.days.length, 1);
  assert.equal(draft.routineLog.days[0].entries[0].occurrenceId, result.occurrenceId);
});

test('reminder sampling uses actual-day capacity across old owner buckets', async () => {
  const { routineReminder } = require('../src/capabilities/routines');
  const draft = state([bucket(11, 30, 13), bucket(12, 30, 13)]);
  draft.routines[0].schedule = { frequency: 'daily', timesOfDay: ['12:00'], weekdays: [], windowMinutes: 60 };
  let delivered = 0, notified = 0;
  const sampler = routineReminder.createRoutineReminder({ now: () => at(13, 12, 5), dayKey: localDayKey,
    getRoutines: () => draft.routines, getRoutineLog: () => draft.routineLog,
    getSettings: () => ({ routineRemindersEnabled: true }), remind: async () => { delivered++; return true; },
    recordNotified: () => { notified++; return { ok: true, changed: true }; }, recordMissed: () => {} });
  await sampler.sample();
  assert.equal(delivered, 0); assert.equal(notified, 0);
  assert.equal(draft.routineLog.days.flatMap(day => day.entries).length, 60);
});
