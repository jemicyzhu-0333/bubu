'use strict';

// "I took it" and "no, I didn't", wrapped in a transaction.
//
// Writes `routineLog` and nothing else. In particular it does not write `xp`,
// `streak`, `level` or `pet`: ARCHITECTURE「日常与能量」 forbids gamifying a routine, and a write set
// of exactly one path is how that stops being a matter of trust. Reading
// `state.routines` to check the routine exists is not a write, so it stays out of
// the declaration.
//
// The clock is read once per call and passed down, because `at` and the day key
// have to agree. Deriving the day key from a second `clock.now()` would put a
// midnight-crossing tap in one day's entries with the previous day's timestamp.

const { randomUUID } = require('node:crypto');
const routineLogging = require('../domain/routine-logging');
const { ROUTINE_LOGGABLE_STATUSES } = require('../../../core/routine-model');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const LOG_ROUTINE_OCCURRENCE_WRITES = Object.freeze(['routineLog']);

function createLogRoutineOccurrenceCommand({
  unitOfWork,
  clock,
  generationFactory = randomUUID,
  resolveMappingVersion = () => null,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('log-routine-occurrence command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function' || typeof clock.dayKey !== 'function') {
    throw new TypeError('log-routine-occurrence command requires a clock with now and dayKey');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('log-routine-occurrence command effects must be functions');
  }

  function commit(fact, transaction) {
    if (!transaction.committed) return;
    runPostCommitEffect(publish, Object.freeze({ ...fact, revision: transaction.revision }), reportEffectError);
  }

  function log({ routineId, occurrenceId, status, note, magnitude, at, expectedAt, expectedStatus, expectedRevision } = {}) {
    const now = clock.now();
    const generation = generationFactory();
    const loggedAt = at === undefined ? now : at;
    if (!Number.isSafeInteger(loggedAt) || loggedAt < 0 || !Number.isFinite(new Date(loggedAt).getTime())) {
      return { ok: false, reason: 'invalid-occurrence-time' };
    }
    const today = clock.dayKey(now);
    const dayKey = loggedAt === now ? today : clock.dayKey(loggedAt);
    const validity = routineLogging.validateOccurrenceTime({ at: loggedAt, now, dayKey, today });
    if (!validity.ok) return validity;
    const correcting = expectedAt !== undefined || expectedStatus !== undefined;
    if (correcting && (at === undefined || note !== undefined || magnitude !== undefined)) {
      return { ok: false, reason: 'invalid-occurrence-correction' };
    }
    const transaction = unitOfWork.run({
      writes: LOG_ROUTINE_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now },
      transition: state => {
        if (correcting) return routineLogging.correctOccurrenceTime(state, {
          routineId, occurrenceId, status, at: loggedAt, expectedAt, expectedStatus, now, dayKey, today
        });
        // An explicit time editing a terminal answer must use the same CAS as
        // the editor. New records and a notified slot's first answer still work.
        const existing = at === undefined ? null : state.routineLog.days
          .flatMap(day => day.entries).find(entry => entry.occurrenceId === occurrenceId);
        if (existing && ROUTINE_LOGGABLE_STATUSES.includes(existing.status) && existing.at !== loggedAt) {
          return { ok: false, reason: 'invalid-occurrence-correction' };
        }
        return routineLogging.logOccurrence(state, {
          routineId, occurrenceId, status, note, magnitude, dayKey, at: loggedAt,
          completionContext: { generation, committedAt: now, origin: at === undefined ? 'live_completion' : 'historical_backfill',
            mappingVersion: resolveMappingVersion('routine', state.routines.find(item => item.id === routineId)?.presetId) }
        });
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({
      type: 'routine-logged',
      operation: transaction.operation || 'edit',
      origin: transaction.operation === 'complete' ? transaction.completion?.origin : 'history_edit',
      completion: transaction.completion || null,
      themeSuppressionReason: transaction.themeSuppressionReason || null,
      committedAt: now,
      postCommit: true, replayed: false,
      commitEventId: `routine:${transaction.revision}:${transaction.operation || 'edit'}`,
      routineId,
      occurrenceId: transaction.occurrenceId,
      status: transaction.status,
      // ARCHITECTURE「日常与能量」 rides on the fact rather than on the return value: the timeline row
      // may only be appended once the commit landed, and `log()` answers the caller
      // on the uncommitted path too. `kind` and `scheduled` come from the domain
      // because it read the routine; re-deriving them post-commit would mean
      // re-reading state that may already have moved.
      kind: transaction.kind || null,
      scheduled: transaction.scheduled === true,
      at: loggedAt,
      dayKey: transaction.dayKey
    }, transaction);
    return {
      ok: true,
      changed: transaction.committed,
      occurrenceId: transaction.occurrenceId,
      status: transaction.status,
      dayKey: transaction.dayKey
    };
  }

  function undo({ occurrenceId, expectedRevision } = {}) {
    const now = clock.now();
    const transaction = unitOfWork.run({
      writes: LOG_ROUTINE_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now },
      transition: state => routineLogging.undoOccurrence(state, { occurrenceId, now })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'routine-log-undone', occurrenceId, routineId: transaction.routineId,
      operation: 'revoke', origin: 'history_edit', completion: transaction.completion || null, at: transaction.at,
      committedAt: now, postCommit: true, replayed: false, commitEventId: `routine:${transaction.revision}:revoke` }, transaction);
    return {
      ok: true,
      changed: transaction.committed,
      occurrenceId,
      routineId: transaction.routineId,
      dayKey: transaction.dayKey
    };
  }

  // The reminder sampler's writer, kept apart from `log()` on purpose. Being
  // reminded is not the same event as answering: it writes `notified` (never a
  // user status) through the domain's `noteReminded`, which refuses to overwrite
  // an existing entry, and it publishes a DISTINCT fact type `routine-reminded`
  // rather than `routine-logged`. Folding this into `log()` would record every
  // reminder as `routine.logged(status=notified)`, and the timeline's logged lane
  // would then be full of things the app did, not things the user did.
  //
  // Same one-path write set as `log()`, so no manifest change: `notified` lives in
  // `routineLog` like every other entry. `level` rides on the fact only — it is
  // the escalation tier the reminder actually used, which the timeline wants and
  // the store has no field for. The publish is gated on `transaction.committed`,
  // so a tick that found the row already reminded (or already answered) writes and
  // announces nothing.
  function recordNotified({ routineId, occurrenceId, level, at, expectedRevision } = {}) {
    const notifiedAt = at === undefined ? clock.now() : at;
    const dayKey = clock.dayKey(notifiedAt);
    const transaction = unitOfWork.run({
      writes: LOG_ROUTINE_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now: notifiedAt },
      transition: state => routineLogging.noteReminded(state, { routineId, occurrenceId, dayKey, at: notifiedAt })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({
      type: 'routine-reminded',
      routineId,
      occurrenceId: transaction.occurrenceId,
      kind: transaction.kind || null,
      level: Number.isInteger(level) ? level : null,
      at: notifiedAt,
      dayKey: transaction.dayKey
    }, transaction);
    return { ok: true, changed: transaction.committed, occurrenceId: transaction.occurrenceId, dayKey: transaction.dayKey };
  }

  return Object.freeze({ log, undo, recordNotified });
}

module.exports = { LOG_ROUTINE_OCCURRENCE_WRITES, createLogRoutineOccurrenceCommand };
