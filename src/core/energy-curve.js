'use strict';

// The personal energy curve: one parameterized shape for the day, plus one
// closed-form bump per intervention the user logged, corrected by what the user
// actually reported about themselves.
//
// This is core, so it reads the default effect table from content and knows
// nothing about routines, tasks, settings or the store. Every input arrives as
// an argument, including `now` — which is what makes the whole file testable
// without a clock.
//
// Three properties are load-bearing, and nearly every choice below serves one:
//
// 1. **It can explain itself.** Each sample carries the baseline it started from
//    and one attribution row per contribution, and those numbers add up to the
//    level exactly. A curve that cannot say why it reads 61 is decoration, and
//    decoration that looks like a measurement is worse than no curve at all.
// 2. **It is smooth.** Every rise and every fall goes through a Hermite
//    smoothstep, never a straight line, so the slope the curve reports is a
//    property of the model rather than an artifact of where two segments were
//    joined. `trend` comes from the analytic derivative, not from differencing
//    two samples.
// 3. **It does not reward logging more.** Repeated interventions of the same kind
//    decay, and the total positive contribution is capped. A purely additive
//    model would make "log another coffee" a way to raise the number, turning a
//    modelling hole into a usage suggestion.
//
// The honest discontinuities, since "smooth" should be a measured claim and not
// an adjective. Intervention shapes are continuous. The inferred baseline has a
// slope change at assumed sleep onset (the two-process equations change there),
// and a self-report may move the estimate immediately because it is new evidence,
// not an intervention whose onset should be invented. `test/energy-curve.test.js`
// measures both rather than hiding them behind drawing-time smoothing:
//
//   - Where a segment reaches its peak and starts decaying, the slope steps by
//     `amplitude x ln2 / halfLife`. That is 4 points an hour for medication and
//     27 for the sleep-inertia dip, which is the largest in the model because it
//     is the shortest and steepest segment the content table describes.
//   - At each check-in, an innovation is applied from that instant forward and
//     then decays. Future reports never rewrite the earlier curve, and every
//     report is therefore an exact observation rather than one vote in a global
//     average.
//
// Both are an order of magnitude below what a linear ramp would show throughout
// (27 points an hour against a linear inertia dip's 96), and both are unavoidable
// without adding a blend whose only purpose is making a test read nicer.
//
// Not in scope, ever: dose, adherence, clinical claims, or any prediction beyond
// the day being drawn. See ARCHITECTURE「日常与能量」.

const { localDayStart, localDayKey } = require('./calendar');
const {
  BASELINE_EDITABLE_BOUNDS,
  defaultEnergyBaseline,
  effectProfileById
} = require('../content/energy-effects.mjs');

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const LN2 = Math.log(2);

// 96 points at 15 minutes, which is the resolution the curve is drawn at. Fine
// enough that the eye reads a curve, coarse enough that a day's worth fits in one
// IPC payload without paging.
const DEFAULT_SAMPLE_MINUTES = 15;
const MIN_SAMPLE_MINUTES = 1;
const MAX_SAMPLE_MINUTES = 120;

// The visible scale deliberately never reaches either end. This is an estimate,
// not a battery or a cognitive-capacity measurement; 0 and 100 would imply a
// certainty the inputs cannot support. User corrections and interventions share
// the same envelope.
const ENERGY_FLOOR = 10;
const ENERGY_CEILING = 90;

// Baseline constants implement the *shape* of the Borbély two-process model:
// homeostatic sleep pressure rises exponentially while awake and dissipates
// exponentially during assumed sleep, while a circadian oscillator can oppose
// that pressure late in the day. The classic time constants are population
// priors, not individual clinical parameters. Sleep timing is still inferred
// from the user's existing wake/work setting and can be calibrated locally.
const ASSUMED_AWAKE_MINUTES = 16 * 60;
const HOMEOSTATIC_WAKE_TAU_MINUTES = 18.2 * 60;
const HOMEOSTATIC_SLEEP_TAU_MINUTES = 4.2 * 60;
const HOMEOSTATIC_DROP = 12;
const CIRCADIAN_AMPLITUDE = 14;
const CIRCADIAN_PEAK_AFTER_WAKE_MINUTES = 9 * 60;
const SLEEP_INERTIA_DEPTH = 16;
const PRE_WAKE_TRANSITION_MINUTES = 60;
const REFERENCE_LEVEL = 58;

// Kept as named exports for older consumers. They now describe the display
// envelope's rough anchors, not two plateaus joined by ramps.
const NIGHT_LEVEL = 30;
const DAY_LEVEL = REFERENCE_LEVEL;

// Calibration uses this interval to recognise the descending evening portion.
// The baseline itself has no hard evening join: the circadian and homeostatic
// terms are continuous.
const EVENING_AFTER_WAKE_MINUTES = 11 * 60;
const EVENING_FALL_MINUTES = 6 * 60;
// A wake-relative afternoon dip is retained as an editable secondary circadian
// feature. It must not be described as a meal effect: meals are separate logged
// interventions below.
const POST_LUNCH_AFTER_WAKE_MINUTES = 6 * 60;
const POST_LUNCH_HALF_WIDTH_MINUTES = 120;

// Every segment rises for at least this long. `drain` has `onsetMin: 0`, and
// without a floor its rise would be instantaneous — a step in the value itself,
// which is a worse artifact than the slope step described in the header.
const MIN_RISE_MINUTES = 5;
const MIN_SEGMENT_MINUTES = 3 * MIN_RISE_MINUTES;
// And no segment reaches its peak in less than an eighth of its own life. The
// onset delay alone is not enough of a floor: `rest` has `onsetMin: 5` and lasts
// three hours, so onset-length rises would have it climbing 14 points in five
// minutes — 250 points an hour, which then stacked with the sleep-inertia dip
// into a 22-point spike. A model that spikes is not a smooth model with a display
// problem; it is the artifact this file's second stated property exists to
// exclude. The fraction bounds the slope by the segment's own scale, which is the
// only scale available here.
const MIN_RISE_FRACTION = 1 / 8;
// A meeting's drain does not stop the moment the meeting does. Two half-lives of
// tail is enough to be visible and short enough not to colour the evening.
const DRAIN_TAIL_HALF_LIVES = 2;

// The n-th logged intervention of the same kind counts for 1/(1+0.6n), n from 0,
// so the first one is undiscounted: five coffees must not push the
// curve to 100.
const SAME_KIND_DECAY = 0.6;
const POSITIVE_SUM_CAP = 25;

// A self-reported magnitude of 50 is "typical" and scales nothing; 100 gives 1.5x
// and 1 gives roughly half. The floor is derived from the neutral point rather
// than written down beside it, so the two cannot drift into disagreeing about
// which magnitude is a no-op.
//
// Absence also scales nothing: a user who logged a coffee without saying how big
// it was told us nothing about the size, and reading silence as "small" would
// quietly shrink every effect logged from a keyboard shortcut.
const NEUTRAL_MAGNITUDE = 50;
const MAGNITUDE_FLOOR = 1 - NEUTRAL_MAGNITUDE / 100;

// Shared with `currentEnergyEstimate`, which uses the same half-life for the same
// purpose. A self-report from three hours ago carries half the weight it did when
// it was made.
const DEFAULT_CHECK_IN_HALF_LIFE_MINUTES = 180;
const MIN_CHECK_IN_HALF_LIFE_MINUTES = 30;
const MAX_CHECK_IN_HALF_LIFE_MINUTES = 720;
// AI-derived impulse signals are deliberately shorter-lived and smaller than a
// direct self-report. The person remains the highest-authority sensor.
const ENERGY_SIGNAL_HALF_LIFE_MINUTES = 120;
const ENERGY_SIGNAL_MAX_AGE_MINUTES = 24 * 60;

const TREND_FLAT_POINTS_PER_HOUR = 2;
// 专注负荷：专注本身是一种消耗，而且是这条曲线里唯一不需要你手动记录的干预。
// 它原本只在头部读数里按“今天累计几分钟”分档扣分，曲线上看不到，于是同一时刻出现两个数。
// 现在它是曲线的一个分量，由两部分组成：
// - 急性部分：一段专注期间逐渐加深（smoothstep，60 分钟到底 −8），结束后按 40 分钟半衰回收——
//   休息就是回收，不需要另外打卡；
// - 累积部分：当天每专注 20 分钟留下 −1，封顶 −8，当天不回收，第二天清零。
// 数值是先验，和效应表一样由自评残差把它拉回这个人的现实。
const FOCUS_ACUTE_MAX = 8;
const FOCUS_ACUTE_FULL_MINUTES = 60;
const FOCUS_RECOVERY_HALF_LIFE_MINUTES = 40;
const FOCUS_RESIDUAL_MINUTES_PER_POINT = 20;
const FOCUS_RESIDUAL_CAP = 8;
const FOCUS_MAX_SESSION_MINUTES = 240;
// The same 0.65 threshold `currentEnergyEstimate` uses to call a check-in weight
// "high", so the two features never disagree about the same check-in.
const CONFIDENCE_CHECK_IN_WEIGHT = 0.65;
const CONFIDENCE_MAE_HIGH = 8;
const CONFIDENCE_MAE_MEDIUM = 16;
const CONFIDENCE_ORDER = Object.freeze(['low', 'medium', 'high']);

const WINDOW_MARGIN = 3;
const MIN_WINDOW_MINUTES = 30;
const MAX_SUGGESTED_WINDOWS = 2;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Hermite smoothstep on [0,1], flat at both ends. Every transition in this file
// goes through it: a linear ramp leaves the
// derivative discontinuous at both of its ends, so the curvature the curve
// appears to show would be a property of the joins rather than of the model.
// s'(0) = s'(1) = 0 is what makes the joins invisible.
function smoothstep(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

function smoothstepSlope(x) {
  if (x <= 0 || x >= 1) return 0;
  return 6 * x * (1 - x);
}

// A symmetric bump on [-1,1], used for the afternoon dip. Composed from
// smoothstep so it inherits the flat ends, and the derivative approaches zero
// from both sides at the peak, so the mirroring introduces no kink there.
function bump(x) {
  return smoothstep(1 - Math.abs(x));
}

function bumpSlope(x) {
  if (x === 0) return 0;
  return -Math.sign(x) * smoothstepSlope(1 - Math.abs(x));
}

// Clamps rather than rejects, which is the opposite of what the persistence layer
// does with the same four numbers — deliberately. By the time a value reaches
// here it has already passed the store's validation; the only remaining question
// is whether the drawing code can proceed, and content's `editable` bounds are
// the documented policy ceiling for exactly that.
function resolveBaselineParams(raw) {
  const defaults = defaultEnergyBaseline();
  const source = isPlainObject(raw) ? raw : {};
  const resolved = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const bounds = BASELINE_EDITABLE_BOUNDS[key];
    const value = source[key];
    if (!Number.isFinite(value)) {
      resolved[key] = fallback;
    } else if (bounds) {
      resolved[key] = clamp(value, bounds[0], bounds[1]);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

// Periodic steady-state Process S. Solving the wake/sleep recurrence first is
// important: resetting pressure to an arbitrary value at midnight would create
// a daily sawtooth, while resetting it at wake time would hide the previous
// night's dissipation. The assumed 16h/8h rhythm is only a prior until real sleep
// timing exists in the product.
function homeostaticPressure(minutesAfterWake) {
  const sleepMinutes = MINUTES_PER_DAY - ASSUMED_AWAKE_MINUTES;
  const wakeDecay = Math.exp(-ASSUMED_AWAKE_MINUTES / HOMEOSTATIC_WAKE_TAU_MINUTES);
  const sleepDecay = Math.exp(-sleepMinutes / HOMEOSTATIC_SLEEP_TAU_MINUTES);
  const wakePressure = sleepDecay * (1 - wakeDecay) / (1 - wakeDecay * sleepDecay);
  const endPressure = 1 - (1 - wakePressure) * wakeDecay;
  if (minutesAfterWake < ASSUMED_AWAKE_MINUTES) {
    const pressure = 1 - (1 - wakePressure)
      * Math.exp(-minutesAfterWake / HOMEOSTATIC_WAKE_TAU_MINUTES);
    return {
      awake: true,
      pressure,
      slope: (1 - pressure) / HOMEOSTATIC_WAKE_TAU_MINUTES,
      wakePressure,
      endPressure
    };
  }
  const asleepFor = minutesAfterWake - ASSUMED_AWAKE_MINUTES;
  const pressure = endPressure * Math.exp(-asleepFor / HOMEOSTATIC_SLEEP_TAU_MINUTES);
  return {
    awake: false,
    pressure,
    slope: -pressure / HOMEOSTATIC_SLEEP_TAU_MINUTES,
    wakePressure,
    endPressure
  };
}

// One explainable daily baseline. Four persisted personal parameters remain the
// public configuration surface, but they now shape physiologically motivated
// components instead of choosing joins between hand-drawn plateaus:
//   - wakeHour + chronotypeShift place the phase;
//   - morningRampMinutes controls how quickly sleep inertia clears;
//   - postLunchDipDepth controls the secondary afternoon dip.
function energyBaselineAt(minuteOfDay, params) {
  const wake = params.wakeHour * 60 + params.chronotypeShift;
  const afterWake = modulo(minuteOfDay - wake, MINUTES_PER_DAY);
  const processS = homeostaticPressure(afterWake);
  const pressureSpan = processS.endPressure - processS.wakePressure;
  const pressureProgress = pressureSpan > 0
    ? (processS.pressure - processS.wakePressure) / pressureSpan
    : 0;
  const homeostatic = -HOMEOSTATIC_DROP * pressureProgress;
  const homeostaticSlope = -HOMEOSTATIC_DROP * processS.slope / pressureSpan;

  const angularRate = 2 * Math.PI / MINUTES_PER_DAY;
  const circadianPhase = afterWake - (CIRCADIAN_PEAK_AFTER_WAKE_MINUTES - MINUTES_PER_DAY / 4);
  const circadian = CIRCADIAN_AMPLITUDE * Math.sin(circadianPhase * angularRate);
  const circadianSlope = CIRCADIAN_AMPLITUDE * angularRate * Math.cos(circadianPhase * angularRate);

  // A Gaussian recovery has zero slope at wake and reaches 5% at the configured
  // ramp duration. The preceding hour eases into the same value while the person
  // is still assumed asleep. That pre-wake shoulder is not labelled inertia; it
  // exists so a 24-hour estimate does not jump vertically at the guessed wake
  // minute, when in reality sleep/wake timing is not known to that precision.
  const inertiaTau = Math.max(10, params.morningRampMinutes / Math.sqrt(Math.log(20)));
  let inertiaFactor = 0;
  let inertiaFactorSlope = 0;
  if (processS.awake) {
    inertiaFactor = Math.exp(-Math.pow(afterWake / inertiaTau, 2));
    inertiaFactorSlope = -2 * afterWake * inertiaFactor / (inertiaTau * inertiaTau);
  } else if (afterWake > MINUTES_PER_DAY - PRE_WAKE_TRANSITION_MINUTES) {
    const enteringWake = (afterWake - (MINUTES_PER_DAY - PRE_WAKE_TRANSITION_MINUTES))
      / PRE_WAKE_TRANSITION_MINUTES;
    inertiaFactor = smoothstep(enteringWake);
    inertiaFactorSlope = smoothstepSlope(enteringWake) / PRE_WAKE_TRANSITION_MINUTES;
  }
  const inertia = -SLEEP_INERTIA_DEPTH * inertiaFactor;
  const inertiaSlope = -SLEEP_INERTIA_DEPTH * inertiaFactorSlope;

  const dipPosition = (afterWake - POST_LUNCH_AFTER_WAKE_MINUTES) / POST_LUNCH_HALF_WIDTH_MINUTES;
  const afternoonDip = -params.postLunchDipDepth * bump(dipPosition);
  const afternoonDipSlope = -params.postLunchDipDepth
    * bumpSlope(dipPosition) / POST_LUNCH_HALF_WIDTH_MINUTES;
  return {
    level: REFERENCE_LEVEL + homeostatic + circadian + inertia + afternoonDip,
    slope: homeostaticSlope + circadianSlope + inertiaSlope + afternoonDipSlope,
    components: Object.freeze({
      homeostatic,
      circadian,
      sleepInertia: inertia,
      afternoonDip,
      pressure: processS.pressure,
      awake: processS.awake
    })
  };
}

// One segment is: nothing, then a smoothstep rise to `gain`, then an optional
// plateau, then an exponential decay closed by a smoothstep that spans the whole
// decay. The closing smoothstep is why `durationMin` and `decayHalfLifeMin` can
// both be honoured without over-determining the tail: the half-life shapes the
// decay, the duration ends it, and the segment lands at exactly zero with zero
// slope instead of being cut off at whatever height it had reached.
//
// It also means `gain` is the realized peak rather than an asymptote nobody
// reaches, which is what keeps an attribution row readable.
function buildSegment({ gain, startMin, durationMin, halfLifeMin, holdMin = 0 }) {
  const span = Math.max(MIN_SEGMENT_MINUTES, durationMin);
  // The rise takes as long as the onset delay, so a profile that needs 40 minutes
  // to start also needs 40 minutes to peak — the same number describes both, and
  // the peak lands at twice the onset. Floored by the segment's own scale for the
  // reason on `MIN_RISE_FRACTION`, and capped at a third of the span so a long
  // onset on a short effect cannot leave no room to come back down.
  const riseMin = clamp(Math.max(startMin, span * MIN_RISE_FRACTION), MIN_RISE_MINUTES, span / 3);
  const heldMin = clamp(holdMin, 0, span - riseMin - MIN_RISE_MINUTES);
  const decayMin = span - riseMin - heldMin;
  const halfLife = Number.isFinite(halfLifeMin) && halfLifeMin > 0
    ? halfLifeMin
    // A segment the table gives no half-life for decays to a quarter of its peak
    // across its own span, and the closing smoothstep takes it from there to 0.
    : span / 2;
  return { gain, startMin, riseMin, heldMin, decayMin, halfLife, endMin: startMin + span };
}

function segmentAt(segment, elapsedMin) {
  const { gain, startMin, riseMin, heldMin, decayMin, halfLife, endMin } = segment;
  if (gain === 0 || elapsedMin <= startMin || elapsedMin >= endMin) return { delta: 0, slope: 0 };
  const since = elapsedMin - startMin;
  if (since < riseMin) {
    const x = since / riseMin;
    return { delta: gain * smoothstep(x), slope: gain * smoothstepSlope(x) / riseMin };
  }
  if (since < riseMin + heldMin) return { delta: gain, slope: 0 };
  const decayed = since - riseMin - heldMin;
  const remaining = (decayMin - decayed) / decayMin;
  const level = Math.pow(0.5, decayed / halfLife);
  const close = smoothstep(remaining);
  return {
    delta: gain * level * close,
    // d/dt [ 2^(-m/h) * S((D-m)/D) ], product rule with dS/dt negated by the
    // falling argument.
    slope: gain * level * (close * (-LN2 / halfLife) - smoothstepSlope(remaining) / decayMin)
  };
}

// Each of the six shapes in `energy-effects.mjs` becomes one or two segments.
// `ramp-decay` and `quick-lift` share the same builder because they are the same
// shape at different numbers — writing that once is the point of having a builder.
function segmentsForShape(profile, { amplitude, durationMin, eventMinutes }, gainScale) {
  const gain = amplitude * gainScale;
  const onset = Math.max(0, profile.onsetMin);
  const halfLifeMin = profile.decayHalfLifeMin;
  const lift = () => buildSegment({ gain, startMin: onset, durationMin, halfLifeMin });
  switch (profile.shape) {
    case 'ramp-decay':
    case 'quick-lift':
      return [lift()];
    case 'dip-recover': {
      const dip = lift();
      // The rebound starts where the dip bottoms out, and both end together, so
      // the pair reads as one movement: down, then back up to slightly above the
      // baseline. No new constant — the dip's own rise length sets the offset.
      return [dip, buildSegment({
        gain: (profile.reboundAmplitude || 0) * gainScale,
        startMin: dip.startMin + dip.riseMin,
        durationMin: durationMin - dip.riseMin,
        halfLifeMin
      })];
    }
    case 'delayed-lift':
      // The cost comes first and is over before the lift arrives: exercise is
      // tiring while you are doing it.
      return [buildSegment({
        gain: (profile.costAmplitude || 0) * gainScale,
        startMin: 0,
        durationMin: profile.costMinutes || MIN_SEGMENT_MINUTES,
        halfLifeMin: null
      }), lift()];
    case 'restore': {
      const segments = [lift()];
      // Sleep inertia is gated on how long the rest actually lasted, and the log
      // does not record a duration. So without an explicit `eventMinutes` there
      // is no inertia segment at all: inventing a nap length in order to invent
      // grogginess from it is exactly the fabrication the persisted schema exists
      // to prevent.
      const longEnough = Number.isFinite(eventMinutes)
        && Number.isFinite(profile.inertiaAfterMin)
        && eventMinutes > profile.inertiaAfterMin;
      if (longEnough) {
        segments.unshift(buildSegment({
          gain: (profile.inertiaAmplitude || 0) * gainScale,
          startMin: 0,
          durationMin: profile.inertiaMinutes || MIN_SEGMENT_MINUTES,
          halfLifeMin: null
        }));
      }
      return segments;
    }
    case 'drain':
      // Held at full depth for as long as the thing lasts, then a tail. This is
      // the only shape where `durationMin` describes the event rather than the
      // effect, because a meeting drains you for exactly as long as it runs.
      return [buildSegment({
        gain,
        startMin: onset,
        durationMin: durationMin + DRAIN_TAIL_HALF_LIVES * Math.max(1, halfLifeMin || 0),
        halfLifeMin,
        holdMin: durationMin
      })];
    default:
      return [];
  }
}

function magnitudeScale(magnitude) {
  if (!Number.isFinite(magnitude)) return 1;
  return MAGNITUDE_FLOOR + clamp(magnitude, 1, 100) / 100;
}

// Resolves each logged intervention into segments with an absolute start time.
// An entry whose profile is not in the content table is dropped rather than
// defaulted: an unknown effect id means the writer and this file disagree, and
// guessing which shape was meant would put a bump on the curve that no version of
// the app ever intended.
function prepareEffects(rawEffects, effectScale) {
  const scales = isPlainObject(effectScale) ? effectScale : {};
  const usable = (Array.isArray(rawEffects) ? rawEffects : [])
    .map(effect => (isPlainObject(effect) ? { effect, profile: effectProfileById(effect.profileId) } : null))
    .filter(entry => entry && entry.profile && Number.isFinite(entry.effect.at))
    // Sorted so the same-kind discount is assigned oldest-first, with a total
    // tie-break so two entries at the same instant cannot swap places between
    // runs. ARCHITECTURE「日常与能量」 requires input-order independence,
    // and a stable sort is how that is achieved rather than asserted.
    .sort((left, right) => left.effect.at - right.effect.at
      || String(left.effect.id || '').localeCompare(String(right.effect.id || ''))
      || String(left.effect.profileId).localeCompare(String(right.effect.profileId)));

  const seenByKind = new Map();
  const prepared = [];
  for (const { effect, profile } of usable) {
    const kindKey = typeof effect.kind === 'string' && effect.kind ? effect.kind : effect.profileId;
    const seen = seenByKind.get(kindKey) || 0;
    seenByKind.set(kindKey, seen + 1);
    const calibration = Number.isFinite(scales[effect.profileId]) ? scales[effect.profileId] : 1;
    const gainScale = calibration
      * magnitudeScale(effect.magnitude)
      / (1 + SAME_KIND_DECAY * seen);
    const segments = segmentsForShape(profile, {
      amplitude: Number.isFinite(effect.amplitude) ? effect.amplitude : profile.amplitude,
      durationMin: Number.isFinite(effect.durationMin) ? effect.durationMin : profile.durationMin,
      eventMinutes: effect.eventMinutes
    }, gainScale);
    if (!segments.length) continue;
    prepared.push({
      source: 'routine',
      id: typeof effect.id === 'string' ? effect.id : null,
      label: typeof effect.label === 'string' ? effect.label : null,
      profileId: effect.profileId,
      at: effect.at,
      segments
    });
  }
  return prepared;
}

function prepareEnergySignals(rawSignals) {
  return (Array.isArray(rawSignals) ? rawSignals : [])
    .filter(signal => isPlainObject(signal)
      && typeof signal.id === 'string'
      && Number.isFinite(signal.at)
      && Number.isFinite(signal.delta)
      && signal.delta !== 0)
    .map(signal => ({
      source: 'impulse-ai',
      id: signal.id,
      label: typeof signal.reason === 'string' ? signal.reason : null,
      at: signal.at,
      delta: clamp(signal.delta, -12, 12)
    }))
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
}

function energySignalAt(signal, timestamp) {
  const elapsed = (timestamp - signal.at) / MS_PER_MINUTE;
  if (elapsed < 0 || elapsed > ENERGY_SIGNAL_MAX_AGE_MINUTES) return { delta: 0, slope: 0 };
  const weight = Math.pow(0.5, elapsed / ENERGY_SIGNAL_HALF_LIFE_MINUTES);
  return {
    delta: signal.delta * weight,
    slope: signal.delta * weight * (-LN2 / ENERGY_SIGNAL_HALF_LIFE_MINUTES)
  };
}

function prepareFocusSessions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(session => isPlainObject(session)
      && Number.isFinite(session.startMs) && Number.isFinite(session.endMs)
      && session.endMs > session.startMs)
    .map(session => ({
      startMs: Math.max(session.startMs, session.endMs - FOCUS_MAX_SESSION_MINUTES * MS_PER_MINUTE),
      endMs: session.endMs
    }))
    .sort((left, right) => left.startMs - right.startMs);
}

function focusLoadAt(sessions, timestamp, dayStart) {
  let acute = 0;
  let acuteSlope = 0;
  let residual = 0;
  let residualSlope = 0;
  for (const session of sessions) {
    const elapsed = (timestamp - session.startMs) / MS_PER_MINUTE;
    if (elapsed <= 0) continue;
    const duration = (session.endMs - session.startMs) / MS_PER_MINUTE;
    const within = Math.min(elapsed, duration);
    if (session.startMs >= dayStart) {
      residual -= within / FOCUS_RESIDUAL_MINUTES_PER_POINT;
      if (elapsed < duration) residualSlope -= 1 / FOCUS_RESIDUAL_MINUTES_PER_POINT;
    }
    if (elapsed < duration) {
      const x = within / FOCUS_ACUTE_FULL_MINUTES;
      acute -= FOCUS_ACUTE_MAX * smoothstep(x);
      acuteSlope -= FOCUS_ACUTE_MAX * smoothstepSlope(x) / FOCUS_ACUTE_FULL_MINUTES;
    } else {
      const peak = -FOCUS_ACUTE_MAX * smoothstep(duration / FOCUS_ACUTE_FULL_MINUTES);
      const weight = Math.pow(0.5, (elapsed - duration) / FOCUS_RECOVERY_HALF_LIFE_MINUTES);
      acute += peak * weight;
      acuteSlope += peak * weight * (-LN2 / FOCUS_RECOVERY_HALF_LIFE_MINUTES);
    }
  }
  if (acute < -FOCUS_ACUTE_MAX) { acute = -FOCUS_ACUTE_MAX; acuteSlope = 0; }
  if (residual < -FOCUS_RESIDUAL_CAP) { residual = -FOCUS_RESIDUAL_CAP; residualSlope = 0; }
  return { delta: acute + residual, slope: acuteSlope + residualSlope };
}

// The model on its own, before any self-report is folded in. Separate from the
// corrected read because the residuals are defined against this: correcting the
// curve and then measuring how wrong it is against the corrected version would
// measure nothing.
function modelAt(timestamp, dayStart, params, prepared, preparedSignals = [], preparedFocus = []) {
  const minuteOfDay = (timestamp - dayStart) / MS_PER_MINUTE;
  const base = energyBaselineAt(minuteOfDay, params);
  const rows = [];
  let positive = 0;
  let positiveSlope = 0;
  let negative = 0;
  let negativeSlope = 0;
  for (const effect of prepared) {
    const elapsed = (timestamp - effect.at) / MS_PER_MINUTE;
    let delta = 0;
    let slope = 0;
    for (const segment of effect.segments) {
      const point = segmentAt(segment, elapsed);
      delta += point.delta;
      slope += point.slope;
    }
    if (delta === 0 && slope === 0) continue;
    rows.push({ source: effect.source, id: effect.id, label: effect.label, delta, slope });
    if (delta > 0) {
      positive += delta;
      positiveSlope += slope;
    } else {
      negative += delta;
      negativeSlope += slope;
    }
  }
  for (const signal of preparedSignals) {
    const point = energySignalAt(signal, timestamp);
    if (point.delta === 0 && point.slope === 0) continue;
    rows.push({
      source: signal.source,
      id: signal.id,
      label: signal.label,
      delta: point.delta,
      slope: point.slope
    });
    if (point.delta > 0) {
      positive += point.delta;
      positiveSlope += point.slope;
    } else {
      negative += point.delta;
      negativeSlope += point.slope;
    }
  }

  const load = focusLoadAt(preparedFocus, timestamp, dayStart);
  if (load.delta !== 0 || load.slope !== 0) {
    rows.push({ source: 'focus-load', id: null, label: null, delta: load.delta, slope: load.slope });
    negative += load.delta;
    negativeSlope += load.slope;
  }

  let sum = positive + negative;
  let sumSlope = positiveSlope + negativeSlope;
  if (positive > POSITIVE_SUM_CAP) {
    const factor = POSITIVE_SUM_CAP / positive;
    for (const row of rows) if (row.delta > 0) row.delta *= factor;
    sum = POSITIVE_SUM_CAP + negative;
    // While the cap binds, the positive total is pinned at exactly the cap, so it
    // contributes no slope. Scaling the slopes by `factor` instead would report a
    // rise the curve is not making.
    sumSlope = negativeSlope;
  }
  return { minuteOfDay, baseline: base.level, baselineSlope: base.slope, rows, sum, sumSlope };
}

function normalizeCheckIns(raw) {
  const byTimestamp = new Map();
  for (const entry of (Array.isArray(raw) ? raw : [])) {
    if (!isPlainObject(entry) || !Number.isFinite(entry.at) || !Number.isFinite(entry.level)) continue;
    byTimestamp.set(entry.at, {
      at: entry.at,
      level: clamp(entry.level, ENERGY_FLOOR, ENERGY_CEILING)
    });
  }
  return [...byTimestamp.values()]
    .sort((left, right) => left.at - right.at);
}

// Fold observations in as causal innovations. Each anchor stores only the part
// of its residual that older anchors did not already explain. At the exact
// observation time, old decays + the new innovation equal the reported value;
// afterwards all innovations fade independently. This is an online correction,
// not an interpolant, so a later report cannot pull an earlier point away from
// what the person actually said or create oscillations between reports.
function correctionAt(timestamp, anchors, halfLifeMinutes) {
  if (!anchors.length) return { delta: 0, slope: 0 };
  let delta = 0;
  let slope = 0;
  for (const anchor of anchors) {
    const ageMinutes = (timestamp - anchor.at) / MS_PER_MINUTE;
    if (ageMinutes < 0) continue;
    const weight = Math.pow(0.5, ageMinutes / halfLifeMinutes);
    delta += weight * anchor.innovation;
    slope += weight * anchor.innovation * (-LN2 / halfLifeMinutes);
  }
  return { delta, slope };
}

function trendFromSlope(slopePerMinute) {
  const perHour = slopePerMinute * 60;
  if (perHour > TREND_FLAT_POINTS_PER_HOUR) return 'rising';
  if (perHour < -TREND_FLAT_POINTS_PER_HOUR) return 'falling';
  return 'flat';
}

function checkInConfidence(weight) {
  if (weight >= CONFIDENCE_CHECK_IN_WEIGHT) return 'high';
  return weight > 0 ? 'medium' : 'low';
}

function calibrationConfidence(residualMae) {
  if (!Number.isFinite(residualMae)) return 'medium';
  if (residualMae <= CONFIDENCE_MAE_HIGH) return 'high';
  return residualMae <= CONFIDENCE_MAE_MEDIUM ? 'medium' : 'low';
}

// The worse of the two, deliberately: a curve is a bigger claim than the single
// number `currentEnergyEstimate` returns, so it needs both a recent self-report
// and a calibration that has been holding up before it says "high".
function worseConfidence(left, right) {
  return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(left), CONFIDENCE_ORDER.indexOf(right))];
}

// Describes only which stretch ahead is relatively high. It schedules nothing and
// names no task: the moment this picks work for the user it becomes a planner
// that cannot see their calendar (ARCHITECTURE「日常与能量」).
function findSuggestedWindows(samples, fromMinute, sampleMinutes) {
  const ahead = samples.filter(sample => sample.minute >= fromMinute);
  if (ahead.length < 2) return [];
  const mean = ahead.reduce((total, sample) => total + sample.level, 0) / ahead.length;
  const threshold = mean + WINDOW_MARGIN;
  const runs = [];
  let current = null;
  for (const sample of ahead) {
    if (sample.level >= threshold) {
      if (!current) current = { startMinute: sample.minute, endMinute: sample.minute, peak: sample.level };
      current.endMinute = sample.minute + sampleMinutes;
      current.peak = Math.max(current.peak, sample.level);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs
    .filter(run => run.endMinute - run.startMinute >= MIN_WINDOW_MINUTES)
    .sort((left, right) => right.peak - left.peak)
    .slice(0, MAX_SUGGESTED_WINDOWS)
    .sort((left, right) => left.startMinute - right.startMinute);
}

// Nothing here is rounded, and that is a decision rather than an omission:
// rounding is a presentation concern that belongs to the surface, and rounding
// here would make `attribution` stop adding up to `level` — the one property this
// whole structure exists to guarantee.
function buildEnergyCurve(input = {}) {
  const {
    dayKey,
    now = null,
    baseline = null,
    baselineTrial = null,
    effectScale = null,
    effects = [],
    energySignals = [],
    focusSessions = [],
    checkIns = [],
    residualMae = null,
    sampleMinutes = DEFAULT_SAMPLE_MINUTES,
    checkInHalfLifeMinutes = DEFAULT_CHECK_IN_HALF_LIFE_MINUTES
  } = isPlainObject(input) ? input : {};

  const dayStart = localDayStart(dayKey);
  const params = resolveBaselineParams(baseline);
  // Trial interpretation is causal and expiring; old samples and anchor residuals
  // use the baseline that was applicable when they occurred.
  const trialParams = isPlainObject(baselineTrial) && isPlainObject(baselineTrial.baseline)
    && Number.isFinite(baselineTrial.startsAt) && Number.isFinite(baselineTrial.expiresAt)
    && baselineTrial.expiresAt > baselineTrial.startsAt ? resolveBaselineParams(baselineTrial.baseline) : null;
  const paramsAt = timestamp => trialParams && timestamp >= baselineTrial.startsAt && timestamp < baselineTrial.expiresAt
    ? trialParams : params;
  const step = Number.isInteger(sampleMinutes)
    && sampleMinutes >= MIN_SAMPLE_MINUTES
    && sampleMinutes <= MAX_SAMPLE_MINUTES
    ? sampleMinutes
    : DEFAULT_SAMPLE_MINUTES;
  const halfLife = Number.isFinite(checkInHalfLifeMinutes)
    ? clamp(checkInHalfLifeMinutes, MIN_CHECK_IN_HALF_LIFE_MINUTES, MAX_CHECK_IN_HALF_LIFE_MINUTES)
    : DEFAULT_CHECK_IN_HALF_LIFE_MINUTES;

  const prepared = prepareEffects(effects, effectScale);
  const preparedSignals = prepareEnergySignals(energySignals);
  const preparedFocus = prepareFocusSessions(focusSessions);
  const anchors = [];
  for (const checkIn of normalizeCheckIns(checkIns)) {
    const point = modelAt(checkIn.at, dayStart, paramsAt(checkIn.at), prepared, preparedSignals, preparedFocus);
    const prior = correctionAt(checkIn.at, anchors, halfLife);
    anchors.push({
      at: checkIn.at,
      innovation: checkIn.level - (point.baseline + point.sum + prior.delta)
    });
  }

  const pointAt = (timestamp, minute) => {
    const model = modelAt(timestamp, dayStart, paramsAt(timestamp), prepared, preparedSignals, preparedFocus);
    const correction = correctionAt(timestamp, anchors, halfLife);
    const attribution = model.rows.map(({ source, id, label, delta }) => ({ source, id, label, delta }));
    if (correction.delta !== 0) {
      // Carried as a row so the disclosure stays complete. No copy: the label is
      // the surface's to write, and a Chinese string in core would be the wrong
      // layer holding it.
      attribution.push({ source: 'check-in', id: null, label: null, delta: correction.delta });
    }
    const raw = model.baseline + model.sum + correction.delta;
    const level = clamp(raw, ENERGY_FLOOR, ENERGY_CEILING);
    return {
      minute,
      level,
      modelLevel: clamp(model.baseline + model.sum, ENERGY_FLOOR, ENERGY_CEILING),
      slope: model.baselineSlope + model.sumSlope + correction.slope,
      baseline: model.baseline,
      attribution,
      // Exactly 0 unless the clamp bit, which keeps the identity
      // `baseline + sum(attribution) + clampedBy === level` true at every sample
      // — the attribution contract in ARCHITECTURE「日常与能量」, and the reason
      // a hover can be trusted at the top and bottom of the range too.
      clampedBy: level - raw
    };
  };

  const samples = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += step) {
    samples.push(pointAt(dayStart + minute * MS_PER_MINUTE, minute));
  }

  const nowMinute = Number.isFinite(now) ? (now - dayStart) / MS_PER_MINUTE : null;
  // A day that is not today has no "now" to mark, and saying otherwise would put
  // a marker on a historical curve at whichever edge happened to be closest.
  const nowInDay = nowMinute !== null && nowMinute >= 0 && nowMinute < MINUTES_PER_DAY;
  const nowPoint = nowInDay ? pointAt(now, nowMinute) : null;

  const anchorWeight = (timestamp) => anchors.reduce(
    (best, anchor) => Math.max(best, Math.pow(0.5, Math.abs(timestamp - anchor.at) / MS_PER_MINUTE / halfLife)),
    0
  );
  // Confidence is about how much to trust what is on screen. For today that is
  // the reading at `now`; for a past day "now" means nothing, so the question
  // becomes whether the user reported anything at all that day.
  const weight = nowInDay
    ? anchorWeight(now)
    : Number(anchors.some(anchor => localDayKey(anchor.at) === dayKey));

  return {
    dayKey,
    sampleMinutes: step,
    samples,
    nowMinute: nowInDay ? nowMinute : null,
    nowLevel: nowPoint ? nowPoint.level : null,
    nowModelLevel: nowPoint ? nowPoint.modelLevel : null,
    nowAttribution: nowPoint ? nowPoint.attribution : [],
    // The UI's sentence is built from `trend`, not from `level`: "your energy is
    // still climbing" is actionable in a way that "your energy is 61" is not.
    trend: nowPoint ? trendFromSlope(nowPoint.slope) : null,
    confidence: worseConfidence(checkInConfidence(weight), calibrationConfidence(residualMae)),
    suggestedWindows: nowInDay ? findSuggestedWindows(samples, nowMinute, step) : []
  };
}

module.exports = {
  DEFAULT_SAMPLE_MINUTES,
  DEFAULT_CHECK_IN_HALF_LIFE_MINUTES,
  ENERGY_SIGNAL_HALF_LIFE_MINUTES,
  ENERGY_FLOOR,
  ENERGY_CEILING,
  ASSUMED_AWAKE_MINUTES,
  HOMEOSTATIC_WAKE_TAU_MINUTES,
  HOMEOSTATIC_SLEEP_TAU_MINUTES,
  HOMEOSTATIC_DROP,
  CIRCADIAN_AMPLITUDE,
  SLEEP_INERTIA_DEPTH,
  NIGHT_LEVEL,
  DAY_LEVEL,
  // Exported for calibration (ARCHITECTURE「日常与能量」): deciding *which* baseline parameter a miss
  // belongs to means asking which segment of this shape the report landed in, and
  // a second copy of these offsets would silently stop matching the shape they
  // describe the moment one of them is tuned.
  EVENING_AFTER_WAKE_MINUTES,
  EVENING_FALL_MINUTES,
  POST_LUNCH_AFTER_WAKE_MINUTES,
  POST_LUNCH_HALF_WIDTH_MINUTES,
  SAME_KIND_DECAY,
  POSITIVE_SUM_CAP,
  FOCUS_ACUTE_MAX,
  FOCUS_RESIDUAL_CAP,
  FOCUS_RECOVERY_HALF_LIFE_MINUTES,
  MIN_WINDOW_MINUTES,
  MAX_SUGGESTED_WINDOWS,
  smoothstep,
  energyBaselineAt,
  resolveBaselineParams,
  buildEnergyCurve
};
