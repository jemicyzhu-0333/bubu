'use strict';

const taskDatesApi = (function createTaskDates() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  // Convert local calendar fields to a stable ordinal. This deliberately does
  // not divide local timestamps by 24 hours, which would be wrong across DST.
  function localDayOrdinal(value) {
    const date = validDate(value);
    if (!date) return null;
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  }

  function localCalendarDayDiff(value, reference = Date.now()) {
    const valueDay = localDayOrdinal(value);
    const referenceDay = localDayOrdinal(reference);
    return valueDay === null || referenceDay === null ? null : valueDay - referenceDay;
  }

  function describeDeadline(value, reference = Date.now()) {
    const deadline = validDate(value);
    const now = validDate(reference);
    if (!deadline || !now) return null;

    const dayDiff = localCalendarDayDiff(deadline, now);
    if (dayDiff < 0) {
      return { text: `逾期 ${Math.abs(dayDiff)} 天`, tone: 'late', overdue: true, dayDiff };
    }
    if (dayDiff === 0 && deadline.getTime() < now.getTime()) {
      return { text: '已逾期', tone: 'late', overdue: true, dayDiff };
    }
    if (dayDiff === 0) return { text: '今天 DDL', tone: 'warn', overdue: false, dayDiff };
    if (dayDiff === 1) return { text: '明天 DDL', tone: 'warn', overdue: false, dayDiff };
    return {
      text: `${dayDiff} 天后`,
      tone: dayDiff <= 3 ? 'warn' : 'ok',
      overdue: false,
      dayDiff
    };
  }

  function formatScheduledFor(value, reference = Date.now()) {
    const scheduled = validDate(value);
    if (!scheduled || !validDate(reference)) return '';
    const dayDiff = localCalendarDayDiff(scheduled, reference);
    const time = `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`;
    if (dayDiff === 0) return `今天 ${time}`;
    if (dayDiff === 1) return `明天 ${time}`;
    if (dayDiff === -1) return `昨天 ${time}`;
    return `${scheduled.getMonth() + 1}/${scheduled.getDate()} ${time}`;
  }

  function endOfLocalDateISO(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day, 23, 59, 59, 999);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
    return date.toISOString();
  }

  return Object.freeze({
    describeDeadline,
    endOfLocalDateISO,
    formatScheduledFor,
    localCalendarDayDiff
  });
})();

export default taskDatesApi;
export const describeDeadline = taskDatesApi.describeDeadline;
export const endOfLocalDateISO = taskDatesApi.endOfLocalDateISO;
export const formatScheduledFor = taskDatesApi.formatScheduledFor;
export const localCalendarDayDiff = taskDatesApi.localCalendarDayDiff;
