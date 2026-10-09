'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createUnitOfWork, createRoutineTimelineEffects } = require('../src/application');
const { logRoutineOccurrence, dayPlan, routineReminder } = require('../src/capabilities/routines');
const { recordTimeline } = require('../src/capabilities/progress');
const { focusSession } = require('../src/capabilities/execution');
const { localDayKey } = require('../src/core/calendar');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');

const { registerNudgeActions } = require('../src/bootstrap/nudge-actions');

function fixture(t, { at = new Date(2026, 9, 7, 8, 5).getTime(), time = '08:00' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-action-'));
  const database = path.join(dir, 'config.sqlite');
  let now = at, failCommit = false, failPublish = false, rejectCommand = false;
  const repository = createSqliteStateAdapter({ userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => now,
    authorityFactory: options => openSqliteConfigAuthority(options, {
      selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
      makeHandle: ({ db, filePath }) => ({
        exec(sql) {
          if (failCommit && filePath === database && sql === 'COMMIT') {
            failCommit = false;
            throw new Error('synthetic pre-COMMIT failure');
          }
          return db.exec(sql);
        },
        run: (sql, args = []) => db.prepare(sql).run(...args),
        get: (sql, args = []) => db.prepare(sql).get(...args),
        all: (sql, args = []) => db.prepare(sql).all(...args),
        userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        setUserVersion: value => db.exec(`PRAGMA user_version=${value}`), close: () => db.close()
      })
    }) });
  const facts = openDatabase({ filePath: path.join(dir, 'facts.sqlite'), driver: 'node:sqlite' });
  t.after(() => { repository.close(); facts.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const initial = repository.snapshot();
  initial.routines = [{ id: 'routine', title: 'Synthetic private title', kind: 'movement', effect: null, active: true,
    createdAt: now - 172800000, updatedAt: now - 172800000, maxLevel: 1,
    schedule: { frequency: 'daily', timesOfDay: [time], weekdays: [], windowMinutes: 60 } }];
  initial.settings.routineRemindersEnabled = true;
  repository.commit(initial, { now });
  const publications = [], errors = [], writes = [];
  const effects = createRoutineTimelineEffects({ timelineRecorder: recordTimeline.createTimelineRecorder({ timeline: facts.timeline }),
    publish: dirty => {
      publications.push({ dirty, rows: facts.timeline.readDay(localDayKey(now)) });
      if (failPublish) throw new Error('synthetic publication failure');
    }, reportEffectError: error => errors.push(error.message) });
  const uow = createUnitOfWork({ repository });
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: { run(options) { writes.push(options.writes); return uow.run(options); } },
    clock: { now: () => now, dayKey: localDayKey }, publish: effects.publishCommitted,
    reportEffectError: error => errors.push(error.message)
  });
  const reminder = routineReminder.createRoutineReminder({ now: () => now, dayKey: localDayKey,
    getRoutines: () => repository.get('routines'), getRoutineLog: () => repository.get('routineLog'),
    getSettings: () => repository.get('settings'), remind: () => ({ shown: false }),
    recordNotified: command.recordNotified, recordMissed: effects.recordMissed });
  const resolveRoutineRequest = reminder.resolveRequest;
  let handler;
  const otherCalls = [];
  const ports = { nudge: { setActionHandler: value => { handler = value; } }, resolveRoutineRequest,
    logRoutineOccurrenceCommand: { log: input => rejectCommand ? { ok: false, reason: 'synthetic-refusal' } : command.log(input) },
    recordTaskAvoidance: input => otherCalls.push(input), readFocusSession: () => focusSession.createIdleSession(now),
    readNowTaskId: () => null, getSettings: () => repository.get('settings'), acceptHealthyShutdown: () => ({ ok: true }),
    stopFocusSession: () => ({ ok: true }), startRestSession: () => ({ ok: true }), startFocusSession: () => ({ ok: true }) };
  registerNudgeActions(ports);
  const row = dayPlan.dueOccurrences({ ...repository.snapshot(), dayKey: localDayKey(now), now })[0];
  const identity = { routineId: 'routine', occurrenceId: row.occurrenceId };
  return { repository, command, timeline: facts.timeline, publications, errors, writes, identity, ports, otherCalls,
    action: (actionId, context = identity, type = 'routine', deferMinutes) => handler({ actionId, context, type, deferMinutes }),
    setNow: value => { now = value; }, failCommit: () => { failCommit = true; },
    failPublish: () => { failPublish = true; }, rejectCommand: value => { rejectCommand = value; },
    update: change => { const state = repository.snapshot(); change(state); repository.commit(state, { now }); }
  };
}

for (const [action, status] of [['complete-routine', 'done'], ['skip-routine-today', 'skipped']]) {
  test(`registered ${action} commits only the exact occurrence before timeline/publication`, t => {
    const f = fixture(t);
    f.command.recordNotified({ ...f.identity, level: 1 });
    const before = f.repository.snapshot(), revision = f.repository.revision();
    const result = f.action(action);
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    const after = f.repository.snapshot();
    assert.equal(after.routineLog.days[0].entries[0].status, status);
    assert.deepEqual({ ...after, routineLog: before.routineLog }, before);
    assert.deepEqual(f.writes.at(-1), ['routineLog']);
    const rows = f.publications.at(-1).rows.filter(row => row.kind === 'routine.logged');
    assert.equal(rows.length, 1); assert.equal(rows[0].payload.status, status);
    assert.equal(rows[0].entityVersion, String(revision + 1));
    assert.equal(JSON.stringify(rows).includes('Synthetic private title'), false);
    assert.equal(f.action(action).ok, false, 'a duplicate cannot correct an already answered reminder');
    assert.equal(f.repository.revision(), revision + 1);
  });
}

test('missing, mismatched and noncanonical IDs cannot use the free logging path', t => {
  const f = fixture(t), before = f.repository.snapshot();
  for (const context of [null, {}, { routineId: 'routine' }, { occurrenceId: f.identity.occurrenceId },
    { ...f.identity, routineId: 'other' }, { ...f.identity, occurrenceId: 'routine:2026-10-07:free:0' },
    { ...f.identity, routineId: ' routine' }, { ...f.identity, occurrenceId: f.identity.occurrenceId + ' ' }]) {
    assert.equal(f.action('complete-routine', context).ok, false);
    assert.deepEqual(f.repository.snapshot(), before);
  }
});

for (const [reason, change] of [
  ['disabled', state => { state.settings.routineRemindersEnabled = false; }],
  ['muted', state => { state.routines[0].active = false; }],
  ['deleted', state => { state.routines = []; }],
  ['rescheduled', state => { state.routines[0].schedule.timesOfDay = ['10:00']; }]
]) {
  test(`registered routine action rejects a ${reason} target without writing`, t => {
    const f = fixture(t); f.update(change); const before = f.repository.snapshot();
    assert.equal(f.action('complete-routine').ok, false);
    assert.deepEqual(f.repository.snapshot(), before); assert.deepEqual(f.publications, []);
  });
}

test('expired reminder rejects but the exact inclusive end remains answerable', t => {
  const f = fixture(t); const end = new Date(2026, 9, 7, 9).getTime();
  f.setNow(end + 1); assert.equal(f.action('complete-routine').ok, false);
  f.setNow(end); assert.equal(f.action('complete-routine').ok, true);
  assert.equal(f.repository.get('routineLog').days[0].entries[0].at, end);
});

test('eligibility and log share one captured answer instant even if the clock crosses the end', t => {
  const f = fixture(t), end = new Date(2026, 9, 7, 9).getTime();
  const resolve = f.ports.resolveRoutineRequest;
  f.setNow(end);
  f.ports.resolveRoutineRequest = identity => { const request = resolve(identity); f.setNow(end + 1); return request; };
  registerNudgeActions(f.ports);
  assert.equal(f.action('complete-routine').ok, true);
  assert.equal(f.repository.get('routineLog').days[0].entries[0].at, end);
});

test('answering an existing notified occurrence still works in a full 60-entry day', t => {
  const f = fixture(t);
  f.command.recordNotified({ ...f.identity, level: 1 });
  f.update(state => {
    const entries = state.routineLog.days[0].entries;
    for (let index = 1; index < 60; index += 1) entries.push({ ...entries[0],
      occurrenceId: `routine:2026-10-07:free:${index}`, status: 'done' });
    entries.sort((left, right) => left.at - right.at || left.occurrenceId.localeCompare(right.occurrenceId));
  });
  assert.equal(f.repository.get('routineLog').days[0].entries.length, 60);
  assert.equal(f.action('complete-routine').ok, true);
  const entries = f.repository.get('routineLog').days[0].entries;
  assert.equal(entries.length, 60);
  assert.equal(entries.find(row => row.occurrenceId === f.identity.occurrenceId).status, 'done');
});

test('command rejection and real pre-COMMIT failure do not publish or consume the action', t => {
  const f = fixture(t), before = f.repository.snapshot(), revision = f.repository.revision();
  f.rejectCommand(true); assert.equal(f.action('complete-routine').reason, 'synthetic-refusal');
  f.rejectCommand(false); f.failCommit(); assert.throws(() => f.action('complete-routine'), /pre-COMMIT failure/);
  assert.deepEqual(f.repository.snapshot(), before); assert.equal(f.repository.revision(), revision);
  assert.deepEqual(f.publications, []);
  assert.equal(f.action('complete-routine').ok, true);
});

test('postcommit publication failure does not turn a committed action into a retry', t => {
  const f = fixture(t); f.failPublish();
  assert.equal(f.action('complete-routine').ok, true);
  assert.equal(f.repository.get('routineLog').days[0].entries[0].status, 'done');
  assert.deepEqual(f.errors, ['synthetic publication failure']);
  assert.equal(f.action('complete-routine').ok, false);
});

test('cross-midnight action owns the previous occurrence day and records the actual answer day', t => {
  const at = new Date(2026, 9, 7, 0, 5).getTime(), f = fixture(t, { at, time: '23:45' });
  assert.equal(f.action('skip-routine-today').ok, true);
  const log = f.repository.get('routineLog');
  assert.equal(log.days[0].dayKey, '2026-10-06');
  assert.equal(log.days[0].entries[0].at, at);
  const rows = f.timeline.readDay('2026-10-07');
  assert.equal(rows.length, 1); assert.equal(rows[0].occurredAt, at);
  assert.equal(rows[0].payload.occurrenceId, 'routine:2026-10-06:23:45');
  assert.deepEqual(f.timeline.readDay('2026-10-06'), []);
});

test('extracted action registration preserves both existing task-avoidance routes and focus fallback', t => {
  const f = fixture(t), starts = [];
  f.ports.readNowTaskId = () => 'selected-task';
  f.ports.startFocusSession = (...args) => { starts.push(args); return { ok: false, reason: 'start-refused' }; };
  registerNudgeActions(f.ports);
  f.action('defer-5', { kind: 'break-complete', taskId: 'deferred-task' }, 'focus', 5);
  f.action('dismiss', { taskId: 'dismissed-task' }, 'focus');
  assert.deepEqual(f.otherCalls, [{ taskId: 'deferred-task' }, { taskId: 'dismissed-task' }]);
  assert.equal(f.action('accept-focus', {}, 'focus').reason, 'start-refused');
  assert.deepEqual(starts, [['selected-task', f.repository.get('settings').pomodoroMinutes]]);
  assert.deepEqual(f.repository.get('routineLog').days, []);
});
