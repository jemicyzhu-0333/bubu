'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quickRecordItems, quickRecordTarget } = require('../src/surfaces/popover/features/routine-quick-record.mjs');
const now = new Date(2026, 9, 13, 0, 5).getTime();
const previous = new Date(2026, 9, 12, 23, 59).getTime();

test('quick suggestions use the local calendar day, not a rolling 24-hour history', () => {
  const items = [
    { id: 'scheduled', schedule: { frequency: 'weekly' }, createdAt: previous },
    { id: 'old', createdAt: previous }, { id: 'new', createdAt: now },
    { id: 'used' }, { id: 'skipped' }, { id: 'notified' },
    { id: 'future', createdAt: now + 1 }, { id: 'inactive', active: false, createdAt: now }
  ];
  const occurrences = ['used', 'skipped', 'notified'].map((routineId, i) => ({
    routineId, status: ['done', 'skipped', 'notified'][i], loggedAt: now
  }));
  assert.deepEqual(quickRecordItems({ items, occurrences }, now).map(item => item.id), ['scheduled', 'new', 'used']);
  assert.deepEqual(quickRecordItems({ items: [{ id: 'used' }], occurrences: [{ routineId: 'used', status: 'done', loggedAt: previous }] }, now), []);
});

test('quick targeting rechecks both window bounds and never guesses between overlapping occurrences', () => {
  const occurrence = { routineId: 'r', occurrenceId: 'one', scheduled: true, due: true,
    answered: false, scheduledAt: now - 1000, windowEndsAt: now + 1000 };
  const target = (entries, at = now) => quickRecordTarget({ occurrences: entries }, 'r', at);
  assert.equal(target([occurrence]), 'one');
  assert.equal(target([occurrence], now + 1001), undefined);
  assert.equal(target([occurrence], now - 1001), undefined);
  assert.equal(target([{ ...occurrence, answered: true }]), undefined);
  assert.equal(target([{ ...occurrence, windowEndsAt: undefined }]), undefined);
  assert.equal(target([occurrence, { ...occurrence, occurrenceId: 'two' }]), undefined);
});
