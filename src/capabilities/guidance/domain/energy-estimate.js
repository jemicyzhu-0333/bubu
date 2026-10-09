'use strict';

const { ENERGY_FLOOR, ENERGY_CEILING } = require('../../../core/energy-curve');
const { clamp, finiteNumber } = require('./task-demand');

const DEFAULT_WORK_START = 10;

const DEFAULT_WORK_END = 21;

const DEFAULT_CHECK_IN_HALF_LIFE_MINUTES = 180;

const MAX_CHECK_IN_AGE_MS = 24 * 60 * 60 * 1000;

const ENERGY_STATE_LEVELS = {
  exhausted: 15,
  empty: 15,
  depleted: 20,
  tired: 25,
  low: 30,
  medium: 50,
  neutral: 50,
  okay: 55,
  good: 70,
  high: 80,
  energized: 90,
  excellent: 90,
  // Chinese values are useful when the renderer stores the displayed label.
  '精疲力竭': 15,
  '需要休息': 20,
  '有点累': 30,
  '中等': 50,
  '状态良好': 70,
  '精力充沛': 90
};

function resolveWorkHours(settings) {
  let start = Math.round(Number(settings && settings.workStartHour));
  let end = Math.round(Number(settings && settings.workEndHour));
  if (!Number.isFinite(start)) start = DEFAULT_WORK_START;
  if (!Number.isFinite(end)) end = DEFAULT_WORK_END;
  start = clamp(start, 0, 22);
  end = clamp(end, start + 1, 24);
  return { start, end };
}

/**
 * A deliberately coarse time-of-day prior.
 *
 * This is retained for API compatibility, but unlike the old curve it does not
 * claim that every person starts work at 95% and experiences the same sharp
 * afternoon crash. Callers should prefer currentEnergyEstimate(), which will
 * blend a recent user check-in with this low-confidence prior.
 */
function baseEnergyAt(hour, settings) {
  const { start, end } = resolveWorkHours(settings);
  const h = clamp(finiteNumber(hour, start), 0, 24);
  const span = end - start;
  if (h < start - 2) return 35;
  if (h < start) return 45;
  const progress = (h - start) / span;
  if (progress < 0.30) return 65;
  if (progress < 0.55) return 50;
  if (progress < 0.82) return 60;
  if (progress < 1) return 50;
  return 35;
}

function parseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeEnergyCheckIn(checkIn) {
  if (!checkIn || typeof checkIn !== 'object') return null;
  const state = String(checkIn.state || checkIn.status || '').trim().toLowerCase();
  let level = finiteNumber(checkIn.level);
  if (level === null && state) level = ENERGY_STATE_LEVELS[state];
  const timestamp = parseTimestamp(
    checkIn.timestamp !== undefined ? checkIn.timestamp
      : (checkIn.checkedAt !== undefined ? checkIn.checkedAt : checkIn.createdAt)
  );
  if (!Number.isFinite(level) || timestamp === null) return null;
  return {
    level: clamp(level, ENERGY_FLOOR, ENERGY_CEILING),
    state: state || null,
    timestamp
  };
}

function focusLoadAdjustment(stats, pomodoroState, now) {
  const safeStats = stats && typeof stats === 'object' ? stats : {};
  const dailyFocus = safeStats.dailyFocus && typeof safeStats.dailyFocus === 'object'
    ? safeStats.dailyFocus : {};
  const localDate = new Date(now);
  const today = [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, '0'),
    String(localDate.getDate()).padStart(2, '0')
  ].join('-');
  const completedMinutes = Math.max(0, finiteNumber(dailyFocus[today], 0)) / 60000;

  // Broad buckets avoid implying a physiological measurement. This is a mild
  // workload hint and is deliberately capped.
  let adjustment = 0;
  if (completedMinutes >= 180) adjustment -= 10;
  else if (completedMinutes >= 90) adjustment -= 5;
  else if (completedMinutes >= 45) adjustment -= 2;

  const p = pomodoroState && typeof pomodoroState === 'object' ? pomodoroState : {};
  if (p.running && p.mode === 'focus') {
    const reportedElapsedMs = finiteNumber(p.elapsedMs);
    const startedAt = finiteNumber(p.startedAt, now);
    const activeMinutes = reportedElapsedMs !== null
      ? clamp(reportedElapsedMs / 60000, 0, 180)
      : clamp((now - startedAt) / 60000, 0, 180);
    if (activeMinutes >= 60) adjustment -= 8;
    else if (activeMinutes >= 25) adjustment -= 4;
  }
  return adjustment;
}

/**
 * Return an explainable energy estimate. `energyCheckIn` is expected to be:
 *   { level: 10..90, state?: string, timestamp: epochMs | ISO string }
 * It may also be stored as `settings.energyCheckIn` for incremental adoption.
 */
function currentEnergyEstimate(input = {}, readNow) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const stats = safeInput.stats || {};
  const pomodoroState = safeInput.pomodoroState || {};
  const settings = safeInput.settings && typeof safeInput.settings === 'object' ? safeInput.settings : {};
  const energyCheckIn = safeInput.energyCheckIn || null;
  const now = safeInput.now === undefined ? readNow() : safeInput.now;
  const at = Number.isFinite(Number(now)) ? Number(now) : readNow();
  const date = new Date(at);
  const hour = date.getHours() + date.getMinutes() / 60;
  // ARCHITECTURE「日常与能量」: when the caller has an energy curve for today it supplies the
  // curve's reading here and the coarse five-bucket table steps aside. The rest of
  // this function is untouched on purpose — the curve replaces the *prior*, not the
  // estimate, so the check-in still decays over it exactly as before and the header
  // bar cannot end up showing a different number than the curve it sits above.
  //
  // Only an actual number counts. `finiteNumber` would be wrong here: it coerces, and
  // `Number(null)` is 0 — so the callers that legitimately pass null (the curve is off,
  // or a past day has no "now" reading) would pin the bar to a confident-looking 0.
  // ARCHITECTURE「日常与能量」: one number. When the caller has today's curve it passes the
  // curve's own reading at `now` — which already contains the logged routines, the
  // focus load and the self-report correction. The estimate then reads it as-is:
  // no second blend of the check-in, no second focus-load table, no 5-point rounding
  // that would put a different number on the bar than on the curve beneath it.
  const curveLevel = typeof safeInput.curveLevel === 'number' && Number.isFinite(safeInput.curveLevel)
    ? safeInput.curveLevel
    : null;
  if (curveLevel !== null) {
    const checkIn = normalizeEnergyCheckIn(energyCheckIn || settings.energyCheckIn);
    let checkInWeight = 0;
    let checkInAgeMinutes = null;
    if (checkIn) {
      const ageMs = Math.max(0, at - checkIn.timestamp);
      checkInAgeMinutes = Math.round(ageMs / 60000);
      if (ageMs <= MAX_CHECK_IN_AGE_MS) {
        const configuredHalfLife = finiteNumber(settings.energyCheckInHalfLifeMinutes, DEFAULT_CHECK_IN_HALF_LIFE_MINUTES);
        checkInWeight = Math.pow(0.5, ageMs / (clamp(configuredHalfLife, 30, 12 * 60) * 60000));
      }
    }
    const level = clamp(Math.round(curveLevel), ENERGY_FLOOR, ENERGY_CEILING);
    const fromCheckIn = checkInWeight > 0;
    return {
      level,
      band: energyToBand(level),
      source: fromCheckIn ? 'check-in' : 'curve',
      confidence: fromCheckIn ? (checkInWeight >= 0.65 ? 'high' : 'medium') : 'medium',
      reason: fromCheckIn
        ? '按今天的曲线：日常、专注负荷，并以你最近的自评为准，随时间逐步降低其权重'
        : '尚无近期自评，按今天的曲线：记录的日常和专注负荷',
      checkIn,
      checkInAgeMinutes,
      checkInWeight: Number(checkInWeight.toFixed(3)),
      prior: level,
      activityAdjustment: 0
    };
  }
  const modelPrior = typeof safeInput.modelPrior === 'number' && Number.isFinite(safeInput.modelPrior)
    ? safeInput.modelPrior
    : null;
  const prior = modelPrior === null
    ? baseEnergyAt(hour, settings)
    : clamp(modelPrior, ENERGY_FLOOR, ENERGY_CEILING);
  const normalized = normalizeEnergyCheckIn(energyCheckIn || settings.energyCheckIn);

  let level = prior;
  let source = modelPrior === null ? 'time-prior' : 'curve';
  // A curve with no self-report is built from interventions the user actually
  // logged, which is more than a time-of-day table knows and less than a fresh
  // check-in. 'low' would understate it; 'high' is reserved for a recent report.
  let confidence = modelPrior === null ? 'low' : 'medium';
  let checkInWeight = 0;
  let checkInAgeMinutes = null;

  if (normalized) {
    const ageMs = Math.max(0, at - normalized.timestamp);
    checkInAgeMinutes = Math.round(ageMs / 60000);
    if (ageMs <= MAX_CHECK_IN_AGE_MS) {
      const configuredHalfLife = finiteNumber(settings.energyCheckInHalfLifeMinutes, DEFAULT_CHECK_IN_HALF_LIFE_MINUTES);
      const halfLifeMs = clamp(configuredHalfLife, 30, 12 * 60) * 60000;
      checkInWeight = Math.pow(0.5, ageMs / halfLifeMs);
      level = normalized.level * checkInWeight + prior * (1 - checkInWeight);
      source = 'check-in';
      confidence = checkInWeight >= 0.65 ? 'high' : 'medium';
    }
  }

  const activityAdjustment = focusLoadAdjustment(stats, pomodoroState, at);
  // Quantize to 5-point steps: the result is guidance, not biometric truth.
  level = clamp(
    Math.round((level + activityAdjustment) / 5) * 5,
    ENERGY_FLOOR,
    ENERGY_CEILING
  );
  const band = energyToBand(level);
  const load = activityAdjustment ? '，同时参考今日专注负荷' : '';
  const reason = source === 'check-in'
    ? `基于最近自评，并随时间逐步降低其权重${load}`
    : (source === 'curve'
      ? `尚无近期自评，按今天记录的日常推算${load}`
      : `尚无近期自评，仅使用低置信度的时段参考${activityAdjustment ? '和今日专注负荷' : ''}`);

  return {
    level,
    band,
    source,
    confidence,
    reason,
    checkIn: normalized,
    checkInAgeMinutes,
    checkInWeight: Number(checkInWeight.toFixed(3)),
    prior,
    activityAdjustment
  };
}

// Backward-compatible numeric API. A fourth argument may provide a check-in.
function currentEnergyLevel(stats, pomodoroState, settings, energyCheckIn, readNow) {
  return currentEnergyEstimate({ stats, pomodoroState, settings, energyCheckIn }, readNow).level;
}

function energyToBand(level) {
  const n = clamp(finiteNumber(level, 50), ENERGY_FLOOR, ENERGY_CEILING);
  if (n >= 65) return 'high';
  if (n >= 35) return 'medium';
  return 'low';
}

function energyLabel(level) {
  const n = clamp(finiteNumber(level, 50), ENERGY_FLOOR, ENERGY_CEILING);
  if (n >= 80) return { emoji: '⚡', text: '精力充沛', color: '#9ece6a' };
  if (n >= 60) return { emoji: '☀️', text: '状态良好', color: '#7dcfff' };
  if (n >= 40) return { emoji: '🌤', text: '中等', color: '#e0af68' };
  if (n >= 20) return { emoji: '☁️', text: '有点累', color: '#ff9a6c' };
  return { emoji: '🌙', text: '需要休息', color: '#bb9af7' };
}

module.exports = {
  currentEnergyLevel,
  currentEnergyEstimate,
  normalizeEnergyCheckIn,
  energyToBand,
  energyLabel,
  resolveWorkHours,
  baseEnergyAt,
  parseTimestamp
};
