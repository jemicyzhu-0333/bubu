'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmMemory, CONFIRMABLE_KINDS, RESERVED_PAIRS } = require('../src/capabilities/guidance/domain/memory-confirmation');
const { MEMORY_KINDS, memoryUniqueKey } = require('../src/platform/persistence/sqlite/memory-rules');

test('a confirmation becomes a user-confirmed entry with source/confidence/expiry the domain sets', () => {
  const result = confirmMemory({ kind: 'preference', subject: '安静的下午', body: '下午两点后不排会议。' }, { now: 1000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry, {
    kind: 'preference',
    subject: '安静的下午',
    body: '下午两点后不排会议。',
    source: 'user-confirmed',
    confidence: 1,
    expiresAt: null
  });
});

test('source, confidence and expiry are never taken from the payload (ARCHITECTURE「事实流与长期记忆」)', () => {
  // A caller cannot launder model output in as a user fact by setting the source:
  // confirmMemory reads only kind/subject/body, so these extras are ignored.
  const result = confirmMemory({
    kind: 'context',
    subject: '孩子的作息',
    body: '晚上八点后要陪睡。',
    source: 'aggregated',
    confidence: 0.3,
    expiresAt: 5
  }, { now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.entry.source, 'user-confirmed');
  assert.equal(result.entry.confidence, 1);
  assert.equal(result.entry.expiresAt, null);
});

test('the body is collapsed and both fields are bounded', () => {
  const result = confirmMemory({ kind: 'rhythm', subject: '  早起  ', body: 'a\n\n  b   c' }, { now: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.entry.subject, '早起');
  assert.equal(result.entry.body, 'a b c');
});

test('the three aggregated-owned subjects are refused so a daily reset cannot overwrite them', () => {
  for (const pair of RESERVED_PAIRS) {
    const result = confirmMemory({ kind: pair.kind, subject: pair.subject, body: '手写的内容' }, { now: 0 });
    assert.equal(result.ok, false, `${pair.kind}::${pair.subject} must be refused`);
  }
});

test('the reserved-subject refusal survives casing and whitespace variants', () => {
  const result = confirmMemory({ kind: 'rhythm', subject: '  连续投入的天数 ', body: 'x' }, { now: 0 });
  assert.equal(result.ok, false);
  // A different kind on the same text is fine — the reservation is per kind+subject.
  assert.equal(confirmMemory({ kind: 'context', subject: '连续投入的天数', body: 'x' }, { now: 0 }).ok, true);
});

test('off-shape input is refused with a reason, not thrown', () => {
  assert.equal(confirmMemory(null, { now: 0 }).ok, false);
  assert.equal(confirmMemory({ kind: 'nope', subject: 's', body: 'b' }, { now: 0 }).ok, false);
  assert.equal(confirmMemory({ kind: 'preference', subject: '   ', body: 'b' }, { now: 0 }).ok, false);
  assert.equal(confirmMemory({ kind: 'preference', subject: 's', body: '   ' }, { now: 0 }).ok, false);
});

test('the confirmable kinds stay in lockstep with the persistence enum', () => {
  // memory-confirmation owns its own copy because capabilities may not import from
  // platform; this pin fails loudly if the two lists ever drift.
  assert.deepEqual([...CONFIRMABLE_KINDS].sort(), [...MEMORY_KINDS].sort());
});

test('a confirmed entry upserts onto the same unique key the store computes', () => {
  const result = confirmMemory({ kind: 'preference', subject: 'Quiet Afternoons', body: 'x' }, { now: 0 });
  assert.equal(result.ok, true);
  // The store keys on kind + normalized subject; the domain must produce a subject
  // that lands on exactly one key (re-confirming replaces, never accretes).
  assert.equal(
    memoryUniqueKey(result.entry.kind, result.entry.subject),
    memoryUniqueKey('preference', 'Quiet Afternoons')
  );
});
