'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const { MAX_PROPOSALS } = require('../src/core/breakdown-proposal');

test('negative integer capacity rejects during construction before any instance assignments', () => {
  const assignments = [];
  class ObservedStore extends ProposalStore {
    set max(value) { assignments.push(value); }
  }
  for (const max of [-1, -2, -Number.MAX_SAFE_INTEGER, -1e100]) {
    assert.throws(() => new ObservedStore({ max, get ttlMs() { throw new Error('must reject before later options'); } }),
      { name: 'RangeError', message: 'max must be a non-negative integer' });
  }
  assert.deepEqual(assignments, []);
});

test('zero and nonnegative integer capacity retain the exact value', () => {
  for (const max of [0, -0, 1, 5, Number.MAX_SAFE_INTEGER, 1e100]) {
    const store = new ProposalStore({ max, now: () => 0, idFactory: () => 'id' });
    assert.equal(Object.is(store.max, max), true);
    assert.equal(store.size, 0);
  }
});

test('noninteger or absent capacity retains the existing default without coercion', () => {
  for (const max of [undefined, null, true, false, '', '0', '-1', 1.5, -1.5, NaN, Infinity, -Infinity, {}]) {
    const store = new ProposalStore({ max, now: () => 0, idFactory: () => 'id' });
    assert.equal(store.max, MAX_PROPOSALS);
    assert.equal(store.size, 0);
  }
});

test('existing capacity option read count and order stay unchanged', () => {
  for (const value of [undefined, '2', 2]) {
    const reads = [];
    new ProposalStore({ get max() { reads.push('max'); return value; },
      get ttlMs() { reads.push('ttlMs'); return undefined; }, now: () => 0, idFactory: () => 'id' });
    assert.deepEqual(reads, Number.isInteger(value) ? ['max', 'max', 'ttlMs'] : ['max', 'ttlMs']);
  }
});
