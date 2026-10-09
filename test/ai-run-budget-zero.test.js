'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLLABORATION_BUDGET, normalizeRunBudget, createTurnBudget,
  buildBoundedContext, serializedBytes, unicodeLength } = require('../src/application/ai/run-budget');

const DEFAULTS = Object.freeze({
  maxMessageChars: 8000, maxSegmentTurns: 100, maxSegmentBytes: 512 * 1024,
  maxContextBytes: 64 * 1024, maxOutputChars: 8000, maxReadCalls: 6,
  maxProviderCalls: 5, maxRepairAttempts: 1, deadlineMs: 180000,
  softTurnNotice: 30, maxPendingChangeSets: 1
});
const zeroFields = new Set(['maxReadCalls', 'maxRepairAttempts']);
const limitError = { name: 'RangeError', message: 'run-budget-limit-invalid' };

test('only read and repair limits accept positive and negative zero', () => {
  for (const key of Object.keys(DEFAULTS)) {
    for (const zero of [0, -0]) {
      if (zeroFields.has(key)) {
        const input = Object.freeze({ [key]: zero });
        const result = normalizeRunBudget(input);
        assert.ok(Object.is(result[key], zero), key);
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.is(input[key], zero));
      } else assert.throws(() => normalizeRunBudget({ [key]: zero }), limitError, key);
    }
  }
  assert.deepEqual(normalizeRunBudget({ maxReadCalls: 0, maxRepairAttempts: 0 }),
    { ...DEFAULTS, maxReadCalls: 0, maxRepairAttempts: 0 });
});

test('every field retains integral bounds and rejects nonnumeric limits', () => {
  for (const [key, maximum] of Object.entries(DEFAULTS)) {
    for (const value of [-1, -0.5, 0.5, 1.5, NaN, Infinity, -Infinity,
      maximum + 1, Number.MAX_SAFE_INTEGER + 1, undefined, null, '1', true]) {
      assert.throws(() => normalizeRunBudget({ [key]: value }), limitError, key);
    }
    assert.equal(normalizeRunBudget({ [key]: 1 })[key], 1);
    assert.equal(normalizeRunBudget({ [key]: maximum })[key], maximum);
  }
});

test('defaults, storage-related constants and normalization shape remain immutable', () => {
  assert.deepEqual(COLLABORATION_BUDGET, DEFAULTS);
  assert.deepEqual(normalizeRunBudget(), DEFAULTS);
  assert.ok(Object.isFrozen(COLLABORATION_BUDGET));
  const normalized = normalizeRunBudget(Object.freeze({}));
  assert.ok(Object.isFrozen(normalized));
  assert.notEqual(normalized, COLLABORATION_BUDGET);
  assert.deepEqual(Object.keys(normalized), Object.keys(DEFAULTS));
  assert.throws(() => { normalized.maxReadCalls = 0; }, TypeError);
  for (const value of [null, false, 1, 'limits', []]) {
    assert.throws(() => normalizeRunBudget(value), { name: 'TypeError', message: 'run-budget-invalid' });
  }
  assert.throws(() => normalizeRunBudget({ maxReadCalls: 0, unknown: 1 }),
    { name: 'TypeError', message: 'run-budget-field-invalid' });
});

test('existing getter and property handling is preserved', () => {
  let accesses = 0;
  const input = Object.create({ maxProviderCalls: 1, inheritedUnknown: true });
  Object.defineProperty(input, 'maxReadCalls', { enumerable: true, get() { accesses += 1; return 0; } });
  Object.defineProperty(input, 'hiddenUnknown', { value: true });
  const marker = Symbol('existing spread semantics');
  input[marker] = 'kept';
  const result = normalizeRunBudget(input);
  assert.equal(accesses, 1);
  assert.equal(result.maxProviderCalls, DEFAULTS.maxProviderCalls);
  assert.equal(result.maxReadCalls, 0);
  assert.equal(result[marker], 'kept');
  assert.equal(Object.hasOwn(result, 'hiddenUnknown'), false);
  const failure = new Error('getter-failure');
  assert.throws(() => normalizeRunBudget({ get maxReadCalls() { throw failure; } }), error => error === failure);
});

test('zero reads deny repeatedly without increments or consuming provider allowance', () => {
  for (const zero of [0, -0]) {
    const budget = createTurnBudget({ now: () => 10,
      limits: { maxReadCalls: zero, maxRepairAttempts: zero, maxProviderCalls: 1 } });
    assert.ok(Object.isFrozen(budget));
    assert.ok(Object.isFrozen(budget.limits));
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(budget.consume('read'), { ok: false, reason: 'read-budget' });
    }
    assert.deepEqual(budget.usage(), { reads: 0, providerCalls: 0, elapsedMs: 0, tokens: null });
    assert.deepEqual(budget.consume('provider'), { ok: true });
    assert.deepEqual(budget.consume('provider'), { ok: false, reason: 'provider-budget' });
    assert.deepEqual(budget.consume('repair'), { ok: false, reason: 'budget-kind-invalid' });
    assert.deepEqual(budget.usage(), { reads: 0, providerCalls: 1, elapsedMs: 0, tokens: null });
    assert.ok(Object.isFrozen(budget.usage()));
  }
});

test('deadline wins over zero reads, exhausted providers and unknown kinds', () => {
  let at = 100;
  const budget = createTurnBudget({ now: () => at,
    limits: { maxReadCalls: 0, maxRepairAttempts: 0, maxProviderCalls: 1, deadlineMs: 10 } });
  assert.deepEqual(budget.consume('provider'), { ok: true });
  at = 109;
  assert.deepEqual(budget.check(), { ok: true });
  assert.equal(budget.remainingMs(), 1);
  assert.deepEqual(budget.consume('read'), { ok: false, reason: 'read-budget' });
  for (const invalidTime of [110, 111, 99, NaN, Infinity, -Infinity]) {
    at = invalidTime;
    assert.deepEqual(budget.check(), { ok: false, reason: 'turn-deadline' });
    for (const kind of ['read', 'provider', 'repair', 'unknown']) {
      assert.deepEqual(budget.consume(kind), { ok: false, reason: 'turn-deadline' });
    }
    assert.equal(budget.usage().reads, 0);
    assert.equal(budget.usage().providerCalls, 1);
  }
  at = 111;
  assert.equal(budget.remainingMs(), 0);
});

test('positive counters, elapsed time and required clock errors remain unchanged', () => {
  let at = 20;
  const budget = createTurnBudget({ now: () => at, limits: { maxReadCalls: 1, maxRepairAttempts: 0 } });
  assert.deepEqual(budget.consume('read'), { ok: true });
  assert.deepEqual(budget.consume('read'), { ok: false, reason: 'read-budget' });
  at = 25;
  assert.deepEqual(budget.usage(), { reads: 1, providerCalls: 0, elapsedMs: 5, tokens: null });
  assert.equal(budget.remainingMs(), DEFAULTS.deadlineMs - 5);
  assert.throws(() => createTurnBudget(), { name: 'TypeError', message: 'run-budget-clock-required' });
  for (const value of [NaN, Infinity, -Infinity, '0']) {
    assert.throws(() => createTurnBudget({ now: () => value }),
      { name: 'TypeError', message: 'run-budget-clock-invalid' });
  }
});

test('zero optional limits preserve exact UTF-8 context boundary and newest message', () => {
  const latest = Object.freeze({ id: 'latest', content: '中🙂' });
  const messages = Object.freeze([Object.freeze({ id: 'old', content: 'earlier' }), latest]);
  const envelope = { summary: null, messages: [latest], data: [] };
  const bytes = serializedBytes(envelope);
  const limits = { maxReadCalls: 0, maxRepairAttempts: 0, maxContextBytes: bytes };
  const result = buildBoundedContext({ messages, limits });
  assert.equal(result.ok, true);
  assert.deepEqual(result.context, envelope);
  assert.equal(result.context.messages[0], latest);
  assert.equal(result.bytes, bytes);
  assert.equal(result.tokens, null);
  assert.ok(Object.isFrozen(result.context));
  assert.ok(Object.isFrozen(result.coverage));
  assert.deepEqual(result.coverage, { included: 1, total: 2, omitted: 1, throughMessageId: null });
  assert.deepEqual(buildBoundedContext({ messages, limits: { ...limits, maxContextBytes: bytes - 1 } }),
    { ok: false, reason: 'context-budget', latestPreserved: true });
  assert.equal(messages.length, 2);
  assert.equal(unicodeLength(latest.content), 2);
});

test('context filtering, summary and data budgets are unchanged with zero limits', () => {
  const limits = { maxReadCalls: 0, maxRepairAttempts: 0 };
  const summary = { throughMessageId: 'prior', text: 'bounded summary' };
  const messages = [{ id: 'hidden', content: 'excluded', contextAllowed: false }, { id: 'latest', content: 'ok' }];
  const data = [{ value: 'selected' }];
  const inputCopy = structuredClone({ messages, summary, data });
  const result = buildBoundedContext({ messages, summary, data, limits });
  assert.equal(result.ok, true);
  assert.deepEqual(result.context, { summary, messages: [messages[1]], data });
  assert.equal(result.coverage.throughMessageId, 'prior');
  assert.deepEqual({ messages, summary, data }, inputCopy);
  assert.deepEqual(buildBoundedContext({ messages: [], data: [{ content: 'x'.repeat(65536) }], limits }),
    { ok: false, reason: 'context-budget', latestPreserved: true });
  assert.throws(() => buildBoundedContext({ messages: null, limits }),
    { name: 'TypeError', message: 'context-invalid' });
  assert.throws(() => buildBoundedContext({ messages: [], data: null, limits }),
    { name: 'TypeError', message: 'context-invalid' });
});
