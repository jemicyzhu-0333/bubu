'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const { MAX_PROPOSALS, PROPOSAL_TTL_MS, buildDeterministicProposal } = require('../src/core/breakdown-proposal');
const { validateEnrichProposal, buildDeterministicEnrich } = require('../src/core/enrich-proposal');

const proposal = () => buildDeterministicProposal(['打开文件', '写内容', '保存文件']);
const harness = options => {
  let now = 1000;
  let sequence = 0;
  const store = new ProposalStore({ now: () => now, idFactory: () => `id-${++sequence}`, ...options });
  return { store, at: value => { now = value; } };
};

test('store defaults and public methods keep existing shapes', () => {
  const { store } = harness();
  assert.equal(store.max, MAX_PROPOSALS);
  assert.equal(store.ttlMs, PROPOSAL_TTL_MS);
  assert.deepEqual(Object.getOwnPropertyNames(ProposalStore.prototype), ['constructor', 'prune', 'put', 'get', 'consume', 'size']);
  const entry = store.put(proposal());
  assert.deepEqual(Object.keys(entry), ['id', 'createdAt', 'expiresAt', 'proposal', 'context']);
  assert.equal(entry.createdAt, 1000);
  assert.equal(entry.expiresAt, 1000 + PROPOSAL_TTL_MS);
  assert.equal(store.get(entry.id), entry);
});

test('expiry removes at the exact deadline and never reappears after clock rollback', () => {
  const { store, at } = harness({ ttlMs: 100 });
  const entry = store.put(proposal());
  at(1099); assert.equal(store.get(entry.id), entry);
  at(1100); assert.equal(store.get(entry.id), null);
  at(1101); assert.equal(store.size, 0);
  at(1000); assert.equal(store.get(entry.id), null);
});

test('capacity uses insertion order and repeated ids keep their original slot', () => {
  const ids = ['a', 'b', 'a', 'c'];
  const { store } = harness({ max: 2, idFactory: () => ids.shift() });
  const a = store.put(proposal());
  const b = store.put(proposal());
  const replacement = store.put(proposal());
  assert.notEqual(a, replacement);
  assert.equal(store.get('a'), replacement);
  store.put(proposal());
  assert.equal(store.get('a'), null);
  assert.equal(store.get('b'), b);
  assert.equal(store.size, 2);
});

test('consume returns the stored identity once and missing ids stay null', () => {
  const { store } = harness();
  const entry = store.put(proposal());
  assert.equal(store.consume(entry.id), entry);
  assert.equal(store.consume(entry.id), null);
  assert.equal(store.get('missing'), null);
  assert.equal(store.size, 0);
});

test('context normalization freezes only its existing closed record and tags', () => {
  const { store } = harness();
  const source = { kind: 'enrich', title: ' t ', description: 'x'.repeat(1001), taskId: 'i'.repeat(101), allowedTags: [' b ', 'a', 'b', null, 'x'.repeat(21)], extra: true };
  const entry = store.put(proposal(), source);
  assert.deepEqual(entry.context, { kind: 'enrich', title: 't', description: 'x'.repeat(1000), taskId: 'i'.repeat(100), allowedTags: ['b', 'a', 'x'.repeat(20)] });
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.context), true);
  assert.equal(Object.isFrozen(entry.context.allowedTags), true);
  assert.equal(Object.isFrozen(entry.proposal), true);
  assert.equal(Object.isFrozen(entry.proposal.steps), false);
  assert.equal(source.title, ' t ');
  assert.equal(store.put(proposal(), { kind: 'unknown' }).context.kind, 'breakdown');
});

test('custom enrich validation sees normalized context before insertion', () => {
  let calls = 0;
  const { store } = harness({ validate(value, context) {
    calls++;
    assert.equal(Object.isFrozen(context), true);
    assert.deepEqual(context.allowedTags, ['work']);
    return validateEnrichProposal(value, { allowedTags: context.allowedTags });
  } });
  const value = { ...buildDeterministicEnrich({}), tags: ['work'] };
  const entry = store.put(value, { kind: 'enrich', allowedTags: [' work ', 'work'] });
  assert.equal(calls, 1);
  assert.equal(entry.context.kind, 'enrich');
  assert.deepEqual(entry.proposal.tags, ['work']);
});

test('put preserves clock id validation order and failed validation consumes no slot', () => {
  const calls = [];
  let fail = false;
  const { store } = harness({ now: () => { calls.push('now'); return 1000; },
    idFactory: () => { calls.push('id'); return 'same'; }, validate(value) {
      calls.push('validate'); if (fail) throw new Error('synthetic validation failure'); return value;
    } });
  const original = store.put(proposal());
  assert.deepEqual(calls, ['now', 'id', 'validate']);
  calls.length = 0; fail = true;
  assert.throws(() => store.put(proposal()), /synthetic validation failure/);
  assert.deepEqual(calls, ['now', 'id', 'validate']);
  assert.equal(store.get('same'), original);
});

test('expiry pruning happens before an id factory failure', () => {
  let fail = false;
  const { store, at } = harness({ ttlMs: 100, idFactory: () => { if (fail) throw new Error('synthetic id failure'); return 'a'; } });
  store.put(proposal());
  at(1100); fail = true;
  assert.throws(() => store.put(proposal()), /synthetic id failure/);
  assert.equal(store.size, 0);
});

test('zero capacity and nonpositive TTL still return an immediately evicted entry', () => {
  for (const options of [{ max: 0 }, { ttlMs: 0 }, { ttlMs: -1 }]) {
    const { store } = harness(options);
    const entry = store.put(proposal());
    assert.equal(entry.id, 'id-1');
    assert.equal(store.get(entry.id), null);
    assert.equal(store.size, 0);
  }
});

test('empty and undefined id factory results retain current map-key behavior', () => {
  for (const id of ['', undefined]) {
    const { store } = harness({ idFactory: () => id });
    const first = store.put(proposal());
    const second = store.put(proposal());
    assert.equal(first.id, id);
    assert.equal(store.size, 1);
    assert.equal(store.get(id), second);
    assert.equal(store.consume(id), second);
    assert.equal(store.consume(id), null);
  }
});
