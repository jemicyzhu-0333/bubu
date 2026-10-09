'use strict';

// ARCHITECTURE「日常与能量」. Two halves: the domain rule (what may move, how far, and when nothing
// moves) and the daily pass that drives it once per local day.

const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../src/capabilities/guidance');
const routines = require('../src/capabilities/routines');
const { predictModelLevelAt } = require('../src/application');
const {
  BASELINE_EDITABLE_BOUNDS,
  EFFECT_SCALE_EDITABLE,
  defaultEnergyBaseline
} = require('../src/content/energy-effects.mjs');
const { localDayStart, addDaysToKey } = require('../src/core/calendar');

const {
  MIN_OBSERVATIONS_BEFORE_TUNING,
  MAX_STEP_FRACTION,
  calibrateEnergyProfile,
  resetEnergyCalibration
} = guidance.energyCalibration;

const DAY = '2026-09-20';
const DAY_START = localDayStart(DAY);
const MINUTE = 60 * 1000;
const DAY_MS = 1440 * MINUTE;
const at = minute => DAY_START + minute * MINUTE;
const WORK_START = 9;
const SEED = defaultEnergyBaseline({ workStartHour: WORK_START });

function draft(overrides = {}) {
  return { energyCheckIn: null, energyProfile: null, routines: [], routineLog: null, ...overrides };
}

const checkIn = (level, minute) => ({ level, state: 'medium', timestamp: at(minute) });

// A profile that has already earned the right to be tuned.
function warmProfile(overrides = {}) {
  return {
    baseline: { ...SEED },
    effectScale: {},
    observations: MIN_OBSERVATIONS_BEFORE_TUNING - 1,
    updatedAt: at(-600),
    lastResidualMae: 10,
    ...overrides
  };
}

function calibrate(state, { minute = 10 * 60, modelLevel = 50, effects = [], now = at(23 * 60) } = {}) {
  return calibrateEnergyProfile(state, {
    now, modelLevel, effects, baselineSeed: SEED, checkInMinute: minute
  });
}

test('nothing to compare against is a no-op, not an invented profile', () => {
  // Three separate silences, all of which must leave `energyProfile` at null:
  // `null` is the one signal the panel reads as "not calibrated".
  const noReport = draft();
  assert.deepEqual(calibrate(noReport), { ok: true, changed: false, reason: 'no-check-in' });
  assert.equal(noReport.energyProfile, null);

  const broken = draft({ energyCheckIn: { level: null, state: 'medium', timestamp: at(600) } });
  assert.equal(calibrate(broken).reason, 'no-check-in');

  // The curve is switched off, so there is no model reading for that moment. The
  // report must not count: an inflated `observations` would start tuning against a
  // model that had answered ten times with nothing.
  const dark = draft({ energyCheckIn: checkIn(70, 600) });
  assert.deepEqual(calibrate(dark, { modelLevel: null }), {
    ok: true, changed: false, reason: 'no-model'
  });
  assert.equal(dark.energyProfile, null);
});

// One warm-up pass: the report lands at 10:00 and the local-day pass that folds it
// in runs just after the following midnight. Walking a real daily timeline is what
// keeps every report newer than the watermark the previous pass left behind.
function warmUpPass(state, pass, { baselineSeed = SEED } = {}) {
  state.energyCheckIn = { level: 90, state: 'medium', timestamp: at(10 * 60) + pass * DAY_MS };
  return calibrateEnergyProfile(state, {
    now: at(24 * 60 + 5) + pass * DAY_MS,
    modelLevel: 50, effects: [], baselineSeed, checkInMinute: 10 * 60
  });
}

test('the warm-up counts reports, holds every parameter still, and re-seeds from settings', () => {
  const state = draft();
  let last = null;
  for (let pass = 1; pass <= MIN_OBSERVATIONS_BEFORE_TUNING - 2; pass += 1) {
    last = warmUpPass(state, pass);
    assert.equal(last.changed, true);
    assert.equal(last.calibrating, false, `第 ${pass} 次上报还不该动参数`);
    assert.equal(last.adjusted, null);
    assert.deepEqual(state.energyProfile.baseline, SEED, '热身期基线始终等于种子');
  }
  assert.equal(last.observations, MIN_OBSERVATIONS_BEFORE_TUNING - 2);
  // Held at null on purpose: `calibrationConfidence(null)` caps the curve at
  // "medium", and a handful of reports does not earn "high".
  assert.equal(state.energyProfile.lastResidualMae, null);

  // Moving your work hours during the warm-up moves the seed with you, rather than
  // leaving a day-one copy outranking the settings.
  const moved = defaultEnergyBaseline({ workStartHour: 6 });
  assert.notDeepEqual(moved, SEED);
  const reseeded = warmUpPass(state, MIN_OBSERVATIONS_BEFORE_TUNING - 1, { baselineSeed: moved });
  assert.equal(reseeded.calibrating, false, '这一次仍在热身期内');
  assert.deepEqual(state.energyProfile.baseline, moved);
});

test('the tenth report starts tuning, and one run moves exactly one parameter', () => {
  const state = draft({
    energyCheckIn: checkIn(90, 22 * 60),
    energyProfile: warmProfile()
  });
  const result = calibrate(state, { minute: 22 * 60, modelLevel: 40 });

  assert.equal(result.observations, MIN_OBSERVATIONS_BEFORE_TUNING);
  assert.equal(result.calibrating, true);
  assert.equal(result.residual, 50);
  // 22:00 is inside the modelled evening decline, and still going strong there
  // reads as a later chronotype — the decline should start later than it does.
  assert.equal(result.adjusted.parameter, 'chronotypeShift');
  assert.ok(result.adjusted.to > result.adjusted.from);
  // Everything else is exactly where it was: one degree of freedom per report.
  const moved = { ...state.energyProfile.baseline, chronotypeShift: SEED.chronotypeShift };
  assert.deepEqual(moved, SEED);
  assert.deepEqual(state.energyProfile.effectScale, {});
  assert.equal(state.energyProfile.lastResidualMae, 22, '残差 50 把 EMA 从 10 拉到 22');
});

test('no single run may move a parameter more than 2% of its own editable span', () => {
  // The worst case the domain can be handed: a full-scale miss, every run.
  // One minute inside each of the three moving parts of the shape: the morning
  // climb, the afternoon dip, and the evening decline.
  for (const [minute, key] of [[9 * 60, 'morningRampMinutes'], [14 * 60, 'postLunchDipDepth'], [22 * 60, 'chronotypeShift']]) {
    const [min, max] = BASELINE_EDITABLE_BOUNDS[key];
    const budget = Math.max(1, Math.round((max - min) * MAX_STEP_FRACTION));
    const state = draft({
      energyCheckIn: checkIn(100, minute),
      energyProfile: warmProfile()
    });
    const result = calibrate(state, { minute, modelLevel: 0 });
    assert.equal(result.adjusted.parameter, key, `${minute} 分钟该落在 ${key} 上`);
    assert.ok(
      Math.abs(result.adjusted.to - result.adjusted.from) <= budget,
      `${key} 一次动了 ${Math.abs(result.adjusted.to - result.adjusted.from)},超过 ${budget}`
    );
    assert.ok(result.adjusted.to >= min && result.adjusted.to <= max, `${key} 必须留在可编辑区间内`);
  }
});

test('a hundred runs of the same wrong report cannot walk a parameter out of bounds', () => {
  // Bounds are a contract, not a hope: the clamp has to hold at the far end of a
  // long run of identical misses. An early riser, so that "inside the evening
  // decline" stays inside the same calendar day however far the shift walks.
  const [, maxShift] = BASELINE_EDITABLE_BOUNDS.chronotypeShift;
  const early = { ...SEED, wakeHour: 3, chronotypeShift: maxShift - 10 };
  const state = draft({ energyProfile: warmProfile({ observations: 200, baseline: early }) });
  for (let pass = 1; pass <= 100; pass += 1) {
    const { baseline } = state.energyProfile;
    // Chase the decline as it moves: a report that fell out of the window would
    // stop moving the parameter for a reason other than the clamp.
    const minute = baseline.wakeHour * 60 + baseline.chronotypeShift + 800;
    state.energyCheckIn = { level: 100, state: 'high', timestamp: at(minute) + pass * DAY_MS };
    calibrate(state, { minute, modelLevel: 0, now: at(minute) + pass * DAY_MS + MINUTE });
    assert.ok(state.energyProfile.baseline.chronotypeShift <= maxShift, `第 ${pass} 次越界了`);
  }
  assert.equal(state.energyProfile.baseline.chronotypeShift, maxShift);
  assert.equal(state.energyProfile.baseline.wakeHour, early.wakeHour, 'wakeHour 永远不动');
  assert.ok(state.energyProfile.lastResidualMae <= 100);
});

test('a report from the flat middle of the day is counted but routed nowhere', () => {
  // 18:00 for an 08:00 riser: the climb is over, the dip is past, the evening
  // decline has not started. The baseline is level in all four parameters there, so
  // moving one would be a number changing for show.
  const state = draft({
    energyCheckIn: checkIn(95, 18 * 60),
    energyProfile: warmProfile()
  });
  const result = calibrate(state, { minute: 18 * 60, modelLevel: 60 });
  assert.equal(result.calibrating, true);
  assert.equal(result.adjusted, null);
  assert.deepEqual(state.energyProfile.baseline, SEED);
  // Counted, and the miss still shows up in the fit the panel reports.
  assert.equal(result.observations, MIN_OBSERVATIONS_BEFORE_TUNING);
  assert.ok(result.lastResidualMae > 10);
});

test('a routine that owned the moment gets its own scale tuned instead of the day shape', () => {
  const state = draft({
    energyCheckIn: checkIn(70, 10 * 60),
    energyProfile: warmProfile()
  });
  // The model credited coffee with +12 at that moment and still came in 20 low, so
  // this person's coffee does more than the profile says.
  const result = calibrate(state, {
    minute: 10 * 60, modelLevel: 50, effects: [{ profileId: 'stimulant-default', delta: 12 }]
  });
  assert.equal(result.adjusted.parameter, 'effectScale:stimulant-default');
  assert.ok(result.adjusted.to > 1);
  assert.ok(result.adjusted.to <= EFFECT_SCALE_EDITABLE[1]);
  assert.deepEqual(state.energyProfile.baseline, SEED, '归到效果上时,基线一动不动');

  // A drain that drained less than modelled is the same correction with both signs
  // flipped, so the scale still moves towards what actually happened.
  const drained = draft({
    energyCheckIn: checkIn(70, 10 * 60),
    energyProfile: warmProfile()
  });
  const down = calibrate(drained, {
    minute: 10 * 60, modelLevel: 50, effects: [{ profileId: 'depressant-default', delta: -12 }]
  });
  assert.equal(down.adjusted.parameter, 'effectScale:depressant-default');
  assert.ok(down.adjusted.to < 1);

  // Two effects splitting the moment evenly means neither owned it: the miss goes
  // to the shape of the day instead. Picking a winner from a tie would mean picking
  // by array order, which is not something the user can see or predict.
  const split = draft({
    energyCheckIn: checkIn(70, 22 * 60),
    energyProfile: warmProfile()
  });
  const shared = calibrate(split, {
    minute: 22 * 60, modelLevel: 50,
    effects: [{ profileId: 'stimulant-default', delta: 8 }, { profileId: 'meal-default', delta: 8 }]
  });
  assert.equal(shared.adjusted.parameter, 'chronotypeShift');
  assert.deepEqual(split.energyProfile.effectScale, {});
});

test('a report already folded in is never folded in twice', () => {
  const state = draft({
    energyCheckIn: checkIn(70, 10 * 60),
    energyProfile: warmProfile()
  });
  const first = calibrate(state);
  assert.equal(first.changed, true);
  const afterFirst = structuredClone(state.energyProfile);

  // `updatedAt` is the watermark: calibration always runs after the check-in it
  // folds in, so a report at or before it has been counted. No extra field, and
  // running the daily pass twice therefore learns nothing twice.
  assert.deepEqual(calibrate(state), { ok: true, changed: false, reason: 'already-folded' });
  assert.deepEqual(state.energyProfile, afterFirst);
});

test('a reset goes back to "never calibrated" rather than to a default profile', () => {
  const state = draft({ energyProfile: warmProfile() });
  assert.deepEqual(resetEnergyCalibration(state), { ok: true, changed: true, reason: null });
  assert.equal(state.energyProfile, null);
  // Idempotent, and honest about it: the daily pass commits on `changed`, and a
  // second reset must not bump a revision and republish a projection.
  assert.deepEqual(resetEnergyCalibration(state), {
    ok: true, changed: false, reason: 'not-calibrated'
  });
});

test('calibration refuses inputs it cannot replay', () => {
  assert.throws(() => calibrateEnergyProfile(null, { now: 1 }), /requires a state draft/);
  assert.throws(() => calibrateEnergyProfile(draft(), { now: 1.5 }), /timestamp the store can hold/);
  assert.throws(() => calibrateEnergyProfile(draft(), {}), /timestamp the store can hold/);
  assert.throws(() => resetEnergyCalibration('nope'), /requires a state draft/);
});

test('an unroutable report is still counted but moves nothing', () => {
  // The projection could not place the report inside a day (no `nowMinute`). It is
  // evidence that a report happened, but not evidence about any one parameter.
  const state = draft({
    energyCheckIn: checkIn(90, 10 * 60),
    energyProfile: warmProfile()
  });
  const result = calibrateEnergyProfile(state, {
    now: at(23 * 60), modelLevel: 40, effects: [], baselineSeed: SEED, checkInMinute: null
  });
  assert.equal(result.changed, true);
  assert.equal(result.adjusted, null);
  assert.deepEqual(state.energyProfile.baseline, SEED);
});

test('the routine log keeps only the two days the curve can use', () => {
  const stale = {
    days: [
      { dayKey: addDaysToKey(DAY, -4), entries: [] },
      { dayKey: addDaysToKey(DAY, -1), entries: [] },
      { dayKey: DAY, entries: [] }
    ]
  };
  const state = draft({ routineLog: structuredClone(stale) });
  const rolled = routines.routineLogging.rollLogForward(state, { today: DAY });
  assert.deepEqual(rolled, { ok: true, changed: true, droppedDayKeys: [addDaysToKey(DAY, -4)] });
  assert.deepEqual(
    state.routineLog.days.map(day => day.dayKey),
    [addDaysToKey(DAY, -1), DAY],
    '留下今天和昨天 —— 跨零点的尾巴要昨天那份'
  );

  // Already correct is a no-op: the daily pass commits on these flags, and a log
  // that needs nothing must not bump a revision.
  const clean = structuredClone(state);
  assert.deepEqual(routines.routineLogging.rollLogForward(state, { today: DAY }), {
    ok: true, changed: false, droppedDayKeys: []
  });
  assert.deepEqual(state, clean);

  // A clock that went backwards is not a reason to delete something the user
  // reported; those days fall out on their own once the calendar catches up.
  const ahead = draft({ routineLog: { days: [{ dayKey: addDaysToKey(DAY, 2), entries: [] }] } });
  assert.equal(routines.routineLogging.rollLogForward(ahead, { today: DAY }).changed, false);

  const empty = draft();
  assert.deepEqual(routines.routineLogging.rollLogForward(empty, { today: DAY }), {
    ok: true, changed: false, droppedDayKeys: []
  });
});

test('the model reading calibration learns from is the one the panel drew', () => {
  // ARCHITECTURE「日常与能量」's load-bearing wiring: the residual must be measured against the curve
  // *before* the self-report was folded into it. Comparing against a curve that
  // already contains the report would make the model look accurate and teach it
  // nothing.
  const snapshot = {
    routines: [{
      id: 'r-coffee', title: '那杯咖啡', kind: 'stimulant',
      effect: { profileId: 'stimulant-default', amplitude: 14, durationMin: 150 }
    }],
    routineLog: {
      days: [{
        dayKey: DAY,
        entries: [{
          occurrenceId: 'o-1', routineId: 'r-coffee', status: 'done',
          at: at(9 * 60), note: null, magnitude: null
        }]
      }]
    },
    energyCheckIn: checkIn(95, 10 * 60),
    energyProfile: null
  };
  const ask = overrides => predictModelLevelAt({
    snapshot, settings: { energyCurveEnabled: true }, at: at(10 * 60),
    dayKey: DAY, workStartHour: WORK_START, ...overrides
  });

  const prediction = ask();
  assert.ok(Number.isFinite(prediction.modelLevel));
  assert.ok(prediction.modelLevel < 95, '95 的自评没有被折进模型读数里');
  assert.equal(prediction.minuteOfDay, 10 * 60);
  // The seed the warm-up re-seeds from is provably the same one the uncalibrated
  // panel curve uses.
  assert.deepEqual(prediction.baselineSeed, SEED);
  // Attribution rows carry routineId; `effectScale` is keyed by profileId. The
  // translation happens here so the domain never has to read the content catalog.
  assert.deepEqual(prediction.effects.map(effect => effect.profileId), ['stimulant-default']);
  assert.ok(prediction.effects[0].delta > 0);

  // Curve switched off: no reading, and calibration reads that as 'no-model'.
  const dark = predictModelLevelAt({
    snapshot, settings: { energyCurveEnabled: false }, at: at(10 * 60),
    dayKey: DAY, workStartHour: WORK_START
  });
  assert.deepEqual(dark, { modelLevel: null, minuteOfDay: null, effects: [], baselineSeed: SEED });
});
