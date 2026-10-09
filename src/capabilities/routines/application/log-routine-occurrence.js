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

const routineLogging = require('../domain/routine-logging');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const LOG_ROUTINE_OCCURRENCE_WRITES = Object.freeze(['routineLog']);

function createLogRoutineOccurrenceCommand({
  unitOfWork,
  clock,
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

  function log({ routineId, occurrenceId, status, note, magnitude, at, expectedRevision } = {}) {
    const loggedAt = at === undefined ? clock.now() : at;
    const dayKey = clock.dayKey(loggedAt);
    const transaction = unitOfWork.run({
      writes: LOG_ROUTINE_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now: loggedAt },
      transition: state => routineLogging.logOccurrence(state, {
        routineId, occurrenceId, status, note, magnitude, dayKey, at: loggedAt
      })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({
      type: 'routine-logged',
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
    const transaction = unitOfWork.run({
      writes: LOG_ROUTINE_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now: clock.now() },
      transition: state => routineLogging.undoOccurrence(state, { occurrenceId })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'routine-log-undone', occurrenceId, routineId: transaction.routineId }, transaction);
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
