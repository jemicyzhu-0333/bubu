'use strict';

// ARCHITECTURE「日常与能量」's checks for the routine list, the log and today's plan. The two that
// matter most are here by name: a tap that paints as done must store exactly one
// entry (#12-adjacent), and undo must remove the bump rather than record a
// correction (#20). The rest guard the refusals — an unknown kind, a half-parsed
// schedule, a nudge surface reaching a channel it was never granted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const routines = require('../src/capabilities/routines');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { buildOccurrenceId, buildFreeOccurrenceId, MAX_ROUTINE_LEVEL, DEFAULT_ROUTINE_LEVEL } = require('../src/core/routine-model');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const timelineFacts = require('../src/capabilities/progress/domain/timeline-facts');

const { routineEditing, routineLogging, dayPlan, manageRoutine, logRoutineOccurrence, routineReminder } = routines;

const DAY = '2026-09-14';
const NOON = new Date(2026, 8, 14, 12, 0, 0, 0).getTime();

function at(hour, minute = 0) {
  return new Date(2026, 8, 14, hour, minute, 0, 0).getTime();
}

function draft(overrides = {}) {
  return normalizePersistedState(overrides, { now: NOON });
}

function routine(overrides = {}) {
  return {
    id: 'routine-1',
    title: '吃药',
    kind: 'medication',
    schedule: { frequency: 'daily', timesOfDay: ['09:00'], weekdays: [], windowMinutes: 60 },
    effect: { profileId: 'medication-default', amplitude: 18, durationMin: 480 },
    maxLevel: 2,
    active: true,
    createdAt: NOON,
    updatedAt: NOON,
    ...overrides
  };
}

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      state = normalizePersistedState(candidate, context);
      revision += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision })
  };
}

function ids() {
  let seq = 0;
  return () => {
    seq += 1;
    return `routine-${seq}`;
  };
}

test('adding a routine refuses an unknown kind and never maps it to a neighbour', () => {
  const state = draft();
  const idFactory = ids();
  assert.deepEqual(
    routineEditing.addRoutine(state, {
      title: '吃药', kind: 'vitamins', profiles: ROUTINE_EFFECT_PROFILES, idFactory, now: NOON
    }),
    { ok: false, reason: 'kind-unknown' }
  );
  assert.deepEqual(state.routines, []);
});

test('a half-parsed schedule collapses to no schedule instead of a daily default', () => {
  const state = draft();
  const added = routineEditing.addRoutine(state, {
    title: '散步',
    kind: 'movement',
    // No frequency: the normalizer's all-or-nothing rule has to hold here too,
    // because a daily fallback would invent a reminder nobody asked for.
    schedule: { timesOfDay: ['09:00'] },
    profiles: ROUTINE_EFFECT_PROFILES,
    idFactory: ids(),
    now: NOON
  });
  assert.equal(added.ok, true);
  assert.equal(state.routines[0].schedule, null);
});

test('a custom routine carries no effect, and editing a kind re-derives the curve', () => {
  const state = draft();
  const idFactory = ids();
  routineEditing.addRoutine(state, {
    title: '记一句', kind: 'custom', effect: { amplitude: 30 }, profiles: ROUTINE_EFFECT_PROFILES, idFactory, now: NOON
  });
  assert.equal(state.routines[0].effect, null);

  const changed = routineEditing.updateRoutine(state, {
    routineId: state.routines[0].id, patch: { kind: 'meal' }, profiles: ROUTINE_EFFECT_PROFILES, now: NOON + 1
  });
  assert.equal(changed.ok, true);
  assert.equal(state.routines[0].effect.profileId, 'meal-default');
  assert.equal(state.routines[0].effect.amplitude, ROUTINE_EFFECT_PROFILES.meal.amplitude);
});

test('an out-of-range amplitude clamps to the editable band rather than being rejected', () => {
  const state = draft();
  routineEditing.addRoutine(state, {
    title: '咖啡', kind: 'stimulant', effect: { amplitude: 900, durationMin: 1 },
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: ids(), now: NOON
  });
  const [low, high] = ROUTINE_EFFECT_PROFILES.stimulant.editable.amplitude;
  assert.equal(state.routines[0].effect.amplitude, high);
  assert.ok(state.routines[0].effect.amplitude >= low);
  assert.equal(state.routines[0].effect.durationMin, ROUTINE_EFFECT_PROFILES.stimulant.editable.durationMin[0]);
});

test('a patch that changes nothing reports no change, so the surface gets no redraw', () => {
  const state = draft({ routines: [routine()] });
  const result = routineEditing.updateRoutine(state, {
    routineId: 'routine-1', patch: { title: '吃药' }, profiles: ROUTINE_EFFECT_PROFILES, now: NOON + 5000
  });
  assert.deepEqual(result, { ok: true, changed: false, routineId: 'routine-1' });
  assert.equal(state.routines[0].updatedAt, NOON);
});

test('deleting a routine deletes its log entries, so nothing invisible keeps bumping the curve', () => {
  const state = draft({
    routines: [routine(), routine({ id: 'routine-2', title: '喝水', kind: 'custom', effect: null })],
    routineLog: {
      days: [{
        dayKey: DAY,
        entries: [
          { occurrenceId: buildOccurrenceId('routine-1', DAY, '09:00'), routineId: 'routine-1', status: 'done', at: at(9, 5), note: null, magnitude: null },
          { occurrenceId: buildFreeOccurrenceId('routine-2', DAY, 0), routineId: 'routine-2', status: 'done', at: at(10), note: null, magnitude: null }
        ]
      }]
    }
  });
  const result = routineEditing.removeRoutine(state, { routineId: 'routine-1' });
  assert.deepEqual(result, { ok: true, changed: true, routineId: 'routine-1', removedEntries: 1 });
  assert.deepEqual(state.routines.map(item => item.id), ['routine-2']);
  assert.deepEqual(state.routineLog.days[0].entries.map(entry => entry.routineId), ['routine-2']);
});

test('one tap writes exactly one entry, and re-reporting replaces it', () => {
  const state = draft({ routines: [routine()] });
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const first = routineLogging.logOccurrence(state, {
    routineId: 'routine-1', occurrenceId, status: 'done', dayKey: DAY, at: at(9, 3)
  });
  // `kind` and `scheduled` are reported, not stored (ARCHITECTURE「日常与能量」): the timeline row is
  // appended after the commit, and by then nothing can honestly re-derive either.
  assert.deepEqual(first, {
    ok: true, changed: true, occurrenceId, status: 'done', kind: 'medication', scheduled: true, dayKey: DAY, replaced: false
  });

  const again = routineLogging.logOccurrence(state, {
    routineId: 'routine-1', occurrenceId, status: 'skipped', dayKey: DAY, at: at(9, 9)
  });
  assert.equal(again.replaced, true);
  assert.equal(state.routineLog.days[0].entries.length, 1);
  assert.equal(state.routineLog.days[0].entries[0].status, 'skipped');

  const identical = routineLogging.logOccurrence(state, {
    routineId: 'routine-1', occurrenceId, status: 'skipped', dayKey: DAY, at: at(9, 9)
  });
  assert.deepEqual(identical, {
    ok: true, changed: false, occurrenceId, status: 'skipped', kind: 'medication', scheduled: true, dayKey: DAY
  });
});

test('an occurrence id belonging to another routine or day is refused, not rewritten', () => {
  const state = draft({ routines: [routine()] });
  for (const wrong of [
    buildOccurrenceId('routine-9', DAY, '09:00'),
    buildOccurrenceId('routine-1', '2026-09-13', '09:00'),
    'routine-1:2026-09-14:9:00'
  ]) {
    assert.deepEqual(
      routineLogging.logOccurrence(state, { routineId: 'routine-1', occurrenceId: wrong, status: 'done', dayKey: DAY, at: NOON }),
      { ok: false, reason: 'occurrence-mismatch' }
    );
  }
  assert.deepEqual(state.routineLog.days, []);
});

test('a free-form tap gets its own slot without inventing a scheduled time', () => {
  const state = draft({ routines: [routine({ schedule: null })] });
  const first = routineLogging.logOccurrence(state, { routineId: 'routine-1', status: 'done', dayKey: DAY, at: at(10) });
  const second = routineLogging.logOccurrence(state, { routineId: 'routine-1', status: 'done', dayKey: DAY, at: at(15) });
  assert.equal(first.occurrenceId, buildFreeOccurrenceId('routine-1', DAY, 0));
  assert.equal(second.occurrenceId, buildFreeOccurrenceId('routine-1', DAY, 1));
  assert.equal(state.routineLog.days[0].entries.length, 2);
  // The suffix shape is the only thing that knows this was not a scheduled slot,
  // and it is read exactly once — here is where that answer comes back out.
  assert.equal(first.scheduled, false);
  assert.equal(second.scheduled, false);
});

// ARCHITECTURE「日常与能量」 #20: undo has to take the bump away. A compensating entry would leave
// the curve holding both the mistake and its correction.
test('undo removes the entry rather than recording a correction', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const state = draft({
    routines: [routine()],
    routineLog: {
      days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'done', at: at(9, 2), note: null, magnitude: null }] }]
    }
  });
  const result = routineLogging.undoOccurrence(state, { occurrenceId });
  assert.deepEqual(result, { ok: true, changed: true, occurrenceId, routineId: 'routine-1', dayKey: DAY });
  assert.deepEqual(state.routineLog.days[0].entries, []);
  assert.deepEqual(routineLogging.undoOccurrence(state, { occurrenceId }), { ok: false, reason: 'occurrence-not-found' });
});

test('a rejected status stores nothing at all', () => {
  const state = draft({ routines: [routine()] });
  assert.deepEqual(
    routineLogging.logOccurrence(state, { routineId: 'routine-1', status: 'maybe', dayKey: DAY, at: NOON }),
    { ok: false, reason: 'status-unknown' }
  );
  assert.deepEqual(state.routineLog.days, []);
});

test("today's plan derives due, upcoming and missed from now and never stores them", () => {
  const state = draft({
    routines: [routine({ schedule: { frequency: 'daily', timesOfDay: ['09:00', '13:00', '21:00'], weekdays: [], windowMinutes: 60 } })]
  });
  const plan = dayPlan.buildDayPlan({ routines: state.routines, routineLog: state.routineLog, dayKey: DAY, now: at(13, 30) });
  const byTime = new Map(plan.occurrences.map(item => [item.timeOfDay, item]));
  assert.deepEqual([...byTime.keys()], ['09:00', '13:00', '21:00']);
  assert.equal(byTime.get('09:00').status, 'missed');
  assert.equal(byTime.get('13:00').due, true);
  assert.equal(byTime.get('13:00').status, null);
  assert.equal(byTime.get('21:00').upcoming, true);
  assert.deepEqual(plan.counts, { total: 3, done: 0, open: 2, due: 1 });
  // Derived, never written: the log is still empty after reading the plan.
  assert.deepEqual(state.routineLog.days, []);
});

test('a reminder that was only shown leaves the row open and answerable', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const state = draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] }
  });
  const plan = dayPlan.buildDayPlan({ routines: state.routines, routineLog: state.routineLog, dayKey: DAY, now: at(9, 30) });
  assert.equal(plan.occurrences[0].answered, false);
  assert.equal(plan.occurrences[0].due, true);
  assert.equal(plan.counts.open, 1);
});

test('weekly and weekdays schedules only appear on the days they name', () => {
  const monday = '2026-09-14';
  const saturday = '2026-09-19';
  const state = draft({
    routines: [
      routine({ id: 'routine-1', schedule: { frequency: 'weekdays', timesOfDay: ['09:00'], weekdays: [], windowMinutes: 60 } }),
      routine({ id: 'routine-2', title: '周会', kind: 'meeting', effect: null, schedule: { frequency: 'weekly', timesOfDay: ['10:00'], weekdays: [6], windowMinutes: 60 } })
    ]
  });
  const mondayPlan = dayPlan.buildDayPlan({ routines: state.routines, routineLog: state.routineLog, dayKey: monday, now: at(12) });
  const saturdayPlan = dayPlan.buildDayPlan({
    routines: state.routines, routineLog: state.routineLog, dayKey: saturday,
    now: new Date(2026, 8, 19, 12).getTime()
  });
  assert.deepEqual(mondayPlan.occurrences.map(item => item.routineId), ['routine-1']);
  assert.deepEqual(saturdayPlan.occurrences.map(item => item.routineId), ['routine-2']);
});

test('an inactive routine drops off the plan without losing what was already logged', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const state = draft({
    routines: [routine({ active: false })],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'done', at: at(9), note: null, magnitude: null }] }] }
  });
  const plan = dayPlan.buildDayPlan({ routines: state.routines, routineLog: state.routineLog, dayKey: DAY, now: at(12) });
  // The scheduled row is gone, but the answer the user gave is still drawn: a
  // stored answer the panel hides is the same failure as a tap that stored
  // nothing, seen from the other side.
  assert.deepEqual(plan.occurrences.map(item => item.scheduled), [false]);
  assert.equal(plan.occurrences[0].status, 'done');
});

test('the two commands declare the narrow write sets that keep routines out of the game layer', () => {
  assert.deepEqual([...manageRoutine.MANAGE_ROUTINE_WRITES], ['routines', 'routineLog']);
  assert.deepEqual([...logRoutineOccurrence.LOG_ROUTINE_OCCURRENCE_WRITES], ['routineLog']);
  for (const writes of [manageRoutine.MANAGE_ROUTINE_WRITES, logRoutineOccurrence.LOG_ROUTINE_OCCURRENCE_WRITES]) {
    for (const forbidden of ['xp', 'streak', 'level', 'pet', 'stats']) {
      assert.equal(writes.includes(forbidden), false, `${forbidden} must never be written by a routine`);
    }
  }
});

test('logging through the command commits once, publishes once and leaves xp and streak alone', () => {
  const repository = createRepository(draft({ routines: [routine()], xp: 120, streak: { current: 3, best: 5, lastDayKey: DAY } }));
  const facts = [];
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => at(9, 4), dayKey: () => DAY },
    publish: fact => facts.push(fact)
  });
  const before = repository.inspect().state;
  const result = command.log({ routineId: 'routine-1', occurrenceId: buildOccurrenceId('routine-1', DAY, '09:00'), status: 'done' });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.dayKey, DAY);
  const after = repository.inspect();
  assert.equal(after.revision, 1);
  assert.equal(after.state.routineLog.days[0].entries.length, 1);
  assert.equal(after.state.xp, before.xp);
  assert.deepEqual(after.state.streak, before.streak);
  assert.deepEqual(facts.map(fact => fact.type), ['routine-logged']);
  assert.equal(Object.isFrozen(facts[0]), true);
});

test('the log command reads the clock once, so a midnight tap cannot land in two days', () => {
  const repository = createRepository(draft({ routines: [routine({ schedule: null })] }));
  const reads = [];
  const midnight = new Date(2026, 8, 14, 23, 59, 59, 999).getTime();
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: {
      now: () => { reads.push('now'); return midnight; },
      dayKey: timestamp => { reads.push(timestamp); return DAY; }
    }
  });
  const result = command.log({ routineId: 'routine-1', status: 'done' });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, ['now', midnight]);
  assert.equal(repository.inspect().state.routineLog.days[0].entries[0].at, midnight);
});

test('the manage command defaults to the shipped profile table so the wiring stays pure wiring', () => {
  const repository = createRepository(draft());
  const command = manageRoutine.createManageRoutineCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOON },
    idFactory: ids()
  });
  const added = command.add({ title: '吃药', kind: 'medication' });
  assert.equal(added.ok, true);
  assert.equal(repository.inspect().state.routines[0].effect.profileId, 'medication-default');
});

test('a failed transition commits nothing and publishes nothing', () => {
  const repository = createRepository(draft());
  const facts = [];
  const command = manageRoutine.createManageRoutineCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOON },
    idFactory: ids(),
    publish: fact => facts.push(fact)
  });
  assert.deepEqual(command.update({ routineId: 'missing', patch: { title: 'x' } }), { ok: false, reason: 'routine-not-found' });
  assert.equal(repository.inspect().revision, 0);
  assert.deepEqual(facts, []);
});

test('the five channels validate their payloads and only logging is reachable from a reminder', () => {
  const routeFor = channel => routines.ipcRoutes.find(route => route.channel === channel) || null;
  for (const channel of ['routines:add', 'routines:update', 'routines:remove', 'routines:log', 'routines:undo-log']) {
    const route = routeFor(channel);
    assert.ok(route, `${channel} must be declared`);
    assert.equal(route.capability, 'routines');
    assert.equal(route.kind, 'command');
  }
  assert.deepEqual(allowedSurfacesFor('routines:log'), ['popover', 'nudgeCorner', 'nudgeFullscreen']);
  for (const channel of ['routines:add', 'routines:update', 'routines:remove', 'routines:undo-log']) {
    assert.deepEqual(allowedSurfacesFor(channel), ['popover'], `${channel} must not be reachable from a reminder`);
  }

  const add = routeFor('routines:add');
  assert.equal(add.decode({ title: '吃药', kind: 'medication', schedule: { frequency: 'daily', timesOfDay: ['09:00'] } }).ok, true);
  assert.equal(add.decode({ title: '吃药', kind: 'vitamins' }).ok, false);
  // `9:05` sorts after `10:00` as text, and text order is what occurrence ids
  // rely on, so an unpadded time is a rejection rather than a repair.
  assert.equal(add.decode({ title: '吃药', kind: 'medication', schedule: { frequency: 'daily', timesOfDay: ['9:05'] } }).ok, false);
  assert.equal(add.decode({ title: '吃药', kind: 'medication', dose: '20mg' }).ok, false);
  assert.equal(add.decode({ title: '吃药', kind: 'medication', effect: { onsetMin: 5 } }).ok, false);

  const update = routeFor('routines:update');
  assert.equal(update.decode({ routineId: 'routine-1', patch: { active: false } }).ok, true);
  assert.equal(update.decode({ routineId: 'routine-1', patch: {} }).ok, false);
  assert.equal(update.decode({ routineId: 'routine-1', patch: { createdAt: 1 } }).ok, false);

  const log = routeFor('routines:log');
  assert.equal(log.decode({ routineId: 'routine-1', status: 'done' }).ok, true);
  assert.equal(log.decode({ routineId: 'routine-1', status: 'done', magnitude: 40 }).ok, true);
  assert.equal(log.decode({ routineId: 'routine-1', status: 'done', magnitude: 0 }).ok, false);
  assert.equal(log.decode({ routineId: 'routine-1', status: 'done', mg: 200 }).ok, false);
  assert.equal(log.decode({ status: 'done' }).ok, false);

  assert.equal(routeFor('routines:undo-log').decode({ occurrenceId: 'routine-1:2026-09-14:09:00' }).ok, true);
  assert.equal(routeFor('routines:undo-log').decode({}).ok, false);
});

// ARCHITECTURE「日常与能量」 — the reminder half. The two derivations the panel and the sampler
// must agree on (dueOccurrences / witnessedMissedOccurrences), the `notified`
// writer that keeps a tick from re-raising and refuses to shout over an answer,
// the distinct `routine-reminded` fact the command publishes, the timeline
// builders' ids/payload shape, and the sampler that ties them together.

test('dueOccurrences raises a scheduled slot once, then goes quiet after the reminder is marked', () => {
  const state = draft({ routines: [routine()] });
  // In window, nothing logged yet: exactly the 09:00 slot is raiseable.
  const fresh = dayPlan.dueOccurrences({ routines: state.routines, routineLog: state.routineLog, dayKey: DAY, now: at(9, 30) });
  assert.deepEqual(fresh.map(item => item.occurrenceId), [buildOccurrenceId('routine-1', DAY, '09:00')]);
  assert.equal(fresh[0].kind, 'medication');

  // A stored `notified` entry sets loggedAt without answering, so the next tick
  // drops it: `loggedAt == null` is "not yet reminded", which is what stops a
  // 30-second tick from firing the same reminder every 30 seconds.
  const reminded = draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId: buildOccurrenceId('routine-1', DAY, '09:00'), routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] }
  });
  assert.deepEqual(dayPlan.dueOccurrences({ routines: reminded.routines, routineLog: reminded.routineLog, dayKey: DAY, now: at(9, 30) }), []);
});

test('witnessedMissedOccurrences fires only when a reminder was shown and then the window closed unanswered', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  // Reminder shown (notified stored), window since closed: a witnessed miss.
  const witnessed = draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] }
  });
  assert.deepEqual(
    dayPlan.witnessedMissedOccurrences({ routines: witnessed.routines, routineLog: witnessed.routineLog, dayKey: DAY, now: at(11) }).map(item => item.occurrenceId),
    [occurrenceId]
  );

  // Same closed window with NO stored reminder (the app was shut): the panel still
  // derives `missed` live, but this witness excludes it — loggedAt is null. Writing
  // "you missed your meds" for a day the app never watched is worse than nothing.
  const unwitnessed = draft({ routines: [routine()] });
  assert.deepEqual(dayPlan.witnessedMissedOccurrences({ routines: unwitnessed.routines, routineLog: unwitnessed.routineLog, dayKey: DAY, now: at(11) }), []);

  // An answered window is not a miss, even though a reminder had been shown.
  const answered = draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'done', at: at(9, 10), note: null, magnitude: null }] }] }
  });
  assert.deepEqual(dayPlan.witnessedMissedOccurrences({ routines: answered.routines, routineLog: answered.routineLog, dayKey: DAY, now: at(11) }), []);
});

test('noteReminded writes a notified mark once and never overwrites a prior mark', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const state = draft({ routines: [routine()] });

  const first = routineLogging.noteReminded(state, { routineId: 'routine-1', occurrenceId, dayKey: DAY, at: at(9) });
  assert.deepEqual(first, { ok: true, changed: true, occurrenceId, status: 'notified', kind: 'medication', scheduled: true, dayKey: DAY });
  assert.equal(state.routineLog.days[0].entries.length, 1);

  // A second tick finds the mark already there: no change, nothing appended, and
  // the original timestamp stands.
  const again = routineLogging.noteReminded(state, { routineId: 'routine-1', occurrenceId, dayKey: DAY, at: at(9, 1) });
  assert.deepEqual(again, { ok: true, changed: false, occurrenceId, status: 'notified', kind: 'medication', scheduled: true, dayKey: DAY });
  assert.equal(state.routineLog.days[0].entries.length, 1);
  assert.equal(state.routineLog.days[0].entries[0].at, at(9));
});

test('noteReminded refuses to shout over an answer the user already gave', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const state = draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'done', at: at(8, 55), note: null, magnitude: null }] }] }
  });
  // The stored `done` stands — a reminder is never louder than the user's own answer.
  assert.deepEqual(
    routineLogging.noteReminded(state, { routineId: 'routine-1', occurrenceId, dayKey: DAY, at: at(9) }),
    { ok: true, changed: false, occurrenceId, status: 'done', kind: 'medication', scheduled: true, dayKey: DAY }
  );
  assert.equal(state.routineLog.days[0].entries[0].status, 'done');
});

test('noteReminded refuses a forged occurrence id rather than rewriting it', () => {
  const state = draft({ routines: [routine()] });
  assert.deepEqual(
    routineLogging.noteReminded(state, { routineId: 'routine-1', occurrenceId: buildOccurrenceId('routine-9', DAY, '09:00'), dayKey: DAY, at: at(9) }),
    { ok: false, reason: 'occurrence-mismatch' }
  );
  assert.deepEqual(state.routineLog.days, []);
});

test('recordNotified commits a notified mark, publishes routine-reminded once, and leaves xp and streak alone', () => {
  const repository = createRepository(draft({ routines: [routine()], xp: 50, streak: { current: 2, best: 4, lastDayKey: DAY } }));
  const facts = [];
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => at(9, 1), dayKey: () => DAY },
    publish: fact => facts.push(fact)
  });
  const before = repository.inspect().state;
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const result = command.recordNotified({ routineId: 'routine-1', occurrenceId, level: 3, at: at(9, 1) });

  assert.deepEqual(result, { ok: true, changed: true, occurrenceId, dayKey: DAY });
  const after = repository.inspect();
  assert.equal(after.revision, 1);
  assert.equal(after.state.routineLog.days[0].entries[0].status, 'notified');
  // ARCHITECTURE「日常与能量」: being reminded is not a score. A DISTINCT fact type keeps the timeline's
  // logged lane free of things the app did rather than the user, and the game layer
  // is untouched.
  assert.equal(after.state.xp, before.xp);
  assert.deepEqual(after.state.streak, before.streak);
  assert.deepEqual(facts.map(fact => fact.type), ['routine-reminded']);
  assert.equal(facts[0].level, 3);
  assert.equal(facts[0].kind, 'medication');
  assert.equal(Object.isFrozen(facts[0]), true);
});

test('recordNotified on an already-marked occurrence commits nothing and publishes nothing', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const repository = createRepository(draft({
    routines: [routine()],
    routineLog: { days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] }
  }));
  const facts = [];
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => at(9, 1), dayKey: () => DAY },
    publish: fact => facts.push(fact)
  });
  const result = command.recordNotified({ routineId: 'routine-1', occurrenceId, level: 2, at: at(9, 1) });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.occurrenceId, occurrenceId);
  assert.equal(repository.inspect().revision, 0);
  assert.deepEqual(facts, []);
});

test('routineRemindedFacts builds one idempotent event, carries level, and never the title', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const [fact] = timelineFacts.routineRemindedFacts({
    routineId: 'routine-1', kind: 'medication', occurrenceId, level: 3, remindedAt: at(9)
  });
  assert.equal(fact.id, `routine.reminded:${occurrenceId}:v1`);
  assert.equal(fact.kind, 'routine.reminded');
  assert.equal(fact.occurredAt, at(9));
  assert.deepEqual(fact.payload, { routineId: 'routine-1', kind: 'medication', occurrenceId, level: 3 });
  // The one field a permanent event table must never hold for a medication routine.
  assert.equal('title' in fact.payload, false);
});

test('routineRemindedFacts refuses a shapeless input rather than writing a half event', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  assert.deepEqual(timelineFacts.routineRemindedFacts({ routineId: 'routine-1', occurrenceId, level: 3 }), []);
  assert.deepEqual(timelineFacts.routineRemindedFacts({ routineId: 'routine-1', occurrenceId, level: 3, remindedAt: Number.NaN }), []);
  assert.deepEqual(timelineFacts.routineRemindedFacts({ occurrenceId, level: 3, remindedAt: at(9) }), []);
  assert.deepEqual(timelineFacts.routineRemindedFacts({ routineId: 'routine-1', level: 3, remindedAt: at(9) }), []);
  // A non-integer level is dropped, not carried as junk.
  const [loose] = timelineFacts.routineRemindedFacts({ routineId: 'routine-1', occurrenceId, level: 2.5, remindedAt: at(9) });
  assert.equal('level' in loose.payload, false);
});

test('routineMissedFacts builds one idempotent event with no title and no level', () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const [fact] = timelineFacts.routineMissedFacts({ routineId: 'routine-1', kind: 'medication', occurrenceId, missedAt: at(11) });
  assert.equal(fact.id, `routine.missed:${occurrenceId}:v1`);
  assert.equal(fact.kind, 'routine.missed');
  assert.equal(fact.occurredAt, at(11));
  assert.deepEqual(fact.payload, { routineId: 'routine-1', kind: 'medication', occurrenceId });
  assert.equal('title' in fact.payload, false);
  assert.equal('level' in fact.payload, false);
  assert.deepEqual(timelineFacts.routineMissedFacts({ routineId: 'routine-1', occurrenceId }), []);
  assert.deepEqual(timelineFacts.routineMissedFacts({ kind: 'medication', occurrenceId, missedAt: at(11) }), []);
});

// A sampler wired to spies: it owns no state but its own dedupe set and reads no
// clock, so everything it touches is one of these eight injected seams.
function sampler(overrides = {}) {
  const calls = [];
  const base = {
    now: () => at(9, 30),
    dayKey: () => DAY,
    getRoutines: () => [routine()],
    getRoutineLog: () => ({ days: [] }),
    getSettings: () => ({}),
    remind: request => { calls.push({ fn: 'remind', request }); return { shown: true, level: 1 }; },
    recordNotified: input => { calls.push({ fn: 'recordNotified', input }); return { ok: true, changed: true }; },
    recordMissed: input => calls.push({ fn: 'recordMissed', input })
  };
  return { instance: routineReminder.createRoutineReminder({ ...base, ...overrides }), calls };
}

test('the sampler refuses construction unless every collaborator is a function', () => {
  const ok = {
    now: () => 0, dayKey: () => DAY, getRoutines: () => [], getRoutineLog: () => ({ days: [] }),
    getSettings: () => ({}), remind: () => {}, recordNotified: () => {}, recordMissed: () => {}
  };
  assert.doesNotThrow(() => routineReminder.createRoutineReminder(ok));
  for (const missing of ['now', 'dayKey', 'getRoutines', 'getRoutineLog', 'getSettings', 'remind', 'recordNotified', 'recordMissed']) {
    assert.throws(() => routineReminder.createRoutineReminder({ ...ok, [missing]: null }), new RegExp(missing));
  }
});

test('with routine reminders switched off the tick raises nothing and records no misses', async () => {
  const { instance, calls } = sampler({
    getSettings: () => ({ routineRemindersEnabled: false }),
    // A witnessed miss is sitting right there in the log; the off switch still wins.
    // A user who silenced routine reminders did not ask for a quiet ledger of
    // everything they then failed to do.
    getRoutineLog: () => ({ days: [{ dayKey: DAY, entries: [{ occurrenceId: buildOccurrenceId('routine-1', DAY, '09:00'), routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] }),
    now: () => at(11)
  });
  assert.deepEqual(await instance.sample(), { triggered: false, reminded: 0, missed: 0 });
  assert.deepEqual(calls, []);
});

test('a due slot reminds before it records, and pins to level 1 under do-not-disturb', async () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const { instance, calls } = sampler({ getSettings: () => ({ dnd: true, themePrimary: '#123456' }) });
  assert.deepEqual(await instance.sample(), { triggered: true, reminded: 1, missed: 0 });
  // Order is load-bearing: if the notified write throws, loggedAt stays null and the
  // next tick re-raises — a duplicate reminder is a far smaller harm than a missed
  // medication reminder, and the deterministic event id makes the duplicate free.
  assert.deepEqual(calls.map(call => call.fn), ['remind', 'recordNotified']);
  assert.equal(calls[0].request.type, 'routine');
  assert.equal(calls[0].request.maxLevel, 1);
  assert.equal(calls[0].request.message, '吃药');
  assert.equal(calls[0].request.themePrimary, '#123456');
  // The occurrence rides in context so "I took it" answers from the nudge itself —
  // and the title is NOT duplicated into context (the surface has it as `message`).
  assert.deepEqual(calls[0].request.context, { routineId: 'routine-1', occurrenceId, kind: 'medication' });
  assert.equal(calls[1].input.level, 1);
  assert.equal(calls[1].input.occurrenceId, occurrenceId);
});

test('outside do-not-disturb the reminder escalates only as far as the routine allows', async () => {
  const capped = sampler({ getRoutines: () => [routine({ maxLevel: 3 })] });
  await capped.instance.sample();
  assert.equal(capped.calls.find(call => call.fn === 'remind').request.maxLevel, 3);

  // No cap of its own ⟹ the default, never the workspace-taking level 4.
  const defaulted = sampler({ getRoutines: () => [routine({ maxLevel: undefined })] });
  await defaulted.instance.sample();
  assert.equal(defaulted.calls.find(call => call.fn === 'remind').request.maxLevel, DEFAULT_ROUTINE_LEVEL);

  // Asking for more than policy allows is clamped down to the cap.
  const greedy = sampler({ getRoutines: () => [routine({ maxLevel: 9 })] });
  await greedy.instance.sample();
  assert.equal(greedy.calls.find(call => call.fn === 'remind').request.maxLevel, MAX_ROUTINE_LEVEL);
});

test('a witnessed miss is recorded once per process even though the day plan keeps deriving it', async () => {
  const occurrenceId = buildOccurrenceId('routine-1', DAY, '09:00');
  const { instance, calls } = sampler({
    now: () => at(11),
    getRoutineLog: () => ({ days: [{ dayKey: DAY, entries: [{ occurrenceId, routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] })
  });
  assert.deepEqual(await instance.sample(), { triggered: false, reminded: 0, missed: 1 });
  assert.deepEqual(calls.find(call => call.fn === 'recordMissed').input, {
    routineId: 'routine-1', kind: 'medication', occurrenceId, missedAt: at(11)
  });

  // Second tick, same closed window: day-plan still derives the miss, but the Set
  // spares the append — no second recordMissed call.
  assert.deepEqual(await instance.sample(), { triggered: false, reminded: 0, missed: 0 });
  assert.equal(calls.filter(call => call.fn === 'recordMissed').length, 1);
});

test('one tick both raises a due slot and records an earlier witnessed miss, misses last', async () => {
  const nineId = buildOccurrenceId('routine-1', DAY, '09:00');
  const oneId = buildOccurrenceId('routine-1', DAY, '13:00');
  const twiceDaily = routine({ schedule: { frequency: 'daily', timesOfDay: ['09:00', '13:00'], weekdays: [], windowMinutes: 60 } });
  const { instance, calls } = sampler({
    now: () => at(13, 30),
    getRoutines: () => [twiceDaily],
    getRoutineLog: () => ({ days: [{ dayKey: DAY, entries: [{ occurrenceId: nineId, routineId: 'routine-1', status: 'notified', at: at(9), note: null, magnitude: null }] }] })
  });
  assert.deepEqual(await instance.sample(), { triggered: true, reminded: 1, missed: 1 });
  assert.equal(calls.find(call => call.fn === 'recordNotified').input.occurrenceId, oneId);
  assert.equal(calls.find(call => call.fn === 'recordMissed').input.occurrenceId, nineId);
  // Both due-pass effects land before the miss pass runs.
  assert.deepEqual(calls.map(call => call.fn), ['remind', 'recordNotified', 'recordMissed']);
});

test('the log channel accepts only what a person can tap, refusing the machine-only statuses', () => {
  const log = routines.ipcRoutes.find(route => route.channel === 'routines:log');
  assert.equal(log.decode({ routineId: 'routine-1', status: 'done' }).ok, true);
  assert.equal(log.decode({ routineId: 'routine-1', status: 'skipped' }).ok, true);
  // `notified` is the sampler's in-process mark and `missed` is derived, never
  // stored — a reminder surface must not forge either through the one channel it is
  // granted (ARCHITECTURE「日常与能量」, ROUTINE_LOGGABLE_STATUSES).
  assert.equal(log.decode({ routineId: 'routine-1', status: 'notified' }).ok, false);
  assert.equal(log.decode({ routineId: 'routine-1', status: 'missed' }).ok, false);
});
