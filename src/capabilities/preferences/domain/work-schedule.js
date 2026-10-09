'use strict';
const { DEFAULT_SETTINGS } = require('../contract/settings');
function getWorkHours(s) {
  let start = Math.round(Number(s.workStartHour));
  let end = Math.round(Number(s.workEndHour));
  if (!Number.isFinite(start)) start = DEFAULT_SETTINGS.workStartHour;
  if (!Number.isFinite(end)) end = DEFAULT_SETTINGS.workEndHour;
  start = Math.max(0, Math.min(22, start));
  end = Math.max(start + 1, Math.min(24, end));
  return { start, end };
}
function isWorkTime(settings, at) {
  const d = new Date(at);
  const { start, end } = getWorkHours(settings);
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= start && h < end;
}

// ============ 自动过期策略 ============
function endOfDay(from) {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
// schema 8 里自动过期是用户显式开启的策略，不再是“临时任务”自带的属性。
// 这里只负责把用户选的时效模式算成具体时间点。
function computeAutoExpiry(fromTs, s) {
  if (s.adhocTtlMode === 'hours') {
    const hours = Math.max(1, Math.min(24 * 14, Number(s.adhocTtlHours) || DEFAULT_SETTINGS.adhocTtlHours));
    return new Date(fromTs + hours * 3600 * 1000).toISOString();
  }
  let eod = endOfDay(fromTs);
  if (eod.getTime() <= fromTs) eod = new Date(eod.getTime() + 86400000);
  return eod.toISOString();
}

module.exports = { getWorkHours, isWorkTime, computeAutoExpiry };
