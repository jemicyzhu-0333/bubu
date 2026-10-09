'use strict';

// ARCHITECTURE「事实流与长期记忆」: turn already-committed session and task facts into timeline
// events. Pure — it derives events from data passed in, touches no database and
// reads no wall clock. The single writer (application/record-timeline.js) appends
// whatever these return, after the document commit has already succeeded.
//
// Event ids are deterministic (`<kind>:<stable-id>:v1`), so a replay, retry or
// crash-recovery re-record collides on the primary key and is swallowed by
// INSERT OR IGNORE — idempotence without a dedupe pass (ARCHITECTURE「事实流与长期记忆」).

const { localDayKey, splitAcrossLocalDays } = require('../../../core/calendar');
const { activeTimeFact, accountingSegments, SESSION_KINDS } = require('./session-settlement');

const MAX_PAYLOAD_JSON = 1024; // ARCHITECTURE「事实流与长期记忆」: payload is bounded; truncate rather than grow unbounded.

// A payload is a closed, bounded bag: undefined fields are dropped so the shape
// stays predictable, and the whole thing is capped so no single event can bloat.
function boundedPayload(fields) {
  const payload = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) payload[key] = value;
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON) return { truncated: true };
  return payload;
}

function event({ id, occurredAt, dayKey, kind, taskId = null, sessionId = null, durationMs = null, payload = {} }) {
  return Object.freeze({
    id,
    occurredAt,
    dayKey: dayKey || localDayKey(occurredAt),
    kind,
    taskId: taskId || null,
    sessionId: sessionId || null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    payload
  });
}

function isFocusKind(kind) {
  return kind === SESSION_KINDS.FOCUS || kind === SESSION_KINDS.QUICK_START;
}

// session.started (point): a focus/quick-start session began. Break starts flow
// through a different command and are out of this pass.
function sessionStartedFacts({ session, taskId, startedAt } = {}) {
  if (!session || typeof session.sessionId !== 'string' || !session.sessionId) return [];
  if (!Number.isFinite(startedAt)) return [];
  const plannedMs = Number.isFinite(session.plannedDurationMs) ? session.plannedDurationMs
    : Number.isFinite(session.plannedMs) ? session.plannedMs : null;
  // state.focusSession names the kind `status`; a settled completion names it
  // `kind`. Read either so this builder works from both shapes.
  const sessionKind = session.kind || session.status || null;
  return [event({
    id: `session.started:${session.sessionId}:v1`,
    occurredAt: startedAt,
    kind: 'session.started',
    taskId: taskId || session.taskId || null,
    sessionId: session.sessionId,
    payload: boundedPayload({ sessionKind, plannedMs })
  })];
}

// session.segment (bar) + session.completed (point) from one settled completion.
// Segments are derived from accountingSegments + splitAcrossLocalDays under the
// SAME guard that feeds dailyFocus (activeTimeFact), so the day's bar total equals
// stats.dailyFocus[dayKey] (ARCHITECTURE「事实流与长期记忆」 test 7). A cross-midnight segment is split and
// each slice keeps its own day_key, matching how dailyFocus attributes the time.
function sessionSettlementFacts(completion) {
  if (!completion || typeof completion.sessionId !== 'string' || !completion.sessionId) return [];
  // This pass records the focus/quick-start lifecycle only; break settlement is
  // deferred (its start is not recorded either), so a break yields no events.
  if (!isFocusKind(completion.kind)) return [];
  const facts = [];

  if (activeTimeFact(completion)) {
    let index = 0;
    for (const segment of accountingSegments(completion)) {
      for (const slice of splitAcrossLocalDays(segment.startedAt, segment.endedAt)) {
        if (!(slice.durationMs > 0)) continue;
        facts.push(event({
          id: `session.segment:${completion.sessionId}:${index}:v1`,
          occurredAt: slice.startMs,
          dayKey: slice.dateKey,
          kind: 'session.segment',
          taskId: completion.taskId,
          sessionId: completion.sessionId,
          durationMs: slice.durationMs,
          payload: boundedPayload({ sessionKind: completion.kind, taskId: completion.taskId })
        }));
        index += 1;
      }
    }
  }

  if (completion.completed === true) {
    facts.push(event({
      id: `session.completed:${completion.sessionId}:v1`,
      occurredAt: completion.endedAt,
      kind: 'session.completed',
      taskId: completion.taskId,
      sessionId: completion.sessionId,
      payload: boundedPayload({ sessionKind: completion.kind, elapsedMs: completion.elapsedMs })
    }));
  }
  return facts;
}

// task.completed (point). A task completes at most once per local day, so
// taskId + dayKey is the stable identity.
function taskCompletedEventId(taskId, completedAt) {
  return `task.completed:${taskId}:${localDayKey(completedAt)}:v1`;
}

function taskCompletedFacts({ taskId, completedAt, stepCount, hadFocus } = {}) {
  if (typeof taskId !== 'string' || !taskId || !Number.isFinite(completedAt)) return [];
  const dayKey = localDayKey(completedAt);
  return [event({
    id: taskCompletedEventId(taskId, completedAt),
    occurredAt: completedAt,
    dayKey,
    kind: 'task.completed',
    taskId,
    payload: boundedPayload({
      stepCount: Number.isFinite(stepCount) ? stepCount : 0,
      hadFocus: Boolean(hadFocus)
    })
  })];
}

// energy.profile-calibrated (point). ARCHITECTURE「日常与能量」: the curve changed shape, and the
// reason has to survive the day it happened on — a model that retunes itself
// invisibly is one nobody can argue with afterwards.
//
// At most one per local day falls out of the id rather than out of a guard: the
// day pass runs once per local day, so `dayKey` already is the stable identity,
// and a re-run collides on the primary key instead of writing a second row.
function energyCalibratedFacts({ observations, mae, calibratedAt } = {}) {
  if (!Number.isFinite(calibratedAt)) return [];
  // A calibration that folded no report in is not an event: `observations` counts
  // the reports the curve has actually learned from, so zero means nothing moved.
  if (!Number.isSafeInteger(observations) || observations <= 0) return [];
  const dayKey = localDayKey(calibratedAt);
  return [event({
    id: `energy.profile-calibrated:${dayKey}:v1`,
    occurredAt: calibratedAt,
    dayKey,
    kind: 'energy.profile-calibrated',
    // `mae` is absent during the warm-up, and boundedPayload drops nulls, so the
    // field is simply missing until tuning begins. That reads correctly on the way
    // back out; a literal 0 would claim the model predicted the user perfectly.
    payload: boundedPayload({ observations, mae: Number.isFinite(mae) ? mae : null })
  })];
}

// routine.logged (point). The occurrence id already carries routine + day + slot,
// so it is the whole identity: re-reporting the same occurrence overwrites one
// log entry and collides on one event id, exactly as the log itself behaves.
//
// The payload deliberately stops at ids and shape. ARCHITECTURE「日常与能量」: `title` never goes in,
// because a routine may be named 「吃阿立哌唑」 and copying that into a permanent
// event table spreads a medication record to a second place that no "edit the
// routine" and no "forget it" ever reaches. Readers resolve the title by
// `routineId` against the current definitions, which is also the only way a
// renamed routine reads correctly in old history.
function routineLoggedEventId(occurrenceId) {
  return `routine.logged:${occurrenceId}:v1`;
}

function routineLoggedFacts({ revision, routineId, kind, occurrenceId, status, scheduled, loggedAt } = {}) {
  if (!Number.isSafeInteger(revision) || revision < 1) return [];
  if (typeof occurrenceId !== 'string' || !occurrenceId) return [];
  if (typeof routineId !== 'string' || !routineId) return [];
  if (typeof status !== 'string' || !status) return [];
  if (!Number.isFinite(loggedAt)) return [];
  return [Object.freeze({ ...event({
    id: routineLoggedEventId(occurrenceId),
    occurredAt: loggedAt,
    kind: 'routine.logged',
    payload: boundedPayload({
      routineId,
      kind: typeof kind === 'string' && kind ? kind : null,
      occurrenceId,
      status,
      // A boolean survives boundedPayload's null-drop, so `false` is recorded as
      // "this was a free-form tap" rather than disappearing into a missing field.
      scheduled: scheduled === true
    })
  }), entityVersion: String(revision) })];
}

// routine.reminded (point). ARCHITECTURE「日常与能量」: the in-process sampler raised a reminder
// for this occurrence. The occurrence id is the whole identity, so the same tick
// firing twice — or a crash-recovery replay — collides on one event id and is
// swallowed by INSERT OR IGNORE, exactly like routine.logged.
//
// `level` is the escalation tier the reminder actually used (1 under do-not-disturb,
// up to the routine's own cap otherwise); it rides here because the log has no
// field for it. `title` stays out for the ARCHITECTURE「日常与能量」 reason routine.logged documents.
function routineRemindedFacts({ routineId, kind, occurrenceId, level, remindedAt } = {}) {
  if (typeof occurrenceId !== 'string' || !occurrenceId) return [];
  if (typeof routineId !== 'string' || !routineId) return [];
  if (!Number.isFinite(remindedAt)) return [];
  return [event({
    id: `routine.reminded:${occurrenceId}:v1`,
    occurredAt: remindedAt,
    kind: 'routine.reminded',
    payload: boundedPayload({
      routineId,
      kind: typeof kind === 'string' && kind ? kind : null,
      occurrenceId,
      level: Number.isInteger(level) ? level : null
    })
  })];
}

// routine.missed (point). Produced ONLY by the in-process sampler, and only for a
// scheduled window the app itself watched pass unanswered while running — the
// witness is a stored `notified` entry (see day-plan.js witnessedMissedOccurrences).
// This is option (b) of the 2026-09-21 product decision, and the constraint it
// honours is why there is no other producer:
//
// ARCHITECTURE「日常与能量」 lists a `missed` payload but gives it no deterministic id and no producer.
// `missed` is otherwise derived in day-plan.js and shown live (ARCHITECTURE「日常与能量」: a window
// passes, the row goes quiet, nothing accumulates). The tempting second producer —
// the daily pass reading yesterday — writes "you missed seven days of your meds"
// after the app was closed for a week, for days the user actually took them. A
// false medication record in a permanent table is worse than an absent one, so
// that path stays unwritten; only the live in-process witness reaches here.
function routineMissedFacts({ routineId, kind, occurrenceId, missedAt } = {}) {
  if (typeof occurrenceId !== 'string' || !occurrenceId) return [];
  if (typeof routineId !== 'string' || !routineId) return [];
  if (!Number.isFinite(missedAt)) return [];
  return [event({
    id: `routine.missed:${occurrenceId}:v1`,
    occurredAt: missedAt,
    kind: 'routine.missed',
    payload: boundedPayload({
      routineId,
      kind: typeof kind === 'string' && kind ? kind : null,
      occurrenceId
    })
  })];
}

// Explicit local app actions only. A provider suggestion and an external hook
// are not evidence that an inbox item was captured or resolved.
function inboxCapturedFacts({ inboxId, capturedAt, timezone = null, utcOffsetMinutes = null, localDayKey: dayKey } = {}) {
  if (typeof inboxId !== 'string' || !inboxId || !Number.isSafeInteger(capturedAt) || capturedAt < 0) return [];
  return [Object.freeze({ ...event({ id: `inbox.captured:${inboxId}:v1`, occurredAt: capturedAt,
    dayKey, kind: 'inbox.captured', payload: { inboxId, count: 1 } }),
    schemaVersion: 1, receivedAt: capturedAt, timezone, utcOffsetMinutes,
    localDayKey: dayKey || localDayKey(capturedAt), actor: 'user', source: 'local-app',
    correlationId: null, causationId: null, commandId: null, entityVersion: null,
    visibility: 'normal', redactionState: 'none' })];
}
function inboxResolvedFacts({ inboxId, resolvedAt, action, targetId = null,
  timezone = null, utcOffsetMinutes = null, localDayKey: dayKey } = {}) {
  if (typeof inboxId !== 'string' || !inboxId || !Number.isSafeInteger(resolvedAt) || resolvedAt < 0
      || !['promote', 'next-step', 'schedule', 'someday', 'routine', 'log', 'state', 'feeling', 'keep'].includes(action)
      || (targetId !== null && typeof targetId !== 'string')) return [];
  return [Object.freeze({ ...event({ id: `inbox.resolved:${inboxId}:${resolvedAt}:v1`, occurredAt: resolvedAt,
    dayKey, kind: 'inbox.resolved', payload: { inboxId, targetId, action, count: 1 } }),
    schemaVersion: 1, receivedAt: resolvedAt, timezone, utcOffsetMinutes,
    localDayKey: dayKey || localDayKey(resolvedAt), actor: 'user', source: 'local-app',
    correlationId: null, causationId: null, commandId: null, entityVersion: null,
    visibility: 'normal', redactionState: 'none' })];
}

function planningChangedFacts(fact = {}) {
  const identity = fact.receiptId || fact.trialId;
  if (!['planning.preference.changed', 'energy.profile.changed'].includes(fact.type)
    || typeof identity !== 'string' || !identity || !Number.isSafeInteger(fact.occurredAt)) return [];
  const references = Array.isArray(fact.evidenceRefs) ? [...new Set(fact.evidenceRefs.filter(id => typeof id === 'string' && id.length <= 200))].slice(0, 240) : [];
  const payload = { action: fact.action || 'confirmed', oldVersion: fact.oldVersion, newVersion: fact.newVersion,
    receiptId: fact.receiptId, trialId: fact.trialId, source: 'user-confirmed',
    evidenceRefs: [...references], evidenceCount: references.length, evidenceRefsTruncated: false };
  while (JSON.stringify(payload).length > MAX_PAYLOAD_JSON && payload.evidenceRefs.length) {
    payload.evidenceRefs.pop(); payload.evidenceRefsTruncated = true;
  }
  return [event({ id: `${fact.type}:${identity}:${fact.action || 'confirmed'}:v1`, kind: fact.type,
    occurredAt: fact.occurredAt, payload: boundedPayload(payload) })];
}

module.exports = {
  planningChangedFacts,
  inboxCapturedFacts,
  inboxResolvedFacts,
  sessionStartedFacts,
  sessionSettlementFacts,
  taskCompletedFacts,
  taskCompletedEventId,
  energyCalibratedFacts,
  routineLoggedFacts,
  routineLoggedEventId,
  routineRemindedFacts,
  routineMissedFacts
};
