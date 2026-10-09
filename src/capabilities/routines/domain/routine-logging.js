'use strict';

// "I took it" / "I skipped it" / "no, I didn't" (ARCHITECTURE「日常与能量」).
//
// The one failure this feature cannot afford is a tap that paints as done and
// stores nothing: the curve would then disagree with the user's own memory of
// the day, and there is no way afterwards to tell which one is wrong. So every
// accepted status writes exactly one entry, and re-reporting the same occurrence
// overwrites that entry rather than appending a second — the occurrence id is
// the idempotency key, built by `core/routine-model` so the builder and the
// store's validator cannot drift apart.
//
// Undo is not an afterthought (ARCHITECTURE「日常与能量」: always undoable). `undoOccurrence` removes
// the entry outright rather than writing a compensating `missed`, because a log
// that keeps a record of a mis-tap is a log the user cannot actually correct.
//
// Free-form entries — "I just had a coffee", no schedule behind it — get a
// `free` occurrence id with a per-day sequence, so a routine with no schedule is
// loggable without inventing a scheduled time it never had.
//
// No clock here; `at` always arrives from the application layer.

const {
  ROUTINE_LOG_STATUSES,
  MAX_ROUTINE_TIMES_OF_DAY,
  TIME_OF_DAY_PATTERN,
  FREE_OCCURRENCE_MARKER,
  buildOccurrenceId,
  buildFreeOccurrenceId,
  isOccurrenceIdFor,
  occurrenceIdPrefix
} = require('../../../core/routine-model');
const { addDaysToKey } = require('../../../core/calendar');
const { findScheduledOccurrence } = require('./day-plan');

const MAX_ROUTINE_NOTE = 200;
const MAX_ROUTINE_ENTRIES_PER_DAY = 60;

function assertDraft(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('routine logging requires a state draft');
  }
}

function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('routine logging requires a timestamp the store can hold');
  }
}

function assertDayKey(dayKey) {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new TypeError('routine logging requires a day key');
  }
}

function logOf(state) {
  if (!state.routineLog || typeof state.routineLog !== 'object' || Array.isArray(state.routineLog)) {
    state.routineLog = { days: [] };
  }
  if (!Array.isArray(state.routineLog.days)) state.routineLog.days = [];
  return state.routineLog;
}

// Read-only: used by everything that might still refuse. Creating the day bucket
// here instead would make a *rejected* tap a state change — the unit of work
// compares top-level paths, so an empty `{ dayKey, entries: [] }` is enough to
// commit, bump the revision and republish a projection for something the user was
// just told didn't happen.
function entriesOf(state, dayKey) {
  const log = state.routineLog;
  if (!log || typeof log !== 'object' || Array.isArray(log) || !Array.isArray(log.days)) return [];
  const day = log.days.find(entry => entry && entry.dayKey === dayKey);
  return day && Array.isArray(day.entries) ? day.entries : [];
}

// Called only once the write is certain.
function dayOf(state, dayKey) {
  const log = logOf(state);
  let day = log.days.find(entry => entry && entry.dayKey === dayKey);
  if (!day) {
    day = { dayKey, entries: [] };
    log.days.push(day);
  }
  if (!Array.isArray(day.entries)) day.entries = [];
  return day;
}

function noteOrNull(value) {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  if (!note) return null;
  return note.slice(0, MAX_ROUTINE_NOTE);
}

// Two ways to name an occurrence, and the caller picks by what it knows:
// a scheduled tap sends the `HH:mm` occurrence id it was reminded about, a
// free-form tap sends nothing and gets the next free slot of the day. An id
// whose prefix belongs to another routine or another day is refused, not
// rewritten: storing one real occurrence under two ids is unrecoverable.
//
// `scheduled` comes back alongside the id because this is the only place that
// knows: the distinction lives in the suffix shape, and reading it off the id a
// second time downstream would be a second parser to keep in step with this one.
function resolveOccurrenceId(entries, routineId, dayKey, requested) {
  if (requested === undefined || requested === null) {
    const used = new Set(entries.map(entry => entry && entry.occurrenceId));
    for (let sequence = 0; sequence < MAX_ROUTINE_ENTRIES_PER_DAY; sequence += 1) {
      const candidate = buildFreeOccurrenceId(routineId, dayKey, sequence);
      if (!used.has(candidate)) return { ok: true, occurrenceId: candidate, scheduled: false };
    }
    return { ok: false, reason: 'day-full' };
  }
  if (typeof requested !== 'string' || !isOccurrenceIdFor(requested, routineId, dayKey)) {
    return { ok: false, reason: 'occurrence-mismatch' };
  }
  const suffix = requested.slice(occurrenceIdPrefix(routineId, dayKey).length);
  if (TIME_OF_DAY_PATTERN.test(suffix)) {
    // Rebuilt through the builder so a hand-typed id cannot slip a shape past
    // the store's validator.
    return { ok: true, occurrenceId: buildOccurrenceId(routineId, dayKey, suffix), scheduled: true };
  }
  const free = suffix.startsWith(`${FREE_OCCURRENCE_MARKER}:`)
    ? Number(suffix.slice(FREE_OCCURRENCE_MARKER.length + 1))
    : NaN;
  if (Number.isInteger(free) && free >= 0 && free < MAX_ROUTINE_ENTRIES_PER_DAY) {
    return { ok: true, occurrenceId: buildFreeOccurrenceId(routineId, dayKey, free), scheduled: false };
  }
  return { ok: false, reason: 'occurrence-mismatch' };
}

function owningDay(routine, occurrenceId, dayKey, at) {
  if (occurrenceId == null || isOccurrenceIdFor(occurrenceId, routine.id, dayKey)) return dayKey;
  const scheduled = findScheduledOccurrence({ routine, occurrenceId, dayKey, now: at });
  return scheduled?.due ? scheduled.dayKey : null;
}

function logOccurrence(state, { routineId, occurrenceId, status, note, magnitude, dayKey, at } = {}) {
  assertDraft(state);
  assertNow(at);
  assertDayKey(dayKey);
  const routines = Array.isArray(state.routines) ? state.routines : [];
  const routine = routines.find(item => item && item.id === routineId);
  if (!routine) return { ok: false, reason: 'routine-not-found' };
  if (!ROUTINE_LOG_STATUSES.includes(status)) return { ok: false, reason: 'status-unknown' };
  dayKey = owningDay(routine, occurrenceId, dayKey, at);
  if (dayKey === null) return { ok: false, reason: 'occurrence-mismatch' };
  const existingEntries = entriesOf(state, dayKey);
  const resolved = resolveOccurrenceId(existingEntries, routineId, dayKey, occurrenceId);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const entry = {
    occurrenceId: resolved.occurrenceId,
    routineId,
    status,
    at,
    note: noteOrNull(note),
    magnitude: Number.isInteger(magnitude) && magnitude >= 1 && magnitude <= 100 ? magnitude : null
  };
  // Reported, not stored: ARCHITECTURE「日常与能量」's timeline payload wants the routine's kind and
  // whether this was a scheduled slot, and the caller has no honest way to get
  // either afterwards — the post-commit recorder does not read state, and the
  // routine may have been edited between the tap and the append. `title` stays out
  // on purpose (ARCHITECTURE「日常与能量」): a permanent event table is the wrong place for "吃阿立哌唑".
  const kind = routine.kind || null;
  const { scheduled } = resolved;
  const index = existingEntries.findIndex(existing => existing && existing.occurrenceId === entry.occurrenceId);
  // Re-reporting the same occurrence replaces it. A second row for one real event
  // is what makes a log stop being readable.
  if (index >= 0 && JSON.stringify(existingEntries[index]) === JSON.stringify(entry)) {
    return { ok: true, changed: false, occurrenceId: entry.occurrenceId, status, kind, scheduled, dayKey };
  }
  if (index < 0 && existingEntries.length >= MAX_ROUTINE_ENTRIES_PER_DAY) {
    return { ok: false, reason: 'day-full' };
  }
  // Past every refusal, so the bucket is created only for a write that happens.
  const day = dayOf(state, dayKey);
  if (index >= 0) {
    day.entries[index] = entry;
    return { ok: true, changed: true, occurrenceId: entry.occurrenceId, status, kind, scheduled, dayKey, replaced: true };
  }
  day.entries.push(entry);
  return { ok: true, changed: true, occurrenceId: entry.occurrenceId, status, kind, scheduled, dayKey, replaced: false };
}

// The reminder sampler's write, and the reason `notified` is not something the
// user can tap: it records that the app *showed* a reminder for this occurrence,
// which is what lets the day plan stop raising it every tick and, once the window
// closes unanswered, witness a real `missed` (ARCHITECTURE「日常与能量」 option (b)). It is a strictly
// weaker write than `logOccurrence`:
//   - It NEVER overwrites an existing entry. If the user already answered, or a
//     prior tick already marked `notified`, the row stands and this returns
//     `changed: false`. Treating a reminder as louder than the user's own answer
//     is the one thing a medication log must never do.
//   - `status` is fixed to `notified`; there is no status argument to get wrong.
// Same idempotency key and same refusals as `logOccurrence`, so a hand-built id
// for another routine or day is refused rather than rewritten.
function noteReminded(state, { routineId, occurrenceId, dayKey, at } = {}) {
  assertDraft(state);
  assertNow(at);
  assertDayKey(dayKey);
  const routines = Array.isArray(state.routines) ? state.routines : [];
  const routine = routines.find(item => item && item.id === routineId);
  if (!routine) return { ok: false, reason: 'routine-not-found' };
  dayKey = owningDay(routine, occurrenceId, dayKey, at);
  if (dayKey === null) return { ok: false, reason: 'occurrence-mismatch' };
  const existingEntries = entriesOf(state, dayKey);
  const resolved = resolveOccurrenceId(existingEntries, routineId, dayKey, occurrenceId);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const kind = routine.kind || null;
  const { scheduled } = resolved;
  const existing = existingEntries.find(entry => entry && entry.occurrenceId === resolved.occurrenceId) || null;
  if (existing) {
    // Already answered, or already reminded — leave it exactly as it is. No draft
    // mutation, so the unit of work sees no changed path and does not commit.
    return { ok: true, changed: false, occurrenceId: resolved.occurrenceId, status: existing.status, kind, scheduled, dayKey };
  }
  if (existingEntries.length >= MAX_ROUTINE_ENTRIES_PER_DAY) {
    return { ok: false, reason: 'day-full' };
  }
  // Past every refusal, so the bucket is created only for a write that happens.
  dayOf(state, dayKey).entries.push({
    occurrenceId: resolved.occurrenceId,
    routineId,
    status: 'notified',
    at,
    note: null,
    magnitude: null
  });
  return { ok: true, changed: true, occurrenceId: resolved.occurrenceId, status: 'notified', kind, scheduled, dayKey };
}

// Removes the entry rather than writing a compensating one, so the curve loses
// the bump instead of gaining a correction nobody asked to see.
function undoOccurrence(state, { occurrenceId } = {}) {
  assertDraft(state);
  if (typeof occurrenceId !== 'string' || !occurrenceId) return { ok: false, reason: 'occurrence-required' };
  // Read the list without repairing it: an undo that finds nothing must leave the
  // draft byte-identical, or "nothing to undo" would still commit a revision.
  const log = state.routineLog;
  const days = log && typeof log === 'object' && !Array.isArray(log) && Array.isArray(log.days) ? log.days : [];
  for (const day of days) {
    if (!day || !Array.isArray(day.entries)) continue;
    const index = day.entries.findIndex(entry => entry && entry.occurrenceId === occurrenceId);
    if (index < 0) continue;
    const [removed] = day.entries.splice(index, 1);
    return { ok: true, changed: true, occurrenceId, routineId: removed.routineId, dayKey: day.dayKey };
  }
  return { ok: false, reason: 'occurrence-not-found' };
}

// The store caps the log at two days when it writes, but nothing ever drops a day
// that merely stopped being relevant: a Friday log is still the newest thing in
// there on Monday, and the curve would keep hanging Friday's late coffee off
// "yesterday". So the daily pass rolls the log forward and keeps exactly the two
// days the curve can use — today, and yesterday for the tails that cross midnight
// (`collectEffects` asks for that pair and no more).
//
// Reports `changed: false` when there is nothing to drop. The daily pass commits
// on the strength of these flags, and a log that is already correct must not bump
// a revision and republish a projection.
function rollLogForward(state, { today } = {}) {
  assertDraft(state);
  assertDayKey(today);
  const log = state.routineLog;
  const days = log && typeof log === 'object' && !Array.isArray(log) && Array.isArray(log.days)
    ? log.days
    : null;
  if (!days) return { ok: true, changed: false, droppedDayKeys: [] };
  const keep = new Set([addDaysToKey(today, -1), today]);
  // Days in the future are kept too: a clock that went backwards is not a reason
  // to delete something the user reported. They fall out on their own once the
  // calendar catches up.
  const dropped = days.filter(day => day && !keep.has(day.dayKey) && day.dayKey < today);
  if (!dropped.length) return { ok: true, changed: false, droppedDayKeys: [] };
  state.routineLog = { ...log, days: days.filter(day => !dropped.includes(day)) };
  return { ok: true, changed: true, droppedDayKeys: dropped.map(day => day.dayKey) };
}

module.exports = {
  MAX_ROUTINE_NOTE,
  MAX_ROUTINE_ENTRIES_PER_DAY,
  MAX_ROUTINE_TIMES_OF_DAY,
  logOccurrence,
  noteReminded,
  undoOccurrence,
  rollLogForward
};
