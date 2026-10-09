'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERSISTED_SCHEMA_VERSION,
  MAX_ROUTINES,
  MAX_ROUTINE_LOG_DAYS,
  MAX_ROUTINE_ENTRIES_PER_DAY,
  MAX_ROUTINE_NOTE,
  MIN_EFFECT_SCALE,
  MAX_EFFECT_SCALE,
  MAX_EFFECT_SCALE_KEYS,
  normalizeRoutines,
  normalizeRoutineLog,
  normalizeEnergyProfile,
  normalizePersistedState
} = require('../src/platform/persistence/persisted-schema');
const {
  MAX_ROUTINE_TIMES_OF_DAY,
  MAX_ROUTINE_LEVEL,
  DEFAULT_ROUTINE_WINDOW_MINUTES,
  buildOccurrenceId,
  buildFreeOccurrenceId
} = require('../src/core/routine-model');
const {
  ROUTINE_KINDS,
  ROUTINE_EFFECT_PROFILES,
  BASELINE_EDITABLE_BOUNDS,
  EFFECT_SCALE_EDITABLE
} = require('../src/content/energy-effects.mjs');
const { normalizeCompanionState, defaultCompanionState } = require('../src/core/companion-state');

const NOW = 1_764_000_000_000;

function routine(overrides = {}) {
  return {
    id: 'routine-medication',
    title: '吃药',
    kind: 'medication',
    schedule: { frequency: 'daily', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    effect: { profileId: 'medication-default' },
    maxLevel: 2,
    active: true,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 3_600_000,
    ...overrides
  };
}

// -- routines ---------------------------------------------------------------

test('a routine keeps only the fields the user actually gave it', () => {
  const [stored] = normalizeRoutines([routine()]);
  assert.deepEqual(stored, {
    id: 'routine-medication',
    title: '吃药',
    kind: 'medication',
    // Field for field what `routines/domain/routine-editing.js` writes, key order
    // included: this normalizer has to be the identity over its only writer's
    // output, or every save would silently rewrite the schedule.
    schedule: { frequency: 'daily', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    // Overrides absent from the input stay absent as `null` rather than being
    // filled from the content default: the stored row says "use the profile",
    // and copying the profile's numbers in would freeze them at today's value.
    effect: { profileId: 'medication-default', amplitude: null, durationMin: null },
    maxLevel: 2,
    active: true,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 3_600_000
  });
});

test('a routine with no usable schedule is stored unscheduled, not repaired', () => {
  const broken = [
    // Not the task model's vocabulary: `'monthly'` is a recurrence a task can
    // have and a routine cannot, so it is refused here rather than accepted and
    // then ignored by `day-plan.js`, which would leave a routine that shows a
    // schedule in the editor and never appears on a day.
    { frequency: 'monthly', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    { frequency: 'hourly', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    { frequency: null, timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    // Weekly naming no day is the same empty schedule as no schedule at all.
    { frequency: 'weekly', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 },
    { frequency: 'weekly', timesOfDay: ['08:30'], weekdays: [0, 8], windowMinutes: 60 }
  ];
  for (const schedule of broken) {
    const [stored] = normalizeRoutines([routine({ schedule })]);
    assert.equal(stored.schedule, null, JSON.stringify(schedule));
  }

  // Zero times a day is zero occurrences a day, so it is the same statement as
  // "unscheduled" and must not be a second spelling of it.
  const [noTimes] = normalizeRoutines([routine({
    schedule: { frequency: 'daily', timesOfDay: ['8:30', 'lunch'], weekdays: [], windowMinutes: 60 }
  })]);
  assert.equal(noTimes.schedule, null);

  // A routine kept without a schedule is still a routine — it is the "I just had
  // a coffee" case, logged when it happens rather than reminded about.
  const [unscheduled] = normalizeRoutines([routine({ schedule: null })]);
  assert.equal(unscheduled.schedule, null);
  assert.equal(unscheduled.title, '吃药');
});

test('only a weekly schedule carries weekdays, and the days are not clamped', () => {
  const schedule = extra => ({ frequency: 'weekly', timesOfDay: ['08:30'], windowMinutes: 60, ...extra });

  // Strict membership, not clamping: 0 and 8 are dropped rather than pulled to
  // Sunday and Monday, because reminding on a day the user did not pick is the
  // one failure this feature cannot afford.
  const [filtered] = normalizeRoutines([routine({ schedule: schedule({ weekdays: [0, 3, 3, 8, 1] }) })]);
  assert.deepEqual(filtered.schedule.weekdays, [1, 3]);

  // `weekdays` is the frequency, not a day list — "every working day" without the
  // user naming five days, which is the shape most medication routines have and
  // the one the old nested schema could not express at all.
  const [working] = normalizeRoutines([routine({
    schedule: { frequency: 'weekdays', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60 }
  })]);
  assert.deepEqual(working.schedule, {
    frequency: 'weekdays', timesOfDay: ['08:30'], weekdays: [], windowMinutes: 60
  });

  // Non-weekly carries `[]` rather than dropping the key: the domain writes `[]`,
  // and a normalizer that spelled the same state two ways would stop being a
  // fixed point for the byte-for-byte store gate.
  const [daily] = normalizeRoutines([routine({
    schedule: { frequency: 'daily', timesOfDay: ['08:30'], weekdays: [1, 2], windowMinutes: 60 }
  })]);
  assert.deepEqual(daily.schedule.weekdays, []);
});

test('a routine window falls back to the default and times of day are capped', () => {
  const schedule = extra => ({ frequency: 'daily', timesOfDay: ['08:30'], weekdays: [], ...extra });
  // The documented exception to this file's reject-rather-than-repair rule: a bad
  // window shortens a reminder, it cannot move one, so the schedule survives. See
  // the note on `normalizeRoutineSchedule`.
  for (const windowMinutes of [undefined, 0, 4, 241, 60.5]) {
    const [stored] = normalizeRoutines([routine({ schedule: schedule({ windowMinutes }) })]);
    assert.equal(stored.schedule.windowMinutes, DEFAULT_ROUTINE_WINDOW_MINUTES, String(windowMinutes));
  }

  const many = ['23:00', '08:30', '12:00', '08:30', '09:00', '10:00', '11:00', '13:00', '14:00'];
  const [capped] = normalizeRoutines([routine({ schedule: schedule({ timesOfDay: many, windowMinutes: 60 }) })]);
  assert.equal(capped.schedule.timesOfDay.length, MAX_ROUTINE_TIMES_OF_DAY);
  assert.deepEqual(capped.schedule.timesOfDay, ['08:30', '09:00', '10:00', '11:00', '12:00', '13:00']);
});

test('a custom routine has no effect and the escalation level is the one clamped field', () => {
  const [custom] = normalizeRoutines([routine({
    id: 'routine-water', kind: 'custom', effect: { profileId: 'medication-default' }
  })]);
  assert.equal(custom.effect, null);

  // `maxLevel` is clamped rather than rejected because its ceiling is policy,
  // not data: level 4 takes over the whole workspace, and a reminder about
  // something other than the current task has no business doing that.
  const [loud] = normalizeRoutines([routine({ maxLevel: 9 })]);
  assert.equal(loud.maxLevel, MAX_ROUTINE_LEVEL);
  const [quiet] = normalizeRoutines([routine({ maxLevel: 0 })]);
  assert.equal(quiet.maxLevel, 1);
});

test('an effect override outside the storage envelope is dropped, not the whole effect', () => {
  const [stored] = normalizeRoutines([routine({
    effect: { profileId: 'medication-default', amplitude: 400, durationMin: 0 }
  })]);
  assert.deepEqual(stored.effect, { profileId: 'medication-default', amplitude: null, durationMin: null });

  // No profile means no effect at all: an amplitude with nothing to scale is not
  // a partial effect, it is an unattributable number.
  const [orphan] = normalizeRoutines([routine({ effect: { amplitude: 20 } })]);
  assert.equal(orphan.effect, null);
});

test('routine rows keep the user list order and drop the ones that identify nothing', () => {
  const stored = normalizeRoutines([
    routine({ id: 'routine-z' }),
    routine({ id: 'routine-a' }),
    routine({ id: 'routine-z', title: '重复的' }),
    routine({ id: 'Routine-Upper' }),
    routine({ id: 'routine-blank', title: '   ' }),
    routine({ id: 'routine-unknown-kind', kind: 'teleport' }),
    'not an object'
  ]);
  assert.deepEqual(stored.map(item => item.id), ['routine-z', 'routine-a']);
});

test('a routine remembers when it was created even if it never says when it changed', () => {
  const [stored] = normalizeRoutines([routine({ createdAt: 1_000, updatedAt: undefined })]);
  assert.equal(stored.updatedAt, 1_000);
  const [unknown] = normalizeRoutines([routine({ createdAt: 'yesterday', updatedAt: 'today' })]);
  assert.equal(unknown.createdAt, null);
  assert.equal(unknown.updatedAt, null);
});

test('more routines than the cap is refused rather than silently truncated', () => {
  const overflowing = Array.from({ length: MAX_ROUTINES + 1 }, (_unused, index) => routine({ id: `routine-${index}` }));
  assert.throws(() => normalizeRoutines(overflowing), RangeError);
  assert.equal(normalizeRoutines(overflowing.slice(0, MAX_ROUTINES)).length, MAX_ROUTINES);
});

// -- routineLog -------------------------------------------------------------

function logEntry(overrides = {}) {
  return {
    occurrenceId: buildOccurrenceId('routine-medication', '2026-09-17', '08:30'),
    routineId: 'routine-medication',
    status: 'done',
    at: NOW - 7_200_000,
    ...overrides
  };
}

test('a log entry always carries a note and a magnitude, even when unknown', () => {
  const { days } = normalizeRoutineLog({ days: [{ dayKey: '2026-09-17', entries: [logEntry()] }] });
  assert.deepEqual(days[0].entries[0], {
    occurrenceId: 'routine-medication:2026-09-17:08:30',
    routineId: 'routine-medication',
    status: 'done',
    at: NOW - 7_200_000,
    // Always present rather than optional: an absent key and a `null` one are
    // the same fact, and only one of them can be compared byte for byte.
    note: null,
    magnitude: null
  });

  // Free text is the one place truncation beats rejection: the user's words are
  // worth keeping, and dropping a whole note because it ran ten characters long
  // would lose them. Unlike a number, a shortened note cannot claim something the
  // user did not — and `slice` on an already-short string is a no-op, so the
  // byte-for-byte store gate still sees a fixed point.
  const long = normalizeRoutineLog({
    days: [{ dayKey: '2026-09-17', entries: [logEntry({ note: 'x'.repeat(MAX_ROUTINE_NOTE + 10), magnitude: 0 })] }]
  });
  const [truncated] = long.days[0].entries;
  assert.equal(truncated.note.length, MAX_ROUTINE_NOTE);
  assert.deepEqual(normalizeRoutineLog(long), long);

  // A magnitude, by contrast, is rejected: 0 is outside the scale, and there is
  // no honest nearest value to move it to.
  assert.equal(truncated.magnitude, null);

  const blank = normalizeRoutineLog({ days: [{ dayKey: '2026-09-17', entries: [logEntry({ note: '   ' })] }] });
  assert.equal(blank.days[0].entries[0].note, null);
});

test('an occurrence id that does not belong to its routine and day is dropped', () => {
  const day = entries => normalizeRoutineLog({ days: [{ dayKey: '2026-09-17', entries }] }).days[0].entries;

  assert.equal(day([logEntry({ occurrenceId: buildOccurrenceId('routine-other', '2026-09-17', '08:30') })]).length, 0);
  assert.equal(day([logEntry({ occurrenceId: buildOccurrenceId('routine-medication', '2026-09-16', '08:30') })]).length, 0);
  assert.equal(day([logEntry({ occurrenceId: 'routine-medication' })]).length, 0);
  assert.equal(day([logEntry({ status: 'maybe' })]).length, 0);

  // A free-form entry is identified per day too, so logging something with no
  // schedule behind it does not require inventing a time for it.
  const free = day([logEntry({ occurrenceId: buildFreeOccurrenceId('routine-medication', '2026-09-17', 0) })]);
  assert.equal(free.length, 1);
  assert.equal(free[0].occurrenceId, 'routine-medication:2026-09-17:free:0');
});

test('reporting the same occurrence twice does not append a second row', () => {
  const { days } = normalizeRoutineLog({
    days: [{
      dayKey: '2026-09-17',
      entries: [logEntry(), logEntry({ status: 'skipped', at: NOW }), logEntry({ occurrenceId: buildOccurrenceId('routine-medication', '2026-09-17', '20:30') })]
    }]
  });
  assert.deepEqual(days[0].entries.map(entry => entry.occurrenceId), [
    'routine-medication:2026-09-17:08:30',
    'routine-medication:2026-09-17:20:30'
  ]);
  assert.equal(days[0].entries[0].status, 'done');
});

test('the log keeps two days and the newest entries within them', () => {
  const dayFor = dayKey => ({ dayKey, entries: [logEntry({ occurrenceId: buildOccurrenceId('routine-medication', dayKey, '08:30') })] });
  const { days } = normalizeRoutineLog({
    days: [dayFor('2026-09-15'), dayFor('2026-09-17'), dayFor('2026-09-16'), dayFor('2026-09-16'), { dayKey: 'yesterday', entries: [] }]
  });
  assert.equal(days.length, MAX_ROUTINE_LOG_DAYS);
  assert.deepEqual(days.map(day => day.dayKey), ['2026-09-16', '2026-09-17']);

  const crowded = Array.from({ length: MAX_ROUTINE_ENTRIES_PER_DAY + 5 }, (_unused, index) => logEntry({
    occurrenceId: buildFreeOccurrenceId('routine-medication', '2026-09-17', index),
    at: 1_000 + index
  }));
  const sliced = normalizeRoutineLog({ days: [{ dayKey: '2026-09-17', entries: crowded }] });
  assert.equal(sliced.days[0].entries.length, MAX_ROUTINE_ENTRIES_PER_DAY);
  assert.equal(sliced.days[0].entries.at(-1).at, 1_000 + crowded.length - 1);

  assert.deepEqual(normalizeRoutineLog(null), { days: [] });
  assert.deepEqual(normalizeRoutineLog({ days: 'nope' }), { days: [] });
});

// -- energyProfile ----------------------------------------------------------

function profile(overrides = {}) {
  return {
    baseline: { wakeHour: 8, chronotypeShift: 30, morningRampMinutes: 90, postLunchDipDepth: 12 },
    effectScale: { 'medication-default': 1.2 },
    observations: 14,
    updatedAt: NOW - 3_600_000,
    lastResidualMae: 7.5,
    ...overrides
  };
}

test('an uncalibrated energy profile is null rather than a fabricated one', () => {
  assert.equal(normalizeEnergyProfile(null), null);
  assert.equal(normalizeEnergyProfile({}), null);

  // Half a calibration is not a calibration: one untrustworthy baseline
  // parameter takes the whole profile back to "we do not know yet", because a
  // curve drawn from three real numbers and one invented one is not explainable.
  for (const key of Object.keys(BASELINE_EDITABLE_BOUNDS)) {
    const partial = profile();
    delete partial.baseline[key];
    assert.equal(normalizeEnergyProfile(partial), null, key);
  }
  assert.equal(normalizeEnergyProfile(profile({ baseline: { wakeHour: 8.5, chronotypeShift: 0, morningRampMinutes: 90, postLunchDipDepth: 12 } })), null);
});

test('a calibrated profile stores scales the curve can reproduce exactly', () => {
  const stored = normalizeEnergyProfile(profile({
    effectScale: {
      'stimulant-default': 1.234_567_89,
      'medication-default': 0.9,
      'Bad-Id': 1.1,
      'rest-default': 9,
      'meal-default': 'strong'
    }
  }));

  // Rounded on the way in so that reading the file back gives the same number:
  // an unrounded float would make normalization a moving target and every open
  // would look like a rewrite.
  assert.deepEqual(stored.effectScale, { 'medication-default': 0.9, 'stimulant-default': 1.2346 });
  assert.deepEqual(normalizeEnergyProfile(stored), stored);
  assert.equal(stored.observations, 14);
  assert.equal(stored.lastResidualMae, 7.5);

  const rounded = normalizeEnergyProfile(profile({ lastResidualMae: 7.567_8, observations: -3 }));
  assert.equal(rounded.lastResidualMae, 7.57);
  assert.equal(rounded.observations, 0);
});

test('more calibrated scales than the cap is refused rather than silently truncated', () => {
  const tooMany = Object.fromEntries(
    Array.from({ length: MAX_EFFECT_SCALE_KEYS + 1 }, (_unused, index) => [`profile-${index}`, 1])
  );
  assert.throws(() => normalizeEnergyProfile(profile({ effectScale: tooMany })), RangeError);
});

// -- companion.appearance ---------------------------------------------------

test('taking an accessory off is a stored choice, not a missing one', () => {
  const state = normalizeCompanionState({
    appearance: { equipped: { hat: 'straw-hat', back: null, hand: 'Bad Id', '': 'x' }, updatedAt: NOW }
  });
  // `null` survives: without it the default item for that group would grow back
  // on the next read, and the user's "no hat" would be silently overruled.
  assert.deepEqual(state.appearance.equipped, { back: null, hat: 'straw-hat' });
  assert.equal(state.appearance.updatedAt, NOW);

  assert.deepEqual(defaultCompanionState().appearance, { equipped: {}, updatedAt: null });
  assert.deepEqual(normalizeCompanionState({}).appearance, { equipped: {}, updatedAt: null });
});

test('a strict companion read rejects an appearance it would have to change', () => {
  const canonical = normalizeCompanionState({ appearance: { equipped: { hat: 'straw-hat' }, updatedAt: NOW } });
  assert.deepEqual(normalizeCompanionState(canonical, { strict: true }), canonical);

  assert.throws(() => normalizeCompanionState({ ...canonical, appearance: { equipped: { hat: 'straw-hat' } } }, { strict: true }), /unknown key|not canonical/);
  assert.throws(() => normalizeCompanionState({
    ...canonical,
    appearance: { equipped: { hat: 'Bad Id' }, updatedAt: null }
  }, { strict: true }), /invalid entry/);
  assert.throws(() => normalizeCompanionState({
    ...canonical,
    appearance: { equipped: {}, updatedAt: null, theme: 'dark' }
  }, { strict: true }), /unknown key: theme/);
});

// -- the two layers have to agree -------------------------------------------

test('every routine kind the content table defines is a kind the store accepts', () => {
  const stored = normalizeRoutines(ROUTINE_KINDS.map((kind, index) => routine({
    id: `routine-${index}`, kind, effect: { profileId: `${kind}-default` }
  })));
  assert.deepEqual(stored.map(item => item.kind), [...ROUTINE_KINDS]);
  assert.equal(normalizeRoutines([routine({ kind: 'teleport' })]).length, 0);

  // `custom` is the only kind allowed to have no effect profile, and it is the
  // reason "remind me" and "this changes my energy" can be separate things.
  const withoutProfile = ROUTINE_KINDS.filter(kind => ROUTINE_EFFECT_PROFILES[kind] === null);
  assert.deepEqual(withoutProfile, ['custom']);
});

test('the ranges content lets a user pick fit strictly inside what the store will hold', () => {
  // Two tiers on purpose: content answers "is this still that kind of
  // intervention", storage answers "is this number absurd". If content ever grew
  // wider than storage, the app would offer a value it then refuses to save.
  const envelope = {
    wakeHour: [0, 23],
    chronotypeShift: [-240, 240],
    morningRampMinutes: [15, 480],
    postLunchDipDepth: [0, 40]
  };
  for (const [key, [min, max]] of Object.entries(BASELINE_EDITABLE_BOUNDS)) {
    const [outerMin, outerMax] = envelope[key];
    assert.ok(min >= outerMin && max <= outerMax, `${key} editable [${min}, ${max}] escapes [${outerMin}, ${outerMax}]`);
    // And the envelope is checked against the real validator, not just against
    // this table, so a change to either side has to meet the other.
    const baseline = { wakeHour: 8, chronotypeShift: 0, morningRampMinutes: 90, postLunchDipDepth: 12 };
    for (const value of [min, max]) {
      assert.notEqual(normalizeEnergyProfile(profile({ baseline: { ...baseline, [key]: value } })), null, `${key}=${value}`);
    }
  }

  const [scaleMin, scaleMax] = EFFECT_SCALE_EDITABLE;
  assert.ok(scaleMin >= MIN_EFFECT_SCALE && scaleMax <= MAX_EFFECT_SCALE);
  for (const value of [scaleMin, scaleMax]) {
    const stored = normalizeEnergyProfile(profile({ effectScale: { 'medication-default': value } }));
    assert.deepEqual(stored.effectScale, { 'medication-default': value });
  }

  for (const [kind, effectProfile] of Object.entries(ROUTINE_EFFECT_PROFILES)) {
    if (!effectProfile) continue;
    const { amplitude, durationMin } = effectProfile.editable;
    for (const value of amplitude) {
      const [stored] = normalizeRoutines([routine({ kind, effect: { profileId: effectProfile.profileId, amplitude: value } })]);
      assert.equal(stored.effect.amplitude, value, `${kind} amplitude ${value}`);
    }
    for (const value of durationMin) {
      const [stored] = normalizeRoutines([routine({ kind, effect: { profileId: effectProfile.profileId, durationMin: value } })]);
      assert.equal(stored.effect.durationMin, value, `${kind} durationMin ${value}`);
    }
  }
});

test('a fully populated schema 9 state reads back unchanged', () => {
  // Written at schema 8 and read back at schema 9 on purpose: the upgrade is only
  // safe if what the lenient read produces is something the strict read accepts
  // without changing a byte. A partial `companion` like the one below is legal
  // input here and would be refused outright on the second pass.
  const state = normalizePersistedState({
    schemaVersion: 15,
    routines: [routine(), routine({ id: 'routine-gym', kind: 'movement', effect: { profileId: 'movement-default', amplitude: 20 } })],
    routineLog: {
      days: [
        { dayKey: '2026-09-16', entries: [logEntry({ occurrenceId: buildOccurrenceId('routine-medication', '2026-09-16', '08:30') })] },
        { dayKey: '2026-09-17', entries: [logEntry({ note: '晚了半小时', magnitude: 60 })] }
      ]
    },
    energyProfile: profile(),
    companion: { appearance: { equipped: { hat: 'straw-hat', back: null }, updatedAt: NOW } }
  }, { now: NOW });

  const serialized = JSON.parse(JSON.stringify(state));
  assert.equal(serialized.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.deepEqual(normalizePersistedState(serialized, { now: NOW + 60_000 }), serialized);
  assert.equal(state.routines.length, 2);
  assert.equal(state.routineLog.days.length, 2);
  assert.equal(state.energyProfile.effectScale['medication-default'], 1.2);
  assert.deepEqual(state.companion.appearance.equipped, { back: null, hat: 'straw-hat' });
});
