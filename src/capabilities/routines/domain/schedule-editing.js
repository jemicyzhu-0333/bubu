'use strict';

const { isDeepStrictEqual } = require('node:util');
const { scheduleValid } = require('../../../core/ai-change-protocol');
const { localDayKey } = require('../../../core/calendar');
const { buildDayPlan } = require('./day-plan');
const { updateRoutine } = require('./routine-editing');

const ORDINARY_KINDS = Object.freeze(['meal', 'snack', 'movement', 'rest', 'meeting']);

function elapsedSlots(state, routine, now) {
  return buildDayPlan({ routines: [routine], routineLog: state.routineLog,
    dayKey: localDayKey(now), now }).occurrences.filter(slot => slot.scheduled && slot.scheduledAt <= now)
    .map(slot => ({ occurrenceId: slot.occurrenceId, scheduledAt: slot.scheduledAt,
      windowMinutes: routine.schedule.windowMinutes }));
}

function updateSchedule(state, { routineId, schedule, timezone, currentTimezone, now }, { profiles } = {}) {
  if (typeof timezone !== 'string' || timezone !== currentTimezone) return { ok: false, reason: 'routine-timezone-changed' };
  if (!scheduleValid(schedule)) return { ok: false, reason: 'routine-schedule-invalid' };
  const routine = state.routines.find(item => item.id === routineId);
  if (!routine) return { ok: false, reason: 'routine-not-found' };
  if (!ORDINARY_KINDS.includes(routine.kind)) return { ok: false, reason: 'routine-kind-not-authorized' };
  const next = { ...routine, schedule };
  if (!isDeepStrictEqual(elapsedSlots(state, routine, now), elapsedSlots(state, next, now))) {
    return { ok: false, reason: 'routine-elapsed-slots-changed' };
  }
  return updateRoutine(state, { routineId, patch: { schedule }, profiles, now });
}

module.exports = { ORDINARY_KINDS, updateSchedule };
