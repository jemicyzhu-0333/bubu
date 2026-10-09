'use strict';

// Routine vocabulary that has more than one consumer, kept in core so each
// consumer can reach it by an inward import.
//
// This is not a grab bag. Every name here is needed by at least two of
// `src/capabilities/routines/` (domain rules and payload validation),
// `src/capabilities/attention/` (delivering routine reminders) and
// `src/platform/persistence/` (validating the stored shape) — and capabilities
// cannot import platform, so parking these in the persistence module would have
// forced a second copy of a frozen enum. Limits that only describe how much a
// *store* may hold stay in `persisted-schema.js`; see the two-tier note in
// `src/capabilities/work/contract/task-limits.mjs` for the same split.
//
// The kind enum deliberately does NOT live here: kinds are the keys of the
// effect table in `src/content/energy-effects.mjs`, and content cannot import
// core. One definition, imported inward by everyone who needs it.

const ROUTINE_LOG_STATUSES = Object.freeze(['done', 'skipped', 'missed', 'notified']);

// The subset a person can actually tap. `notified` is written by the in-process
// reminder sampler when it raises a nudge, and `missed` is derived live by the
// day plan and never stored (ARCHITECTURE「日常与能量」) — neither is a thing the user reports, so
// neither may arrive over IPC. The store still validates against the full enum
// (a `notified` entry is a legitimate stored shape); this narrower list is what
// the `routines:log` codec accepts, so a reminder surface cannot forge either
// machine-only status through the one channel it is granted.
const ROUTINE_LOGGABLE_STATUSES = Object.freeze(['done', 'skipped']);

// Deliberately not the work model's `RECURRENCE_FREQUENCIES`. A routine repeats
// inside a week — `'weekdays'` is the shape half of them have (medication on
// working days) — and never monthly, while a task needs monthly and has no use
// for `'weekdays'`. The two enums look similar and mean different things, so they
// stay apart; sharing one would force each consumer to reject the other's members
// at every call site, which is exactly the check that gets forgotten once.
//
// There is no `interval`, `strategy` or `anchorDate` alongside it: a routine
// happens on the days it names, `'after-completion'` has no meaning for something
// with no completion to chain from, and an anchor would let a routine be
// scheduled to start in the future — a feature nobody asked for and a reminder
// that silently never fires.
const SCHEDULE_FREQUENCIES = Object.freeze(['daily', 'weekdays', 'weekly']);

// Zero-padded 24-hour local time. Zero-padding is not cosmetic: it makes the
// strings sort chronologically as text, which is what lets `normalizeTimesOfDay`
// and the occurrence id ordering avoid parsing time at all.
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ROUTINE_TIMES_OF_DAY = 6;
const MAX_ROUTINE_TITLE = 40;

// How long after a scheduled time the reminder is still worth showing. Past the
// window the occurrence becomes `missed` silently — there is no overdue list,
// because a growing list of things you failed to do is the opposite of help.
const MIN_ROUTINE_WINDOW_MINUTES = 5;
const MAX_ROUTINE_WINDOW_MINUTES = 240;
const DEFAULT_ROUTINE_WINDOW_MINUTES = 60;

// Escalation step 4 takes the whole workspace. A reminder about something other
// than what the user is currently doing has no business doing that, so routine
// reminders are capped at 3 as policy rather than as a data bound.
const MAX_ROUTINE_LEVEL = 3;
const DEFAULT_ROUTINE_LEVEL = 2;

// Free-form entries — "I just had a coffee" with no schedule behind it — are
// still identified per day, so a routine with no schedule is loggable without
// inventing a fake time for it.
const FREE_OCCURRENCE_MARKER = 'free';

// `<routineId>:<dayKey>:…` is the only reason logging is idempotent: re-reporting
// the same occurrence collides with the same id instead of appending a second
// row. Builder and validator live together on purpose — if they ever disagreed
// about the separator or the order, one real occurrence would be stored twice
// with no way afterwards to tell which row is the wrong one.
//
// Routine ids match `ID_PATTERN` (see `src/core/companion-state.js`), which
// excludes `:`, so the prefix is unambiguous.
function occurrenceIdPrefix(routineId, dayKey) {
  return `${routineId}:${dayKey}:`;
}

function buildOccurrenceId(routineId, dayKey, timeOfDay) {
  if (!TIME_OF_DAY_PATTERN.test(timeOfDay)) throw new TypeError('occurrence time must be HH:mm');
  return `${occurrenceIdPrefix(routineId, dayKey)}${timeOfDay}`;
}

function buildFreeOccurrenceId(routineId, dayKey, sequence) {
  if (!Number.isInteger(sequence) || sequence < 0) throw new TypeError('occurrence sequence must be a non-negative integer');
  return `${occurrenceIdPrefix(routineId, dayKey)}${FREE_OCCURRENCE_MARKER}:${sequence}`;
}

function isOccurrenceIdFor(occurrenceId, routineId, dayKey) {
  return typeof occurrenceId === 'string' && occurrenceId.startsWith(occurrenceIdPrefix(routineId, dayKey));
}

// Rejects rather than repairs: an unparseable time is dropped, never rounded to
// a neighbouring one. Reminding the user at a time they did not configure is the
// single failure this whole feature cannot afford.
function normalizeTimesOfDay(raw) {
  if (!Array.isArray(raw)) return [];
  const times = raw.filter(value => typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value));
  return [...new Set(times)].sort().slice(0, MAX_ROUTINE_TIMES_OF_DAY);
}

module.exports = {
  ROUTINE_LOG_STATUSES,
  ROUTINE_LOGGABLE_STATUSES,
  SCHEDULE_FREQUENCIES,
  TIME_OF_DAY_PATTERN,
  MAX_ROUTINE_TIMES_OF_DAY,
  MAX_ROUTINE_TITLE,
  MIN_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_WINDOW_MINUTES,
  DEFAULT_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_LEVEL,
  DEFAULT_ROUTINE_LEVEL,
  FREE_OCCURRENCE_MARKER,
  occurrenceIdPrefix,
  buildOccurrenceId,
  buildFreeOccurrenceId,
  isOccurrenceIdFor,
  normalizeTimesOfDay
};
