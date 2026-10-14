'use strict';

const { addDaysToKey, localDayKey } = require('../../../core/calendar');

const MAX_ROUTINE_ENTRIES_PER_DAY = 60;
const MAX_ROUTINE_LOG_ENTRIES = 120;

function allEntries(state) {
  return (state.routineLog?.days || []).flatMap(day => day.entries || []);
}

function actualDay(entry) {
  return Number.isSafeInteger(entry?.at) && entry.at >= 0 && entry.at <= 8.64e15 ? localDayKey(entry.at) : null;
}

// Owner buckets preserve identity, while admission is bounded by actual activity
// dates. Existing schema-19 data can exceed 60 on one actual date: never truncate
// it or refuse an in-place edit that does not add to that date's population.
function occurrenceCapacity(state, { occurrenceId, dayKey, at } = {}) {
  const entries = allEntries(state);
  const matches = entries.filter(entry => entry.occurrenceId === occurrenceId);
  if (matches.length > 1) return { ok: false, reason: 'occurrence-conflict' };
  const existing = matches[0];
  const targetDay = actualDay({ at });
  if (!targetDay) return { ok: false, reason: 'invalid-occurrence-time' };
  if (!existing) {
    if (entries.length >= MAX_ROUTINE_LOG_ENTRIES) return { ok: false, reason: 'log-full' };
    const owner = state.routineLog?.days?.find(day => day.dayKey === dayKey);
    if ((owner?.entries?.length || 0) >= MAX_ROUTINE_ENTRIES_PER_DAY) return { ok: false, reason: 'day-full' };
  }
  if ((!existing || actualDay(existing) !== targetDay)
      && entries.filter(entry => actualDay(entry) === targetDay).length >= MAX_ROUTINE_ENTRIES_PER_DAY) {
    return { ok: false, reason: 'day-full' };
  }
  return { ok: true };
}

function hasOccurrenceCapacity(state, input) {
  return occurrenceCapacity(state, input).ok;
}

// ARCHITECTURE「日常与能量」: retention follows actual timestamps, never the
// date embedded in an occurrence identity. A corrected old slot may remain in
// its owner bucket for several days; it still consumes the same global capacity.
function rollLogForward(state, { today } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('routine logging requires a state draft');
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new TypeError('routine logging requires a day key');
  const days = state.routineLog?.days;
  if (!Array.isArray(days)) return { ok: true, changed: false, droppedDayKeys: [] };
  const oldest = addDaysToKey(today, -1), keptDays = [], droppedDayKeys = [];
  let changed = false;
  for (const day of days) {
    const entries = day.entries.filter(entry => {
      const date = actualDay(entry);
      // Unknown legacy times and future records (clock rollback) are not proof
      // of expiry. They remain bounded by the same global 120-entry ceiling.
      return date === null || date >= oldest;
    });
    if (entries.length !== day.entries.length) changed = true;
    if (entries.length) keptDays.push({ ...day, entries });
    else { changed = true; droppedDayKeys.push(day.dayKey); }
  }
  if (changed) state.routineLog = { ...state.routineLog, days: keptDays };
  return { ok: true, changed, droppedDayKeys };
}

module.exports = { MAX_ROUTINE_ENTRIES_PER_DAY, MAX_ROUTINE_LOG_ENTRIES, allEntries, actualDay,
  occurrenceCapacity, hasOccurrenceCapacity, rollLogForward };
