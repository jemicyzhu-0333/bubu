'use strict';

const { addDaysToKey, compareDayKeys } = require('../../../core/calendar');
const { ensureStats } = require('./progress-state');

function validateHealthyShutdownDay(dayKey) {
  try {
    compareDayKeys(dayKey, dayKey);
    return { ok: true, dayKey };
  } catch (_) {
    return { ok: false, reason: 'invalid-day-key' };
  }
}

function recordHealthyShutdown(state, dayKey) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('healthy shutdown requires a state draft');
  }
  const validation = validateHealthyShutdownDay(dayKey);
  if (!validation.ok) return validation;

  const stats = ensureStats(state);
  if (stats.lastHealthyShutdownDate
      && compareDayKeys(dayKey, stats.lastHealthyShutdownDate) <= 0) {
    return {
      ok: true,
      recorded: false,
      dayKey,
      count: Number(stats.healthyShutdownCount) || 0,
      streak: Number(stats.healthyShutdownStreak) || 0
    };
  }

  const continued = stats.lastHealthyShutdownDate === addDaysToKey(dayKey, -1);
  stats.healthyShutdownCount = (Number(stats.healthyShutdownCount) || 0) + 1;
  stats.healthyShutdownStreak = continued
    ? (Number(stats.healthyShutdownStreak) || 0) + 1
    : 1;
  stats.lastHealthyShutdownDate = dayKey;
  return {
    ok: true,
    recorded: true,
    dayKey,
    count: stats.healthyShutdownCount,
    streak: stats.healthyShutdownStreak
  };
}

module.exports = { validateHealthyShutdownDay, recordHealthyShutdown };
