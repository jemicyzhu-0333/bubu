'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlTimelineRepository } = require('../src/platform/persistence/sqlite/timeline-repository');
test('AI history query distinguishes failure from a truly empty range without changing legacy UI reads', () => {
  const range = { fromDayKey: '2026-10-01', toDayKey: '2026-10-04' };
  const empty = createSqlTimelineRepository({ handle: { all: () => [] } });
  assert.deepEqual(empty.queryRange(range), { ok: true, availability: 'available', items: [] });
  const failed = createSqlTimelineRepository({ handle: { all: () => { throw new Error('unavailable'); } } });
  assert.equal(failed.queryRange(range).availability, 'unavailable');
  assert.equal(failed.queryRange(range).ok, false);
  assert.deepEqual(failed.readRange(range), []);
});
