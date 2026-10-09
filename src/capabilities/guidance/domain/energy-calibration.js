'use strict';

// ARCHITECTURE「日常与能量」 — the energy curve learns this person's shape from their own reports.
//
// Three properties shape almost every line below:
//
// 1. Nobody starts with an invented profile. `energyProfile` stays `null` until
//    there is evidence, and `null` reads as "not calibrated" everywhere
//    downstream. Writing a default profile for every existing user would dress a
//    prior up as a measurement.
// 2. It must not chase noise. One self-report a day, on a scale people read
//    loosely, is a very weak signal: nothing moves until ten reports have
//    accumulated, at most one parameter moves per run, that move is at most 2% of
//    the parameter's own editable span, and a step that rounds away to zero is not
//    taken at all. A model that lurches after one bad afternoon is worse than one
//    that never learns, because the user cannot tell which of the two they have.
// 3. It is replayable. No clock, no randomness, no unsorted key iteration: the
//    same draft and the same inputs always produce the same profile, which is what
//    makes a calibration that went wrong something you can read rather than guess
//    at.
//
// Idempotence needs no extra field. Calibration always runs *after* the check-in
// it folds in, so `updatedAt` is already a watermark: a check-in at or before it
// has been counted. Running the daily pass twice therefore changes nothing, and a
// day with no new self-report is a no-op instead of the same report learned again.
// The one cost is that a check-in older than the very first calibration is never
// folded in — one report, once, at the start of a person's history.
//
// No clock here; `now` arrives from the application layer, as does `modelLevel`,
// which must be the same number the panel drew for that moment (see
// `predictModelLevelAt`) — a calibration that learns against a second, privately
// computed model is learning against a curve the user never saw.

const {
  BASELINE_EDITABLE_BOUNDS,
  EFFECT_SCALE_EDITABLE,
  defaultEnergyBaseline
} = require('../../../content/energy-effects.mjs');
const {
  EVENING_AFTER_WAKE_MINUTES,
  EVENING_FALL_MINUTES,
  POST_LUNCH_AFTER_WAKE_MINUTES,
  POST_LUNCH_HALF_WIDTH_MINUTES
} = require('../../../core/energy-curve');

const MINUTES_PER_DAY = 1440;
// ARCHITECTURE「日常与能量」: "at least 10 self-reports before any parameter moves".
const MIN_OBSERVATIONS_BEFORE_TUNING = 10;
const MAX_STEP_FRACTION = 0.02;
// The miss that earns a full-sized step. 20 points on a 0-100 scale is a miss the
// user would describe in words ("not even close"); anything smaller gets a
// proportionally smaller step.
const FULL_STEP_RESIDUAL = 20;
// Recency-weighted, because the model being measured keeps changing: a plain mean
// would still be reporting the fit of a baseline that was tuned away weeks ago.
const MAE_SMOOTHING = 0.3;
// An effect has to own the moment before its scale is blamed for the miss.
const MIN_DOMINANT_DELTA = 3;
const DOMINANT_DELTA_SHARE = 0.5;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertDraft(state) {
  if (!isPlainObject(state)) throw new TypeError('energy calibration requires a state draft');
}

function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('energy calibration requires a timestamp the store can hold');
  }
}

function clampTo(value, bounds) {
  const [min, max] = bounds;
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// The store holds these four as integers, and the editable bounds are narrower
// than the store's envelope, so a profile that arrived from an older default (or a
// hand-edited file) is pulled inside the bounds the first time it is tuned. That
// single correction can exceed the 2% step limit on purpose: the limit governs
// learning, not the bounds contract.
function clampBaseline(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const baseline = {};
  for (const [key, bounds] of Object.entries(BASELINE_EDITABLE_BOUNDS)) {
    baseline[key] = Math.round(clampTo(source[key], bounds));
  }
  return baseline;
}

function resolveSeed(baselineSeed) {
  return clampBaseline(isPlainObject(baselineSeed) ? baselineSeed : defaultEnergyBaseline());
}

// Integer parameters cannot move by less than one unit, so the smallest span here
// (`postLunchDipDepth`, 30 → 0.6 per run) only moves on a miss big enough to round
// that step up to 1 — roughly 17 points. That is the intended behaviour, not a
// rounding accident: a dip depth that twitched on every 3-point miss would be
// noise wearing a parameter's name.
function stepFor(bounds, strength, decimals) {
  const [min, max] = bounds;
  return round((max - min) * MAX_STEP_FRACTION * strength, decimals);
}

function moveBaseline(baseline, key, direction, strength) {
  const bounds = BASELINE_EDITABLE_BOUNDS[key];
  const step = stepFor(bounds, strength, 0);
  if (step <= 0) return null;
  const from = baseline[key];
  const to = Math.round(clampTo(from + direction * step, bounds));
  if (to === from) return null;
  baseline[key] = to;
  return { parameter: key, from, to };
}

// Which parameter owns a miss is decided by which of the baseline's three shaped
// terms is actually moving at that minute — `energyBaselineAt` read back in the
// other direction, with its offsets imported rather than copied so the two cannot
// drift apart. `wakeHour` is deliberately never moved: phase correction lives in
// `chronotypeShift` alone, and two parameters bidding for one degree of freedom
// would drift apart without ever improving the fit.
function routeBaseline(baseline, { residual, strength, checkInMinute }) {
  const wake = baseline.wakeHour * 60 + baseline.chronotypeShift;
  const afterWake = checkInMinute - wake;
  const higherThanModel = residual > 0;
  // Still climbing. Higher than modelled means the climb finished sooner than the
  // ramp says, and the other way round.
  if (afterWake > 0 && afterWake < baseline.morningRampMinutes) {
    return moveBaseline(baseline, 'morningRampMinutes', higherThanModel ? -1 : 1, strength);
  }
  // Inside the afternoon dip's support, where depth is the only parameter that can
  // raise or lower the curve. The test is on the support, not on the current depth:
  // a dip of zero is still where an undiscovered dip would first show up.
  if (Math.abs(afterWake - POST_LUNCH_AFTER_WAKE_MINUTES) < POST_LUNCH_HALF_WIDTH_MINUTES) {
    return moveBaseline(baseline, 'postLunchDipDepth', higherThanModel ? -1 : 1, strength);
  }
  // The evening decline — today's, and yesterday's still finishing after midnight
  // (core/energy-curve.js:205). A later chronotype pushes `wake` forward, which
  // delays that decline and so raises the curve at any fixed clock time: one sign
  // for both, because both are the same falling term.
  for (const dayOffset of [0, MINUTES_PER_DAY]) {
    const intoFall = afterWake + dayOffset - EVENING_AFTER_WAKE_MINUTES;
    if (intoFall > 0 && intoFall < EVENING_FALL_MINUTES) {
      return moveBaseline(baseline, 'chronotypeShift', higherThanModel ? 1 : -1, strength);
    }
  }
  // The plateau, and the flat night on either side of it. All three terms are level
  // there, so no editable parameter can move the curve at that minute and any step
  // taken would be a number changing for show. The report still counts as an
  // observation — it is evidence the model was asked, just not about any one
  // parameter. Reaching the ceiling itself is a limit of a four-parameter shape,
  // not something calibration can tune away.
  return null;
}

// One routine can only be blamed if it plainly owned that moment: at least three
// points of modelled effect, and more than half of all the effect in play. Anything
// less and the miss is about the shape of the day, not about that coffee. Strictly
// more than half, so that two routines splitting a moment evenly have no winner —
// picking one would mean picking by array order, which is not something the user
// can see or predict.
function dominantEffect(effects) {
  if (!Array.isArray(effects)) return null;
  let total = 0;
  let best = null;
  for (const effect of effects) {
    if (!isPlainObject(effect)) continue;
    const { profileId, delta } = effect;
    if (typeof profileId !== 'string' || !profileId || !Number.isFinite(delta)) continue;
    total += Math.abs(delta);
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { profileId, delta };
  }
  if (!best || Math.abs(best.delta) < MIN_DOMINANT_DELTA) return null;
  return Math.abs(best.delta) > total * DOMINANT_DELTA_SHARE ? best : null;
}

function moveEffectScale(effectScale, effect, { residual, strength }) {
  const step = stepFor(EFFECT_SCALE_EDITABLE, strength, 4);
  if (step <= 0) return null;
  const from = Number.isFinite(effectScale[effect.profileId])
    ? clampTo(effectScale[effect.profileId], EFFECT_SCALE_EDITABLE)
    : 1;
  // A drain that drained less than modelled and a boost that lifted more than
  // modelled are the same correction with opposite signs, so the direction is the
  // product: it scales the effect towards what actually happened either way.
  const direction = Math.sign(residual) * Math.sign(effect.delta);
  const to = round(clampTo(from + direction * step, EFFECT_SCALE_EDITABLE), 4);
  if (to === from) return null;
  effectScale[effect.profileId] = to;
  return { parameter: `effectScale:${effect.profileId}`, from, to };
}

function smoothMae(previous, residual) {
  const error = Math.abs(residual);
  if (!Number.isFinite(previous)) return round(Math.min(100, error), 2);
  return round(Math.min(100, previous + MAE_SMOOTHING * (error - previous)), 2);
}

function calibrateEnergyProfile(state, {
  now,
  modelLevel,
  effects = [],
  baselineSeed = null,
  checkInMinute = null
} = {}) {
  assertDraft(state);
  assertNow(now);
  const checkIn = state.energyCheckIn;
  if (!isPlainObject(checkIn) || !Number.isFinite(checkIn.level) || !Number.isFinite(checkIn.timestamp)) {
    return { ok: true, changed: false, reason: 'no-check-in' };
  }
  const previous = isPlainObject(state.energyProfile) ? state.energyProfile : null;
  const watermark = previous && Number.isFinite(previous.updatedAt) ? previous.updatedAt : null;
  if (watermark !== null && checkIn.timestamp <= watermark) {
    return { ok: true, changed: false, reason: 'already-folded' };
  }
  // The curve switched off (or a day the model cannot answer for) leaves nothing to
  // compare against. Counting the report anyway would inflate `observations` with
  // reports that taught the model nothing.
  if (!Number.isFinite(modelLevel)) {
    return { ok: true, changed: false, reason: 'no-model' };
  }

  const residual = checkIn.level - modelLevel;
  const observations = (previous && Number.isSafeInteger(previous.observations) ? previous.observations : 0) + 1;
  const tuning = observations >= MIN_OBSERVATIONS_BEFORE_TUNING;
  // Before tuning starts the baseline is re-seeded every run, so someone who moves
  // their work hours during the warm-up sees the curve follow — a frozen copy of the
  // seed they had on day one would quietly outrank their own settings.
  const baseline = tuning && previous ? clampBaseline(previous.baseline) : resolveSeed(baselineSeed);
  const effectScale = previous && isPlainObject(previous.effectScale) ? { ...previous.effectScale } : {};
  const strength = Math.min(1, Math.abs(residual) / FULL_STEP_RESIDUAL);
  const routable = Number.isInteger(checkInMinute) && checkInMinute >= 0 && checkInMinute < MINUTES_PER_DAY;

  let adjusted = null;
  if (tuning && routable) {
    // Either the effect or the shape, never both in one run: one moving part per
    // report is what keeps the daily step small enough to be honest about.
    const effect = dominantEffect(effects);
    adjusted = effect
      ? moveEffectScale(effectScale, effect, { residual, strength })
      : routeBaseline(baseline, { residual, strength, checkInMinute });
  }

  state.energyProfile = {
    baseline,
    effectScale,
    observations,
    updatedAt: now,
    // Held back until tuning begins: `calibrationConfidence(null)` caps the curve at
    // "medium", which is the truth while a handful of reports is all there is.
    lastResidualMae: tuning ? smoothMae(previous && previous.lastResidualMae, residual) : null
  };
  return {
    ok: true,
    changed: true,
    reason: null,
    observations,
    calibrating: tuning,
    residual: round(residual, 2),
    adjusted,
    lastResidualMae: state.energyProfile.lastResidualMae
  };
}

// ARCHITECTURE「日常与能量」 requires a way back. Returning to `null` rather than to a default profile
// keeps one meaning for "uncalibrated" — anything else would leave the user unable
// to tell a reset curve from a learned one.
function resetEnergyCalibration(state) {
  assertDraft(state);
  if (state.energyProfile === null || state.energyProfile === undefined) {
    return { ok: true, changed: false, reason: 'not-calibrated' };
  }
  state.energyProfile = null;
  return { ok: true, changed: true, reason: null };
}

module.exports = {
  MIN_OBSERVATIONS_BEFORE_TUNING,
  MAX_STEP_FRACTION,
  calibrateEnergyProfile,
  resetEnergyCalibration
};
