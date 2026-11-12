'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorJournal, ERROR_OPERATIONS, errorMessage } = require('../src/surfaces/pet/realtime/error-journal.mjs');

test('aggregate summaries retain ordered root causes without multiplying occurrences or retaining errors', () => {
  const journal = createErrorJournal(), child = new Error('listener release failed');
  const single = new AggregateError([child], 'Pet lifecycle cleanup failed');
  assert.equal(errorMessage(single), 'Pet lifecycle cleanup failed (1 errors): 1: listener release failed');
  const aggregate = new AggregateError([child, new Error('frame cancellation failed')], 'cleanup');
  journal.record('cleanup-lifecycle', aggregate);
  child.message = 'mutated'; aggregate.errors.length = 0;
  assert.deepEqual(journal.messages(), ['cleanup (2 errors): 1: listener release failed; 2: frame cancellation failed']);
  assert.equal(journal.snapshot().total, 1);
  assert.equal(errorMessage(new AggregateError([], 'empty')), 'empty (0 errors): ');
});

test('aggregate summaries tolerate non-Error children and unreadable aggregate accessors', () => {
  const message = errorMessage(new AggregateError([null, undefined, 'text', Object.create(null)], 'mixed'));
  assert.equal(message, 'mixed (4 errors): 1: null; 2: undefined; 3: text; 4: [unprintable error]');
  const aggregate = new AggregateError([], 'broken'); let reads = 0;
  Object.defineProperty(aggregate, 'errors', { get() { reads++; throw null; } });
  assert.match(errorMessage(aggregate), /unreadable aggregate errors/); assert.equal(reads, 0);
  const array = [];
  Object.defineProperty(array, '0', { get() { reads++; throw null; } });
  const item = new AggregateError([], 'bad item'); item.errors = array;
  assert.match(errorMessage(item), /unreadable error item/); assert.equal(reads, 0);
});

test('aggregate traversal and text remain bounded for cycles, depth, width and long messages', () => {
  const cycle = new AggregateError([], 'cycle'); cycle.errors.push(cycle);
  assert.match(errorMessage(cycle), /circular aggregate/);
  let deep = new Error('unreachable');
  for (let i = 0; i < 100; i++) deep = new AggregateError([deep], 'nested');
  assert.match(errorMessage(deep), /aggregate depth limit/);
  const wide = new AggregateError(Array.from({ length: 1000 }, (_, i) => new Error(`child${i}`)), 'wide');
  assert.match(errorMessage(wide), /992 more errors omitted/); assert.doesNotMatch(errorMessage(wide), /child8/);
  const long = new AggregateError(Array.from({ length: 8 }, () => Error('x'.repeat(10000))), 'y'.repeat(10000));
  assert(errorMessage(long).length <= 2048);
  const bad = new AggregateError([new Error('usable child')], 'header');
  Object.defineProperty(bad, 'message', { get() { throw null; } });
  assert.match(errorMessage(bad), /unprintable error.*usable child/);
});

test('aggregate fragments are redacted separately before truncated quotes can cross child boundaries', () => {
  const error = new AggregateError([new Error('token="' + 'sensitive-one-'.repeat(100)),
    new Error('password="sensitive-two"'), new Error('Authorization: Bearer sensitive-three'),
    new Error('https://user:sensitive-four@example.com/path')], 'cleanup');
  const message = errorMessage(error);
  assert.doesNotMatch(message, /sensitive-one|sensitive-two|sensitive-three|sensitive-four/);
  assert.match(message, /redacted/); assert(message.length <= 2048);
});

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

test('path redaction preserves numeric progress and URL error context without exposing URL components', () => {
  assert.equal(errorMessage('loaded 3/4 textures, then WebGL lost'), 'loaded 3/4 textures, then WebGL lost');
  assert.equal(errorMessage('fetch https://u:p@host/a/b failed code=7'), 'fetch [url] failed code=7');
  for (const input of [
    'https://private.example/user/alice?access_token=secret#private failed code=7',
    'HTTP://private.example/private failed code=7'
  ]) {
    const output = errorMessage(input);
    assert.equal(output, '[url] failed code=7');
    assert.equal(errorMessage(output), output);
  }
  // Do not adopt whitespace-delimited path matching: spaces can be private names.
  for (const input of ['C:/Users/Alice Smith/private.txt failed',
    '/home/Alice Smith/private.txt failed', 'file:///home/Alice Smith/private.txt failed',
    '/home/alice/3/4/private.txt failed', '3/4/private.txt failed']) {
    const output = errorMessage(input);
    assert.doesNotMatch(output, /Alice|Smith|alice|private/);
    assert.equal(errorMessage(output), output);
  }
});

test('repeated aggregate sanitization preserves separators and never trusts a redaction prefix', () => {
  const input = new AggregateError([Error('token="sensitive-one"'),
    Error('password="sensitive-two"'), Error('fetch https://u:p@host/a failed code=7'),
    Error('loaded 3/4 textures, then WebGL lost')], 'cleanup');
  const first = errorMessage(input);
  assert.match(first, /token=\[redacted\]; 2: password=\[redacted\]; 3:/);
  assert.doesNotMatch(first, /sensitive|host|u:p/);
  const journal = createErrorJournal(); journal.record('cleanup-lifecycle', first);
  assert.equal(journal.messages()[0], first);
  assert.equal(errorMessage(errorMessage(first)), first);
  for (const value of ['token=[redacted]sensitive', 'token=[redacted]/sensitive', 'token=[redacted];sensitive', 'token=[redacted],sensitive',
    'Authorization: Bearer [redacted]sensitive', 'Bearer [redacted]sensitive']) {
    const output = errorMessage(value);
    assert.doesNotMatch(output, /sensitive/);
    assert.equal(errorMessage(output), output);
  }
});
