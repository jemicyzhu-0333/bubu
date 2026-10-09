'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryEligible, qualifyMemorySelection, discoverMemory, recallSelectedMemory } = require('../src/core/memory-recall');
const { createMemoryRecall } = require('../src/application/ai/memory-recall');
const at = 1000;
const item = (id, extra = {}) => ({ id, version: 1, status: 'active', kind: 'preference', subject: '早上 A.*',
  body: '先做一点 🙂', source: 'user-confirmed', scope: 'work', validFrom: 0, expiresAt: null,
  contextAllowed: true, updatedAt: 0, ...extra });
const authority = { ownerId: 'owner', ledgerId: 'ledger', sequence: 0 };

test('selection is all-or-nothing for zero, eight, nine, duplicates and missing records', () => {
  const records = Array.from({ length: 8 }, (_, n) => item(`m${n}`));
  assert.deepEqual(qualifyMemorySelection([], [], at), { ok: true, items: [] });
  assert.equal(qualifyMemorySelection(records, records.map(value => value.id), at).items.length, 8);
  assert.equal(qualifyMemorySelection(records, [...records.map(value => value.id), 'ninth'], at).reason, 'memory-selection-budget');
  assert.equal(qualifyMemorySelection(records, ['m0', 'm0'], at).reason, 'memory-selection-budget');
  assert.equal(qualifyMemorySelection([], new Array(1), at).reason, 'memory-selection-budget');
  assert.equal(qualifyMemorySelection(records.slice(1), records.map(value => value.id), at).reason, 'memory-context-invalid');
});

test('qualification preserves exact active, time, source and null aggregate expiry rules', () => {
  for (const extra of [{ status: 'paused' }, { status: 'candidate' }, { status: 'removed' }, { contextAllowed: false },
    { version: 0 }, { version: 1.5 }, { validFrom: at + 1 }, { expiresAt: at }, { source: 'aggregated', expiresAt: null }]) {
    const record = item('m', extra);
    assert.equal(memoryEligible(record, at), false);
    assert.equal(qualifyMemorySelection([record], ['m'], at).reason, 'memory-context-invalid');
  }
  assert.equal(memoryEligible(item('m', { source: 'aggregated', expiresAt: at + 1 }), at), true);
  const records = [item('work'), item('personal', { scope: 'personal' })];
  assert.deepEqual(qualifyMemorySelection(records, ['work', 'personal'], at).items.map(value => value.id), ['personal', 'work']);
});

test('the full selected body budget counts Unicode code points before query or paging', () => {
  const records = [item('a', { body: '🙂'.repeat(500) }), item('b', { body: '中'.repeat(500) }), item('c', { body: 'x'.repeat(200) })];
  assert.equal(qualifyMemorySelection(records, ['a', 'b', 'c'], at).ok, true);
  records[2].body += 'x';
  assert.equal(qualifyMemorySelection(records, ['a', 'b', 'c'], at).reason, 'memory-context-budget');
  const recall = createMemoryRecall({ contextReader: {
    readContextSnapshot: () => ({ ok: true, items: records, sampledAt: at, authority })
  } });
  assert.equal(recall.selected(['a', 'b', 'c']).reason, 'memory-context-budget');
});

test('discovery joins fields while Provider uses separate literal locale-lowercase fields', () => {
  const records = [item('b', { subject: 'HELLO', body: 'World' }), item('a')];
  assert.deepEqual(discoverMemory(records, { query: 'hello world' }, at).items.map(value => value.id), ['b']);
  assert.deepEqual(recallSelectedMemory(records, { query: 'hello world' }).items, []);
  for (const query of ['早上', 'A.*', '🙂']) {
    assert.deepEqual(discoverMemory(records, { query }, at).items.map(value => value.id), ['a']);
    assert.deepEqual(recallSelectedMemory(records, { query }).items.map(value => value.id), ['a']);
  }
  assert.deepEqual(recallSelectedMemory(records, { query: '^早上' }).items, []);
  assert.deepEqual(recallSelectedMemory(records, {}).items.map(value => value.id), ['a', 'b']);
});

test('both policies retain 200 code point queries and bounded offset cursors', () => {
  const records = [item('a', { body: '🙂'.repeat(200) })];
  for (const recall of [args => discoverMemory(records, args, at), args => recallSelectedMemory(records, args)]) {
    assert.equal(recall({ query: '🙂'.repeat(200) }).items.length, 1);
    assert.equal(recall({ query: '🙂'.repeat(201) }).reason, 'tool-query-invalid');
    assert.equal(recall({ cursor: 'offset:1000001' }).reason, 'tool-cursor-invalid');
    assert.deepEqual(recall({ cursor: 'offset:1000000' }).items, []);
  }
  assert.equal(recallSelectedMemory(records, { limit: 9 }).reason, 'tool-limit-invalid');
});

test('discovery keeps 20-item ID-ordered pages and neither pure policy mutates inputs', () => {
  const records = Array.from({ length: 41 }, (_, n) => item(`m${String(40 - n).padStart(2, '0')}`));
  const before = structuredClone(records);
  const first = discoverMemory(records, {}, at);
  assert.equal(first.items.length, 20);
  assert.equal(first.nextCursor, 'offset:20');
  const second = discoverMemory(records, { cursor: first.nextCursor }, at);
  assert.equal(second.items[0].id, 'm20');
  assert.equal(second.nextCursor, 'offset:40');
  assert.equal(discoverMemory(records, { cursor: second.nextCursor }, at).nextCursor, null);
  const selected = qualifyMemorySelection(records.slice(0, 8), records.slice(0, 8).map(value => value.id), at);
  const provider = recallSelectedMemory(selected.items, { limit: 1 });
  first.items[0].body = 'changed'; provider.items[0].body = 'changed'; selected.items[0].body = 'changed';
  assert.deepEqual(records, before);
});

test('a 500-record synthetic discovery corpus pages completely without enlarging Provider selection', () => {
  const records = Array.from({ length: 500 }, (_, n) => item(`m${String(n).padStart(3, '0')}`));
  let cursor = null;
  const ids = [];
  do {
    const page = discoverMemory(records, { cursor }, at);
    assert.equal(page.items.length, 20);
    ids.push(...page.items.map(record => record.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.deepEqual(ids, records.map(record => record.id));
  const selected = qualifyMemorySelection(records.slice(0, 8), ids.slice(0, 8), at);
  assert.equal(recallSelectedMemory(selected.items).items.length, 8);
});

test('facade holds only M1, uses its sampled time and returns closed detached projections', () => {
  const calls = [], record = item('m', { sourceRefs: ['PRIVATE'], useCount: 9 });
  const contextReader = {
    readContextSnapshot(request) {
      assert.equal(this, contextReader); calls.push(request);
      return { ok: true, items: [record], sampledAt: at, authority };
    },
    readContextForgettingState() {
      assert.equal(this, contextReader);
      return { ok: true, ...authority, memoryIds: ['forgotten'], sourceRefs: [{ kind: 'message', id: 'old', revision: null }] };
    }
  };
  const recall = createMemoryRecall({ contextReader });
  assert.deepEqual(Object.keys(recall).sort(), ['discovery', 'forgettingState', 'getVersion', 'selected']);
  assert.deepEqual(recall.selected([]), { ok: true, items: [], sampledAt: null, authority: null });
  assert.equal(calls.length, 0);
  const result = recall.selected(['m']);
  assert.equal(result.sampledAt, at);
  assert.equal(Object.hasOwn(result.items[0], 'sourceRefs'), false);
  assert.equal(Object.hasOwn(result.items[0], 'useCount'), false);
  result.items[0].body = 'changed'; result.authority.sequence = 9;
  assert.notEqual(record.body, 'changed'); assert.equal(authority.sequence, 0);
  assert.deepEqual(recall.getVersion({ id: 'm' }), { ok: true, id: 'm', version: 1, contextAllowed: true });
  recall.discovery();
  assert.deepEqual(calls.at(-1), { ids: null });
  const state = recall.forgettingState(); state.sourceRefs[0].id = 'mutated';
  assert.equal(recall.forgettingState().sourceRefs[0].id, 'old');
});

test('facade source property and receiver-bound call each pass through the owner guard', () => {
  const events = [];
  const contextReader = { get readContextSnapshot() {
    events.push('property');
    return function(request) {
      assert.equal(this, contextReader); assert.deepEqual(request, { ids: ['m'] }); events.push('call');
      return { ok: true, items: [item('m')], sampledAt: at, authority };
    };
  } };
  const guard = operation => { events.push('before'); try { return operation(); } finally { events.push('after'); } };
  assert.equal(createMemoryRecall({ contextReader }).selected(['m'], guard).ok, true);
  assert.deepEqual(events, ['before', 'property', 'after', 'before', 'call', 'after']);
});

test('unknown or failed M1 authority never becomes an available empty selection', () => {
  for (const reason of ['memory-commit-outcome-unknown', 'forgetting-ledger-unavailable', 'memory-forgetting-cleanup-pending']) {
    const recall = createMemoryRecall({ contextReader: {
      readContextSnapshot: () => ({ ok: false, availability: 'unavailable', reason }),
      readContextForgettingState: () => ({ ok: false, availability: 'unavailable', reason })
    } });
    for (const result of [recall.selected(['m']), recall.discovery(), recall.getVersion({ id: 'm' }), recall.forgettingState()]) {
      assert.deepEqual(result, { ok: false, reason: 'memory-authority-unavailable' });
      assert.equal(Object.hasOwn(result, 'items'), false);
    }
  }
});

test('a callback cannot replace the original selected IDs or turn a selected read into discovery', () => {
  const ids = ['selected'];
  const recall = createMemoryRecall({ contextReader: { readContextSnapshot(request) {
    ids[0] = 'private'; request.ids[0] = 'private';
    return { ok: true, items: [item('private')], sampledAt: at, authority };
  } } });
  assert.equal(recall.selected(ids).reason, 'memory-context-invalid');
});
