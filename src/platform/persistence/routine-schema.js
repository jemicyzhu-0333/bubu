'use strict';

// The persisted shapes for routines, their two-day occurrence log, and the
// personal energy calibration profile (ARCHITECTURE「日常与能量」).
//
// Split out of `persisted-schema.js` because it is genuinely separable, not to
// make a line count smaller: nothing here reads a task, a setting or the pet,
// and nothing there reads a routine. `persisted-schema.js` composes these three
// normalizers into the whole-store read and re-exports them, so every import
// path stays exactly where it was.
//
// The energy profile lives here rather than in a file of its own because it is
// calibrated *from* the routine log: the two shapes change together, and both
// need the reject-rather-than-clamp helpers below.
//
// One rule governs every field in this file, and it is the opposite of the
// clamping the task model does: **never invent a value the user did not give.**
// `optionalInteger` turns a tampered `[9]` weekday into Sunday and a window of
// `999` into 240 — a schedule the user never set, silently blessed. Here an
// out-of-range value means the data cannot be trusted, so it becomes `null` (or
// a documented default) instead. The one deliberate exception is `maxLevel`,
// where the ceiling is a policy cap rather than user content; see there.
//
// Rejecting also fails in the safer direction: the persistence adapter validates
// current-schema state before accepting it, so a dropped field makes the normalized
// result differ from the stored snapshot and opening is refused. A clamped
// field would quietly admit data nobody wrote.

const { ID_PATTERN } = require('../../core/companion-state');
const {
  isPlainObject,
  numberInRange,
  nonNegativeInteger,
  booleanOr,
  trimmedString,
  validDayKey,
  timestampOrNull
} = require('../../core/field-normalizers');
// The kind enum is the key set of the effect table in content, not a second list
// declared here. Each kind maps to exactly one default effect shape, and `custom`
// maps to `null` — the deliberate escape hatch for "remind me about this, it has
// no energy meaning". Without it every reminder would be forced to claim an
// effect on the curve that nobody measured.
const { ROUTINE_KINDS } = require('../../content/energy-effects.mjs');
// Vocabulary shared with the routines and attention capabilities. Kept in core
// rather than here because capabilities cannot import platform; see the header of
// that module.
const {
  ROUTINE_LOG_STATUSES,
  SCHEDULE_FREQUENCIES,
  MAX_ROUTINE_TITLE,
  MIN_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_WINDOW_MINUTES,
  DEFAULT_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_LEVEL,
  DEFAULT_ROUTINE_LEVEL,
  isOccurrenceIdFor,
  normalizeTimesOfDay
} = require('../../core/routine-model');

const MAX_ROUTINES = 40;
// Two days, not one: a 23:30 nap or a 22:00 coffee has an effect tail that
// crosses midnight, and keeping only today would put a step change at 00:00 in a
// curve that is meant to be continuous. Two is the smallest window that keeps it
// continuous while staying bounded.
const MAX_ROUTINE_LOG_DAYS = 2;
const MAX_ROUTINE_ENTRIES_PER_DAY = 60;
const MAX_ROUTINE_NOTE = 200;
// A calibrated scale may at most halve or 1.5× a default effect. Wider bounds
// would let a run of noisy self-reports turn a documented shape into an
// arbitrary one, and the curve would stop being explainable.
const MIN_EFFECT_SCALE = 0.5;
const MAX_EFFECT_SCALE = 1.5;
const MAX_EFFECT_SCALE_KEYS = 32;

// Kept private to this file rather than added to `core/field-normalizers.js`.
// That module's integer helpers all clamp, and standing a rejecting near-twin
// next to `optionalInteger` in a surface imported by a dozen callers is how the
// wrong one gets picked. Every consumer of these two is in this file.
function integerInRangeOrNull(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) return null;
  // `-0` and `0` are distinct to `isDeepStrictEqual` but the same byte in JSON,
  // so a signed parameter that rounds to negative zero would compare unequal in
  // memory and equal again after a save/load round trip.
  return value === 0 ? 0 : value;
}

// Rounded so that normalization is a fixed point: these are the only persisted
// floats produced by arithmetic rather than copied from a writer, and an
// unrounded 0.7999999999999999 would keep re-serializing as a new value.
function roundedNumberOrNull(value, min, max, decimals) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

// The work model's `normalizeRecurrenceRule` is deliberately lenient: an unknown
// frequency becomes `'daily'` and a missing anchor is synthesized from the
// clock. A routine must not copy that. ARCHITECTURE「日常与能量」 allows reminding the user only at
// the times *they* configured, and falling back to `'daily'` would invent a
// daily medication reminder nobody asked for.
//
// So any invalid part collapses the whole `schedule` to `null`, which is an
// explicitly legal state (ARCHITECTURE「日常与能量」): it degrades the routine to a "log it when it
// happens" button and reminds about nothing.
//
// Shape and rules mirror `routines/domain/routine-editing.js` field for field,
// including the key order, because this normalizer has to be the identity on
// everything that domain writes. An earlier version of this file spoke work's
// nested `{ rule: { frequency, interval, strategy, anchorDate }, … }` instead; the
// two never met in a test, so every schedule the domain produced was silently
// rewritten to `null` on save and today's plan was permanently empty. Persisted
// shape and the shape its only writer produces are one decision, not two.
function normalizeRoutineSchedule(raw) {
  if (!isPlainObject(raw)) return null;
  const frequency = SCHEDULE_FREQUENCIES.includes(raw.frequency) ? raw.frequency : null;
  const timesOfDay = normalizeTimesOfDay(raw.timesOfDay);
  // An empty `timesOfDay` means zero occurrences per day, so a non-null schedule
  // built from it would be a second spelling of `null` — and one state with two
  // spellings is how a normalizer stops being a fixed point.
  if (!frequency || !timesOfDay.length) return null;
  // Weekly with no day named is the same empty schedule, so it collapses too.
  // Non-weekly carries `[]` rather than `null` for the same fixed-point reason:
  // that is the one spelling the domain writes.
  const weekdays = frequency === 'weekly' ? normalizeRoutineWeekdays(raw.weekdays) : [];
  if (weekdays === null) return null;
  // The one part of a schedule that falls back instead of collapsing it, and the
  // reason is what the field does: `frequency` and `timesOfDay` decide *when* the
  // user gets reminded, so a value they did not write there must never be
  // invented. `windowMinutes` only decides how long a reminder stays worth
  // showing — a bad one cannot move a reminder to a time nobody set, while
  // collapsing the whole schedule over it would silence a reminder the user
  // definitely did set. Between "shorter window than the file claimed" and "the
  // medication reminder stopped existing", the first is the honest failure.
  const stored = integerInRangeOrNull(raw.windowMinutes, MIN_ROUTINE_WINDOW_MINUTES, MAX_ROUTINE_WINDOW_MINUTES);
  const windowMinutes = stored === null ? DEFAULT_ROUTINE_WINDOW_MINUTES : stored;
  return { frequency, timesOfDay, weekdays, windowMinutes };
}

// A strict membership test rather than the task model's `optionalInteger(v, 1, 7)`:
// that helper clamps, so a `9` would come back as Sunday — a weekday the user
// never picked, attached to a reminder that then fires on it.
function normalizeRoutineWeekdays(raw) {
  if (!Array.isArray(raw)) return null;
  const days = [...new Set(raw.filter(value => Number.isInteger(value) && value >= 1 && value <= 7))]
    .sort((left, right) => left - right);
  return days.length ? days : null;
}

// `amplitude` and `durationMin` override the defaults from the content table.
// Neither is a dose: they describe the *shape* of an effect on an unitless
// estimate, and no field in this schema records how much of anything the user
// took (ARCHITECTURE「日常与能量」). Adding one would be the first step to giving medical advice.
function normalizeRoutineEffect(raw) {
  if (!isPlainObject(raw)) return null;
  const profileId = typeof raw.profileId === 'string' && ID_PATTERN.test(raw.profileId)
    ? raw.profileId
    : null;
  if (!profileId) return null;
  return {
    profileId,
    amplitude: integerInRangeOrNull(raw.amplitude, -100, 100),
    durationMin: integerInRangeOrNull(raw.durationMin, 1, 24 * 60)
  };
}

// Order is the user's own list order, so this is deduplicated but never sorted.
function normalizeRoutines(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const routines = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const id = typeof item.id === 'string' && ID_PATTERN.test(item.id) ? item.id : null;
    const title = trimmedString(item.title, null, MAX_ROUTINE_TITLE);
    const kind = ROUTINE_KINDS.includes(item.kind) ? item.kind : null;
    if (!id || !title || !kind || seen.has(id)) continue;
    seen.add(id);
    const createdAt = timestampOrNull(item.createdAt);
    const updatedAt = timestampOrNull(item.updatedAt);
    routines.push({
      id,
      title,
      kind,
      ...(kind === 'custom' && item.customLabel ? { customLabel: trimmedString(item.customLabel, null, MAX_ROUTINE_TITLE) } : {}),
      schedule: normalizeRoutineSchedule(item.schedule),
      // `custom` has no effect shape in the content table (ARCHITECTURE「日常与能量」) — it is a
      // pure reminder. Cleared here rather than trusted from the writer, because
      // a routine whose kind was edited would otherwise keep contributing its
      // previous kind's bump to the curve while the UI shows no effect at all.
      effect: kind === 'custom' ? null : normalizeRoutineEffect(item.effect),
      // The one field that clamps instead of rejecting. Level 4 covers the
      // workspace, and ARCHITECTURE「日常与能量」 caps routine reminders at 3 as policy: a reminder
      // about something *other* than what the user is doing has no business
      // taking the screen. Clamping down to the cap is what enforcing a ceiling
      // means, and it matches how the attention layer treats the same value.
      maxLevel: numberInRange(item.maxLevel, DEFAULT_ROUTINE_LEVEL, 1, MAX_ROUTINE_LEVEL, true),
      active: booleanOr(item.active, true),
      createdAt,
      updatedAt: updatedAt === null ? createdAt : updatedAt
    });
  }
  if (routines.length > MAX_ROUTINES) {
    throw new RangeError(`bubu data holds more than ${MAX_ROUTINES} routines`);
  }
  return routines;
}

function normalizeRoutineLogEntry(raw, dayKey) {
  if (!isPlainObject(raw)) return null;
  const routineId = typeof raw.routineId === 'string' && ID_PATTERN.test(raw.routineId)
    ? raw.routineId
    : null;
  const status = ROUTINE_LOG_STATUSES.includes(raw.status) ? raw.status : null;
  const occurrenceId = trimmedString(raw.occurrenceId, null, 200);
  if (!routineId || !status || !occurrenceId) return null;
  // Checked with the same helper that builds the id, so validator and builder
  // cannot drift apart. An id whose prefix does not match would store one real
  // occurrence as two entries, with no way afterwards to tell which is wrong.
  if (!isOccurrenceIdFor(occurrenceId, routineId, dayKey)) return null;
  return {
    occurrenceId,
    routineId,
    status,
    at: timestampOrNull(raw.at),
    note: trimmedString(raw.note, null, MAX_ROUTINE_NOTE),
    // An optional self-reported intensity on an unitless 1–100 scale — "a big
    // coffee", not "200 mg". See the dose note on `normalizeRoutineEffect`.
    magnitude: integerInRangeOrNull(raw.magnitude, 1, 100)
  };
}

// Two days, and the older one is dropped by keeping the two latest day keys.
function normalizeRoutineLog(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const seenDays = new Set();
  const days = (Array.isArray(source.days) ? source.days : [])
    .filter(isPlainObject)
    .map(day => {
      const dayKey = validDayKey(day.dayKey);
      if (!dayKey || seenDays.has(dayKey)) return null;
      seenDays.add(dayKey);
      const seenOccurrences = new Set();
      const entries = (Array.isArray(day.entries) ? day.entries : [])
        .map(entry => normalizeRoutineLogEntry(entry, dayKey))
        .filter(entry => {
          if (!entry || seenOccurrences.has(entry.occurrenceId)) return false;
          seenOccurrences.add(entry.occurrenceId);
          return true;
        })
        .sort((left, right) => Number(left.at || 0) - Number(right.at || 0)
          || left.occurrenceId.localeCompare(right.occurrenceId))
        .slice(-MAX_ROUTINE_ENTRIES_PER_DAY);
      return { dayKey, entries };
    })
    .filter(Boolean)
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey))
    .slice(-MAX_ROUTINE_LOG_DAYS);
  return { days };
}

// Uncalibrated is `null`, not a fabricated profile written for every existing
// user (ARCHITECTURE「日常与能量」). That is also why there are no defaults here: if any one of the
// four baseline parameters cannot be trusted, the whole calibration returns to
// `null`. "We do not know yet" is an honest state; "we know half of it" is not.
//
// The bounds below are only an outer envelope — "this number is not absurd".
// How far a single calibration run may move a parameter, and the narrower range
// it is pinned inside, are decided by the `editable` bounds in
// `src/content/energy-effects.mjs`, which must fit within this envelope.
function normalizeEnergyProfile(raw) {
  if (!isPlainObject(raw) || !isPlainObject(raw.baseline)) return null;
  const baseline = {
    wakeHour: integerInRangeOrNull(raw.baseline.wakeHour, 0, 23),
    // Minutes of circadian phase shift; positive is later.
    chronotypeShift: integerInRangeOrNull(raw.baseline.chronotypeShift, -240, 240),
    morningRampMinutes: integerInRangeOrNull(raw.baseline.morningRampMinutes, 15, 480),
    postLunchDipDepth: integerInRangeOrNull(raw.baseline.postLunchDipDepth, 0, 40)
  };
  if (Object.values(baseline).some(value => value === null)) return null;
  const scales = [];
  for (const [profileId, value] of Object.entries(isPlainObject(raw.effectScale) ? raw.effectScale : {})) {
    const scale = roundedNumberOrNull(value, MIN_EFFECT_SCALE, MAX_EFFECT_SCALE, 4);
    if (!ID_PATTERN.test(profileId) || scale === null) continue;
    scales.push([profileId, scale]);
  }
  if (scales.length > MAX_EFFECT_SCALE_KEYS) {
    throw new RangeError(`bubu data holds more than ${MAX_EFFECT_SCALE_KEYS} energy effect scales`);
  }
  scales.sort(([left], [right]) => left.localeCompare(right));
  return {
    baseline,
    effectScale: Object.fromEntries(scales),
    observations: nonNegativeInteger(raw.observations, 0, 1000000),
    updatedAt: timestampOrNull(raw.updatedAt),
    // Mean absolute error of the last calibration, kept so the UI can say how
    // much to trust the curve. Unreadable becomes `null` rather than `0`: zero
    // would claim the model predicted this user perfectly.
    lastResidualMae: roundedNumberOrNull(raw.lastResidualMae, 0, 100, 2)
  };
}

module.exports = {
  MAX_ROUTINES,
  MAX_ROUTINE_LOG_DAYS,
  MAX_ROUTINE_ENTRIES_PER_DAY,
  MAX_ROUTINE_NOTE,
  MIN_EFFECT_SCALE,
  MAX_EFFECT_SCALE,
  MAX_EFFECT_SCALE_KEYS,
  normalizeRoutines,
  normalizeRoutineLog,
  normalizeEnergyProfile
};
