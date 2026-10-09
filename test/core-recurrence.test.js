'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ADVANCE_ITERATIONS,
  isoWeekday,
  mondayOrdinal,
  daysInMonth,
  assertValidRule,
  weeklyDays,
  advanceOnce,
  nextOccurrenceDate,
  firstOccurrenceDate,
  buildOccurrence,
  anchorDateFrom
} = require('../src/capabilities/work').recurrence;

// ================================================================
// Helpers
// ================================================================

function dailyRule(overrides = {}) {
  return {
    frequency: 'daily',
    strategy: 'fixed',
    interval: 1,
    weekdays: null,
    anchorDate: '2025-01-01',
    ...overrides
  };
}

function weeklyRule(overrides = {}) {
  return {
    frequency: 'weekly',
    strategy: 'fixed',
    interval: 1,
    weekdays: null,
    anchorDate: '2025-01-01',
    ...overrides
  };
}

function monthlyRule(overrides = {}) {
  return {
    frequency: 'monthly',
    strategy: 'fixed',
    interval: 1,
    weekdays: null,
    anchorDate: '2025-01-01',
    ...overrides
  };
}

function seriesTemplate(overrides = {}) {
  return {
    id: 'series-1',
    template: {
      title: 'Test task',
      description: null,
      tags: [],
      stepTitles: ['Step 1', 'Step 2'],
      energy: null,
      energyAuto: true,
      estimateMinutes: null
    },
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

// ================================================================
// assertValidRule
// ================================================================

test('assertValidRule rejects missing or non-object rule', () => {
  assert.throws(() => assertValidRule(null), TypeError);
  assert.throws(() => assertValidRule(undefined), TypeError);
  assert.throws(() => assertValidRule('not-an-object'), TypeError);
});

test('assertValidRule rejects unknown frequency', () => {
  assert.throws(() => assertValidRule(dailyRule({ frequency: 'hourly' })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ frequency: 'yearly' })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ frequency: '' })), RangeError);
});

test('assertValidRule accepts valid frequencies', () => {
  assert.doesNotThrow(() => assertValidRule(dailyRule({ frequency: 'daily' })));
  assert.doesNotThrow(() => assertValidRule(dailyRule({ frequency: 'weekly' })));
  assert.doesNotThrow(() => assertValidRule(dailyRule({ frequency: 'monthly' })));
});

test('assertValidRule rejects unknown strategy', () => {
  assert.throws(() => assertValidRule(dailyRule({ strategy: 'custom' })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ strategy: '' })), RangeError);
});

test('assertValidRule accepts valid strategies', () => {
  assert.doesNotThrow(() => assertValidRule(dailyRule({ strategy: 'fixed' })));
  assert.doesNotThrow(() => assertValidRule(dailyRule({ strategy: 'after-completion' })));
});

test('assertValidRule rejects invalid intervals', () => {
  assert.throws(() => assertValidRule(dailyRule({ interval: 0 })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ interval: -1 })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ interval: 366 })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ interval: 1.5 })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ interval: null })), RangeError);
});

test('assertValidRule accepts valid intervals', () => {
  assert.doesNotThrow(() => assertValidRule(dailyRule({ interval: 1 })));
  assert.doesNotThrow(() => assertValidRule(dailyRule({ interval: 365 })));
  assert.doesNotThrow(() => assertValidRule(dailyRule({ interval: 30 })));
});

test('assertValidRule rejects weekdays on non-weekly rule', () => {
  assert.throws(() => assertValidRule(dailyRule({ weekdays: [1, 3, 5] })), RangeError);
  assert.throws(() => assertValidRule(monthlyRule({ weekdays: [1, 3, 5] })), RangeError);
});

test('assertValidRule validates weekday array', () => {
  assert.throws(() => assertValidRule(weeklyRule({ weekdays: [] })), RangeError);
  assert.throws(() => assertValidRule(weeklyRule({ weekdays: [0] })), RangeError);
  assert.throws(() => assertValidRule(weeklyRule({ weekdays: [8] })), RangeError);
  assert.throws(() => assertValidRule(weeklyRule({ weekdays: [-1] })), RangeError);
  assert.throws(() => assertValidRule(weeklyRule({ weekdays: [1.5] })), RangeError);
  assert.doesNotThrow(() => assertValidRule(weeklyRule({ weekdays: [1, 3, 5] })));
  assert.doesNotThrow(() => assertValidRule(weeklyRule({ weekdays: [1, 2, 3, 4, 5, 6, 7] })));
});

test('assertValidRule rejects invalid anchorDate', () => {
  assert.throws(() => assertValidRule(dailyRule({ anchorDate: 'invalid' })), TypeError);
  assert.throws(() => assertValidRule(dailyRule({ anchorDate: '2025-13-01' })), RangeError);
  assert.throws(() => assertValidRule(dailyRule({ anchorDate: '2025-02-30' })), RangeError);
});

// ================================================================
// MAX_ADVANCE_ITERATIONS
// ================================================================

test('MAX_ADVANCE_ITERATIONS is a positive integer', () => {
  assert.ok(Number.isInteger(MAX_ADVANCE_ITERATIONS));
  assert.ok(MAX_ADVANCE_ITERATIONS > 0);
});

// ================================================================
// isoWeekday, mondayOrdinal, daysInMonth
// ================================================================

test('isoWeekday returns correct ISO weekday (1=Mon … 7=Sun)', () => {
  // 2025-01-01 is a Wednesday → ISO 3
  assert.equal(isoWeekday('2025-01-01'), 3);
  // 2025-01-06 is a Monday → ISO 1
  assert.equal(isoWeekday('2025-01-06'), 1);
  // 2025-01-05 is a Sunday → ISO 7
  assert.equal(isoWeekday('2025-01-05'), 7);
});

test('mondayOrdinal returns consistent week numbering', () => {
  // 2025-01-06 (Mon) and 2025-01-07 (Tue) should be in the same week
  const mon = mondayOrdinal('2025-01-06');
  const tue = mondayOrdinal('2025-01-07');
  assert.equal(mon, tue);
  // 2025-01-13 (next Mon) should be one week later
  assert.equal(mondayOrdinal('2025-01-13'), mon + 7);
});

test('daysInMonth returns correct values', () => {
  assert.equal(daysInMonth(2025, 1), 31);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29); // leap year
  assert.equal(daysInMonth(2025, 4), 30);
});

// ================================================================
// weeklyDays
// ================================================================

test('weeklyDays returns custom weekdays when set', () => {
  const rule = weeklyRule({ weekdays: [1, 5], anchorDate: '2025-01-01' });
  assert.deepEqual(weeklyDays(rule), [1, 5]);
});

test('weeklyDays falls back to anchorDate weekday', () => {
  const rule = weeklyRule({ anchorDate: '2025-01-01' }); // Wednesday
  assert.deepEqual(weeklyDays(rule), [3]);
});

// ================================================================
// advanceOnce — daily
// ================================================================

test('advanceOnce daily with interval=1 from 2025-01-01 returns 2025-01-02', () => {
  assert.equal(advanceOnce(dailyRule({ interval: 1 }), '2025-01-01'), '2025-01-02');
});

test('advanceOnce daily with interval=2 from 2025-01-01 returns 2025-01-03', () => {
  assert.equal(advanceOnce(dailyRule({ interval: 2 }), '2025-01-01'), '2025-01-03');
});

test('advanceOnce daily with interval=7 from 2025-01-01 returns 2025-01-08', () => {
  assert.equal(advanceOnce(dailyRule({ interval: 7 }), '2025-01-01'), '2025-01-08');
});

test('advanceOnce daily crosses month boundary', () => {
  assert.equal(advanceOnce(dailyRule({ interval: 1 }), '2025-01-31'), '2025-02-01');
});

test('advanceOnce daily crosses year boundary', () => {
  assert.equal(advanceOnce(dailyRule({ interval: 1 }), '2025-12-31'), '2026-01-01');
});

// ================================================================
// advanceOnce — weekly
// ================================================================

test('advanceOnce weekly with default weekday (anchor day) steps by interval', () => {
  // 2025-01-01 is Wed, interval=1 → next Wed = 2025-01-08
  assert.equal(advanceOnce(weeklyRule({ interval: 1 }), '2025-01-01'), '2025-01-08');
});

test('advanceOnce weekly with multi-weekday set steps to the next valid day', () => {
  // Wed 2025-01-01, weekdays=[1,5] (Mon,Fri), next is Fri 2025-01-03
  const rule = weeklyRule({ interval: 1, weekdays: [1, 5], anchorDate: '2025-01-01' });
  assert.equal(advanceOnce(rule, '2025-01-01'), '2025-01-03');
});

test('advanceOnce weekly from Friday to Monday with weekdays=[1,5]', () => {
  const rule = weeklyRule({ interval: 1, weekdays: [1, 5], anchorDate: '2025-01-01' });
  // From Fri 2025-01-03, next is Mon 2025-01-06
  assert.equal(advanceOnce(rule, '2025-01-03'), '2025-01-06');
});

test('advanceOnce weekly with interval=2 skips a week', () => {
  // Wed 2025-01-01, interval=2 → Wed 2025-01-15 (two weeks)
  assert.equal(advanceOnce(weeklyRule({ interval: 2 }), '2025-01-01'), '2025-01-15');
});

// ================================================================
// advanceOnce — monthly
// ================================================================

test('advanceOnce monthly with interval=1 from 2025-01-15 returns 2025-02-15', () => {
  assert.equal(advanceOnce(monthlyRule({ interval: 1, anchorDate: '2025-01-15' }), '2025-01-15'), '2025-02-15');
});

test('advanceOnce monthly from 2025-01-31 clamps to 2025-02-28', () => {
  const rule = monthlyRule({ interval: 1, anchorDate: '2025-01-31' });
  assert.equal(advanceOnce(rule, '2025-01-31'), '2025-02-28');
});

test('advanceOnce monthly from 2025-01-31 during leap year clamps to 2024-02-29', () => {
  const rule = monthlyRule({ interval: 1, anchorDate: '2024-01-31' });
  assert.equal(advanceOnce(rule, '2024-01-31'), '2024-02-29');
});

test('advanceOnce monthly with interval=3 advances by quarter', () => {
  assert.equal(advanceOnce(monthlyRule({ interval: 3, anchorDate: '2025-01-15' }), '2025-01-15'), '2025-04-15');
});

// ================================================================
// Monthly clamping: 1/31 → 2/28 → 3/31 (triple assertion)
// ================================================================

test('monthly recurrence preserves anchor day-of-month across clamping (1/31 → 2/28 → 3/31)', () => {
  const rule = monthlyRule({ interval: 1, anchorDate: '2025-01-31' });

  // First advance: Jan 31 → Feb 28 (clamped)
  const feb = advanceOnce(rule, '2025-01-31');
  assert.equal(feb, '2025-02-28');

  // Second advance: Feb 28 → Mar 31 (recovers to 31, anchor preserved)
  const mar = advanceOnce(rule, feb);
  assert.equal(mar, '2025-03-31');

  // Third advance: Mar 31 → Apr 30 (clamped again)
  const apr = advanceOnce(rule, mar);
  assert.equal(apr, '2025-04-30');

  // Fourth advance: Apr 30 → May 31 (recovers again)
  const may = advanceOnce(rule, apr);
  assert.equal(may, '2025-05-31');
});

// ================================================================
// nextOccurrenceDate — fixed strategy with multi-period collapse
// ================================================================

test('nextOccurrenceDate fixed: single step from anchor', () => {
  const rule = dailyRule({ interval: 3, anchorDate: '2025-01-01' });
  const result = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2025-01-01'
  });
  assert.equal(result.date, '2025-01-04');
  assert.equal(result.skipped, 0);
});

test('nextOccurrenceDate fixed: collapses multiple periods without debt', () => {
  const rule = dailyRule({ interval: 3, anchorDate: '2025-01-01' });
  // referenceDay is 10 days after anchor, so 3 periods have passed (Jan 4, 7, 10)
  // The next should be Jan 13, with 3 skipped periods
  const result = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2025-01-10'
  });
  assert.equal(result.date, '2025-01-13');
  assert.equal(result.skipped, 3);
});

test('nextOccurrenceDate fixed: skipped count increases with referenceDay distance', () => {
  const rule = dailyRule({ interval: 1, anchorDate: '2025-01-01' });
  const near = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2025-01-01'
  });
  const far = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2025-01-20'
  });
  assert.equal(near.skipped, 0);
  assert.equal(far.skipped, 19);
});

// ================================================================
// nextOccurrenceDate — after-completion strategy
// ================================================================

test('nextOccurrenceDate after-completion: uses completedOn instead of lastOccurrenceDate', () => {
  const rule = dailyRule({ interval: 3, strategy: 'after-completion' });
  // lastOccurrenceDate=Jan 1, completedOn=Jan 5
  // fixed would use Jan 1 → Jan 4
  // after-completion uses Jan 5 → Jan 8
  const result = nextOccurrenceDate(rule, {
    lastOccurrenceDate: '2025-01-01',
    completedOn: '2025-01-05',
    referenceDay: '2025-01-05'
  });
  assert.equal(result.date, '2025-01-08');
});

test('nextOccurrenceDate after-completion produces different date than fixed for late completion', () => {
  const rule = dailyRule({ interval: 3 });
  const fixedResult = nextOccurrenceDate(
    { ...rule, strategy: 'fixed' },
    {
      lastOccurrenceDate: '2025-01-01',
      completedOn: '2025-01-05',
      referenceDay: '2025-01-05'
    }
  );
  const afterResult = nextOccurrenceDate(
    { ...rule, strategy: 'after-completion' },
    {
      lastOccurrenceDate: '2025-01-01',
      completedOn: '2025-01-05',
      referenceDay: '2025-01-05'
    }
  );
  // fixed: from Jan 1, forward to after Jan 5 → Jan 7 (skip 1)
  // after-completion: from Jan 5 → Jan 8
  assert.notEqual(fixedResult.date, afterResult.date);
});

// ================================================================
// nextOccurrenceDate — defaults fromDayKey
// ================================================================

test('nextOccurrenceDate uses fromDayKey when lastOccurrenceDate is omitted', () => {
  const rule = dailyRule({ interval: 3 });
  const result = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2025-01-01'
  });
  assert.equal(result.date, '2025-01-04');
});

// ================================================================
// nextOccurrenceDate — long-lived series
// ================================================================

test('nextOccurrenceDate keeps exact counts across hundreds of periods', () => {
  const rule = dailyRule({ interval: 3 });
  const result = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2030-06-01'
  });
  // 2025-01-01 → 2030-06-01 is exactly 1,977 days, or 659
  // three-day slots. The reference day itself is therefore skipped and the
  // next slot is three days later.
  assert.deepEqual(result, { date: '2030-06-04', skipped: 659 });
});

test('nextOccurrenceDate folds more than the former iteration cap without rejecting a valid rule', () => {
  const rule = dailyRule({ interval: 1 });
  const result = nextOccurrenceDate(rule, {
    fromDayKey: '2025-01-01',
    referenceDay: '2040-01-01'
  });
  assert.deepEqual(result, { date: '2040-01-02', skipped: 5478 });
  assert.ok(result.skipped > MAX_ADVANCE_ITERATIONS);
});

test('long weekly and monthly gaps are folded arithmetically with exact counts', () => {
  const weekly = nextOccurrenceDate(weeklyRule({
    anchorDate: '2020-01-01', weekdays: [1, 2, 3, 4, 5, 6, 7]
  }), {
    lastOccurrenceDate: '2020-01-01',
    referenceDay: '2025-01-01'
  });
  assert.deepEqual(weekly, { date: '2025-01-02', skipped: 1827 });

  const monthly = nextOccurrenceDate(monthlyRule({ anchorDate: '1900-01-31' }), {
    lastOccurrenceDate: '1900-01-31',
    referenceDay: '2025-01-31'
  });
  assert.deepEqual(monthly, { date: '2025-02-28', skipped: 1500 });
});

// ================================================================
// Cross-DST: calendar-based approach immune to DST
// ================================================================

test('nextOccurrenceDate daily works correctly across DST transition dates', () => {
  // The implementation uses calendar day keys (YYYY-MM-DD), not milliseconds,
  // so a 23-hour or 25-hour DST day still counts as exactly one calendar day.
  // We test that dates around typical DST boundaries work correctly.
  withTimeZone('America/New_York', () => {
    const rule = dailyRule({ interval: 1, anchorDate: '2025-03-08' });
    const result = nextOccurrenceDate(rule, {
      fromDayKey: '2025-03-08',
      referenceDay: '2025-03-08'
    });
    assert.equal(result.date, '2025-03-09');

    const result2 = nextOccurrenceDate(rule, {
      fromDayKey: '2025-03-09',
      referenceDay: '2025-03-09'
    });
    assert.equal(result2.date, '2025-03-10');
  });
});

test('advanceOnce daily handles fall-back DST day (25 hours)', () => {
  withTimeZone('America/New_York', () => {
    const rule = dailyRule({ interval: 1 });
    assert.equal(advanceOnce(rule, '2025-11-01'), '2025-11-02');
    assert.equal(advanceOnce(rule, '2025-11-02'), '2025-11-03');
  });
});

// ================================================================
// firstOccurrenceDate
// ================================================================

test('firstOccurrenceDate daily returns startDayKey unchanged', () => {
  assert.equal(
    firstOccurrenceDate(dailyRule({ anchorDate: '2025-01-01' }), '2025-01-01'),
    '2025-01-01'
  );
});

test('firstOccurrenceDate monthly returns startDayKey unchanged', () => {
  assert.equal(
    firstOccurrenceDate(monthlyRule({ anchorDate: '2025-01-01' }), '2025-01-01'),
    '2025-01-01'
  );
});

test('firstOccurrenceDate weekly on valid weekday returns startDayKey unchanged', () => {
  // 2025-01-01 is Wed, weekdays=[3] (Wed) — it's valid
  assert.equal(
    firstOccurrenceDate(weeklyRule({ anchorDate: '2025-01-01', weekdays: [3] }), '2025-01-01'),
    '2025-01-01'
  );
});

test('firstOccurrenceDate weekly on invalid weekday advances to the next valid day', () => {
  // 2025-01-01 is Wed, weekdays=[1,5] (Mon,Fri)
  // Start on Thu 2025-01-02 → next valid is Fri 2025-01-03
  assert.equal(
    firstOccurrenceDate(
      weeklyRule({ anchorDate: '2025-01-01', weekdays: [1, 5] }),
      '2025-01-02'
    ),
    '2025-01-03'
  );
});

test('firstOccurrenceDate weekly returns the same day when it is already a valid weekday', () => {
  // 2025-01-01 is Wed, weekdays=[1,3,5] (Mon,Wed,Fri)
  assert.equal(
    firstOccurrenceDate(
      weeklyRule({ anchorDate: '2025-01-01', weekdays: [1, 3, 5] }),
      '2025-01-01'
    ),
    '2025-01-01'
  );
});

// ================================================================
// buildOccurrence
// ================================================================

test('buildOccurrence creates a task with correct shape', () => {
  const series = seriesTemplate();
  const occurrence = buildOccurrence(series, {
    date: '2025-01-15',
    now: 1700000000000,
    taskId: 'task-001'
  });

  assert.equal(occurrence.id, 'task-001');
  assert.equal(occurrence.title, 'Test task');
  assert.equal(occurrence.seriesId, 'series-1');
  assert.equal(occurrence.occurrenceDate, '2025-01-15');
  assert.equal(occurrence.plannedFor, '2025-01-15');
  assert.equal(occurrence.done, false);
  assert.equal(occurrence.completedAt, null);
  assert.equal(occurrence.steps.length, 2);
  assert.equal(occurrence.steps[0].title, 'Step 1');
  assert.equal(occurrence.steps[1].title, 'Step 2');
  assert.ok(occurrence.steps[0].id !== occurrence.steps[1].id);
});

test('buildOccurrence generates unique step IDs', () => {
  const series = seriesTemplate({
    template: { title: 'Test', description: null, tags: [], stepTitles: ['A', 'B', 'C'], energy: null, energyAuto: true, estimateMinutes: null }
  });
  const occurrence = buildOccurrence(series, {
    date: '2025-01-15',
    now: 1700000000000,
    taskId: 'task-002'
  });
  assert.equal(occurrence.steps.length, 3);
  const ids = occurrence.steps.map(step => step.id);
  assert.equal(new Set(ids).size, 3);
});

test('buildOccurrence rejects missing taskId', () => {
  assert.throws(() => buildOccurrence(seriesTemplate(), { date: '2025-01-15', now: 1 }), TypeError);
  assert.throws(() => buildOccurrence(seriesTemplate(), { date: '2025-01-15', now: 1, taskId: '' }), TypeError);
  assert.throws(() => buildOccurrence(seriesTemplate(), { date: '2025-01-15', now: 1, taskId: '  ' }), TypeError);
});

test('buildOccurrence rejects missing series', () => {
  assert.throws(() => buildOccurrence(null, { date: '2025-01-15', taskId: 'task-003' }), TypeError);
});

test('buildOccurrence copies tags from template', () => {
  const series = seriesTemplate({
    template: { title: 'T', description: null, tags: ['work', 'urgent'], stepTitles: [], energy: null, energyAuto: true, estimateMinutes: null }
  });
  const occurrence = buildOccurrence(series, { date: '2025-01-15', now: 1, taskId: 'task-004' });
  assert.deepEqual(occurrence.tags, ['work', 'urgent']);
  // Tags should be a copy, not a reference
  assert.notStrictEqual(occurrence.tags, series.template.tags);
});

test('buildOccurrence defaults done to false and archivedAt to null', () => {
  const occurrence = buildOccurrence(seriesTemplate(), { date: '2025-01-15', now: 1, taskId: 'task-005' });
  assert.equal(occurrence.done, false);
  assert.equal(occurrence.archivedAt, null);
  assert.equal(occurrence.expired, false);
});

test('buildOccurrence requires its creation time explicitly', () => {
  assert.throws(
    () => buildOccurrence(seriesTemplate(), { date: '2025-01-15', taskId: 'task-006' }),
    /options\.now/
  );
  assert.throws(
    () => buildOccurrence(seriesTemplate(), { date: '2025-01-15', now: null, taskId: 'task-006' }),
    /options\.now/
  );
});

// ================================================================
// anchorDateFrom
// ================================================================

test('anchorDateFrom returns valid day key string unchanged', () => {
  assert.equal(anchorDateFrom('2025-06-15', Date.now()), '2025-06-15');
});

test('anchorDateFrom returns localDayKey for invalid string', () => {
  // 'not-a-date' can't be parsed, falls back to localDayKey of the timestamp
  const result = anchorDateFrom('not-a-date', 1700000000000);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('anchorDateFrom returns localDayKey for non-string', () => {
  const result = anchorDateFrom(42, 1700000000000);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

// ================================================================
// Weekly rule: multi-weekday stepping chain
// ================================================================

test('weekly rule with weekdays=[1,3,5] steps through each weekday in order', () => {
  const rule = weeklyRule({ interval: 1, weekdays: [1, 3, 5], anchorDate: '2025-01-01' });

  // 2025-01-01 is Wed (3), next is Fri (5) = 2025-01-03
  let date = advanceOnce(rule, '2025-01-01');
  assert.equal(date, '2025-01-03');
  assert.equal(isoWeekday(date), 5);

  // From Fri, next is Mon (1) = 2025-01-06
  date = advanceOnce(rule, date);
  assert.equal(date, '2025-01-06');
  assert.equal(isoWeekday(date), 1);

  // From Mon, next is Wed (3) = 2025-01-08
  date = advanceOnce(rule, date);
  assert.equal(date, '2025-01-08');
  assert.equal(isoWeekday(date), 3);

  // From Wed, next is Fri (5) = 2025-01-10
  date = advanceOnce(rule, date);
  assert.equal(date, '2025-01-10');
  assert.equal(isoWeekday(date), 5);
});

// ================================================================
// Weekly rule: interval > 1 with multi-weekday
// ================================================================

test('weekly rule with interval=2 and weekdays=[1,5] skips a week', () => {
  const rule = weeklyRule({ interval: 2, weekdays: [1, 5], anchorDate: '2025-01-01' });

  const friday = advanceOnce(rule, '2025-01-01');
  assert.equal(friday, '2025-01-03');
  const nextMonday = advanceOnce(rule, friday);
  assert.equal(nextMonday, '2025-01-13');
  assert.equal(advanceOnce(rule, nextMonday), '2025-01-17');
});

// ================================================================
// nextOccurrenceDate with weekly rules
// ================================================================

test('nextOccurrenceDate weekly: fixed strategy collapses missed weeks', () => {
  const rule = weeklyRule({ interval: 1, anchorDate: '2025-01-01' }); // Wed weekly
  const result = nextOccurrenceDate(rule, {
    lastOccurrenceDate: '2025-01-01',
    referenceDay: '2025-01-20' // 19 days later, should have skipped ~2 occurrences
  });
  assert.deepEqual(result, { date: '2025-01-22', skipped: 2 });
});

// ================================================================
// Monthly end-of-month edge cases
// ================================================================

test('monthly from Jan 30 to Feb 28 in non-leap year', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2025-01-30' }), '2025-01-30'), '2025-02-28');
});

test('monthly from Jan 29 to Feb 28 in non-leap year', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2025-01-29' }), '2025-01-29'), '2025-02-28');
});

test('monthly from Jan 29 to Feb 29 in leap year', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2024-01-29' }), '2024-01-29'), '2024-02-29');
});

test('monthly from Jan 28 to Feb 28 in non-leap year', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2025-01-28' }), '2025-01-28'), '2025-02-28');
});

test('monthly across year boundary', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2025-12-15' }), '2025-12-15'), '2026-01-15');
});

test('monthly from Dec 31 to Jan 31', () => {
  assert.equal(advanceOnce(monthlyRule({ anchorDate: '2025-12-31' }), '2025-12-31'), '2026-01-31');
});
