'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorJournal, ERROR_OPERATIONS } = require('../src/surfaces/pet/realtime/error-journal.mjs');

test('presentation error identity counts occurrences even when messages are identical', () => {
  const journal = createErrorJournal();
  const error = new Error('same failure');
  journal.record('panel-open', error, 10); journal.record('panel-open', error, 20);
  const snapshot = journal.snapshot();
  assert.deepEqual(snapshot, { schemaVersion: 1, total: 2, overwritten: 0, rows: [
    { sequence: 1, atMs: 10, operation: 'panel-open', message: 'same failure' },
    { sequence: 2, atMs: 20, operation: 'panel-open', message: 'same failure' }
  ] });
  error.message = 'changed later'; snapshot.rows[0].message = 'caller changed';
  assert.deepEqual(journal.messages(), ['same failure', 'same failure']);
  assert.equal(journal.snapshot().total, 2, 'reading does not create more occurrences');
});

test('presentation error journal retains a bounded chronological window and exact eviction count', () => {
  const journal = createErrorJournal();
  for (let i = 1; i <= 100; i++) journal.record('frame', 'x'.repeat(3000), i);
  const snapshot = journal.snapshot();
  assert.equal(snapshot.total, 100); assert.equal(snapshot.overwritten, 92); assert.equal(snapshot.rows.length, 8);
  assert.deepEqual(snapshot.rows.map(row => row.sequence), [93, 94, 95, 96, 97, 98, 99, 100]);
  assert(snapshot.rows.every(row => row.message.length === 2048));
  assert.deepEqual(journal.messages(), snapshot.rows.map(row => row.message));
});

test('journal records only allowlisted operations and scalar copies, never raw errors or nonfinite timestamps', () => {
  const journal = createErrorJournal({ capacity: 1 });
  const error = new Error('detail'); error.stack = 'must not retain stack'; error.scene = { private: true };
  journal.record('terminal-diagnostics', error, NaN);
  assert.deepEqual(journal.snapshot().rows, [{ sequence: 1, atMs: null, operation: 'terminal-diagnostics', message: 'detail' }]);
  assert.throws(() => journal.record('unknown', error, 1), /Unknown/);
  assert.equal(journal.snapshot().total, 1);
  assert(Object.isFrozen(ERROR_OPERATIONS));
  for (const capacity of [0, 9, 1.5, NaN]) assert.throws(() => createErrorJournal({ capacity }), /capacity/);
});

test('non-Error rejections and unprintable exceptions still produce bounded occurrence records', () => {
  const journal = createErrorJournal();
  const badMessage = new Error(); Object.defineProperty(badMessage, 'message', { get() { throw null; } });
  for (const error of [null, undefined, 'rejected text', Object.create(null), badMessage]) journal.record('frame', error);
  assert.equal(journal.snapshot().total, 5);
  assert.deepEqual(journal.messages(), ['null', 'undefined', 'rejected text', '[unprintable error]', '[unprintable error]']);
});
