'use strict';

const { parseDayKey, addDaysToKey, compareDayKeys, localDayKey } = require('./calendar');

// Recurrence-rule grammar belongs to the shared calendar layer. Keep these
// values local so core never reaches outward into the work capability.
const RECURRENCE_FREQUENCIES = Object.freeze(['daily', 'weekly', 'monthly']);
const RECURRENCE_STRATEGIES = Object.freeze(['fixed', 'after-completion']);
const RECURRENCE_INTERVAL_MAX = 365;

// Every date here is a local `YYYY-MM-DD` calendar key handled through
// `core/calendar.js`. Nothing divides elapsed milliseconds, so a 23/25-hour DST
// day still counts as exactly one calendar day and a monthly anchor stays on the
// user's wall calendar.

// Kept as an exported compatibility constant, but it now bounds only the
// day-by-day search for one weekly step. Catching up across many occurrences is
// calculated arithmetically below, so a legitimate long-lived series is never
// rejected merely because it missed more than this many slots.
const MAX_ADVANCE_ITERATIONS = 7 * RECURRENCE_INTERVAL_MAX + 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayOrdinal(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

// ISO weekday: 1 = Monday … 7 = Sunday.
function isoWeekday(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function mondayOrdinal(dayKey) {
  return dayOrdinal(dayKey) - (isoWeekday(dayKey) - 1);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function assertValidRule(rule) {
  if (!rule || typeof rule !== 'object') throw new TypeError('A recurrence rule object is required');
  if (!RECURRENCE_FREQUENCIES.includes(rule.frequency)) {
    throw new RangeError(`Unsupported recurrence frequency: ${rule.frequency}`);
  }
  if (!RECURRENCE_STRATEGIES.includes(rule.strategy)) {
    throw new RangeError(`Unsupported recurrence strategy: ${rule.strategy}`);
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > RECURRENCE_INTERVAL_MAX) {
    throw new RangeError(`Recurrence interval must be an integer from 1 to ${RECURRENCE_INTERVAL_MAX}`);
  }
  if (rule.weekdays !== null && rule.weekdays !== undefined) {
    if (rule.frequency !== 'weekly') throw new RangeError('Only a weekly rule may declare weekdays');
    if (!Array.isArray(rule.weekdays) || rule.weekdays.length < 1 || rule.weekdays.length > 7
        || rule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new RangeError('Weekly rules need 1 to 7 weekday values from 1 (Monday) through 7 (Sunday)');
    }
  }
  parseDayKey(rule.anchorDate);
  return rule;
}

function weeklyDays(rule) {
  return rule.weekdays && rule.weekdays.length
    ? rule.weekdays
    : [isoWeekday(rule.anchorDate)];
}

function advanceMonthlyBy(rule, fromDayKey, steps) {
  const anchorDay = parseDayKey(rule.anchorDate).day;
  const from = parseDayKey(fromDayKey);
  const absoluteMonth = from.year * 12 + (from.month - 1) + rule.interval * steps;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  // Clamp against the anchor's original day-of-month rather than the previously
  // clamped value, so 1/31 → 2/28 → 3/31 instead of collapsing to the 28th.
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function advanceMonthly(rule, fromDayKey) {
  return advanceMonthlyBy(rule, fromDayKey, 1);
}

function advanceWeekly(rule, fromDayKey) {
  const allowed = new Set(weeklyDays(rule));
  const anchorWeek = mondayOrdinal(rule.anchorDate);
  // Scanning day by day is deliberate: with at most 7 weekdays and an interval
  // in weeks the search window is bounded, and it stays obviously correct for
  // multi-week intervals combined with a weekday set.
  const window = Math.min(7 * rule.interval + 7, MAX_ADVANCE_ITERATIONS);
  let candidate = fromDayKey;
  for (let step = 0; step < window; step += 1) {
    candidate = addDaysToKey(candidate, 1);
    if (!allowed.has(isoWeekday(candidate))) continue;
    const weeksFromAnchor = (mondayOrdinal(candidate) - anchorWeek) / 7;
    if (Number.isInteger(weeksFromAnchor) && ((weeksFromAnchor % rule.interval) + rule.interval) % rule.interval === 0) {
      return candidate;
    }
  }
  throw new RangeError('Could not locate the next weekly occurrence within a bounded search window');
}

/**
 * Advance exactly one step along the rule's grid, strictly after `fromDayKey`.
 */
function advanceOnce(rule, fromDayKey) {
  assertValidRule(rule);
  parseDayKey(fromDayKey);
  if (rule.frequency === 'daily') return addDaysToKey(fromDayKey, rule.interval);
  if (rule.frequency === 'weekly') return advanceWeekly(rule, fromDayKey);
  return advanceMonthly(rule, fromDayKey);
}

function nextDailyAfterReference(rule, fromDayKey, referenceDay) {
  const distance = dayOrdinal(referenceDay) - dayOrdinal(fromDayKey);
  const skipped = distance < rule.interval ? 0 : Math.floor(distance / rule.interval);
  return {
    date: addDaysToKey(fromDayKey, (skipped + 1) * rule.interval),
    skipped
  };
}

function nextMonthlyAfterReference(rule, fromDayKey, referenceDay) {
  if (compareDayKeys(referenceDay, fromDayKey) < 0) {
    return { date: advanceMonthly(rule, fromDayKey), skipped: 0 };
  }
  const from = parseDayKey(fromDayKey);
  const reference = parseDayKey(referenceDay);
  const monthDistance = (reference.year * 12 + reference.month) - (from.year * 12 + from.month);
  let skipped = Math.max(0, Math.floor(monthDistance / rule.interval));

  if (skipped > 0 && compareDayKeys(advanceMonthlyBy(rule, fromDayKey, skipped), referenceDay) > 0) {
    skipped -= 1;
  }
  let date = advanceMonthlyBy(rule, fromDayKey, skipped + 1);
  if (compareDayKeys(date, referenceDay) <= 0) {
    skipped += 1;
    date = advanceMonthlyBy(rule, fromDayKey, skipped + 1);
  }
  return { date, skipped };
}

function nextWeeklyAfterReference(rule, fromDayKey, referenceDay) {
  const fromOrdinal = dayOrdinal(fromDayKey);
  const referenceOrdinal = dayOrdinal(referenceDay);
  if (referenceOrdinal < fromOrdinal) {
    return { date: advanceWeekly(rule, fromDayKey), skipped: 0 };
  }

  const periodDays = 7 * rule.interval;
  const anchorWeek = mondayOrdinal(rule.anchorDate);
  let skipped = 0;
  let nextOrdinal = Number.POSITIVE_INFINITY;

  for (const weekday of new Set(weeklyDays(rule))) {
    const baseOrdinal = anchorWeek + weekday - 1;
    const firstIndex = Math.floor((fromOrdinal - baseOrdinal) / periodDays) + 1;
    const lastIndex = Math.floor((referenceOrdinal - baseOrdinal) / periodDays);
    if (lastIndex >= firstIndex) skipped += lastIndex - firstIndex + 1;

    const nextIndex = Math.floor((referenceOrdinal - baseOrdinal) / periodDays) + 1;
    nextOrdinal = Math.min(nextOrdinal, baseOrdinal + nextIndex * periodDays);
  }

  if (!Number.isFinite(nextOrdinal)) throw new RangeError('Weekly recurrence has no valid weekdays');
  return {
    date: addDaysToKey(referenceDay, nextOrdinal - referenceOrdinal),
    skipped
  };
}

/**
 * Resolve the single next occurrence date.
 *
 * Missing several periods must not create a row of overdue debt: the grid is
 * collapsed forward to one reasonable next date and the number of skipped slots
 * is reported so the series can record it without any penalty.
 */
function nextOccurrenceDate(rule, options = {}) {
  assertValidRule(rule);
  // Fixed schedules advance from the last planned occurrence. Relative
  // schedules advance from the day the user actually closed the occurrence;
  // using its old planned date here makes a late completion immediately create
  // another overdue task instead of waiting for the requested interval.
  const lastOccurrenceDate = options.lastOccurrenceDate ?? options.fromDayKey;
  const completedOn = options.completedOn ?? options.fromDayKey;
  const fromDayKey = rule.strategy === 'after-completion'
    ? (parseDayKey(completedOn) && completedOn)
    : (parseDayKey(lastOccurrenceDate) && lastOccurrenceDate);
  const referenceDay = options.referenceDay === undefined || options.referenceDay === null
    ? fromDayKey
    : (parseDayKey(options.referenceDay) && options.referenceDay);

  if (rule.frequency === 'daily') return nextDailyAfterReference(rule, fromDayKey, referenceDay);
  if (rule.frequency === 'weekly') return nextWeeklyAfterReference(rule, fromDayKey, referenceDay);
  return nextMonthlyAfterReference(rule, fromDayKey, referenceDay);
}

/**
 * Resolve the latest occurrence on the rule grid that is on or before
 * `referenceDay`, starting from `fromDayKey`.
 *
 * This is used only to re-date an already-open fixed occurrence. The occurrence
 * remains the same task, so its steps, focus investment and reward identity stay
 * intact while the series records only the slots that were genuinely passed.
 */
function occurrenceDateOnOrBefore(rule, fromDayKey, referenceDay) {
  assertValidRule(rule);
  parseDayKey(fromDayKey);
  parseDayKey(referenceDay);
  if (compareDayKeys(referenceDay, fromDayKey) <= 0) return { date: fromDayKey, skipped: 0 };

  const { skipped } = nextOccurrenceDate(rule, {
    lastOccurrenceDate: fromDayKey,
    completedOn: fromDayKey,
    referenceDay
  });
  if (skipped <= 0) return { date: fromDayKey, skipped: 0 };
  if (rule.frequency === 'daily') {
    return { date: addDaysToKey(fromDayKey, skipped * rule.interval), skipped };
  }
  if (rule.frequency === 'monthly') {
    return { date: advanceMonthlyBy(rule, fromDayKey, skipped), skipped };
  }

  const referenceOrdinal = dayOrdinal(referenceDay);
  const anchorWeek = mondayOrdinal(rule.anchorDate);
  const periodDays = rule.interval * 7;
  const latestOrdinal = Math.max(...weeklyDays(rule).map(weekday => {
    const base = anchorWeek + weekday - 1;
    return base + Math.floor((referenceOrdinal - base) / periodDays) * periodDays;
  }));
  return { date: addDaysToKey(referenceDay, latestOrdinal - referenceOrdinal), skipped };
}

/**
 * Resolve the first occurrence of a brand new series.
 *
 * The anchor sits on its own grid by construction for daily and monthly rules, so
 * only a weekly rule whose weekday set excludes the anchor has to move: "every
 * Mon/Wed, starting on a Tuesday" should open on the Wednesday rather than making
 * the user wait a full week for a round they asked for now.
 */
function firstOccurrenceDate(rule, startDayKey) {
  assertValidRule(rule);
  parseDayKey(startDayKey);
  if (rule.frequency === 'weekly' && !new Set(weeklyDays(rule)).has(isoWeekday(startDayKey))) {
    return advanceOnce(rule, startDayKey);
  }
  return startDayKey;
}

function anchorDateFrom(value, fallbackTimestamp) {
  if (typeof value === 'string') {
    try {
      parseDayKey(value);
      return value;
    } catch (_) { /* fall through to the timestamp fallback */ }
  }
  return localDayKey(fallbackTimestamp);
}

module.exports = {
  MAX_ADVANCE_ITERATIONS,
  isoWeekday,
  mondayOrdinal,
  daysInMonth,
  assertValidRule,
  weeklyDays,
  advanceOnce,
  nextOccurrenceDate,
  occurrenceDateOnOrBefore,
  firstOccurrenceDate,
  anchorDateFrom
};
