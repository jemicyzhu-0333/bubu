'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeDeadline,
  endOfLocalDateISO,
  formatScheduledFor,
  localCalendarDayDiff
} = require('../src/renderer/task-dates.mjs');

// Use a DST-observing zone so the tests prove that calendar labels are not
// derived from fixed 24-hour timestamp buckets. Scope the process-global TZ
// mutation to each test so the suite also stays deterministic without test
// process isolation.
function testInNewYork(name, body) {
  test(name, context => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      return body(context);
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });
}

testInNewYork('describes deadlines by local calendar day', () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);

  assert.deepEqual(describeDeadline(new Date(2026, 7, 28, 23, 59, 59), now), {
    text: '今天 DDL', tone: 'warn', overdue: false, dayDiff: 0
  });
  assert.deepEqual(describeDeadline(new Date(2026, 7, 29, 23, 59, 59), now), {
    text: '明天 DDL', tone: 'warn', overdue: false, dayDiff: 1
  });
  assert.deepEqual(describeDeadline(new Date(2026, 7, 27, 23, 59, 59), now), {
    text: '逾期 1 天', tone: 'late', overdue: true, dayDiff: -1
  });
});

testInNewYork('marks an elapsed deadline on the same local day as overdue', () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);
  assert.deepEqual(describeDeadline(new Date(2026, 7, 28, 8, 30, 0), now), {
    text: '已逾期', tone: 'late', overdue: true, dayDiff: 0
  });
});

testInNewYork('calendar differences stay correct across a 25-hour DST day', () => {
  const beforeFallback = new Date(2026, 10, 1, 0, 30, 0);
  const tomorrowNight = new Date(2026, 10, 2, 23, 59, 59);

  assert.equal(localCalendarDayDiff(tomorrowNight, beforeFallback), 1);
  assert.equal(describeDeadline(tomorrowNight, beforeFallback).text, '明天 DDL');
});

testInNewYork('converts a date input to the end of that exact local day', () => {
  const iso = endOfLocalDateISO('2026-08-28');
  const result = new Date(iso);

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 7);
  assert.equal(result.getDate(), 28);
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 59);
  assert.equal(endOfLocalDateISO('2026-02-30'), null);
  assert.equal(endOfLocalDateISO('not-a-date'), null);
});

testInNewYork('formats scheduled work using local calendar labels', () => {
  const now = new Date(2026, 7, 28, 18, 0, 0);
  assert.equal(formatScheduledFor(new Date(2026, 7, 28, 20, 5), now), '今天 20:05');
  assert.equal(formatScheduledFor(new Date(2026, 7, 29, 9, 0), now), '明天 09:00');
  assert.equal(formatScheduledFor(new Date(2026, 8, 3, 14, 7), now), '9/3 14:07');
  assert.equal(formatScheduledFor('invalid', now), '');
});
