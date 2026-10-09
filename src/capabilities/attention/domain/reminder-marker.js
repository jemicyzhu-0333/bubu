'use strict';

const { compareDayKeys } = require('../../../core/calendar');
const { validDayKey } = require('../../../core/field-normalizers');

function recordWorkEndReminder(state, { dayKey, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('work-end reminder requires a state draft');
  }
  if (!validDayKey(dayKey) || typeof now !== 'number' || !Number.isFinite(now) || now < 0) {
    return { ok: false, reason: 'work-end-reminder-invalid' };
  }
  const previous = validDayKey(state.lastWorkEndNotifyDate);
  if (previous && compareDayKeys(dayKey, previous) <= 0) {
    return { ok: true, changed: false, dayKey: previous };
  }
  state.lastWorkEndNotifyDate = dayKey;
  return { ok: true, changed: true, dayKey };
}

module.exports = { recordWorkEndReminder };
