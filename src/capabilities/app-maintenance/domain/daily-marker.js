'use strict';

const { compareDayKeys } = require('../../../core/calendar');
const { validDayKey } = require('../../../core/field-normalizers');

function requireState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('the local-day marker requires a state draft');
  }
}

/**
 * Decide what the local-day pass owes for `today`.
 *
 * The marker is monotonic. A clock or time-zone correction can make the
 * persisted day look like the future, and moving the marker backwards would
 * make the same day look new again once the clock is corrected — running the
 * pass twice over the same day.
 */
function planLocalDayPass(state, { today } = {}) {
  requireState(state);
  if (!validDayKey(today)) return { ok: false, reason: 'day-key-invalid' };
  const marker = validDayKey(state.lastResetDate) ? state.lastResetDate : null;
  // No marker means this install has never completed a pass. Record the day
  // without tidying: there is no measured absence to catch up on, and a first
  // launch that archived work would be a surprise rather than a service.
  if (!marker) return { ok: true, mode: 'initialize', today, previousDay: null };
  const elapsed = compareDayKeys(today, marker);
  if (elapsed === 0) return { ok: false, reason: 'day-already-reset' };
  if (elapsed < 0) return { ok: false, reason: 'reset-marker-ahead' };
  return { ok: true, mode: 'advance', today, previousDay: marker };
}

function markLocalDayPassed(state, today) {
  requireState(state);
  if (!validDayKey(today)) return { ok: false, reason: 'day-key-invalid' };
  state.lastResetDate = today;
  return { ok: true, dayKey: today };
}

module.exports = { planLocalDayPass, markLocalDayPassed };
