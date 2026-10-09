'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routineReminder, routineLogging } = require('../src/capabilities/routines');
const { localDayKey } = require('../src/core/calendar');
const { buildOccurrenceId } = require('../src/core/routine-model');

const DAY = '2026-10-07';
const at = (hour, minute = 0) => new Date(2026, 9, 7, hour, minute).getTime();
const id = (routineId = 'r1', time = '09:00', day = DAY) => buildOccurrenceId(routineId, day, time);
const emptyResult = { triggered: false, reminded: 0, missed: 0 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function routine(routineId = 'r1') {
  return {
    id: routineId, title: `Title ${routineId}`, kind: 'custom', active: true, maxLevel: 3,
    createdAt: at(0), updatedAt: at(0),
    schedule: { frequency: 'daily', weekdays: [], timesOfDay: ['09:00'], windowMinutes: 60 }
  };
}

function fixture(overrides = {}) {
  const state = { routines: [routine()], routineLog: { days: [] }, settings: {} };
  let current = at(9, 10);
  const calls = { remind: [], notified: [], missed: [] };
  const sampler = routineReminder.createRoutineReminder({
    now: () => current,
    dayKey: localDayKey,
    getRoutines: () => state.routines,
    getRoutineLog: () => state.routineLog,
    getSettings: () => state.settings,
    remind: request => { calls.remind.push(request); return { shown: true, level: 1 }; },
    recordNotified: input => {
      calls.notified.push(input);
      return routineLogging.noteReminded(state, { ...input, dayKey: localDayKey(input.at) });
    },
    recordMissed: input => calls.missed.push(input),
    ...overrides
  });
  return { state, sampler, calls, setTime: value => { current = value; } };
}

function fillDay(state, count = 60) {
  state.routineLog = { days: [{ dayKey: DAY, entries: Array.from({ length: count }, (_, index) => ({
    routineId: 'r1', occurrenceId: `r1:${DAY}:free:${index}`, status: 'done', at: at(9)
  })) }] };
}

test('overlapping samples share the identical promise and deliver only one of several due slots', async () => {
  const receipt = deferred();
  const f = fixture({ remind: () => receipt.promise });
  f.state.routines.push(routine('r2'));
  const first = f.sampler.sample();
  const second = f.sampler.sample();
  assert.equal(first, second);
  assert.equal(typeof first.then, 'function');
  await Promise.resolve();
  assert.equal(f.calls.notified.length, 0);
  receipt.resolve({ shown: true, level: 1 });
  assert.deepEqual(await first, { triggered: true, reminded: 1, missed: 0 });
  assert.equal(f.calls.notified.length, 1);
});

test('a delivery port that synchronously re-enters sampling sees the already installed shared promise', async () => {
  let nested;
  const f = fixture({ remind: () => { nested = f.sampler.sample(); return { shown: true, level: 1 }; } });
  const outer = f.sampler.sample();
  assert.equal((await outer).reminded, 1);
  assert.equal(nested, outer);
});

test('failed delivery slots rotate fairly and stop blocking after the guard clears', async () => {
  const attempts = [];
  let blocked = true;
  const f = fixture({ remind: request => {
    attempts.push(request.context.routineId);
    return { shown: !blocked, level: 1, reason: blocked ? 'higher-priority-active' : undefined };
  } });
  f.state.routines.push(routine('r2'), routine('r3'));
  for (let index = 0; index < 4; index += 1) assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.deepEqual(attempts, ['r1', 'r2', 'r3', 'r1']);
  blocked = false;
  assert.equal((await f.sampler.sample()).reminded, 1);
  assert.equal(attempts.at(-1), 'r2');
  assert.equal((await f.sampler.sample()).reminded, 1);
  assert.equal(attempts.at(-1), 'r3');
});

for (const receipt of [undefined, { shown: false }, { shown: false, reason: 'unsupported' },
  { shown: false, reason: 'failed' }, { shown: false, reason: 'timeout' },
  { shown: false, reason: 'superseded' }, { shown: true }, { shown: true, level: 4 }]) {
  test(`unconfirmed delivery never becomes a notified record: ${JSON.stringify(receipt)}`, async () => {
    const f = fixture({ remind: () => Promise.resolve(receipt) });
    assert.deepEqual(await f.sampler.sample(), emptyResult);
    assert.deepEqual(f.calls.notified, []);
    assert.deepEqual(f.state.routineLog.days, []);
  });
}

test('notified uses the actual delivery level and time after the wait, then suppresses the next sample', async () => {
  const receipt = deferred();
  const f = fixture({ remind: () => receipt.promise });
  const sample = f.sampler.sample();
  await Promise.resolve();
  f.setTime(at(9, 12));
  receipt.resolve({ shown: true, level: 2 });
  assert.equal((await sample).reminded, 1);
  assert.equal(f.calls.notified[0].level, 2);
  assert.equal(f.calls.notified[0].at, at(9, 12));
  assert.deepEqual(await f.sampler.sample(), emptyResult);
});

for (const mutation of ['done', 'skipped', 'deleted', 'muted', 'rescheduled', 'disabled', 'expired']) {
  test(`delivery wait rechecks canonical eligibility after ${mutation}`, async () => {
    const receipt = deferred();
    const f = fixture({ remind: () => receipt.promise });
    const sample = f.sampler.sample();
    await Promise.resolve();
    if (mutation === 'done' || mutation === 'skipped') {
      routineLogging.logOccurrence(f.state, { routineId: 'r1', occurrenceId: id(), status: mutation, dayKey: DAY, at: at(9, 11) });
    } else if (mutation === 'deleted') f.state.routines = [];
    else if (mutation === 'muted') f.state.routines[0].active = false;
    else if (mutation === 'rescheduled') f.state.routines[0].schedule.timesOfDay = ['11:00'];
    else if (mutation === 'disabled') f.state.settings.routineRemindersEnabled = false;
    else f.setTime(at(10) + 1);
    receipt.resolve({ shown: true, level: 1 });
    assert.deepEqual(await sample, emptyResult);
    assert.deepEqual(f.calls.notified, []);
    if (mutation === 'done' || mutation === 'skipped') assert.equal(f.state.routineLog.days[0].entries[0].status, mutation);
  });
}

test('day-full suppresses repeated presentation and resumes through the existing sample after capacity returns', async () => {
  const f = fixture();
  fillDay(f.state);
  for (let index = 0; index < 3; index += 1) assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.equal(f.calls.remind.length, 0);
  f.state.routineLog.days[0].entries.pop();
  assert.equal((await f.sampler.sample()).reminded, 1);
  assert.equal(f.calls.remind.length, 1);
  assert.equal(f.state.routineLog.days[0].entries.length, 60);
});

test('capacity filled during delivery creates no false success and suppresses further presentations', async () => {
  const receipt = deferred();
  let attempts = 0;
  const f = fixture({ remind: () => { attempts += 1; return receipt.promise; } });
  const sample = f.sampler.sample();
  await Promise.resolve();
  fillDay(f.state);
  receipt.resolve({ shown: true, level: 1 });
  assert.deepEqual(await sample, emptyResult);
  assert.equal(f.calls.notified.length, 0);
  assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.equal(attempts, 1);
});

for (const result of [{ ok: false, reason: 'day-full' }, { ok: true, changed: false }, undefined]) {
  test(`sampler consumes the writer's actual outcome: ${JSON.stringify(result)}`, async () => {
    const f = fixture({ recordNotified: () => result });
    assert.deepEqual(await f.sampler.sample(), emptyResult);
  });
}

test('a writer rejection after a capacity race remains suppressed while canonical capacity is full', async () => {
  let f;
  f = fixture({ recordNotified: input => {
    fillDay(f.state);
    return routineLogging.noteReminded(f.state, { ...input, dayKey: DAY });
  } });
  assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.equal(f.calls.remind.length, 1);
});

test('delivery and writer exceptions clear inFlight so later samples can retry', async () => {
  let failDelivery = true;
  let failWrite = true;
  const f = fixture({
    remind: () => { if (failDelivery) throw new Error('delivery failed'); return { shown: true, level: 1 }; },
    recordNotified: () => { if (failWrite) throw new Error('COMMIT failed'); return { ok: true, changed: true }; }
  });
  await assert.rejects(f.sampler.sample(), /delivery failed/);
  failDelivery = false;
  await assert.rejects(f.sampler.sample(), /COMMIT failed/);
  failWrite = false;
  assert.equal((await f.sampler.sample()).reminded, 1);
});

test('resolveRequest preserves a notified unanswered identity while rebuilding latest text and settings', async () => {
  const f = fixture();
  await f.sampler.sample();
  f.state.routines[0].title = 'Latest title';
  f.state.routines[0].maxLevel = 2;
  f.state.settings = { soundEnabled: true, nudgeWhitelist: ['meeting'], themePrimary: '#123456' };
  const request = f.sampler.resolveRequest({ routineId: 'r1', occurrenceId: id() });
  assert.equal(request.message, 'Latest title');
  assert.equal(request.maxLevel, 2);
  assert.equal(request.themePrimary, '#123456');
  assert.deepEqual(request.context, { routineId: 'r1', occurrenceId: id(), kind: 'custom' });
  f.state.settings.dnd = true;
  const quiet = f.sampler.resolveRequest(request.context);
  assert.equal(quiet.maxLevel, 1);
  assert.equal(quiet.soundEnabled, false);
  assert.deepEqual(quiet.whitelist, []);
});

test('resolveRequest captures one eligibility timestamp through an inclusive end boundary', () => {
  let current = at(10);
  const f = fixture({ now: () => current++ });
  const identity = { routineId: 'r1', occurrenceId: id() };
  assert.equal(f.sampler.resolveRequest(identity).resolvedAt, at(10));
  assert.equal(f.sampler.resolveRequest(identity), null);
});

test('resolveRequest refuses missing, wrong, answered, muted, deleted, and no-longer-scheduled identities', () => {
  const f = fixture();
  for (const input of [undefined, {}, { routineId: 'r1' }, { occurrenceId: id() },
    { routineId: 'r2', occurrenceId: id() }, { routineId: 'r1', occurrenceId: `r1:${DAY}:free:0` },
    { routineId: 'r1', occurrenceId: id('r1', '11:00') }]) assert.equal(f.sampler.resolveRequest(input), null);
  const identity = { routineId: 'r1', occurrenceId: id() };
  for (const change of [() => { f.state.settings.routineRemindersEnabled = false; },
    () => { f.state.routines[0].active = false; }, () => { f.state.routines[0].schedule = null; },
    () => { f.state.routines = []; }]) {
    f.state.settings = {};
    f.state.routines = [routine()];
    change();
    assert.equal(f.sampler.resolveRequest(identity), null);
  }
  for (const status of ['done', 'skipped', 'missed']) {
    f.state.routines = [routine()];
    f.state.routineLog = { days: [{ dayKey: DAY, entries: [{ ...identity, status, at: at(9) }] }] };
    assert.equal(f.sampler.resolveRequest(identity), null);
  }
});

test('a full bucket does not invalidate an already notified request or its existing-entry answer', async () => {
  const f = fixture();
  fillDay(f.state, 59);
  await f.sampler.sample();
  const identity = { routineId: 'r1', occurrenceId: id() };
  assert.ok(f.sampler.resolveRequest(identity));
  const result = routineLogging.logOccurrence(f.state, { ...identity, status: 'done', dayKey: DAY, at: at(9, 12) });
  assert.equal(result.ok, true);
  assert.equal(f.state.routineLog.days[0].entries.length, 60);
});

test('cross-midnight resolution preserves the original day through inclusive end, then expires at +1ms', async () => {
  const f = fixture();
  f.state.routines[0].schedule.timesOfDay = ['23:30'];
  const midnight = new Date(2026, 9, 8, 0, 0).getTime();
  f.setTime(midnight);
  const identity = { routineId: 'r1', occurrenceId: id('r1', '23:30') };
  assert.ok(f.sampler.resolveRequest(identity));
  assert.equal((await f.sampler.sample()).reminded, 1);
  assert.equal(f.state.routineLog.days[0].dayKey, DAY);
  f.setTime(midnight + 30 * 60000);
  assert.ok(f.sampler.resolveRequest(identity));
  f.setTime(midnight + 30 * 60000 + 1);
  assert.equal(f.sampler.resolveRequest(identity), null);
  assert.equal((await f.sampler.sample()).missed, 1);
  assert.equal((await f.sampler.sample()).missed, 0);
});

test('an unsupported presentation cannot witness a later missed occurrence', async () => {
  const f = fixture({ remind: () => ({ shown: false, reason: 'unsupported' }) });
  await f.sampler.sample();
  f.setTime(at(10) + 1);
  assert.deepEqual(await f.sampler.sample(), emptyResult);
  assert.deepEqual(f.calls.missed, []);
});

test('miss witnessing rechecks answers made while an earlier timeline port is pending', async () => {
  const firstMiss = deferred();
  const missed = [];
  const f = fixture({ recordMissed: input => { missed.push(input); return firstMiss.promise; } });
  f.state.routines.push(routine('r2'));
  for (const routineId of ['r1', 'r2']) {
    routineLogging.noteReminded(f.state, { routineId, occurrenceId: id(routineId), dayKey: DAY, at: at(9) });
  }
  f.setTime(at(10) + 1);
  const sample = f.sampler.sample();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(missed.length, 1);
  routineLogging.logOccurrence(f.state, { routineId: 'r2', occurrenceId: id('r2'), status: 'done', dayKey: DAY, at: at(10) + 2 });
  firstMiss.resolve();
  assert.equal((await sample).missed, 1);
  assert.equal(missed.length, 1);
});
