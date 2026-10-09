'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  localDayKey,
  calendarDayDiff,
  compareDayKeys,
  nextLocalDayBoundary,
  nextLocalWorkStart,
  splitAcrossLocalDays
} = require('../src/core/calendar');

test('localDayKey follows the requested positive and negative UTC offsets', () => {
  assert.equal(localDayKey(Date.parse('2026-08-28T16:00:05Z'), { timeZone: 'Asia/Shanghai' }), '2026-08-29');
  assert.equal(localDayKey(Date.parse('2026-08-29T06:30:00Z'), { timeZone: 'America/Los_Angeles' }), '2026-08-28');
});

test('calendarDayDiff counts calendar dates instead of 24-hour periods', () => {
  const beforeSpringForward = Date.parse('2024-03-10T00:00:00-08:00');
  const nextMidnight = Date.parse('2024-03-11T00:00:00-07:00');
  assert.equal(nextMidnight - beforeSpringForward, 23 * 60 * 60 * 1000);
  assert.equal(calendarDayDiff(beforeSpringForward, nextMidnight, { timeZone: 'America/Los_Angeles' }), 1);
});

test('compareDayKeys orders calendar dates without consulting the wall clock', () => {
  assert.equal(compareDayKeys('2026-08-28', '2026-08-29'), -1);
  assert.equal(compareDayKeys('2026-08-29', '2026-08-29'), 0);
  assert.equal(compareDayKeys('2026-08-30', '2026-08-29'), 1);
});

test('nextLocalDayBoundary handles 23-hour and 25-hour DST days', () => {
  const springStart = Date.parse('2024-03-10T00:00:00-08:00');
  assert.equal(
    nextLocalDayBoundary(springStart, { timeZone: 'America/Los_Angeles' }),
    Date.parse('2024-03-11T00:00:00-07:00')
  );

  const fallStart = Date.parse('2024-11-03T00:00:00-07:00');
  assert.equal(
    nextLocalDayBoundary(fallStart, { timeZone: 'America/Los_Angeles' }),
    Date.parse('2024-11-04T00:00:00-08:00')
  );
});

test('splitAcrossLocalDays attributes time to both sides of local midnight', () => {
  const slices = splitAcrossLocalDays(
    Date.parse('2026-08-28T23:30:00+08:00'),
    Date.parse('2026-08-29T00:30:00+08:00'),
    { timeZone: 'Asia/Shanghai' }
  );
  assert.deepEqual(slices.map(slice => [slice.dateKey, slice.durationMs]), [
    ['2026-08-28', 30 * 60 * 1000],
    ['2026-08-29', 30 * 60 * 1000]
  ]);
});

test('nextLocalWorkStart uses the next local work boundary instead of adding 24 hours', () => {
  const beforeStart = new Date(2026, 7, 28, 9, 30, 0, 0);
  const sameDay = new Date(nextLocalWorkStart(beforeStart, 10));
  assert.deepEqual(
    [sameDay.getFullYear(), sameDay.getMonth(), sameDay.getDate(), sameDay.getHours(), sameDay.getMinutes()],
    [2026, 7, 28, 10, 0]
  );

  const atStart = new Date(2026, 7, 28, 10, 0, 0, 0);
  const nextDay = new Date(nextLocalWorkStart(atStart, 10));
  assert.deepEqual(
    [nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), nextDay.getHours(), nextDay.getMinutes()],
    [2026, 7, 29, 10, 0]
  );
  assert.throws(() => nextLocalWorkStart(beforeStart, 24), /workStartHour/);
});
