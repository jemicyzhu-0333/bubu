'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcRoutes, timelineFacts, timelineDay, recordTimeline } = require('../src/capabilities/progress');
const { localDayKey } = require('../src/core/calendar');

const MINUTE = 60 * 1000;

function routeFor(channel) {
  return ipcRoutes.find(route => route.channel === channel) || null;
}

// A firmly mid-day local timestamp keeps single-day cases off the midnight
// boundary regardless of the machine timezone the suite runs in.
const noon = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function focusCompletion(overrides = {}) {
  const createdAt = overrides.createdAt ?? noon;
  const elapsedMs = overrides.elapsedMs ?? 25 * MINUTE;
  const endedAt = overrides.endedAt ?? createdAt + elapsedMs;
  return {
    sessionId: 's-1',
    kind: 'focus',
    taskId: 't-1',
    completed: true,
    reason: 'completed',
    elapsedMs,
    plannedDurationMs: 25 * MINUTE,
    createdAt,
    endedAt,
    activeSegments: [{ startedAt: createdAt, endedAt }],
    ...overrides
  };
}

test('timeline:getDay is a progress query scoped to the popover', () => {
  const route = routeFor('timeline:getDay');
  assert.ok(route, 'timeline:getDay must be declared by progress');
  assert.equal(route.capability, 'progress');
  assert.equal(route.kind, 'query');
  assert.deepEqual([...route.surfaces], ['popover']);
});

test('timeline:getDay requires a concrete, well-formed dayKey', () => {
  const route = routeFor('timeline:getDay');
  assert.equal(route.decode({ dayKey: '2026-01-15' }).ok, true);
  assert.deepEqual(route.decode({ dayKey: '2026-01-15' }).value, { dayKey: '2026-01-15' });
  assert.equal(route.decode({}).ok, false, 'absent dayKey is rejected');
  assert.equal(route.decode({ dayKey: 'not-a-day' }).ok, false, 'malformed dayKey is rejected');
  assert.equal(route.decode({ dayKey: '2026-01-15', extra: 1 }).ok, false, 'unknown field is rejected');
});

test('a settled focus session yields one bar plus a completion point with deterministic ids', () => {
  const completion = focusCompletion();
  const facts = timelineFacts.sessionSettlementFacts(completion);
  const segments = facts.filter(fact => fact.kind === 'session.segment');
  const completed = facts.filter(fact => fact.kind === 'session.completed');

  assert.equal(segments.length, 1);
  assert.equal(completed.length, 1);
  assert.equal(segments[0].id, 'session.segment:s-1:0:v1');
  assert.equal(completed[0].id, 'session.completed:s-1:v1');
  assert.equal(segments[0].dayKey, localDayKey(noon));
  assert.equal(segments[0].payload.sessionKind, 'focus');
  assert.equal(completed[0].payload.elapsedMs, 25 * MINUTE);

  // Idempotence: replay produces the exact same ids so INSERT OR IGNORE dedupes.
  assert.deepEqual(timelineFacts.sessionSettlementFacts(completion).map(f => f.id), facts.map(f => f.id));
});

test('the bar total equals elapsedMs so the gantt can never disagree with dailyFocus', () => {
  const completion = focusCompletion();
  const segments = timelineFacts.sessionSettlementFacts(completion).filter(f => f.kind === 'session.segment');
  const barTotal = segments.reduce((sum, fact) => sum + fact.durationMs, 0);
  assert.equal(barTotal, completion.elapsedMs);
});

test('a cross-midnight session splits into per-day bars, each attributed to its own day', () => {
  const start = new Date(2026, 0, 15, 23, 45, 0, 0).getTime();
  const completion = focusCompletion({ createdAt: start, elapsedMs: 30 * MINUTE, endedAt: start + 30 * MINUTE });
  const segments = timelineFacts.sessionSettlementFacts(completion).filter(f => f.kind === 'session.segment');

  assert.equal(segments.length, 2, 'the segment is split at the local day boundary');
  assert.notEqual(segments[0].dayKey, segments[1].dayKey);
  assert.equal(segments[0].id, 'session.segment:s-1:0:v1');
  assert.equal(segments[1].id, 'session.segment:s-1:1:v1');
  const barTotal = segments.reduce((sum, fact) => sum + fact.durationMs, 0);
  assert.equal(barTotal, completion.elapsedMs, 'the split preserves the total time');
});

test('break settlement records nothing this pass; a stopped short focus still marks completion', () => {
  assert.deepEqual(timelineFacts.sessionSettlementFacts(focusCompletion({ kind: 'break' })), []);
  // Under 5s of active time earns no bar (activeTimeFact guard) but a completed
  // focus session is still a completion point.
  const brief = focusCompletion({ elapsedMs: 2000, endedAt: noon + 2000, activeSegments: [] });
  const facts = timelineFacts.sessionSettlementFacts(brief);
  assert.deepEqual(facts.map(f => f.kind), ['session.completed']);
});

test('session.started reads the kind from state.focusSession (status) or a completion (kind)', () => {
  const fromState = timelineFacts.sessionStartedFacts({
    session: { sessionId: 's-9', status: 'quick-start', plannedDurationMs: 2 * MINUTE },
    taskId: 't-9',
    startedAt: noon
  });
  assert.equal(fromState.length, 1);
  assert.equal(fromState[0].id, 'session.started:s-9:v1');
  assert.equal(fromState[0].payload.sessionKind, 'quick-start');
  assert.equal(fromState[0].payload.plannedMs, 2 * MINUTE);
  assert.equal(fromState[0].taskId, 't-9');
  // No session id → nothing to anchor an id on, so nothing is recorded.
  assert.deepEqual(timelineFacts.sessionStartedFacts({ session: {}, startedAt: noon }), []);
});

test('task.completed carries stepCount and hadFocus, keyed by task and local day', () => {
  const facts = timelineFacts.taskCompletedFacts({ taskId: 't-1', completedAt: noon, stepCount: 3, hadFocus: true });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].id, `task.completed:t-1:${localDayKey(noon)}:v1`);
  assert.equal(facts[0].payload.stepCount, 3);
  assert.equal(facts[0].payload.hadFocus, true);
  // Missing timestamp or id cannot form a stable key, so nothing is recorded.
  assert.deepEqual(timelineFacts.taskCompletedFacts({ taskId: 't-1' }), []);
});

test('buildTimelineDay projects lanes, markers and totals from a day of events', () => {
  const dayKey = localDayKey(noon);
  const completion = focusCompletion();
  const events = [
    ...timelineFacts.sessionSettlementFacts(completion),
    ...timelineFacts.taskCompletedFacts({ taskId: 't-1', completedAt: completion.endedAt, stepCount: 1, hadFocus: true })
  ];
  const day = timelineDay.buildTimelineDay(events, { dayKey });

  assert.equal(day.dayKey, dayKey);
  assert.equal(day.dayStart, new Date(2026, 0, 15).getTime());
  assert.equal(day.dayEnd, new Date(2026, 0, 16).getTime());
  assert.equal(day.lanes.length, 1, 'one task lane');
  assert.equal(day.lanes[0].taskId, 't-1');
  assert.equal(day.lanes[0].segments[0].sessionKind, 'focus');
  assert.equal(day.totals.focusMs, 25 * MINUTE);
  assert.equal(day.totals.segmentCount, 1);
  assert.equal(day.totals.sessionCount, 1);
  assert.equal(day.totals.completedTaskCount, 1);
  assert.ok(day.markers.some(marker => marker.kind === 'task.completed'));
  assert.ok(day.rangeStart <= completion.createdAt && day.rangeEnd >= completion.endedAt);
});

test('overflow lanes retain immutable task identities for completion grouping', () => {
  const dayKey = localDayKey(noon);
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `segment-${index}`,
    kind: 'session.segment',
    taskId: `task-${index}`,
    occurredAt: noon + index * MINUTE,
    durationMs: (8 - index) * MINUTE,
    payload: { sessionKind: 'focus' }
  }));
  const day = timelineDay.buildTimelineDay(events, { dayKey });
  const overflow = day.lanes.find(lane => lane.other);

  assert.ok(overflow);
  assert.deepEqual(overflow.taskIds, ['task-6', 'task-7']);
  assert.equal(Object.isFrozen(overflow.taskIds), true);
  assert.deepEqual(overflow.segments.map(segment => segment.taskId), ['task-6', 'task-7']);
});

test('day projections preserve explicit causal identities without copying payloads or inventing legacy IDs', () => {
  const dayKey = localDayKey(noon);
  const events = [
    { id: 'segment-1', kind: 'session.segment', sessionId: 'session-1',
      causationId: 'cause-1', commandId: 'command-1', taskId: 'task-1',
      occurredAt: noon, durationMs: MINUTE, payload: { sessionKind: 'focus', privateText: 'private' } },
    { id: 'marker-1', kind: 'session.completed', sessionId: 'session-1',
      causationId: 'cause-1', commandId: 'command-1', taskId: 'task-1',
      occurredAt: noon + MINUTE, payload: { privateText: 'private' } },
    { kind: 'session.started', occurredAt: noon, taskId: 'task-1',
      payload: { sessionId: 'do-not-infer-from-payload' } }
  ];
  const day = timelineDay.buildTimelineDay(events, { dayKey });
  const segment = day.lanes[0].segments[0];
  const marker = day.markers.find(item => item.eventId === 'marker-1');
  const identity = item => Object.fromEntries(['eventId', 'sessionId', 'causationId', 'commandId']
    .map(key => [key, item[key]]));
  assert.deepEqual(identity(segment), {
    eventId: 'segment-1', sessionId: 'session-1', causationId: 'cause-1', commandId: 'command-1'
  });
  assert.deepEqual(identity(marker), {
    eventId: 'marker-1', sessionId: 'session-1', causationId: 'cause-1', commandId: 'command-1'
  });
  assert.deepEqual(identity(day.markers.find(item => item.eventId === null)), {
    eventId: null, sessionId: null, causationId: null, commandId: null
  });
  for (const item of [segment, ...day.markers]) {
    assert.equal(Object.isFrozen(item), true);
    assert.equal('payload' in item, false);
    assert.equal('privateText' in item, false);
  }
  assert.equal(day.totals.focusMs, MINUTE, 'retaining identity does not change accounting');
});

test('overflow lanes preserve each segment identity rather than deriving it from a task lane', () => {
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `segment-${index}`, kind: 'session.segment', taskId: `task-${index}`, sessionId: `session-${index}`,
    causationId: `cause-${index}`, commandId: `command-${index}`, occurredAt: noon,
    durationMs: (8 - index) * MINUTE
  }));
  const day = timelineDay.buildTimelineDay(events, { dayKey: localDayKey(noon) });
  const overflow = day.lanes.find(lane => lane.other);
  assert.deepEqual(overflow.segments.map(({ eventId, sessionId, causationId, commandId }) =>
    ({ eventId, sessionId, causationId, commandId })), [6, 7].map(index => ({
    eventId: `segment-${index}`, sessionId: `session-${index}`, causationId: `cause-${index}`, commandId: `command-${index}`
  })));
});

test('buildTimelineDay returns a legal empty structure when a day has no events', () => {
  const day = timelineDay.buildTimelineDay([], { dayKey: '2026-01-15' });
  assert.deepEqual([...day.lanes], []);
  assert.deepEqual([...day.markers], []);
  assert.equal(day.totals.focusMs, 0);
  assert.equal(day.rangeStart, null);
  assert.equal(day.rangeEnd, null);
  assert.equal(day.dayEnd - day.dayStart, 24 * 60 * MINUTE);
});

test('day markers expose only the fields needed to tell a completed routine from a reminder', () => {
  const dayKey = localDayKey(noon);
  const events = [
    ...timelineFacts.routineLoggedFacts({ revision: 1,
      routineId: 'tea-1', kind: 'stimulant', occurrenceId: `tea-1:${dayKey}:10:00`,
      status: 'done', scheduled: true, loggedAt: noon
    }),
    ...timelineFacts.routineLoggedFacts({ revision: 1,
      routineId: 'med-1', kind: 'medication', occurrenceId: `med-1:${dayKey}:11:00`,
      status: 'skipped', loggedAt: noon + 60 * MINUTE
    }),
    ...timelineFacts.routineRemindedFacts({
      routineId: 'med-1', kind: 'medication', occurrenceId: `med-1:${dayKey}:12:00`,
      level: 1, remindedAt: noon + 120 * MINUTE
    })
  ];
  const day = timelineDay.buildTimelineDay(events, { dayKey });
  assert.deepEqual(day.markers.map(({ kind, routineId, routineKind, status }) =>
    ({ kind, routineId, routineKind, status })), [
    { kind: 'routine.logged', routineId: 'tea-1', routineKind: 'stimulant', status: 'done' },
    { kind: 'routine.logged', routineId: 'med-1', routineKind: 'medication', status: 'skipped' },
    { kind: 'routine.reminded', routineId: 'med-1', routineKind: 'medication', status: null }
  ]);
  assert.ok(day.markers.every(marker => !('payload' in marker) && !('title' in marker)));
  assert.equal(Object.isFrozen(day.markers[0]), true);
});

test('the recorder appends built facts through the injected timeline and reports the count', () => {
  const appended = [];
  const timeline = { append: event => { appended.push(event); return { ok: true, inserted: true }; } };
  const recorder = recordTimeline.createTimelineRecorder({ timeline });

  const result = recorder.recordSessionSettlement(focusCompletion());
  assert.equal(result.recorded, 2, 'one segment plus one completion');
  assert.deepEqual(appended.map(e => e.kind).sort(), ['session.completed', 'session.segment']);
});

test('a calibration is one point per local day, keyed by that day and nothing else', () => {
  const [fact] = timelineFacts.energyCalibratedFacts({ observations: 14, mae: 8.5, calibratedAt: noon });
  assert.equal(fact.kind, 'energy.profile-calibrated');
  assert.equal(fact.id, `energy.profile-calibrated:${localDayKey(noon)}:v1`);
  assert.equal(fact.dayKey, localDayKey(noon));
  assert.equal(fact.occurredAt, noon);
  assert.equal(fact.durationMs, null, 'a calibration is a point, not a bar');
  assert.deepEqual(fact.payload, { observations: 14, mae: 8.5 });
  // Two passes on the same local day collide on the primary key rather than
  // writing a second row — ARCHITECTURE「日常与能量」's "每日最多一条" is the id, not a guard.
  const [again] = timelineFacts.energyCalibratedFacts({ observations: 15, mae: 8.1, calibratedAt: noon + MINUTE });
  assert.equal(again.id, fact.id);
});

test('a warm-up calibration records the count without claiming an error of zero', () => {
  // `lastResidualMae` is null until the tenth report, and a literal 0 in the
  // payload would read as "the model predicted you exactly".
  const [fact] = timelineFacts.energyCalibratedFacts({ observations: 3, mae: null, calibratedAt: noon });
  assert.deepEqual(fact.payload, { observations: 3 });
  assert.equal('mae' in fact.payload, false);
});

test('a pass that folded nothing in produces no calibration event at all', () => {
  assert.deepEqual(timelineFacts.energyCalibratedFacts({ observations: 0, mae: null, calibratedAt: noon }), []);
  assert.deepEqual(timelineFacts.energyCalibratedFacts({ observations: 4, mae: 2, calibratedAt: null }), []);
  assert.deepEqual(timelineFacts.energyCalibratedFacts(), []);

  const appended = [];
  const recorder = recordTimeline.createTimelineRecorder({
    timeline: { append: event => { appended.push(event); return { ok: true, inserted: true }; } }
  });
  assert.equal(recorder.recordEnergyCalibrated({ observations: 11, mae: 6, calibratedAt: noon }).recorded, 1);
  assert.equal(recorder.recordEnergyCalibrated({ observations: 0, calibratedAt: noon }).recorded, 0);
  assert.deepEqual(appended.map(event => event.kind), ['energy.profile-calibrated']);
});

// ARCHITECTURE「日常与能量」. The assertion that matters most in this block is the negative one:
// a routine may be titled 「吃阿立哌唑」, and a permanent event table is the one
// place that must never hold a second copy of that.
test('a logged routine carries ids and shape, and never the title', () => {
  const occurrenceId = 'routine-1:2026-01-15:09:00';
  const [fact] = timelineFacts.routineLoggedFacts({ revision: 1,
    routineId: 'routine-1', kind: 'medication', occurrenceId,
    status: 'done', scheduled: true, loggedAt: noon, title: '吃阿立哌唑'
  });
  assert.equal(fact.kind, 'routine.logged');
  assert.equal(fact.id, `routine.logged:${occurrenceId}:v1`);
  assert.equal(fact.dayKey, localDayKey(noon));
  assert.equal(fact.occurredAt, noon);
  assert.equal(fact.durationMs, null, 'a tap is a point, not a bar');
  assert.deepEqual(fact.payload, {
    routineId: 'routine-1', kind: 'medication', occurrenceId, status: 'done', scheduled: true
  });
  assert.equal('title' in fact.payload, false);

  // Re-reporting the same occurrence overwrites one log entry and collides on one
  // event id — the two tables behave identically because they share the identity.
  const [again] = timelineFacts.routineLoggedFacts({ revision: 2,
    routineId: 'routine-1', kind: 'medication', occurrenceId,
    status: 'skipped', scheduled: true, loggedAt: noon + MINUTE
  });
  assert.equal(again.id, fact.id);
});

test('a free-form tap records scheduled:false rather than dropping the field', () => {
  // boundedPayload drops null and undefined; a boolean survives, which is why
  // `scheduled` is normalised to one before it gets there.
  const [fact] = timelineFacts.routineLoggedFacts({ revision: 1,
    routineId: 'routine-2', kind: null, occurrenceId: 'routine-2:2026-01-15:free-0',
    status: 'done', scheduled: false, loggedAt: noon
  });
  assert.equal(fact.payload.scheduled, false);
  assert.equal('kind' in fact.payload, false, 'an unkinded routine says nothing rather than null');
});

test('an incomplete routine log produces no event at all', () => {
  const complete = {
    routineId: 'routine-1', kind: 'medication', occurrenceId: 'routine-1:2026-01-15:09:00',
    status: 'done', scheduled: true, loggedAt: noon
  };
  for (const missing of ['routineId', 'occurrenceId', 'status', 'loggedAt']) {
    assert.deepEqual(timelineFacts.routineLoggedFacts({ revision: 1, ...complete, [missing]: null }), [], missing);
  }
  assert.deepEqual(timelineFacts.routineLoggedFacts(), []);
});

// ARCHITECTURE「日常与能量」 promises a tap is always undoable, and `undoOccurrence` removes the log
// entry rather than writing a correction. A timeline row outliving the undo would
// put that mis-tap back — permanently, one table over.
test('undoing a routine log retracts exactly the row that tap wrote', () => {
  const occurrenceId = 'routine-1:2026-01-15:09:00';
  const appended = [];
  const removed = [];
  const recorder = recordTimeline.createTimelineRecorder({
    timeline: {
      append: event => { appended.push(event); return { ok: true, inserted: true }; },
      upsertRoutineLogged: event => { appended.push(event); return { ok: true, inserted: true }; },
      remove: id => { removed.push(id); return { ok: true, removed: 1 }; }
    }
  });

  assert.equal(recorder.recordRoutineLogged({ revision: 1,
    routineId: 'routine-1', kind: 'medication', occurrenceId,
    status: 'done', scheduled: true, loggedAt: noon
  }).recorded, 1);
  assert.equal(recorder.recordRoutineLogUndone({ occurrenceId }).removed, 1);
  assert.deepEqual(removed, [appended[0].id]);
  assert.deepEqual(removed, [`routine.logged:${occurrenceId}:v1`]);
});

test('an undo against a store that cannot delete is a no-op, not a crash', () => {
  // An older store shape (or tier="none") simply has no `remove`. The undo has
  // already committed by then, so this path must never throw or report failure
  // upward — the same contract every append here follows.
  const older = recordTimeline.createTimelineRecorder({ timeline: { append: () => ({ ok: true }) } });
  assert.doesNotThrow(() => older.recordRoutineLogUndone({ occurrenceId: 'routine-1:2026-01-15:09:00' }));
  assert.equal(older.recordRoutineLogUndone({ occurrenceId: 'routine-1:2026-01-15:09:00' }).removed, 0);

  const traced = [];
  const broken = recordTimeline.createTimelineRecorder({
    timeline: { append: () => ({ ok: true }), remove: () => { throw new Error('store down'); } },
    logger: entry => traced.push(entry)
  });
  assert.equal(broken.recordRoutineLogUndone({ occurrenceId: 'routine-1:2026-01-15:09:00' }).removed, 0);
  assert.ok(traced.length >= 1, 'a swallowed retraction still leaves a trace');

  // No occurrence id means no row to name, so nothing is deleted by guesswork.
  const guarded = recordTimeline.createTimelineRecorder({
    timeline: { append: () => ({ ok: true }), remove: () => { throw new Error('must not be called'); } }
  });
  assert.equal(guarded.recordRoutineLogUndone({}).removed, 0);
  assert.equal(guarded.recordRoutineLogUndone().removed, 0);
});

test('recording never throws and records nothing when the store is a no-op or broken', () => {
  const noop = recordTimeline.createTimelineRecorder({ timeline: { append: () => ({ ok: false, reason: 'store-unavailable' }) } });
  assert.equal(noop.recordSessionSettlement(focusCompletion()).recorded, 0);

  const traced = [];
  const broken = recordTimeline.createTimelineRecorder({
    timeline: { append: () => { throw new Error('store down'); } },
    logger: entry => traced.push(entry)
  });
  assert.doesNotThrow(() => broken.recordTaskCompleted({ taskId: 't-1', completedAt: noon, stepCount: 0, hadFocus: false }));
  assert.equal(broken.recordSessionSettlement(focusCompletion()).recorded, 0);
  assert.ok(traced.length >= 1, 'a swallowed append still leaves a trace');

  // A missing store is a no-op, not a crash (tier="none" presents this shape).
  const absent = recordTimeline.createTimelineRecorder({});
  assert.doesNotThrow(() => absent.recordSessionStarted({ session: { sessionId: 's-1', status: 'focus' }, startedAt: noon }));
  assert.equal(absent.recordSessionSettlement(focusCompletion()).recorded, 0);
});
