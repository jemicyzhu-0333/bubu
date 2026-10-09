'use strict';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dateFormatterCache = new Map();

function toEpochMs(value) {
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : typeof value === 'string' ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(ms)) throw new TypeError('Expected a valid date, timestamp, or ISO date string');
  return ms;
}

function formatterFor(timeZone) {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory', {
      timeZone,
      calendar: 'gregory',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function localDateParts(value = Date.now(), options = {}) {
  const ms = toEpochMs(value);
  const { timeZone } = options;
  if (!timeZone) {
    const date = new Date(ms);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate()
    };
  }

  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const result = {};
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      result[part.type] = Number(part.value);
    }
  }
  if (!Number.isInteger(result.year) || !Number.isInteger(result.month) || !Number.isInteger(result.day)) {
    throw new RangeError(`Could not resolve calendar date in time zone: ${timeZone}`);
  }
  return result;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function partsToKey({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function localDayKey(value = Date.now(), options = {}) {
  return partsToKey(localDateParts(value, options));
}

function parseDayKey(key) {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!match) throw new TypeError(`Invalid calendar day key: ${key}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) {
    throw new RangeError(`Invalid calendar day key: ${key}`);
  }
  return parts;
}

// The host-local instant a day key starts at. Built with the local `Date`
// constructor for the same reason `calendarDayDiff` refuses to divide elapsed
// milliseconds: on a DST boundary a day is not 24 hours long, so anything that
// anchors "minute 480 of 2026-03-29" by adding to a previous midnight drifts by
// an hour twice a year.
//
// No `timeZone` option, deliberately. Deriving the start of a day in an
// arbitrary zone needs the same binary search `nextLocalDayBoundary` does, and
// the callers that place samples on a local timeline all work in the host zone.
function localDayStart(key) {
  const { year, month, day } = parseDayKey(key);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function dayOrdinal(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}

// Returns the number of local calendar dates crossed from `from` to `to`.
// It intentionally does not divide elapsed milliseconds, so 23/25-hour DST days
// still count as exactly one calendar day.
function calendarDayDiff(from, to, options = {}) {
  return dayOrdinal(localDateParts(to, options)) - dayOrdinal(localDateParts(from, options));
}

function addDaysToKey(key, amount) {
  if (!Number.isInteger(amount)) throw new TypeError('Calendar day amount must be an integer');
  const { year, month, day } = parseDayKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return partsToKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  });
}

function compareDayKeys(left, right) {
  return Math.sign(dayOrdinal(parseDayKey(left)) - dayOrdinal(parseDayKey(right)));
}

// Finds the first instant whose local calendar key differs from the key at
// `value`. Binary search avoids assuming that a local day is always 24 hours.
function nextLocalDayBoundary(value = Date.now(), options = {}) {
  const afterMs = Math.floor(toEpochMs(value));
  const { timeZone } = options;

  if (!timeZone) {
    const date = new Date(afterMs);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
  }

  const currentKey = localDayKey(afterMs, options);
  let low = afterMs + 1;
  let high = afterMs + 36 * 60 * 60 * 1000;
  let attempts = 0;
  while (localDayKey(high, options) === currentKey && attempts < 4) {
    high += MS_PER_DAY;
    attempts += 1;
  }
  if (localDayKey(high, options) === currentKey) {
    throw new RangeError(`Could not locate the next local day boundary for ${timeZone}`);
  }

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (localDayKey(mid, options) === currentKey) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Return the next occurrence of a whole local clock hour. This intentionally
// uses the host calendar rather than adding 24 hours, so DST transitions keep
// the appointment aligned with the user's wall clock.
function nextLocalWorkStart(value = Date.now(), workStartHour = 10) {
  const afterMs = Math.floor(toEpochMs(value));
  if (!Number.isInteger(workStartHour) || workStartHour < 0 || workStartHour > 23) {
    throw new RangeError('workStartHour must be an integer from 0 through 23');
  }
  const candidate = new Date(afterMs);
  candidate.setHours(workStartHour, 0, 0, 0);
  if (candidate.getTime() <= afterMs) candidate.setDate(candidate.getDate() + 1);
  return candidate.getTime();
}

function splitAcrossLocalDays(start, end, options = {}) {
  const startMs = toEpochMs(start);
  const endMs = toEpochMs(end);
  if (endMs < startMs) throw new RangeError('End must be greater than or equal to start');
  if (endMs === startMs) return [];

  const slices = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs) {
    if (guard++ > 10000) throw new RangeError('Date range is too large to split safely');
    const boundary = nextLocalDayBoundary(cursor, options);
    const sliceEnd = Math.min(boundary, endMs);
    const dateKey = localDayKey(cursor, options);
    slices.push({
      dateKey,
      startMs: cursor,
      endMs: sliceEnd,
      durationMs: sliceEnd - cursor
    });
    if (sliceEnd <= cursor) throw new RangeError('Calendar boundary did not advance');
    cursor = sliceEnd;
  }
  return slices;
}

module.exports = {
  MS_PER_DAY,
  toEpochMs,
  localDateParts,
  localDayKey,
  parseDayKey,
  localDayStart,
  calendarDayDiff,
  addDaysToKey,
  compareDayKeys,
  nextLocalDayBoundary,
  nextLocalBoundary: nextLocalDayBoundary,
  nextLocalWorkStart,
  splitAcrossLocalDays
};
