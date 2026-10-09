'use strict';

// Pure closure: budget, execution and turn guard. All acquired resources use
// synthetic ports; allowance consumption does not establish actual transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnBudget } = require('../src/application/ai/run-budget');
const { createRunExecution } = require('../src/application/ai/run-execution');

function fixture() {
  let at = 100;
  let clockFailure = null;
  let freshnessFailure = null;
  let aborted = false;
  const trace = [];
  const listeners = new Set();
  const timers = new Map();
  const execution = createRunExecution({
    now() {
      trace.push('clock');
      if (clockFailure) throw clockFailure;
      return at;
    },
    limits: { maxReadCalls: 1, maxProviderCalls: 1, deadlineMs: 10 },
    signal: {
      get aborted() { trace.push('signal'); return aborted; },
      addEventListener(type, callback) {
        assert.equal(type, 'abort');
        trace.push('listen');
        listeners.add(callback);
      },
      removeEventListener(type, callback) {
        assert.equal(type, 'abort');
        trace.push('unlisten');
        listeners.delete(callback);
      }
    },
    schedule(callback, ms) {
      trace.push('schedule');
      assert.equal(ms, 10);
      timers.set(0, callback);
      return 0;
    },
    cancelSchedule(handle) {
      trace.push('cancel');
      assert.equal(handle, 0);
      timers.delete(handle);
    },
    assertCurrent() {
      trace.push('freshness');
      if (freshnessFailure) throw freshnessFailure;
    }
  });
  return { execution, trace, listeners, timers,
    setTime(value) { at = value; },
    failClock(error) { clockFailure = error; },
    failFreshness(error) { freshnessFailure = error; },
    abort() {
      aborted = true;
      for (const callback of [...listeners]) callback();
    },
    expire() { for (const callback of [...timers.values()]) callback(); } };
}

function assertQuietCounts(subject, trace, expected) {
  const before = [...trace];
  const first = subject.counts();
  assert.deepEqual(first, expected);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => { first.reads = 999; }, TypeError);
  assert.throws(() => { first.providerCalls = 999; }, TypeError);
  const second = subject.counts();
  assert.notEqual(first, second);
  assert.deepEqual(second, expected);
  assert.deepEqual(trace, before);
  return first;
}

test('budget counts are independent frozen snapshots of the existing allowances', () => {
  const trace = [];
  const budget = createTurnBudget({ now() { trace.push('clock'); return 100; },
    limits: { maxReadCalls: 1, maxProviderCalls: 1 } });
  const initial = assertQuietCounts(budget, trace, { reads: 0, providerCalls: 0 });
  assert.deepEqual(budget.consume('read'), { ok: true });
  const afterRead = assertQuietCounts(budget, trace, { reads: 1, providerCalls: 0 });
  assert.deepEqual(budget.consume('provider'), { ok: true });
  assert.deepEqual(budget.consume('read'), { ok: false, reason: 'read-budget' });
  assert.deepEqual(budget.consume('provider'), { ok: false, reason: 'provider-budget' });
  assert.deepEqual(budget.consume('unknown'), { ok: false, reason: 'budget-kind-invalid' });
  assertQuietCounts(budget, trace, { reads: 1, providerCalls: 1 });
  assert.deepEqual(initial, { reads: 0, providerCalls: 0 });
  assert.deepEqual(afterRead, { reads: 1, providerCalls: 0 });
  assert.deepEqual(budget.usage(), { reads: 1, providerCalls: 1, elapsedMs: 0, tokens: null });
});

test('counts never sample time while existing clock failures and deadline rules remain visible', () => {
  let at = 100;
  let failure = null;
  const trace = [];
  const budget = createTurnBudget({ now() {
    trace.push('clock');
    if (failure) throw failure;
    return at;
  }, limits: { maxReadCalls: 0, deadlineMs: 10 } });
  assert.deepEqual(budget.consume('read'), { ok: false, reason: 'read-budget' });
  assert.deepEqual(budget.consume('provider'), { ok: true });
  for (const value of [99, 110, NaN, Infinity, -Infinity]) {
    at = value;
    assert.deepEqual(budget.consume('provider'), { ok: false, reason: 'turn-deadline' });
    assertQuietCounts(budget, trace, { reads: 0, providerCalls: 1 });
  }
  failure = new Error('synthetic-clock-failure');
  assertQuietCounts(budget, trace, { reads: 0, providerCalls: 1 });
  for (const operation of [budget.usage, budget.check, budget.remainingMs, () => budget.consume('read')]) {
    const before = trace.length;
    assert.throws(operation, error => error === failure);
    assert.equal(trace.length, before + 1);
    assertQuietCounts(budget, trace, { reads: 0, providerCalls: 1 });
  }
});

test('execution exposes consumed attempts without invoking owner ports or proving transport', async () => {
  const f = fixture();
  const e = f.execution;
  try {
    const initial = assertQuietCounts(e, f.trace, { reads: 0, providerCalls: 0 });
    e.consumeRead();
    assert.throws(e.consumeRead, { message: 'read-budget' });
    await assert.rejects(e.wait(controls => {
      controls.beforeProviderAttempt();
      throw new Error('synthetic-failure-before-transport');
    }), { message: 'synthetic-failure-before-transport' });
    await assert.rejects(e.wait(controls => controls.beforeProviderAttempt()), { message: 'provider-budget' });
    assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
    assert.deepEqual(initial, { reads: 0, providerCalls: 0 });
    f.setTime(104);
    assert.deepEqual(e.usage(), { reads: 1, providerCalls: 1, elapsedMs: 4, tokens: null });
    const failure = new Error('synthetic-clock-failure');
    f.failClock(failure);
    assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
    assert.throws(e.usage, error => error === failure);
  } finally { e.dispose(); }
  assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('freshness rejection does not consume an attempt or become a count read callback', async () => {
  const f = fixture();
  try {
    f.failFreshness(new Error('synthetic-owner-stale'));
    await assert.rejects(f.execution.wait(controls => controls.beforeProviderAttempt()),
      { message: 'synthetic-owner-stale' });
    assertQuietCounts(f.execution, f.trace, { reads: 0, providerCalls: 0 });
  } finally { f.execution.dispose(); }
});

test('canceled, expired and disposed executions retain quiet counts and closed gates', async () => {
  for (const reason of ['turn-canceled', 'turn-deadline', 'run-closed']) {
    const f = fixture();
    const e = f.execution;
    try {
      e.consumeRead();
      await e.wait(controls => controls.beforeProviderAttempt());
      if (reason === 'turn-canceled') f.abort();
      else if (reason === 'turn-deadline') f.expire();
      else e.dispose();
      f.failClock(new Error('synthetic-clock-failure'));
      f.failFreshness(new Error('synthetic-owner-failure'));
      assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
      assert.throws(e.consumeRead, { message: reason });
      await assert.rejects(e.wait(() => { throw new Error('must-not-run'); }), { message: reason });
      assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
    } finally { e.dispose(); }
    assertQuietCounts(e, f.trace, { reads: 1, providerCalls: 1 });
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});
