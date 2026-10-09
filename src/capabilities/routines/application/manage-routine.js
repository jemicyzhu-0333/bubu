'use strict';

// The routine list's three writes, wrapped in a transaction.
//
// A capability command rather than an `application/workflows/` entry, for the
// reason `equip-appearance.js` spells out: workflows exist for writes that span
// capabilities, and this one touches nothing outside its own two state paths. The
// narrow declaration is the point — `routines` and `routineLog` and nothing else
// is what makes ARCHITECTURE「日常与能量」's "completing a routine never produces XP, never affects a
// streak, never feeds the pet" a checkable property of the manifest instead of a
// promise in a design doc.
//
// `routineLog` is in the write set because deleting a routine deletes its log
// entries too (ARCHITECTURE「日常与能量」: always deletable). A routine whose history outlived it
// would keep bumping the estimate with something the user can no longer see.

const routineEditing = require('../domain/routine-editing');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { ROUTINE_EFFECT_PROFILES } = require('../../../content/energy-effects.mjs');

const MANAGE_ROUTINE_WRITES = Object.freeze(['routines', 'routineLog']);

function createManageRoutineCommand({
  unitOfWork,
  clock,
  // Defaulted rather than required: the capability already knows which table its
  // kinds come from, so the wiring in `main.js` stays pure wiring. Still
  // injectable, because the domain rules are worth testing against a table of
  // two profiles instead of eight.
  profiles = ROUTINE_EFFECT_PROFILES,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('manage-routine command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('manage-routine command requires a clock');
  }
  if (!profiles || typeof profiles !== 'object') {
    throw new TypeError('manage-routine command requires an effect profile table');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('manage-routine command requires an id factory');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('manage-routine command effects must be functions');
  }

  // All three writes announce themselves the same way, because the surface reacts
  // the same way to any of them: re-read the projection and redraw the list and
  // the curve.
  function commit(fact, transaction) {
    if (!transaction.committed) return;
    runPostCommitEffect(publish, Object.freeze({ ...fact, revision: transaction.revision }), reportEffectError);
  }

  function add({ title, kind, customLabel, schedule, effect, maxLevel, active, now, expectedRevision } = {}) {
    const createdAt = now === undefined ? clock.now() : now;
    const transaction = unitOfWork.run({
      writes: MANAGE_ROUTINE_WRITES,
      expectedRevision,
      context: { now: createdAt },
      transition: state => routineEditing.addRoutine(state, {
        title, kind, customLabel, schedule, effect, maxLevel, active, profiles, idFactory, now: createdAt
      })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'routine-added', routineId: transaction.routineId }, transaction);
    return { ok: true, changed: transaction.committed, routineId: transaction.routineId, routine: transaction.routine };
  }

  function update({ routineId, patch, now, expectedRevision } = {}) {
    const updatedAt = now === undefined ? clock.now() : now;
    const transaction = unitOfWork.run({
      writes: MANAGE_ROUTINE_WRITES,
      expectedRevision,
      context: { now: updatedAt },
      transition: state => routineEditing.updateRoutine(state, { routineId, patch, profiles, now: updatedAt })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'routine-updated', routineId }, transaction);
    return { ok: true, changed: transaction.committed, routineId, routine: transaction.routine };
  }

  function remove({ routineId, expectedRevision } = {}) {
    const transaction = unitOfWork.run({
      writes: MANAGE_ROUTINE_WRITES,
      expectedRevision,
      context: { now: clock.now() },
      transition: state => routineEditing.removeRoutine(state, { routineId })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'routine-removed', routineId, removedEntries: transaction.removedEntries }, transaction);
    return {
      ok: true,
      changed: transaction.committed,
      routineId,
      removedEntries: transaction.removedEntries
    };
  }

  return Object.freeze({ add, update, remove });
}

module.exports = { MANAGE_ROUTINE_WRITES, createManageRoutineCommand };
