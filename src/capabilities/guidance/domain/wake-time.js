'use strict';

// 今天几点起的：本人说一句，当天曲线的基线就从这里起算（ARCHITECTURE「日常与能量」）。
// minutes 为 null 表示“问过了，跳过”——记下来是为了不在同一天再问一次，不是一个起床时间。
const { normalizeWakeMinute, normalizeWakeTimes } = require('../../../core/wellbeing');

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function recordWakeTime(state, { dayKey, minutes } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('wake time requires a state draft');
  }
  if (typeof dayKey !== 'string' || !DAY_KEY.test(dayKey)) return { ok: false, reason: 'wake-day-invalid' };
  const minute = normalizeWakeMinute(minutes);
  if (minute === undefined) return { ok: false, reason: 'wake-time-invalid' };
  const current = normalizeWakeTimes(state.wakeTimes);
  if (Object.prototype.hasOwnProperty.call(current, dayKey) && current[dayKey] === minute) {
    return { ok: true, changed: false, dayKey, minutes: minute };
  }
  state.wakeTimes = normalizeWakeTimes({ ...current, [dayKey]: minute });
  return { ok: true, changed: true, dayKey, minutes: minute };
}

// 曲线用的那一天的起床分钟数；没说过或跳过都是 null，曲线照旧按上班时间推。
function wakeMinutesFor(wakeTimes, dayKey) {
  const value = normalizeWakeTimes(wakeTimes)[dayKey];
  return Number.isInteger(value) ? value : null;
}

// 今天要不要问：这一天没有任何记录（既没答过也没跳过）才问。
function shouldAskWakeTime(wakeTimes, dayKey) {
  return !Object.prototype.hasOwnProperty.call(normalizeWakeTimes(wakeTimes), dayKey);
}

module.exports = { recordWakeTime, wakeMinutesFor, shouldAskWakeTime };
