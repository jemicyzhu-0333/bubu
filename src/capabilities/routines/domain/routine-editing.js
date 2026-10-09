'use strict';

// Adding, editing and deleting a routine (ARCHITECTURE「日常与能量」).
//
// The list is the user's own: it is deduplicated by id but never sorted, and the
// order a routine was added in is the order it stays in. `normalizeRoutines`
// makes the same promise, so neither layer can quietly reshuffle what the other
// wrote.
//
// Two refusals are deliberate rather than repairs:
//   - an unknown `kind` is rejected, never mapped to a neighbour. The kind picks
//     the curve shape, and a `medication` routine silently filed as `custom`
//     would drop out of the estimate while still showing on the list.
//   - a schedule whose parts do not all parse collapses to `null` (no schedule),
//     which is what `normalizeRoutineSchedule` does too. Falling back to a daily
//     default would invent a daily reminder nobody asked for.
//
// Health constraint (ARCHITECTURE「日常与能量」): completing a routine must never produce XP, never
// affect a streak and never feed the pet, so nothing in this file touches `xp`,
// `streak`, `level` or `pet` — and the command layer's write set names only
// `routines` and `routineLog`, which is what makes that checkable rather than
// merely intended.
//
// No dose field, ever (ARCHITECTURE「日常与能量」). `effect.amplitude` is an unitless self-reported
// bump; there is no milligram anywhere in this feature.
//
// No clock. `src/capabilities/*/domain/` may not read one (the architecture check
// enforces it), so every timestamp arrives as `now` from the application layer.

const {
  MAX_ROUTINE_TITLE,
  MAX_ROUTINE_LEVEL,
  DEFAULT_ROUTINE_LEVEL,
  DEFAULT_ROUTINE_WINDOW_MINUTES,
  MIN_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_WINDOW_MINUTES,
  SCHEDULE_FREQUENCIES,
  normalizeTimesOfDay,
  occurrenceIdPrefix
} = require('../../../core/routine-model');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MAX_ROUTINES = 40;

function assertDraft(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('routine editing requires a state draft');
  }
}

// Spelled the way `normalizeTimestamp` spells it: a fractional or negative `now`
// is one the store would read back as `null`, so refusing it here is the
// difference between a caught bug and an `updatedAt` that never sticks.
function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('routine editing requires a timestamp the store can hold');
  }
}

function routinesOf(state) {
  if (!Array.isArray(state.routines)) state.routines = [];
  return state.routines;
}

function titleOrNull(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (!title || title.length > MAX_ROUTINE_TITLE) return null;
  return title;
}

// All-or-nothing, matching `normalizeRoutineSchedule`. An empty `timesOfDay` is
// also `null`: one state with two spellings is how a normalizer stops being a
// fixed point, and it would also mean "scheduled, but at no time".
function normalizeSchedule(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!SCHEDULE_FREQUENCIES.includes(raw.frequency)) return null;
  const timesOfDay = normalizeTimesOfDay(raw.timesOfDay);
  if (!timesOfDay.length) return null;
  let weekdays = [];
  if (raw.frequency === 'weekly') {
    // Strict membership, never clamped: a `9` clamped to `7` would come back as
    // a Sunday the user never picked.
    const days = Array.isArray(raw.weekdays) ? raw.weekdays : [];
    weekdays = [...new Set(days.filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
    if (!weekdays.length) return null;
  }
  const window = Number.isInteger(raw.windowMinutes) ? raw.windowMinutes : DEFAULT_ROUTINE_WINDOW_MINUTES;
  if (window < MIN_ROUTINE_WINDOW_MINUTES || window > MAX_ROUTINE_WINDOW_MINUTES) return null;
  return { frequency: raw.frequency, timesOfDay, weekdays, windowMinutes: window };
}

// `custom` is a pure reminder with no curve contribution, so it carries no
// effect at all — cleared here rather than trusted from the caller, because a
// routine whose kind was edited to `custom` would otherwise keep bumping the
// estimate while the UI shows no effect.
function normalizeEffect(kind, raw, profiles) {
  if (kind === 'custom') return null;
  const profile = profiles && profiles[kind];
  if (!profile) return null;
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const editable = profile.editable || {};
  const amplitude = clampToEditable(source.amplitude, profile.amplitude, editable.amplitude);
  const durationMin = clampToEditable(source.durationMin, profile.durationMin, editable.durationMin);
  return { profileId: profile.profileId || kind, amplitude, durationMin };
}

// Clamps rather than rejects, and only inside the bounds the content table calls
// editable. The default is the profile's own value, so "I did not touch this"
// and "I typed the default" end up as the same stored routine.
function clampToEditable(value, fallback, bounds) {
  if (!Number.isInteger(value)) return fallback;
  if (!Array.isArray(bounds) || bounds.length !== 2) return fallback;
  const [low, high] = bounds;
  return Math.min(Math.max(value, low), high);
}

function levelOrDefault(value) {
  if (!Number.isInteger(value)) return DEFAULT_ROUTINE_LEVEL;
  return Math.min(Math.max(value, 1), MAX_ROUTINE_LEVEL);
}

function addRoutine(state, { title, kind, customLabel, schedule, effect, maxLevel, active, profiles, idFactory, now } = {}) {
  assertDraft(state);
  assertNow(now);
  if (typeof idFactory !== 'function') throw new TypeError('routine editing requires an id factory');
  const kinds = profiles ? Object.keys(profiles) : [];
  const cleanTitle = titleOrNull(title);
  if (!cleanTitle) return { ok: false, reason: 'title-required' };
  if (customLabel !== undefined && !titleOrNull(customLabel)) return { ok: false, reason: 'title-required' };
  if (!kinds.includes(kind)) return { ok: false, reason: 'kind-unknown' };
  const routines = routinesOf(state);
  if (routines.length >= MAX_ROUTINES) return { ok: false, reason: 'routine-limit' };
  const used = new Set(routines.map(routine => routine.id));
  let id = null;
  for (let attempt = 0; attempt < 8 && !id; attempt += 1) {
    const candidate = idFactory('routine');
    if (typeof candidate === 'string' && ID_PATTERN.test(candidate) && !used.has(candidate)) id = candidate;
  }
  if (!id) return { ok: false, reason: 'id-unavailable' };
  const routine = {
    id,
    title: cleanTitle,
    kind,
    ...(kind === 'custom' && customLabel ? { customLabel: titleOrNull(customLabel) } : {}),
    schedule: normalizeSchedule(schedule),
    effect: normalizeEffect(kind, effect, profiles),
    maxLevel: levelOrDefault(maxLevel),
    active: active === undefined ? true : Boolean(active),
    createdAt: now,
    updatedAt: now
  };
  routines.push(routine);
  return { ok: true, changed: true, routineId: id, routine };
}

// A patch, not a replacement: an absent key means "leave it alone". Spelling it
// this way is what lets the surface send one field without having to resend a
// schedule it never showed the user.
function updateRoutine(state, { routineId, patch, profiles, now } = {}) {
  assertDraft(state);
  assertNow(now);
  const routines = routinesOf(state);
  const index = routines.findIndex(routine => routine && routine.id === routineId);
  if (index < 0) return { ok: false, reason: 'routine-not-found' };
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const current = routines[index];
  const next = { ...current };
  if ('title' in source) {
    const title = titleOrNull(source.title);
    if (!title) return { ok: false, reason: 'title-required' };
    next.title = title;
  }
  if ('kind' in source) {
    const kinds = profiles ? Object.keys(profiles) : [];
    if (!kinds.includes(source.kind)) return { ok: false, reason: 'kind-unknown' };
    next.kind = source.kind;
    // Changing the kind re-derives the effect from the new profile: keeping the
    // old amplitude would leave a `meal` routine bumping the curve the way
    // medication does.
    next.effect = normalizeEffect(source.kind, 'effect' in source ? source.effect : null, profiles);
  } else if ('effect' in source) {
    next.effect = normalizeEffect(next.kind, source.effect, profiles);
  }
  if ('customLabel' in source) {
    const label = titleOrNull(source.customLabel);
    if (!label) return { ok: false, reason: 'title-required' };
    next.customLabel = label;
  }
  if (next.kind !== 'custom') delete next.customLabel;
  if ('schedule' in source) next.schedule = normalizeSchedule(source.schedule);
  if ('maxLevel' in source) next.maxLevel = levelOrDefault(source.maxLevel);
  if ('active' in source) next.active = Boolean(source.active);
  // Same value in means no write out, so the unit of work sees nothing to
  // commit and the surface does not get a redraw for a no-op.
  if (JSON.stringify(next) === JSON.stringify({ ...current, updatedAt: current.updatedAt })) {
    return { ok: true, changed: false, routineId };
  }
  next.updatedAt = now;
  routines[index] = next;
  return { ok: true, changed: true, routineId, routine: next };
}

// Deleting a routine deletes the same-day log entries that belong to it (ARCHITECTURE「日常与能量」:
// always undoable, always deletable). Leaving them behind would keep the curve
// bumped by something the user can no longer see, let alone remove — which is
// the exact shape of "the app remembers my medication after I deleted it".
function removeRoutine(state, { routineId } = {}) {
  assertDraft(state);
  const routines = routinesOf(state);
  const index = routines.findIndex(routine => routine && routine.id === routineId);
  if (index < 0) return { ok: false, reason: 'routine-not-found' };
  routines.splice(index, 1);
  let removedEntries = 0;
  const log = state.routineLog && typeof state.routineLog === 'object' && !Array.isArray(state.routineLog)
    ? state.routineLog
    : null;
  const days = log && Array.isArray(log.days) ? log.days : [];
  for (const day of days) {
    if (!day || !Array.isArray(day.entries)) continue;
    const prefix = occurrenceIdPrefix(routineId, day.dayKey);
    const kept = day.entries.filter(entry => !(entry && typeof entry.occurrenceId === 'string'
      && entry.occurrenceId.startsWith(prefix)));
    removedEntries += day.entries.length - kept.length;
    day.entries = kept;
  }
  return { ok: true, changed: true, routineId, removedEntries };
}

module.exports = {
  SCHEDULE_FREQUENCIES,
  MAX_ROUTINES,
  addRoutine,
  updateRoutine,
  removeRoutine
};
