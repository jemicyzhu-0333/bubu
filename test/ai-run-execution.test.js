'use strict';

// Pure import closure: this test -> execution -> budget and turn guard.
// Every clock/scheduler/parent signal is synthetic; no provider or owner store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunExecution } = require('../src/application/ai/run-execution');
const { createTurnGuard } = require('../src/application/ai/collaboration-turn-guard');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function parentSignal({ removeThrows = false, addThrows = false } = {}) {
  const listeners = new Map();
  let aborted = false;
  let adds = 0;
  let removes = 0;
  const signal = {
    get aborted() { return aborted; },
    addEventListener(type, callback, options) {
      assert.equal(type, 'abort');
      adds += 1;
      listeners.set(callback, options);
      if (addThrows) throw new Error('private-listener-detail');
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'abort');
      removes += 1;
      if (removeThrows) throw new Error('private-listener-detail');
      listeners.delete(callback);
    }
  };
  return { signal, get adds() { return adds; }, get removes() { return removes; },
    get listeners() { return listeners.size; },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const [callback, options] of [...listeners]) {
        if (options?.once) listeners.delete(callback);
        callback();
      }
    } };
}

function fixture(options = {}) {
  const parent = options.parent || parentSignal();
  const trace = [];
  const timers = new Map();
  let at = 100;
  let clockCalls = 0;
  let cancels = 0;
  let freshnessCalls = 0;
  let execution;
  const schedule = (callback, ms) => {
    trace.push(`schedule:${ms}`);
    if (options.scheduleThrows) throw new Error('private-scheduler-detail');
    const handle = Object.hasOwn(options, 'handle') ? options.handle : 0;
    timers.set(handle, callback);
    if (options.syncSchedule) callback();
    return handle;
  };
  execution = createRunExecution({
    now() {
      clockCalls += 1;
      trace.push('clock');
      if (clockCalls === options.clockThrowsAt) throw new Error('private-clock-detail');
      if (clockCalls === options.clockInvalidAt) return NaN;
      return at;
    },
    limits: options.limits,
    signal: parent.signal,
    schedule,
    cancelSchedule(handle) {
      cancels += 1;
      trace.push(`cancel:${handle}`);
      if (options.cancelThrows) throw new Error('private-cancel-detail');
      timers.delete(handle);
    },
    assertCurrent() {
      freshnessCalls += 1;
      trace.push('freshness');
      execution.check();
      return options.freshness?.(execution, parent);
    }
  });
  return { execution, parent, trace, timers, setTime(value) { at = value; },
    fire() { for (const callback of [...timers.values()]) callback(); },
    get clockCalls() { return clockCalls; }, get cancels() { return cancels; },
    get freshnessCalls() { return freshnessCalls; } };
}

const CLOSED = { message: 'run-closed' };
const OPERATION_CLOSED = { message: 'operation-closed' };
const CANCELED = { message: 'turn-canceled' };
const DEADLINE = { message: 'turn-deadline' };

test('normal execution has a frozen closed API and preserves ordered clock samples', async () => {
  const f = fixture();
  const e = f.execution;
  assert.ok(Object.isFrozen(e));
  assert.ok(Object.isFrozen(e.limits));
  assert.deepEqual(Object.keys(e), ['signal', 'limits', 'check', 'consumeRead', 'wait', 'counts', 'usage', 'budgetStatus', 'dispose']);
  e.check();
  const value = await e.wait(controls => {
    assert.ok(Object.isFrozen(controls));
    assert.equal(controls.signal, e.signal);
    controls.assertOpen();
    controls.beforeProviderAttempt();
    return 'answer';
  });
  assert.equal(value, 'answer');
  assert.deepEqual(e.usage(), { reads: 0, providerCalls: 1, elapsedMs: 0, tokens: null });
  assert.deepEqual(f.trace, ['clock', 'clock', 'schedule:180000', 'clock', 'clock', 'clock',
    'freshness', 'clock', 'clock', 'clock', 'clock']);
  assert.equal(f.freshnessCalls, 1);
  e.dispose();
});

test('freshness may call check without recursion and construction never invokes freshness', async () => {
  const f = fixture();
  assert.equal(f.freshnessCalls, 0);
  f.execution.check();
  assert.equal(f.freshnessCalls, 0);
  await f.execution.wait(controls => controls.beforeProviderAttempt());
  assert.equal(f.freshnessCalls, 1);
  f.execution.dispose();
});

test('zero read refusal never calls a read port or increments reads', () => {
  const f = fixture({ limits: { maxReadCalls: 0, maxRepairAttempts: 0 } });
  let reads = 0;
  assert.throws(() => { f.execution.consumeRead(); reads += 1; }, { message: 'read-budget' });
  assert.equal(reads, 0);
  assert.equal(f.execution.usage().reads, 0);
  assert.equal(f.execution.limits.maxRepairAttempts, 0);
  f.execution.dispose();
});

test('five provider attempts are shared across operations, with no run-wide repair counter', async () => {
  const f = fixture();
  for (const count of [2, 2, 1]) {
    await f.execution.wait(controls => {
      for (let i = 0; i < count; i += 1) controls.beforeProviderAttempt();
    });
  }
  await assert.rejects(f.execution.wait(controls => controls.beforeProviderAttempt()), { message: 'provider-budget' });
  assert.equal(f.execution.usage().providerCalls, 5);
  assert.equal(f.execution.limits.maxRepairAttempts, 1);
  f.execution.dispose();
});

test('preaborted parent prevents all operation and freshness callbacks', async () => {
  const parent = parentSignal();
  parent.abort();
  const f = fixture({ parent });
  let called = false;
  await assert.rejects(f.execution.wait(() => { called = true; }), CANCELED);
  assert.equal(called, false);
  assert.equal(f.freshnessCalls, 0);
  f.execution.dispose();
  assert.equal(f.execution.signal.reason, 'turn-canceled');
});

test('deadline before invocation and between initial check and microtask prevents operation', async () => {
  for (const beforeWait of [true, false]) {
    const f = fixture({ limits: { deadlineMs: 10 } });
    let calls = 0;
    if (beforeWait) f.setTime(110);
    const pending = f.execution.wait(() => { calls += 1; });
    if (!beforeWait) f.setTime(110);
    await assert.rejects(pending, DEADLINE);
    assert.equal(calls, 0);
    f.execution.dispose();
  }
});

test('cancellation and deadline settle an abort-ignoring operation without late success', async () => {
  for (const reason of ['turn-canceled', 'turn-deadline', 'run-closed']) {
    const f = fixture();
    const started = deferred();
    const result = deferred();
    let controls;
    let accepted = 0;
    const pending = f.execution.wait(value => { controls = value; started.resolve(); return result.promise; });
    const refusal = assert.rejects(pending, { message: reason });
    await started.promise;
    if (reason === 'turn-canceled') f.parent.abort();
    else if (reason === 'turn-deadline') f.fire();
    else f.execution.dispose();
    const clocks = f.clockCalls;
    const freshness = f.freshnessCalls;
    assert.equal(controls.isOpen(), false);
    assert.throws(() => { controls.assertOpen(); accepted += 1; }, { message: reason });
    assert.throws(() => controls.beforeProviderAttempt(), { message: reason });
    assert.equal(f.clockCalls, clocks);
    assert.equal(f.freshnessCalls, freshness);
    await refusal;
    result.resolve('late answer');
    await result.promise;
    assert.equal(accepted, 0);
    f.execution.dispose();
    assert.equal(f.execution.signal.reason, reason);
  }
});

test('settled operation callbacks are fenced before source effects and observations', async () => {
  const f = fixture();
  let controls;
  let effects = 0;
  let reports = 0;
  await f.execution.wait(value => { controls = value; return 'done'; });
  const clocks = f.clockCalls;
  assert.throws(() => { controls.assertOpen(); effects += 1; }, OPERATION_CLOSED);
  assert.throws(() => controls.beforeProviderAttempt(), OPERATION_CLOSED);
  if (controls.isOpen()) reports += 1;
  assert.equal(effects, 0);
  assert.equal(reports, 0);
  assert.equal(f.freshnessCalls, 0);
  assert.equal(f.clockCalls, clocks);
  await f.execution.wait(next => assert.equal(next.isOpen(), true));
  f.execution.dispose();
});

test('first observed fulfillment and rejection close controls before caller resumes', async () => {
  for (const fails of [false, true]) {
    const f = fixture();
    const started = deferred();
    const source = deferred();
    let controls;
    const pending = f.execution.wait(value => { controls = value; started.resolve(); return source.promise; });
    const observed = fails ? assert.rejects(pending, { message: 'operation-failed' }) : pending;
    await started.promise;
    if (fails) source.reject(new Error('operation-failed'));
    else source.resolve('done');
    await Promise.resolve();
    assert.equal(controls.isOpen(), false);
    assert.throws(() => controls.beforeProviderAttempt(), OPERATION_CLOSED);
    await observed;
    f.execution.dispose();
  }
});

test('synchronous operation failure closes its captured scope immediately', async () => {
  const f = fixture();
  let controls;
  const pending = f.execution.wait(value => { controls = value; throw new Error('operation-failed'); });
  const refusal = assert.rejects(pending, { message: 'operation-failed' });
  await Promise.resolve();
  assert.equal(controls.isOpen(), false);
  assert.throws(() => controls.beforeProviderAttempt(), OPERATION_CLOSED);
  await refusal;
  f.execution.dispose();
});

test('freshness that aborts or disposes cannot charge afterward', async () => {
  for (const dispose of [false, true]) {
    const f = fixture({ freshness(execution, parent) {
      if (dispose) execution.dispose();
      else parent.abort();
    } });
    await assert.rejects(f.execution.wait(controls => controls.beforeProviderAttempt()),
      dispose ? CLOSED : CANCELED);
    assert.equal(f.execution.usage().providerCalls, 0);
    f.execution.dispose();
  }
});

test('asynchronous freshness is refused without charging a provider', async () => {
  const f = fixture({ freshness: () => Promise.reject(new Error('private-freshness-detail')) });
  await assert.rejects(f.execution.wait(controls => controls.beforeProviderAttempt()), { message: 'run-freshness-async' });
  assert.equal(f.execution.usage().providerCalls, 0);
  f.execution.dispose();
});

test('disposed execution rejects work without clocks but preserves metadata reads', async () => {
  const f = fixture();
  const e = f.execution;
  e.dispose();
  const clocks = f.clockCalls;
  assert.throws(() => e.check(), CLOSED);
  assert.throws(() => e.consumeRead(), CLOSED);
  await assert.rejects(e.wait(() => assert.fail('operation ran')), CLOSED);
  assert.equal(f.clockCalls, clocks);
  assert.equal(f.freshnessCalls, 0);
  assert.equal(e.usage().tokens, null);
  assert.deepEqual(e.budgetStatus(), { ok: true });
  assert.equal(f.clockCalls, clocks + 2);
});

test('cancel and deadline are sticky through later aborts and disposal', () => {
  for (const cancelFirst of [true, false]) {
    const f = fixture();
    if (cancelFirst) { f.parent.abort(); f.fire(); }
    else { f.fire(); f.parent.abort(); }
    f.execution.dispose();
    assert.equal(f.execution.signal.reason, cancelFirst ? 'turn-canceled' : 'turn-deadline');
    assert.throws(() => f.execution.check(), cancelFirst ? CANCELED : DEADLINE);
  }
});

test('handle zero is canceled and successful disposal is frozen, cached and idempotent', () => {
  const f = fixture();
  const result = f.execution.dispose();
  assert.deepEqual(result, { ok: true, timer: 'released', listener: 'released' });
  assert.ok(Object.isFrozen(result));
  assert.equal(f.execution.dispose(), result);
  assert.equal(f.cancels, 1);
  assert.equal(f.parent.removes, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.parent.listeners, 0);
});

test('synchronously firing scheduler is safe and preabort keeps reason precedence', async () => {
  for (const preabort of [false, true]) {
    const parent = parentSignal();
    if (preabort) parent.abort();
    const f = fixture({ parent, syncSchedule: true });
    await assert.rejects(f.execution.wait(() => assert.fail('operation ran')), preabort ? CANCELED : DEADLINE);
    assert.equal(f.execution.dispose().ok, true);
    assert.equal(f.cancels, 1);
  }
});

test('cleanup failures independently attempt all resources and never reopen gates', () => {
  for (const [cancelThrows, removeThrows] of [[true, false], [false, true], [true, true]]) {
    const parent = parentSignal({ removeThrows });
    const f = fixture({ parent, cancelThrows });
    const result = f.execution.dispose();
    assert.deepEqual(result, { ok: false, timer: cancelThrows ? 'unconfirmed' : 'released',
      listener: removeThrows ? 'unconfirmed' : 'released' });
    assert.equal(parent.removes, 1);
    assert.equal(f.cancels, 1);
    assert.equal(f.execution.dispose(), result);
    assert.equal(parent.removes, 1);
    assert.equal(f.cancels, 1);
    assert.throws(() => f.execution.check(), CLOSED);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('abort listener reentrant disposal receives a bounded snapshot without duplicate cleanup', () => {
  const f = fixture();
  let nested;
  f.execution.signal.addEventListener('abort', () => { nested = f.execution.dispose(); });
  const final = f.execution.dispose();
  assert.ok(Object.isFrozen(nested));
  assert.deepEqual(nested, { ok: false, timer: 'unconfirmed', listener: 'unconfirmed' });
  assert.deepEqual(final, { ok: true, timer: 'released', listener: 'released' });
  assert.equal(f.execution.dispose(), final);
  assert.equal(f.cancels, 1);
  assert.equal(f.parent.removes, 1);
});

test('clock, listener and scheduler setup failures roll back with bounded error metadata', () => {
  for (const entry of [
    { options: { clockThrowsAt: 1 }, stage: 'budget', listener: 'not-acquired' },
    { options: { clockInvalidAt: 1 }, stage: 'budget', listener: 'not-acquired' },
    { options: { clockThrowsAt: 2 }, stage: 'clock', listener: 'released' },
    { options: { clockInvalidAt: 2 }, stage: 'clock', listener: 'released' },
    { options: { scheduleThrows: true }, stage: 'schedule', listener: 'released' }
  ]) {
    const parent = parentSignal();
    assert.throws(() => fixture({ ...entry.options, parent }), error => {
      assert.equal(error.message, 'run-setup-failed');
      assert.equal(error.setupStage, entry.stage);
      assert.deepEqual(error.cleanup, { ok: true, timer: 'not-acquired', listener: entry.listener });
      assert.ok(Object.isFrozen(error.cleanup));
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.equal(JSON.stringify(error).includes('private'), false);
      return true;
    });
    assert.equal(parent.listeners, 0);
    assert.equal(parent.removes, entry.listener === 'released' ? 1 : 0);
  }
  const parent = parentSignal({ addThrows: true });
  assert.throws(() => fixture({ parent }), error => error.setupStage === 'listener' && error.cleanup.listener === 'released');
  assert.equal(parent.listeners, 0);
});

test('setup rollback uncertainty never replaces the original bounded stage', () => {
  const parent = parentSignal({ removeThrows: true });
  assert.throws(() => fixture({ parent, clockThrowsAt: 2 }), error => {
    assert.equal(error.message, 'run-setup-failed');
    assert.equal(error.setupStage, 'clock');
    assert.deepEqual(error.cleanup, { ok: false, timer: 'not-acquired', listener: 'unconfirmed' });
    return true;
  });
  assert.equal(parent.removes, 1);
});

test('nullish scheduler handles fail closed and report untracked timer uncertainty', () => {
  for (const handle of [undefined, null]) {
    const parent = parentSignal();
    assert.throws(() => fixture({ parent, handle }), error => {
      assert.equal(error.setupStage, 'schedule');
      assert.deepEqual(error.cleanup, { ok: false, timer: 'unconfirmed', listener: 'released' });
      return true;
    });
    assert.equal(parent.listeners, 0);
  }
});

test('guard validates ports before acquisition and direct callers are terminal after dispose', async () => {
  const parent = parentSignal();
  for (const invalid of [null, false, 1]) {
    assert.throws(() => createTurnGuard({ sessionSignal: parent.signal,
      budget: { check: () => ({ ok: true }), remainingMs: () => 5 }, schedule: invalid }),
    error => error.message === 'run-setup-failed' && error.setupStage === 'ports');
  }
  assert.equal(parent.adds, 0);
  let clocks = 0;
  const guard = createTurnGuard({ sessionSignal: parent.signal,
    budget: { check() { clocks += 1; return { ok: true }; }, remainingMs: () => 5 },
    schedule: () => 0, cancelSchedule: () => {} });
  guard.dispose();
  assert.throws(() => guard.check(), CLOSED);
  await assert.rejects(guard.wait(() => assert.fail('operation ran')), CLOSED);
  assert.equal(clocks, 0);
});

test('finite clock movement still uses origin rather than stricter per-sample monotonicity', () => {
  const f = fixture({ limits: { deadlineMs: 20 } });
  f.setTime(115);
  f.execution.check();
  f.setTime(110);
  f.execution.check();
  f.setTime(99);
  assert.throws(() => f.execution.check(), DEADLINE);
  f.execution.dispose();
});

test('direct guard caller keeps accepted success when finally cleanup is unconfirmed', async () => {
  const parent = parentSignal();
  let cleanup;
  let commits = 0;
  const guard = createTurnGuard({ sessionSignal: parent.signal,
    budget: { check: () => ({ ok: true }), remainingMs: () => 5 },
    schedule: () => 0, cancelSchedule() { throw new Error('private-cleanup-detail'); } });
  async function owner() {
    try {
      await guard.wait(() => 'answer');
      commits += 1;
      return { ok: true, accepted: 'answer' };
    } finally { cleanup = guard.dispose(); }
  }
  assert.deepEqual(await owner(), { ok: true, accepted: 'answer' });
  assert.equal(commits, 1);
  assert.deepEqual(cleanup, { ok: false, timer: 'unconfirmed', listener: 'released' });
  assert.equal(parent.removes, 1);
  assert.equal(guard.dispose(), cleanup);
});

test('disposing closes all simultaneous pending waits with one resource cleanup', async () => {
  const f = fixture();
  const controls = [];
  const started = [deferred(), deferred()];
  const results = [deferred(), deferred()];
  const waits = results.map((result, index) => f.execution.wait(value => {
    controls.push(value);
    started[index].resolve();
    return result.promise;
  }));
  const refused = waits.map(pending => assert.rejects(pending, CLOSED));
  await Promise.all(started.map(value => value.promise));
  f.execution.dispose();
  for (const value of controls) {
    assert.equal(value.isOpen(), false);
    assert.throws(() => value.beforeProviderAttempt(), CLOSED);
  }
  await Promise.all(refused);
  assert.equal(f.cancels, 1);
  assert.equal(f.parent.removes, 1);
  for (const result of results) result.resolve('late');
  await Promise.all(results.map(result => result.promise));
  assert.equal(f.execution.usage().providerCalls, 0);
});

test('option and signal getters fail with bounded ports metadata before acquisition', () => {
  function bounded(error) {
    assert.equal(error.message, 'run-setup-failed');
    assert.equal(error.setupStage, 'ports');
    assert.deepEqual(error.cleanup, { ok: true, timer: 'not-acquired', listener: 'not-acquired' });
    assert.ok(Object.isFrozen(error.cleanup));
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  }
  for (const factory of [createTurnGuard, createRunExecution]) {
    assert.equal(factory.length, 0);
    assert.throws(() => factory(null), bounded);
    for (const failure of ['private-value', Object.freeze(new Error('private-frozen-error'))]) {
      const optionName = factory === createTurnGuard ? 'sessionSignal' : 'now';
      const options = Object.defineProperty({}, optionName, { get() { throw failure; } });
      assert.throws(() => factory(options), bounded);
    }
  }
  for (const key of ['aborted', 'addEventListener', 'removeEventListener']) {
    for (const failure of ['private-value', Object.freeze(new Error('private-frozen-error'))]) {
      const parent = parentSignal();
      const signal = Object.create(parent.signal);
      Object.defineProperty(signal, key, { get() { throw failure; } });
      let schedules = 0;
      const ports = { schedule() { schedules += 1; return 0; }, cancelSchedule() {} };
      assert.throws(() => createTurnGuard({ ...ports, sessionSignal: signal,
        budget: { check: () => ({ ok: true }), remainingMs: () => 5 } }), bounded);
      assert.throws(() => createRunExecution({ ...ports, now: () => 100, signal, assertCurrent() {} }), bounded);
      assert.equal(parent.adds, 0);
      assert.equal(parent.removes, 0);
      assert.equal(schedules, 0);
    }
  }
});

test('constructors retain option property read order and undefined defaults', () => {
  const parent = parentSignal();
  const guardOrder = [];
  const executionOrder = [];
  function observed(values, order) {
    const options = {};
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(options, key, { get() { order.push(key); return value; } });
    }
    return options;
  }
  const guard = createTurnGuard(observed({ sessionSignal: parent.signal,
    budget: { check: () => ({ ok: true }), remainingMs: () => 5 },
    schedule: () => 0, cancelSchedule: () => {} }, guardOrder));
  assert.deepEqual(guardOrder, ['sessionSignal', 'budget', 'schedule', 'cancelSchedule']);
  guard.dispose();
  const execution = createRunExecution(observed({ now: () => 100, limits: undefined,
    signal: parent.signal, schedule: () => 0, cancelSchedule: () => {}, assertCurrent() {} }, executionOrder));
  assert.deepEqual(executionOrder, ['now', 'limits', 'signal', 'schedule', 'cancelSchedule', 'assertCurrent']);
  assert.equal(execution.limits.maxProviderCalls, 5);
  execution.dispose();
});
