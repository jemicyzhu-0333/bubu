'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { localDayStart } = require('../src/core/calendar');
const {
  DEFAULT_SAMPLE_MINUTES,
  DEFAULT_CHECK_IN_HALF_LIFE_MINUTES,
  NIGHT_LEVEL,
  DAY_LEVEL,
  POSITIVE_SUM_CAP,
  MIN_WINDOW_MINUTES,
  MAX_SUGGESTED_WINDOWS,
  energyBaselineAt,
  resolveBaselineParams,
  buildEnergyCurve
} = require('../src/core/energy-curve');
const { BASELINE_EDITABLE_BOUNDS, defaultEnergyBaseline } = require('../src/content/energy-effects.mjs');

// A plain mid-March day, deliberately not a DST boundary: the boundary behaviour
// belongs to `calendar.js` and is covered in core-calendar.test.js. What matters
// here is that every timestamp is derived from the same day start the curve uses,
// so the tests never assume a fixed UTC offset and pass in any host time zone.
const DAY = '2026-03-10';
const DAY_START = localDayStart(DAY);

function at(hour, minute = 0) {
  return DAY_START + (hour * 60 + minute) * 60_000;
}

function sampleAt(curve, hour, minute = 0) {
  const wanted = hour * 60 + minute;
  const sample = curve.samples.find(entry => entry.minute === wanted);
  assert.ok(sample, `expected a sample at minute ${wanted}`);
  return sample;
}

function contribution(sample) {
  return sample.attribution.reduce((total, row) => total + row.delta, 0);
}

function peakContribution(curve) {
  return Math.max(...curve.samples.map(contribution));
}

function routine(id, kind, profileId, when, extra = {}) {
  return { id, kind, profileId, at: when, ...extra };
}

// A full ordinary day, used by the properties that should hold over a realistic
// mixture rather than over one effect in isolation.
const BUSY_DAY = [
  routine('med', 'medication', 'medication-default', at(8, 20)),
  routine('coffee-1', 'stimulant', 'stimulant-default', at(9, 10)),
  routine('coffee-2', 'stimulant', 'stimulant-default', at(13, 40)),
  routine('lunch', 'meal', 'meal-default', at(12, 10)),
  routine('standup', 'meeting', 'meeting-default', at(15, 5), { durationMin: 90 }),
  routine('nap', 'rest', 'rest-default', at(14), { eventMinutes: 75 }),
  routine('gym', 'movement', 'movement-default', at(18, 25))
];

test('a day with nothing logged is the baseline, sampled every quarter hour', () => {
  const curve = buildEnergyCurve({ dayKey: DAY });

  assert.equal(curve.sampleMinutes, DEFAULT_SAMPLE_MINUTES);
  assert.equal(curve.samples.length, (24 * 60) / DEFAULT_SAMPLE_MINUTES);
  assert.equal(curve.samples[0].minute, 0);
  assert.equal(curve.samples.at(-1).minute, 24 * 60 - DEFAULT_SAMPLE_MINUTES);
  for (const sample of curve.samples) {
    assert.deepEqual(sample.attribution, []);
    assert.equal(sample.level, sample.baseline);
    assert.equal(sample.clampedBy, 0);
  }
});

test('the baseline joins up at midnight, so a day is not a sawtooth', () => {
  // The previous evening's decline is still running during the small hours. If it
  // were dropped, every day would open with a step at 00:00 in a curve whose
  // whole purpose is being continuous.
  for (const wakeHour of BASELINE_EDITABLE_BOUNDS.wakeHour) {
    for (const chronotypeShift of BASELINE_EDITABLE_BOUNDS.chronotypeShift) {
      const params = resolveBaselineParams({ ...defaultEnergyBaseline(), wakeHour, chronotypeShift });
      const endOfDay = energyBaselineAt(24 * 60, params).level;
      const startOfDay = energyBaselineAt(0, params).level;
      assert.ok(
        Math.abs(endOfDay - startOfDay) < 1e-9,
        `wake ${wakeHour}:00 shift ${chronotypeShift} left a ${endOfDay - startOfDay} step at midnight`
      );
    }
  }
});

// F6 section 14, test 6.
test('each baseline parameter moves the curve in its own documented direction', () => {
  const base = defaultEnergyBaseline();
  const params = resolveBaselineParams(base);

  // The secondary circadian dip is exactly as deep as configured at its centre,
  // without moving the rest of the day. It is not labelled as a meal effect.
  const wake = base.wakeHour * 60;
  const deeper = resolveBaselineParams({ ...base, postLunchDipDepth: base.postLunchDipDepth + 10 });
  assert.ok(Math.abs(
    energyBaselineAt(wake + 360, deeper).level
      - energyBaselineAt(wake + 360, params).level + 10
  ) < 1e-9);
  assert.equal(energyBaselineAt(wake + 120, deeper).level, energyBaselineAt(wake + 120, params).level);
  assert.equal(energyBaselineAt(wake + 600, deeper).level, energyBaselineAt(wake + 600, params).level);

  // Wake time is a phase, not a second shape: moving it two hours moves every
  // homeostatic/circadian/inertia component by the same two hours.
  const later = resolveBaselineParams({ ...base, wakeHour: base.wakeHour + 2 });
  for (const minute of [wake, wake + 90, wake + 360, wake + 900]) {
    assert.ok(Math.abs(
      energyBaselineAt(minute, later).level - energyBaselineAt(minute - 120, params).level
    ) < 1e-9);
  }

  // A longer ramp keeps more sleep inertia during the same post-wake interval,
  // then converges once that local effect has cleared.
  const slower = resolveBaselineParams({ ...base, morningRampMinutes: base.morningRampMinutes * 2 });
  for (let minute = wake + 15; minute < wake + base.morningRampMinutes; minute += 15) {
    assert.ok(energyBaselineAt(minute, slower).level < energyBaselineAt(minute, params).level);
  }
  assert.ok(Math.abs(
    energyBaselineAt(wake + 600, slower).level - energyBaselineAt(wake + 600, params).level
  ) < 1e-9);

  // chronotypeShift slides the whole shape, dip included.
  const shifted = resolveBaselineParams({ ...base, chronotypeShift: 60 });
  assert.ok(Math.abs(
    energyBaselineAt(wake + 390, shifted).level - energyBaselineAt(wake + 330, params).level
  ) < 1e-9);
});

test('a later workStartHour shifts the rise, with no settings screen involved', () => {
  // The default baseline is derived from a setting the user already gave, so an
  // existing user gets a plausible curve without filling in a questionnaire.
  const early = resolveBaselineParams(defaultEnergyBaseline({ workStartHour: 8 }));
  const late = resolveBaselineParams(defaultEnergyBaseline({ workStartHour: 11 }));

  assert.equal(early.wakeHour, 7);
  assert.equal(late.wakeHour, 10);
  assert.ok(energyBaselineAt(8 * 60, late).level < energyBaselineAt(8 * 60, early).level);
  assert.equal(energyBaselineAt(13 * 60, early).level, energyBaselineAt(16 * 60, late).level);
});

test('a baseline outside the editable bounds is pulled in rather than refused', () => {
  // The opposite of what routine-schema.js does with the same four numbers, and
  // deliberately so: by the time a value arrives here it has already passed
  // storage validation, and the only remaining question is whether the curve can
  // be drawn. Content's editable bounds are the documented ceiling for that.
  const params = resolveBaselineParams({
    wakeHour: 99,
    chronotypeShift: -9999,
    morningRampMinutes: 0,
    postLunchDipDepth: 1000
  });
  assert.equal(params.wakeHour, BASELINE_EDITABLE_BOUNDS.wakeHour[1]);
  assert.equal(params.chronotypeShift, BASELINE_EDITABLE_BOUNDS.chronotypeShift[0]);
  assert.equal(params.morningRampMinutes, BASELINE_EDITABLE_BOUNDS.morningRampMinutes[0]);
  assert.equal(params.postLunchDipDepth, BASELINE_EDITABLE_BOUNDS.postLunchDipDepth[1]);

  // Junk falls back to the default rather than to a bound, because "unreadable"
  // and "extreme" are different states.
  assert.deepEqual(resolveBaselineParams({ wakeHour: 'nope' }), resolveBaselineParams(null));
  assert.deepEqual(resolveBaselineParams(null), { ...defaultEnergyBaseline() });
});

test('each effect shape peaks at its own amplitude, then returns to nothing', () => {
  // The amplitude in the content table is the realized peak, not an asymptote
  // nobody reaches. That is what keeps an attribution row readable: "focus meds
  // +18" has to mean the curve is 18 higher than it would have been.
  // The realized peak, its minute, and the last minute at which the effect is
  // still silent. `movement` has no quiet prefix on purpose — its cost starts
  // immediately, which is the shape — so it carries `null` here and is covered by
  // its own test below.
  const cases = [
    ['medication-default', 'medication', 18, 100, 39],
    ['stimulant-default', 'stimulant', 10, 57, 19],
    ['snack-default', 'snack', 6, 20, 9],
    ['meeting-default', 'meeting', -10, 15, 0],
    ['rest-default', 'rest', 14, 27, 4],
    ['movement-default', 'movement', 12, 46, null]
  ];
  for (const [profileId, kind, amplitude, peakMinute, quietMinute] of cases) {
    const curve = buildEnergyCurve({
      dayKey: DAY,
      sampleMinutes: 1,
      effects: [routine('x', kind, profileId, at(9))]
    });
    const deltas = curve.samples.map(contribution);
    const extreme = amplitude > 0 ? Math.max(...deltas) : Math.min(...deltas);
    // Within a twentieth of a point: the true peak falls between two whole
    // minutes for three of the six shapes, and the sampling grid is in minutes.
    assert.ok(
      Math.abs(extreme - amplitude) < 0.05,
      `${profileId} peaked at ${extreme} instead of ${amplitude}`
    );
    assert.equal(deltas.indexOf(extreme), 9 * 60 + peakMinute);
    if (quietMinute !== null) assert.equal(contribution(sampleAt(curve, 9, quietMinute)), 0);
    // Nothing is still running at the end of the day. An effect whose tail never
    // closed would leak into tomorrow's two-day log window.
    assert.equal(contribution(curve.samples.at(-1)), 0);
  }
});

test('a meal dips first and recovers to just above the baseline', () => {
  const curve = buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 5,
    effects: [routine('lunch', 'meal', 'meal-default', at(12))]
  });
  assert.ok(Math.abs(contribution(sampleAt(curve, 12, 30)) + 8) < 0.01);
  // The recovery is real but small, and the number is pinned here rather than
  // described as "a rebound": the positive tail tops out at about a quarter of a
  // point, because by the time the rebound peaks the dip has not fully cleared.
  // Content describes a meal as settling slightly above the baseline, which is
  // literally what happens. If a future change is meant to make lunch feel
  // restorative, it has to move this number and say so here.
  const tail = curve.samples.filter(s => s.minute >= 13 * 60 + 15 && s.minute <= 14 * 60 + 10);
  assert.ok(tail.every(s => contribution(s) > 0));
  assert.ok(Math.abs(Math.max(...tail.map(contribution)) - 0.258) < 0.005);
  // And it does close: nothing is left two and a half hours after lunch.
  assert.equal(contribution(sampleAt(curve, 14, 15)), 0);
});

test('exercise costs before it pays, which is the point of the shape', () => {
  // "Just finished at the gym, do not schedule anything hard yet" is only an
  // actionable sentence if the curve actually dips first.
  const curve = buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 5,
    effects: [routine('gym', 'movement', 'movement-default', at(17))]
  });
  assert.ok(Math.abs(contribution(sampleAt(curve, 17, 5)) + 5) < 0.01);
  assert.ok(contribution(sampleAt(curve, 17, 15)) < 0);
  assert.ok(contribution(sampleAt(curve, 17, 20)) < 0);
  assert.ok(contribution(sampleAt(curve, 17, 45)) > 11);
});

test('sleep inertia appears only when the rest was long enough to cause it', () => {
  // The log records no duration, so without an explicit one there is no inertia
  // at all. Inventing a nap length in order to invent grogginess from it is the
  // fabrication the persisted schema exists to prevent.
  const build = extra => buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 5,
    effects: [routine('nap', 'rest', 'rest-default', at(13), extra)]
  });
  const long = build({ eventMinutes: 90 });
  const short = build({ eventMinutes: 20 });
  const unknown = build({});

  assert.ok(Math.abs(contribution(sampleAt(long, 13, 5)) + 8) < 0.01);
  assert.equal(contribution(sampleAt(short, 13, 5)), 0);
  assert.equal(contribution(sampleAt(unknown, 13, 5)), 0);
  // The inertia is a short prefix, not a different restore: once it clears, all
  // three agree exactly.
  assert.equal(contribution(sampleAt(long, 14)), contribution(sampleAt(unknown, 14)));
});

test('a meeting drains for as long as it runs, plus a tail', () => {
  const curve = buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 5,
    effects: [routine('review', 'meeting', 'meeting-default', at(14), { durationMin: 90 })]
  });
  // Flat at its full depth for the whole ninety minutes, which is what makes it a
  // drain rather than a bump: a two-hour meeting is not twice as tiring per minute
  // as a one-hour meeting, it is tiring for twice as long.
  for (const minute of [20, 45, 75, 90]) {
    assert.ok(Math.abs(contribution(sampleAt(curve, 14, minute)) + 10) < 0.01);
  }
  assert.ok(contribution(sampleAt(curve, 16)) > -10);
  assert.equal(contribution(sampleAt(curve, 16, 30)), 0);
});

// F6 section 14, test 7.
test('logging five of the same thing does not push the curve to the ceiling', () => {
  const coffee = (index, hour) => routine(`c${index}`, 'stimulant', 'stimulant-default', at(hour));
  const five = [coffee(1, 9), coffee(2, 10), coffee(3, 11), coffee(4, 12), coffee(5, 13)];
  const one = buildEnergyCurve({ dayKey: DAY, sampleMinutes: 5, effects: [coffee(1, 9)] });
  const many = buildEnergyCurve({ dayKey: DAY, sampleMinutes: 5, effects: five });

  const singlePeak = peakContribution(one);
  const manyPeak = peakContribution(many);
  assert.ok(manyPeak > singlePeak, 'five coffees should still be worth more than one');
  // Five times the logging buys well under twice the lift. An additive model would
  // have turned "log another coffee" into a way to raise the number.
  assert.ok(manyPeak < singlePeak * 2, `five coffees reached ${manyPeak} against one at ${singlePeak}`);
  assert.ok(manyPeak <= POSITIVE_SUM_CAP + 1e-9);
});

test('the positive contribution is capped, and while capped it contributes no slope', () => {
  // Five different kinds at once, so the same-kind discount is not what is doing
  // the work: 18 + 10 + 6 + 14 + 12 would otherwise be 60 points of lift.
  const stack = [
    routine('m', 'medication', 'medication-default', at(8)),
    routine('s', 'stimulant', 'stimulant-default', at(8)),
    routine('k', 'snack', 'snack-default', at(8)),
    routine('r', 'rest', 'rest-default', at(8)),
    routine('v', 'movement', 'movement-default', at(8))
  ];
  const curve = buildEnergyCurve({ dayKey: DAY, effects: stack });
  const capped = sampleAt(curve, 10);

  assert.ok(Math.abs(contribution(capped) - POSITIVE_SUM_CAP) < 1e-9);
  // The baseline is flat at 10:00, so if the pinned sum still reported a slope,
  // this would be non-zero — and the curve would be claiming a rise it is not
  // making. Every row is scaled, so the attribution still adds up.
  assert.equal(capped.slope, energyBaselineAt(10 * 60, resolveBaselineParams(null)).slope);
  // Four rows, not five: the snack's whole span is 75 minutes, so by 10:00 it has
  // already finished and correctly contributes no row at all. Every surviving row
  // is scaled down from its own amplitude, so the disclosure still adds up.
  assert.equal(capped.attribution.length, 4);
  assert.ok(capped.attribution.every(row => row.delta > 0 && row.delta < 18));
});

test('the result does not depend on the order the effects arrive in', () => {
  const forwards = buildEnergyCurve({ dayKey: DAY, now: at(14), effects: BUSY_DAY });
  const backwards = buildEnergyCurve({ dayKey: DAY, now: at(14), effects: [...BUSY_DAY].reverse() });
  // Same instant, same day, shuffled input: the discount is assigned by time and
  // then by a total tie-break, so ordering cannot change a single sample.
  assert.deepEqual(backwards.samples, forwards.samples);
  assert.equal(backwards.nowLevel, forwards.nowLevel);
});

// F6 section 14, test 8.
test('the slope is the real derivative, and every kink in it is accounted for', () => {
  const checkIns = [{ at: at(10, 30), level: 55 }];
  const probe = ms => buildEnergyCurve({ dayKey: DAY, now: ms, effects: BUSY_DAY, checkIns }).nowLevel;
  const curve = buildEnergyCurve({
    dayKey: DAY, now: at(11), effects: BUSY_DAY, checkIns, sampleMinutes: 1
  });

  const kinks = [];
  for (const sample of curve.samples) {
    if (sample.minute < 1 || sample.minute > 24 * 60 - 2) continue;
    const instant = DAY_START + sample.minute * 60_000;
    // A central difference across two milliseconds. Where the curve is smooth this
    // agrees with the reported slope to floating-point noise; where it does not,
    // the gap is half a genuine slope discontinuity.
    const numeric = (probe(instant + 1) - probe(instant - 1)) / (2 / 60_000);
    if (Math.abs(numeric - sample.slope) > 1e-6) {
      kinks.push({ minute: sample.minute, jumpPerHour: Math.abs(numeric - sample.slope) * 120 });
    }
  }

  // The check-in is a deliberate observation update, so its central difference
  // spans a jump rather than a derivative. Account for it separately; the seven
  // remaining points are the assumed wake transition and effect-segment peaks.
  const checkInKink = kinks.find(kink => kink.minute === 10 * 60 + 30);
  assert.ok(checkInKink && checkInKink.jumpPerHour > 1_000_000);
  const modelKinks = kinks.filter(kink => kink !== checkInKink);
  assert.equal(modelKinks.length, 7, `unexpected kinks: ${JSON.stringify(kinks)}`);
  // The sleep-inertia peak is the largest, at amplitude x ln2 / halfLife.
  const largest = Math.max(...modelKinks.map(k => k.jumpPerHour));
  assert.ok(Math.abs(largest - (8 * Math.LN2 / 12.5) * 60) < 0.1, `largest kink was ${largest}/h`);
  // A linear ramp of the same dip would show that slope throughout instead of only
  // stepping by it once, which is the whole reason for the smoothstep.
  assert.ok(largest < (8 / 5) * 60);

  const slopes = curve.samples.map(sample => Math.abs(sample.slope * 60));
  assert.ok(Math.max(...slopes) < 150, `steepest excursion was ${Math.max(...slopes)} points/h`);
});

// F6 section 14, test 9.
test('a check-in passes through exactly, then hands authority back to the model', () => {
  const effects = [routine('med', 'medication', 'medication-default', at(8, 30))];
  const model = buildEnergyCurve({ dayKey: DAY, now: at(12), effects });
  const reported = buildEnergyCurve({
    dayKey: DAY, now: at(12), effects, checkIns: [{ at: at(12), level: 40 }]
  });

  // The residual is folded in as a residual, not averaged with the model: at the
  // moment of the report the curve reads exactly what the user said.
  assert.ok(Math.abs(reported.nowLevel - 40) < 1e-9);
  assert.ok(model.nowLevel > 60, 'the model needs to disagree for this test to mean anything');

  const residualAt = hour => sampleAt(reported, hour).level - sampleAt(model, hour).level;
  const initial = residualAt(12);
  // One half-life later, half the correction is left. Three hours is
  // DEFAULT_CHECK_IN_HALF_LIFE_MINUTES, shared with currentEnergyEstimate so the
  // two features never disagree about the same check-in.
  assert.equal(DEFAULT_CHECK_IN_HALF_LIFE_MINUTES, 180);
  assert.ok(Math.abs(residualAt(15) / initial - 0.5) < 1e-9);
  assert.ok(Math.abs(residualAt(18) / initial - 0.25) < 1e-9);
  // The shape survives the correction exactly. The difference between the two
  // curves is a pure decaying offset from the report forward. Before the report
  // the offset is zero: later evidence never rewrites the earlier estimate.
  // That is the whole argument for folding a self-report in as a residual rather
  // than blending it with the model.
  // Neither curve is clamped anywhere here, which is the precondition: a clamp is
  // the one thing that legitimately breaks the identity, and it is disclosed
  // separately through `clampedBy`.
  assert.ok([...model.samples, ...reported.samples].every(sample => sample.clampedBy === 0));
  reported.samples.forEach((sample, index) => {
    const offset = sample.level - model.samples[index].level;
    const decayed = sample.minute < 12 * 60
      ? 0
      : initial * Math.pow(0.5, (sample.minute - 12 * 60) / 180);
    assert.ok(
      Math.abs(offset - decayed) < 1e-9,
      `minute ${sample.minute}: offset ${offset} is not the decayed residual ${decayed}`
    );
  });
});

test('two check-ins are exact causal anchors and a later report does not rewrite the first', () => {
  const checkIns = [{ at: at(10), level: 80 }, { at: at(16), level: 30 }];
  const model = buildEnergyCurve({ dayKey: DAY, effects: BUSY_DAY });
  const reported = buildEnergyCurve({ dayKey: DAY, effects: BUSY_DAY, checkIns });

  const firstOnly = buildEnergyCurve({ dayKey: DAY, effects: BUSY_DAY, checkIns: [checkIns[0]] });
  for (const checkIn of checkIns) {
    const hour = Math.round((checkIn.at - DAY_START) / 3_600_000);
    const after = sampleAt(reported, hour).level;
    assert.ok(Math.abs(after - checkIn.level) < 1e-9);
  }
  assert.ok(Math.abs(sampleAt(reported, 10).level - sampleAt(firstOnly, 10).level) < 1e-9);
  assert.notEqual(sampleAt(model, 10).level, sampleAt(reported, 10).level);
});

// F6 section 14, test 10.
test('every sample can explain itself, exactly', () => {
  // The one property the whole structure exists to guarantee: hovering a point
  // shows "baseline 55 + focus meds 12 - meeting 6 = 61" and the arithmetic is
  // real. Nothing in the returned numbers is rounded, because rounding is a
  // presentation decision and rounding here would make this stop adding up.
  const checkIns = [{ at: at(10, 30), level: 55 }, { at: at(16, 15), level: 35 }];
  const curve = buildEnergyCurve({
    dayKey: DAY, now: at(11), effects: BUSY_DAY, checkIns, sampleMinutes: 1
  });

  for (const sample of curve.samples) {
    const total = sample.baseline + contribution(sample) + sample.clampedBy;
    assert.ok(
      Math.abs(total - sample.level) < 1e-9,
      `minute ${sample.minute}: ${total} does not reconstruct ${sample.level}`
    );
    assert.ok(sample.level >= 10 && sample.level <= 90);
    for (const row of sample.attribution) {
      assert.ok(row.source === 'routine' || row.source === 'check-in');
      assert.ok(Number.isFinite(row.delta));
    }
  }

  // Each logged routine that is still active is its own row, identified, so the
  // surface can name it. Lunch (12:10, a 135-minute span) and the gym session
  // (18:25) are correctly absent at 15:30: a row for an effect that has finished or
  // not started would be a zero the user has to read past.
  const busy = sampleAt(curve, 15, 30);
  const ids = busy.attribution.filter(row => row.source === 'routine').map(row => row.id);
  assert.deepEqual([...ids].sort(), ['coffee-2', 'med', 'nap', 'standup']);
  // The correction is a row too, so the disclosure is complete — but it carries no
  // label, because a user-facing string in core would be the wrong layer holding it.
  const correction = busy.attribution.find(row => row.source === 'check-in');
  assert.ok(correction);
  assert.equal(correction.label, null);
  assert.equal(correction.id, null);
});

test('clamping is disclosed rather than hidden', () => {
  // Ten meetings back to back: the negative sum is deliberately not capped, so
  // the curve can reach the floor. When it does, clampedBy is what keeps the
  // hover honest instead of silently swallowing the difference.
  const effects = Array.from({ length: 10 }, (unused, index) =>
    routine(`m${index}`, `meeting-${index}`, 'meeting-default', at(9, index * 3), { durationMin: 240 }));
  const curve = buildEnergyCurve({ dayKey: DAY, effects });
  const floored = curve.samples.filter(sample => sample.level === 10);

  assert.ok(floored.length > 0, 'ten consecutive meetings should reach the floor');
  for (const sample of floored) {
    assert.ok(sample.clampedBy > 0);
    assert.ok(Math.abs(sample.baseline + contribution(sample) + sample.clampedBy - 10) < 1e-9);
  }
  // And every unclamped sample reports exactly zero, not a rounding smear.
  assert.ok(curve.samples.filter(sample => sample.level > 10).every(sample => sample.clampedBy === 0));
});

test('the trend comes from the derivative, not from the level', () => {
  const effects = [routine('med', 'medication', 'medication-default', at(8, 30))];
  const rising = buildEnergyCurve({ dayKey: DAY, now: at(9, 30), effects });
  const falling = buildEnergyCurve({ dayKey: DAY, now: at(13), effects });
  const flat = buildEnergyCurve({ dayKey: DAY, now: at(4), effects });

  assert.equal(rising.trend, 'rising');
  assert.equal(falling.trend, 'falling');
  assert.equal(flat.trend, 'flat');
  // Rising and falling here are at similar heights, which is exactly why the
  // sentence the UI builds has to come from the trend: "still climbing" and
  // "coming down" are different advice at the same number.
  assert.ok(Math.abs(rising.nowLevel - falling.nowLevel) < 15);
});

test('a magnitude scales the effect, and its absence scales nothing', () => {
  const peak = magnitude => peakContribution(buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 1,
    effects: [routine('c', 'stimulant', 'stimulant-default', at(9), magnitude === null ? {} : { magnitude })]
  }));

  // A user who logged a coffee without saying how big it was told us nothing about
  // the size. Reading that silence as "small" would quietly shrink every effect
  // logged from a keyboard shortcut, so an absent magnitude and a magnitude of 50
  // are the same input — bit for bit, not approximately.
  const unstated = peak(null);
  assert.ok(Math.abs(unstated - 10) < 0.05);
  assert.equal(peak(50), unstated);
  // Linear in the reported intensity, with 50 as the neutral midpoint: the biggest
  // coffee in the world is worth 1.5x an unremarkable one, and the smallest is
  // still worth about half. Ratios rather than absolutes, because the amplitude a
  // one-minute grid actually reaches is a sampling artifact and the scaling is not.
  assert.ok(Math.abs(peak(100) / unstated - 1.5) < 1e-9);
  assert.ok(Math.abs(peak(75) / unstated - 1.25) < 1e-9);
  assert.ok(Math.abs(peak(1) / unstated - 0.51) < 1e-9);
});

test('a calibrated scale is applied per profile and never leaks across profiles', () => {
  const peak = effectScale => peakContribution(buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 1,
    effectScale,
    effects: [routine('c', 'stimulant', 'stimulant-default', at(9))]
  }));
  const uncalibrated = peak(null);

  // The persisted scale is bounded to [0.5, 1.5] by routine-schema.js, and within
  // that range it multiplies exactly. A calibration that is off by a factor it
  // cannot explain would make the attribution row a fiction.
  assert.ok(Math.abs(peak({ 'stimulant-default': 1.4 }) / uncalibrated - 1.4) < 1e-9);
  assert.ok(Math.abs(peak({ 'stimulant-default': 0.5 }) / uncalibrated - 0.5) < 1e-9);
  // Another profile's calibration is not this profile's business, and neither is a
  // value that survived storage but is not a number.
  assert.equal(peak({ 'meal-default': 1.4 }), uncalibrated);
  assert.equal(peak({ 'stimulant-default': 'nope' }), uncalibrated);
  assert.equal(peak({}), uncalibrated);
});

test('an unrecognised effect profile is dropped rather than guessed at', () => {
  // An unknown profile id means the writer and this file disagree about the
  // catalog. Falling back to some default shape would put a bump on the curve
  // that no version of the app ever intended.
  const curve = buildEnergyCurve({
    dayKey: DAY,
    effects: [
      routine('ghost', 'stimulant', 'no-such-profile', at(9)),
      routine('reminder', 'custom', null, at(10)),
      routine('undated', 'stimulant', 'stimulant-default', Number.NaN),
      null,
      'nonsense'
    ]
  });
  for (const sample of curve.samples) assert.deepEqual(sample.attribution, []);
});

test('a routine may override the amplitude and duration it was given', () => {
  // The two fields routine-schema.js persists per routine. They describe the shape
  // of the effect, never a dose — the schema records no quantity of anything, which
  // is what keeps this out of the business of medical advice.
  const curve = buildEnergyCurve({
    dayKey: DAY,
    sampleMinutes: 1,
    effects: [routine('c', 'stimulant', 'stimulant-default', at(9), { amplitude: 25, durationMin: 60 })]
  });
  assert.ok(Math.abs(peakContribution(curve) - 25) < 0.05);
  // A 60-minute span from a 20-minute onset finishes at 10:20, not at the
  // default profile's 14:00.
  assert.ok(contribution(sampleAt(curve, 10, 19)) > 0);
  assert.equal(contribution(sampleAt(curve, 10, 20)), 0);
});

test('suggested windows describe the next high stretch and schedule nothing', () => {
  const curve = buildEnergyCurve({ dayKey: DAY, now: at(9), effects: BUSY_DAY });

  assert.ok(curve.suggestedWindows.length <= MAX_SUGGESTED_WINDOWS);
  for (const window of curve.suggestedWindows) {
    assert.ok(window.startMinute >= 9 * 60, 'a window before now is not "next"');
    assert.ok(window.endMinute - window.startMinute >= MIN_WINDOW_MINUTES);
    assert.ok(window.peak > 0);
    // No task, no title, no calendar: the moment this picks work for the user it
    // becomes a planner that cannot see their commitments.
    assert.deepEqual(Object.keys(window).sort(), ['endMinute', 'peak', 'startMinute']);
  }
  const starts = curve.suggestedWindows.map(window => window.startMinute);
  assert.deepEqual(starts, [...starts].sort((left, right) => left - right));
});

test('a day that is not today has no now, and says so', () => {
  const effects = [routine('c', 'stimulant', 'stimulant-default', at(9))];
  const history = buildEnergyCurve({ dayKey: DAY, now: localDayStart('2026-03-12'), effects });

  assert.equal(history.nowMinute, null);
  assert.equal(history.nowLevel, null);
  assert.equal(history.trend, null);
  assert.deepEqual(history.nowAttribution, []);
  assert.deepEqual(history.suggestedWindows, []);
  // The samples are still a complete day — only the marker is missing.
  assert.equal(history.samples.length, (24 * 60) / DEFAULT_SAMPLE_MINUTES);
  assert.equal(buildEnergyCurve({ dayKey: DAY, effects }).nowLevel, null);
});

test('confidence is the worse of what the user reported and how well calibration holds', () => {
  // Deliberately stricter than currentEnergyEstimate: a whole curve is a bigger
  // claim than a single number, so it takes both a recent self-report and a
  // calibration that has been holding up before this says "high".
  const fresh = [{ at: at(12), level: 60 }];
  const build = extra => buildEnergyCurve({ dayKey: DAY, now: at(12), ...extra }).confidence;

  assert.equal(build({}), 'low');
  assert.equal(build({ checkIns: fresh }), 'medium');
  assert.equal(build({ checkIns: fresh, residualMae: 4 }), 'high');
  assert.equal(build({ checkIns: fresh, residualMae: 12 }), 'medium');
  assert.equal(build({ checkIns: fresh, residualMae: 30 }), 'low');
  // A stale report is worth less than a fresh one, which is the same 0.65 weight
  // threshold currentEnergyEstimate uses.
  assert.equal(build({ checkIns: [{ at: at(6), level: 60 }], residualMae: 4 }), 'medium');
  // On a historical day "now" means nothing, so the question becomes whether the
  // user reported anything at all that day.
  const past = { now: localDayStart('2026-03-12'), residualMae: 4 };
  assert.equal(buildEnergyCurve({ dayKey: DAY, ...past }).confidence, 'low');
  assert.equal(buildEnergyCurve({ dayKey: DAY, ...past, checkIns: fresh }).confidence, 'high');
});

test('malformed input is refused or ignored, never quietly reinterpreted', () => {
  assert.throws(() => buildEnergyCurve({ dayKey: 'not-a-day' }), TypeError);
  assert.throws(() => buildEnergyCurve({ dayKey: '2026-02-30' }), RangeError);
  assert.throws(() => buildEnergyCurve({}), TypeError);

  // A sampling interval that is not a whole number of minutes would put samples
  // at instants the minute-based sample keys cannot express.
  for (const bad of [0, -5, 7.5, 'ten', null, 10_000]) {
    assert.equal(buildEnergyCurve({ dayKey: DAY, sampleMinutes: bad }).sampleMinutes, DEFAULT_SAMPLE_MINUTES);
  }
  assert.equal(buildEnergyCurve({ dayKey: DAY, sampleMinutes: 60 }).samples.length, 24);

  // Unreadable check-ins are dropped, and an out-of-range level is pulled in
  // rather than allowed to drag the curve past its own bounds.
  const junk = buildEnergyCurve({
    dayKey: DAY, now: at(12), checkIns: [null, { at: at(12) }, { level: 50 }, { at: at(12), level: 999 }]
  });
  assert.equal(junk.nowLevel, 90);
});

test('a day key resolves to its own local midnight', () => {
  // The curve places every sample by adding minutes to this instant, so a day key
  // that resolved to the wrong midnight would slide a whole day's samples.
  const start = localDayStart('2026-03-10');
  const asDate = new Date(start);
  assert.equal(asDate.getFullYear(), 2026);
  assert.equal(asDate.getMonth(), 2);
  assert.equal(asDate.getDate(), 10);
  assert.equal(asDate.getHours(), 0);
  assert.equal(asDate.getMinutes(), 0);
  assert.equal(asDate.getSeconds(), 0);
  assert.equal(asDate.getMilliseconds(), 0);
  assert.throws(() => localDayStart('2026-3-10'), TypeError);
  assert.throws(() => localDayStart('2026-13-01'), RangeError);
});
