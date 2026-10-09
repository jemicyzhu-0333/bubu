'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selection } = require('../src/capabilities/work');
const { nowSelection } = require('../src/capabilities/execution');

test('selecting a future appointment updates work-owned facts without mutating its input', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  const task = {
    id: 'scheduled-task',
    title: '提前开始',
    done: false,
    skippedAt: null,
    expired: false,
    scheduledFor: new Date(now + 60_000).toISOString(),
    scheduleNotifiedAt: now - 5_000,
    selectionCount: 2,
    lastSelectedAt: now - 10_000,
    steps: [{ id: 'step-1', title: '打开文件', done: false }]
  };
  const original = structuredClone(task);

  const result = selection.selectTaskForNow(task, now);

  assert.equal(result.ok, true);
  assert.equal(result.task.selectionCount, 3);
  assert.equal(result.task.lastSelectedAt, now);
  assert.equal(result.task.scheduledFor, null);
  assert.equal(result.task.scheduleNotifiedAt, null);
  assert.deepEqual(task, original);
});

test('task selection rejects sealed and expired work without producing a candidate', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  assert.deepEqual(selection.selectTaskForNow({ id: 'done', done: true }, now), {
    ok: false,
    reason: 'task-completed'
  });
  assert.deepEqual(selection.selectTaskForNow({ id: 'skipped', skippedAt: now }, now), {
    ok: false,
    reason: 'occurrence-skipped'
  });
  assert.deepEqual(selection.selectTaskForNow({
    id: 'expired', done: false, expiresAt: new Date(now - 1).toISOString()
  }, now), {
    ok: false,
    reason: 'task-expired'
  });
  assert.throws(
    () => selection.selectTaskForNow({ id: 'task-1', done: false }, -1),
    /finite non-negative timestamp/
  );
});

test('execution owns the closed Now pointer transition', () => {
  assert.deepEqual(nowSelection.selectTask('task-1'), { ok: true, nowTaskId: 'task-1' });
  assert.deepEqual(nowSelection.selectTask('  '), { ok: false, reason: 'task-id-required' });
});
