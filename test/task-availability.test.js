'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { taskStartBlockReason } = require('../src/capabilities/work').availability;

test('blocks missing, completed, future-scheduled, and expired tasks at the process boundary', () => {
  const now = Date.parse('2026-08-29T10:00:00Z');
  assert.equal(taskStartBlockReason(null, now), 'task-not-found');
  assert.equal(taskStartBlockReason({ done: true }, now), 'task-completed');
  assert.equal(taskStartBlockReason({
    done: false, scheduledFor: '2026-08-29T10:01:00Z'
  }, now), 'task-scheduled');
  assert.equal(taskStartBlockReason({
    done: false, category: 'adhoc', expiresAt: '2026-08-29T09:59:59Z'
  }, now), 'task-expired');
  assert.equal(taskStartBlockReason({
    done: false, category: 'adhoc', expired: true, expiresAt: '2026-08-29T11:00:00Z'
  }, now), 'task-expired');
});

test('allows due appointments and active unexpired tasks', () => {
  const now = Date.parse('2026-08-29T10:00:00Z');
  assert.equal(taskStartBlockReason({
    done: false, scheduledFor: '2026-08-29T10:00:00Z'
  }, now), null);
  assert.equal(taskStartBlockReason({
    done: false, category: 'adhoc', expiresAt: '2026-08-29T10:00:00.001Z'
  }, now), null);
  assert.equal(taskStartBlockReason({ done: false, category: 'daily' }, now), null);
});

test('availability never consults an ambient wall clock', () => {
  assert.throws(
    () => taskStartBlockReason({ done: false }),
    /finite non-negative time/
  );
  assert.throws(
    () => taskStartBlockReason({ done: false }, null),
    /finite non-negative time/
  );
});
