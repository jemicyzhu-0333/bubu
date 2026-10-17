'use strict';

// ARCHITECTURE「日常与能量」: occurrence identity names the original slot;
// `at` names what actually happened. Moving the latter never invents a new slot.
const { orderRoutineLog } = require('./log-order');
const { actualDay, occurrenceCapacity } = require('./log-retention');
const { addDaysToKey } = require('../../../core/calendar');
const { ROUTINE_LOGGABLE_STATUSES, TIME_OF_DAY_PATTERN, occurrenceIdPrefix } = require('../../../core/routine-model');

function validateOccurrenceTime({ at, now, dayKey, today }) {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(now) || now < 0) {
    return { ok: false, reason: 'invalid-occurrence-time' };
  }
  if (at > now) return { ok: false, reason: 'occurrence-in-future' };
  if (dayKey !== today && dayKey !== addDaysToKey(today, -1)) {
    return { ok: false, reason: 'occurrence-outside-window' };
  }
  return { ok: true };
}

function correctOccurrenceTime(state, { routineId, occurrenceId, status, at, expectedAt, expectedStatus,
  now, dayKey, today } = {}) {
  const validity = validateOccurrenceTime({ at, now, dayKey, today });
  if (!validity.ok) return validity;
  if (!Number.isSafeInteger(expectedAt) || expectedAt < 0 || !ROUTINE_LOGGABLE_STATUSES.includes(expectedStatus)
      || status !== expectedStatus) return { ok: false, reason: 'invalid-occurrence-correction' };
  const routine = (state.routines || []).find(item => item.id === routineId);
  if (!routine) return { ok: false, reason: 'routine-not-found' };
  const day = (state.routineLog?.days || []).find(item => item.entries.some(entry => entry.occurrenceId === occurrenceId));
  const entry = day?.entries.find(item => item.occurrenceId === occurrenceId);
  if (!entry || entry.routineId !== routineId) return { ok: false, reason: 'occurrence-not-found' };
  const previousDay = actualDay(entry);
  if (previousDay !== today && previousDay !== addDaysToKey(today, -1)) {
    return { ok: false, reason: 'occurrence-outside-window' };
  }
  const result = { ok: true, occurrenceId, status, kind: routine.kind || null,
    scheduled: TIME_OF_DAY_PATTERN.test(occurrenceId.slice(occurrenceIdPrefix(routineId, day.dayKey).length)), dayKey: day.dayKey };
  // Exact retry is harmless; a stale request cannot overwrite a different answer.
  if (entry.at === at && entry.status === status) return { ...result, changed: false };
  if (entry.at !== expectedAt || entry.status !== expectedStatus) return { ok: false, reason: 'target-changed' };
  const capacity = occurrenceCapacity(state, { occurrenceId, dayKey: day.dayKey, at });
  if (!capacity.ok) return capacity;
  entry.at = at;
  if (entry.completion) entry.completion.deadlineOccurredAt = Math.min(entry.completion.deadlineOccurredAt, at);
  orderRoutineLog(state.routineLog);
  return { ...result, changed: true, replaced: true, operation: 'correct', completion: entry.completion || null };
}

module.exports = { validateOccurrenceTime, correctOccurrenceTime };
