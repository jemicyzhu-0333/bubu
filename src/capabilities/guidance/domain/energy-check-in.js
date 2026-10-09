'use strict';

const { ENERGY_FLOOR, ENERGY_CEILING } = require('../../../core/energy-curve');
const { appendSelfReport } = require('./energy-self-reports');

const ENERGY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const ENERGY_ADJUSTMENTS = Object.freeze({ lower: -10, same: 0, higher: 10 });

function validTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function recordEnergyCheckIn(state, checkIn = {}, { collectHistory = false, recordedAt = checkIn.timestamp, estimate = null } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('energy check-in requires a state draft');
  }
  if (!checkIn || typeof checkIn !== 'object' || Array.isArray(checkIn)
      || !Number.isInteger(checkIn.level)
      || checkIn.level < ENERGY_FLOOR || checkIn.level > ENERGY_CEILING
      || !ENERGY_LEVELS.includes(checkIn.state) || !validTimestamp(checkIn.timestamp)) {
    return { ok: false, reason: 'energy-check-in-invalid' };
  }
  const next = {
    level: checkIn.level,
    state: checkIn.state,
    timestamp: checkIn.timestamp
  };
  const previous = state.energyCheckIn;
  if (previous && previous.level === next.level
      && previous.state === next.state && previous.timestamp === next.timestamp) {
    return { ok: true, changed: false, checkIn: previous };
  }
  state.energyCheckIn = next;
  if (collectHistory) appendSelfReport(state, { level: next.level, at: next.timestamp, recordedAt, estimate });
  return { ok: true, changed: true, checkIn: next };
}

function energyStateForLevel(level) {
  if (level < 40) return 'low';
  if (level < 70) return 'medium';
  return 'high';
}

function adjustEnergyCheckIn(state, { direction, currentLevel, timestamp, estimate = null } = {}) {
  if (!Object.prototype.hasOwnProperty.call(ENERGY_ADJUSTMENTS, direction)
      || !Number.isFinite(currentLevel) || !validTimestamp(timestamp)) {
    return { ok: false, reason: 'energy-adjustment-invalid' };
  }
  const current = Math.max(ENERGY_FLOOR, Math.min(ENERGY_CEILING, Math.round(currentLevel)));
  const level = Math.max(
    ENERGY_FLOOR,
    Math.min(ENERGY_CEILING, current + ENERGY_ADJUSTMENTS[direction])
  );
  // Pressing farther into a hard boundary must not refresh the timestamp and
  // make an old observation look new. “About right” is different: it is an
  // explicit observation and therefore does create/refresh the anchor.
  if (direction !== 'same' && level === current) {
    return { ok: true, changed: false, checkIn: state.energyCheckIn || null };
  }
  return recordEnergyCheckIn(state, {
    level,
    state: energyStateForLevel(level),
    timestamp
  }, { collectHistory: true, recordedAt: timestamp, estimate });
}

module.exports = {
  ENERGY_LEVELS,
  ENERGY_ADJUSTMENTS,
  energyStateForLevel,
  recordEnergyCheckIn,
  adjustEnergyCheckIn
};
