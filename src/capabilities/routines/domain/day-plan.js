'use strict';

// What today looks like: one row per scheduled occurrence, plus anything logged
// today that no schedule asked for.
//
// Two consumers need exactly this list and must not disagree about it — the panel
// draws it, and the reminder sampler decides from it what to raise. A second
// derivation would eventually show a row as due in one place and missed in the
// other, on the same screen.
//
// `missed` is derived here, never stored. ARCHITECTURE「日常与能量」 is explicit that there is no
// overdue list: a window closes, the row goes quiet, and nothing accumulates. The
// only way `missed` reaches the store is if the user says so.
//
// No clock: `now` and `dayKey` both arrive from the application layer, which is
// also what lets the panel and the sampler agree on "now" within one tick.

const { parseDayKey, addDaysToKey, localDayKey } = require('../../../core/calendar');
const {
  TIME_OF_DAY_PATTERN,
  DEFAULT_ROUTINE_WINDOW_MINUTES,
  buildOccurrenceId,
  occurrenceIdPrefix
} = require('../../../core/routine-model');

const MINUTE_MS = 60 * 1000;

// Built from explicit parts rather than by adding minutes to midnight, for the
// reason `localDayStart` records: on a DST boundary the day is not 24 hours long,
// so "08:30" is 08:30 local and not "midnight plus 510 minutes".
function instantAt(dayKey, timeOfDay) {
  const { year, month, day } = parseDayKey(dayKey);
  const hours = Number(timeOfDay.slice(0, 2));
  const minutes = Number(timeOfDay.slice(3, 5));
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

function isoWeekdayOf(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  const weekday = new Date(year, month - 1, day, 12).getDay();
  return weekday === 0 ? 7 : weekday;
}

function happensOn(schedule, weekday) {
  if (!schedule) return false;
  if (schedule.frequency === 'daily') return true;
  if (schedule.frequency === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (schedule.frequency === 'weekly') {
    return Array.isArray(schedule.weekdays) && schedule.weekdays.includes(weekday);
  }
  return false;
}

function windowOf(schedule) {
  const minutes = schedule && Number.isInteger(schedule.windowMinutes)
    ? schedule.windowMinutes
    : DEFAULT_ROUTINE_WINDOW_MINUTES;
  return minutes * MINUTE_MS;
}

function entriesFor(routineLog, dayKey) {
  const days = routineLog && Array.isArray(routineLog.days) ? routineLog.days : [];
  const day = days.find(entry => entry && entry.dayKey === dayKey);
  return day && Array.isArray(day.entries) ? day.entries : [];
}

// `notified` is not an answer. A row the user was reminded about but has not
// replied to is still open, so it keeps its due/upcoming state and stays
// answerable — treating the reminder as the reply is how a log ends up recording
// that the app did something rather than that the user did.
function answered(entry) {
  return Boolean(entry) && entry.status !== 'notified';
}

function phaseOf(scheduledAt, windowMs, now) {
  if (now < scheduledAt) return 'upcoming';
  if (now <= scheduledAt + windowMs) return 'due';
  return 'past';
}

function findScheduledOccurrence({ routine, occurrenceId, dayKey, now } = {}) {
  if (!routine || routine.active === false || !Number.isSafeInteger(now)) return null;
  for (const date of [dayKey, addDaysToKey(dayKey, -1)]) {
    if (Number.isSafeInteger(routine.createdAt) && localDayKey(routine.createdAt) > date) continue;
    if (!happensOn(routine.schedule, isoWeekdayOf(date))) continue;
    for (const time of routine.schedule.timesOfDay || []) {
      if (!TIME_OF_DAY_PATTERN.test(time) || buildOccurrenceId(routine.id, date, time) !== occurrenceId) continue;
      const scheduledAt = instantAt(date, time), windowEndsAt = scheduledAt + windowOf(routine.schedule);
      return { occurrenceId, routineId: routine.id, dayKey: date, scheduledAt, windowEndsAt,
        due: phaseOf(scheduledAt, windowOf(routine.schedule), now) === 'due' };
    }
  }
  return null;
}

function buildDayPlan({ routines, routineLog, dayKey, now, includeCarryover = true } = {}) {
  if (typeof dayKey !== 'string') throw new TypeError('day plan requires a day key');
  if (!Number.isSafeInteger(now)) throw new TypeError('day plan requires a timestamp');
  const list = Array.isArray(routines) ? routines.filter(Boolean) : [];
  const entries = entriesFor(routineLog, dayKey);
  const weekday = isoWeekdayOf(dayKey);
  const byOccurrence = new Map(entries.filter(entry => entry && entry.occurrenceId)
    .map(entry => [entry.occurrenceId, entry]));
  const claimed = new Set();
  const occurrences = [];

  for (const routine of list) {
    if (routine.active === false) continue;
    if (Number.isSafeInteger(routine.createdAt) && localDayKey(routine.createdAt) > dayKey) continue;
    const schedule = routine.schedule;
    if (!happensOn(schedule, weekday)) continue;
    const windowMs = windowOf(schedule);
    const times = Array.isArray(schedule.timesOfDay) ? schedule.timesOfDay : [];
    for (const timeOfDay of times) {
      if (!TIME_OF_DAY_PATTERN.test(timeOfDay)) continue;
      const occurrenceId = buildOccurrenceId(routine.id, dayKey, timeOfDay);
      const entry = byOccurrence.get(occurrenceId) || null;
      if (entry) claimed.add(occurrenceId);
      const scheduledAt = instantAt(dayKey, timeOfDay);
      const phase = phaseOf(scheduledAt, windowMs, now);
      occurrences.push({
        occurrenceId,
        routineId: routine.id,
        title: routine.title,
        kind: routine.kind,
        timeOfDay,
        scheduledAt,
        dayKey,
        windowEndsAt: scheduledAt + windowMs,
        scheduled: true,
        // The stored answer wins; only an unanswered row gets a derived state.
        status: answered(entry) ? entry.status : (phase === 'past' ? 'missed' : null),
        answered: answered(entry),
        due: !answered(entry) && phase === 'due',
        upcoming: !answered(entry) && phase === 'upcoming',
        loggedAt: entry ? entry.at : null,
        note: entry ? entry.note || null : null,
        magnitude: entry && Number.isInteger(entry.magnitude) ? entry.magnitude : null
      });
    }
  }

  // Free-form taps — "I just had a coffee", and re-reports of an occurrence whose
  // schedule has since been edited away. They are shown because they are in the
  // log: a stored answer the panel does not draw is the same failure as a tap
  // that stored nothing, seen from the other side.
  const titles = new Map(list.map(routine => [routine.id, routine]));
  for (const entry of entries) {
    if (!entry || !entry.occurrenceId || claimed.has(entry.occurrenceId)) continue;
    if (occurrences.some(item => item.occurrenceId === entry.occurrenceId)) continue;
    const routine = titles.get(entry.routineId) || null;
    if (!routine) continue;
    const prefix = occurrenceIdPrefix(entry.routineId, dayKey);
    occurrences.push({
      occurrenceId: entry.occurrenceId,
      routineId: entry.routineId,
      title: routine.title,
      kind: routine.kind,
      timeOfDay: null,
      dayKey,
      scheduledAt: entry.at,
      scheduled: false,
      status: entry.status,
      answered: answered(entry),
      due: false,
      upcoming: false,
      loggedAt: entry.at,
      note: entry.note || null,
      magnitude: Number.isInteger(entry.magnitude) ? entry.magnitude : null,
      freeForm: entry.occurrenceId.startsWith(prefix)
    });
  }

  if (includeCarryover) {
    const previous = buildDayPlan({ routines, routineLog, dayKey: addDaysToKey(dayKey, -1), now, includeCarryover: false });
    occurrences.push(...previous.occurrences.filter(item => item.scheduled && item.scheduledAt <= now && now <= item.windowEndsAt));
  }

  occurrences.sort((left, right) => left.scheduledAt - right.scheduledAt
    || left.occurrenceId.localeCompare(right.occurrenceId));

  const done = occurrences.filter(item => item.status === 'done').length;
  return {
    dayKey,
    occurrences,
    counts: {
      total: occurrences.length,
      done,
      open: occurrences.filter(item => !item.answered && item.status === null).length,
      due: occurrences.filter(item => item.due).length
    }
  };
}

// What the sampler should raise right now: a scheduled occurrence in its window,
// still unanswered, that the app has not already shown a reminder for. A stored
// `notified` entry sets `loggedAt` (its `at`) while leaving `answered` false — so
// the row is still `due`, but this filter drops it, which is exactly what stops a
// 30-second tick from re-raising the same reminder every tick. `loggedAt == null`
// is therefore "not yet reminded", not "not yet answered".
function dueOccurrences({ routines, routineLog, dayKey, now } = {}) {
  return buildDayPlan({ routines, routineLog, dayKey, now }).occurrences
    .filter(occurrence => occurrence.scheduled && occurrence.due && occurrence.loggedAt == null);
}

// The only data-integrity-sound producer of `routine.missed` (ARCHITECTURE「日常与能量」, option (b)):
// a scheduled window the app itself watched pass unanswered. The proof it watched
// is a stored `notified` entry — so `status === 'missed'` (past + unanswered) AND
// `loggedAt != null` (a reminder was shown in-process) together mean "raised while
// running, then the window closed with no reply". A window that passed while the
// app was closed has no `notified` entry, so `loggedAt` is null and it is excluded
// — that is the whole point of the pairing (writing "you missed a week of meds"
// for days the user actually took them is worse than writing nothing).
function witnessedMissedOccurrences({ routines, routineLog, dayKey, now } = {}) {
  const current = buildDayPlan({ routines, routineLog, dayKey, now }).occurrences;
  const previous = buildDayPlan({ routines, routineLog, dayKey: addDaysToKey(dayKey, -1), now, includeCarryover: false }).occurrences
    .filter(item => item.scheduled && item.windowEndsAt >= instantAt(dayKey, '00:00'));
  return [...current, ...previous]
    .filter(occurrence => occurrence.scheduled && !occurrence.answered && occurrence.status === 'missed' && occurrence.loggedAt != null);
}

module.exports = { findScheduledOccurrence, buildDayPlan, dueOccurrences, witnessedMissedOccurrences };
