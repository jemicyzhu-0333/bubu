'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceOnce, nextOccurrenceDate } = require('../src/core/recurrence-rule');

function rule(overrides = {}) {
  return {
    frequency: 'daily',
    strategy: 'fixed',
    interval: 1,
    weekdays: null,
    anchorDate: '2025-01-01',
    ...overrides
  };
}

function withTimeZone(timeZone, callback) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('core recurrence advances one local calendar day across 23-hour and 25-hour DST days', () => {
  withTimeZone('America/New_York', () => {
    const springStart = new Date(2025, 2, 9).getTime();
    const springEnd = new Date(2025, 2, 10).getTime();
    assert.equal((springEnd - springStart) / 3_600_000, 23);
    assert.equal(advanceOnce(rule({ anchorDate: '2025-03-09' }), '2025-03-09'), '2025-03-10');

    const fallStart = new Date(2025, 10, 2).getTime();
    const fallEnd = new Date(2025, 10, 3).getTime();
    assert.equal((fallEnd - fallStart) / 3_600_000, 25);
    assert.equal(advanceOnce(rule({ anchorDate: '2025-11-02' }), '2025-11-02'), '2025-11-03');
  });
});

test('core monthly recurrence restores the original day after a short month', () => {
  const monthly = rule({ frequency: 'monthly', anchorDate: '2025-01-31' });
  const february = advanceOnce(monthly, '2025-01-31');
  assert.equal(february, '2025-02-28');
  assert.equal(advanceOnce(monthly, february), '2025-03-31');
});

test('core catch-up returns one next occurrence and the number of skipped slots', () => {
  assert.deepEqual(nextOccurrenceDate(rule({ interval: 3 }), {
    lastOccurrenceDate: '2025-01-01',
    referenceDay: '2025-01-10'
  }), {
    date: '2025-01-13',
    skipped: 3
  });
});
