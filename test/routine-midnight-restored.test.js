'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDayPlan, dueOccurrences, witnessedMissedOccurrences } = require('../src/capabilities/routines/domain/day-plan');
const { logOccurrence, noteReminded } = require('../src/capabilities/routines/domain/routine-logging');
const at = (day, time) => new Date(`${day}T${time}:00`).getTime();
function routine(overrides = {}) {
  return { id: 'r', title: 'Synthetic routine', active: true, kind: 'movement',
    createdAt: at('2025-01-01', '10:00'), updatedAt: at('2025-01-01', '10:00'),
    schedule: { frequency: 'daily', timesOfDay: ['23:45'], weekdays: [], windowMinutes: 60 }, ...overrides };
}
function state(r = routine()) { return { routines: [r], routineLog: { days: [] } }; }
function query(s, day, time) { return { ...s, dayKey: day, now: at(day, time) }; }
test('open previous-day window survives midnight and keeps one original identity', () => {
  const s = state();
  const rows = dueOccurrences(query(s, '2026-10-07', '00:05'));
  assert.deepEqual(rows.map(x => [x.occurrenceId, x.dayKey]), [['r:2026-10-06:23:45', '2026-10-06']]);
  assert.equal(buildDayPlan(query(s, '2026-10-07', '00:05')).counts.due, 1);
  assert.equal(dueOccurrences(query(s, '2026-10-07', '00:45')).length, 1);
  assert.equal(dueOccurrences(query(s, '2026-10-07', '00:46')).length, 0);
});
test('late reminder and answer write original day, never a new duplicate day', () => {
  const s = state(), request = { routineId: 'r', occurrenceId: 'r:2026-10-06:23:45',
    dayKey: '2026-10-07', at: at('2026-10-07', '00:05') };
  assert.equal(noteReminded(s, request).dayKey, '2026-10-06');
  assert.equal(dueOccurrences(query(s, '2026-10-07', '00:06')).length, 0);
  assert.equal(logOccurrence(s, { ...request, status: 'done' }).dayKey, '2026-10-06');
  const saved = structuredClone(s);
  assert.equal(noteReminded(s, { ...request, at: request.at + 1000 }).changed, false);
  assert.deepEqual(s, saved);
  assert.equal(s.routineLog.days.length, 1);
  assert.equal(s.routineLog.days[0].entries.length, 1);
  assert.equal(s.routineLog.days[0].entries[0].status, 'done');
});
test('expired, future, different-day and unscheduled previous IDs refuse without mutation', () => {
  for (const id of ['r:2026-10-06:20:00', 'r:2026-10-08:23:45', 'other:2026-10-06:23:45', 'r:2026-10-05:23:45', 'r:2026-10-06:free:0']) {
    const s = state(), saved = structuredClone(s);
    assert.equal(logOccurrence(s, { routineId: 'r', occurrenceId: id, status: 'done', dayKey: '2026-10-07', at: at('2026-10-07', '00:05') }).ok, false);
    assert.deepEqual(s, saved);
  }
  const s = state(), saved = structuredClone(s);
  assert.equal(logOccurrence(s, { routineId: 'r', occurrenceId: 'r:2026-10-06:23:45', status: 'done', dayKey: '2026-10-07', at: at('2026-10-07', '00:46') }).ok, false);
  assert.deepEqual(s, saved);
});
test('weekday and year carryover uses the scheduled day and refuses newly-created prior slots', () => {
  const s = state(routine({ schedule: { frequency: 'weekdays', timesOfDay: ['23:45'], weekdays: [], windowMinutes: 60 } }));
  assert.equal(dueOccurrences(query(s, '2026-10-10', '00:05')).length, 1);
  assert.equal(dueOccurrences(query(s, '2026-10-12', '00:05')).length, 0);
  assert.equal(dueOccurrences(query(state(), '2027-01-01', '00:05'))[0].dayKey, '2026-12-31');
  const fresh = state(routine({ createdAt: at('2026-10-07', '00:00') }));
  assert.equal(dueOccurrences(query(fresh, '2026-10-07', '00:05')).length, 0);
});
test('cross-midnight missed witness requires actual notification and appears once', () => {
  const s = state();
  assert.equal(witnessedMissedOccurrences(query(s, '2026-10-07', '00:46')).length, 0);
  noteReminded(s, { routineId: 'r', occurrenceId: 'r:2026-10-06:23:45', dayKey: '2026-10-06', at: at('2026-10-06', '23:50') });
  const rows = witnessedMissedOccurrences(query(s, '2026-10-07', '00:46'));
  assert.deepEqual(rows.map(x => x.occurrenceId), ['r:2026-10-06:23:45']);
});
test('calendar carryover remains the preceding local date across DST days', () => {
  const { spawnSync } = require('node:child_process');
  const modulePath = require.resolve('../src/capabilities/routines/domain/day-plan');
  const script = `
    const assert = require('node:assert/strict');
    const { dueOccurrences } = require(${JSON.stringify(modulePath)});
    for (const [day, previous] of [['2026-03-09','2026-03-08'], ['2026-11-02','2026-11-01']]) {
      const rows = dueOccurrences({ routines: [{ id:'r', active:true, createdAt:0,
        schedule:{frequency:'daily',timesOfDay:['23:45'],weekdays:[],windowMinutes:60} }],
        routineLog:{days:[]}, dayKey:day, now:new Date(day+'T00:05:00').getTime() });
      assert.equal(rows.length,1); assert.equal(rows[0].dayKey,previous);
      assert.equal(rows[0].occurrenceId,'r:'+previous+':23:45');
      assert.equal(rows[0].windowEndsAt-rows[0].scheduledAt,3600000);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('stored terminal missed status is not a fresh notified-and-unanswered witness', () => {
  const s = state();
  s.routineLog.days.push({ dayKey: '2026-10-06', entries: [{ routineId: 'r', occurrenceId: 'r:2026-10-06:23:45',
    status: 'missed', at: at('2026-10-06', '23:50'), note: null, magnitude: null }] });
  for (const time of ['00:05', '00:46']) {
    assert.deepEqual(witnessedMissedOccurrences(query(s, '2026-10-07', time)), []);
  }
});
