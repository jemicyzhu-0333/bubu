'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetLifecycle } = require('../src/surfaces/pet/lifecycle.mjs');

test('presentation resources cancel exactly their own handles and suppress already captured callbacks', () => {
  let id = 0, runs = 0;
  const active = new Map(), queued = [], removed = [];
  const set = callback => { queued.push(callback); active.set(++id, callback); return id; };
  const cancel = handle => { removed.push(handle); active.delete(handle); };
  const environment = { setTimeout: set, clearTimeout: cancel, setInterval: set, clearInterval: cancel,
    requestAnimationFrame: set, cancelAnimationFrame: cancel };
  const a = createPetLifecycle(environment), b = createPetLifecycle(environment);
  a.setTimeout(() => runs++, 1); a.setInterval(() => runs++, 2); a.requestAnimationFrame(() => runs++);
  b.setTimeout(() => runs += 10, 1);
  a.dispose(); a.dispose();
  assert.deepEqual(removed, [1, 2, 3]);
  assert.deepEqual([...active.keys()], [4]);
  for (const callback of queued) callback(1);
  assert.equal(runs, 10);
  assert.equal(a.setTimeout(() => runs++, 1), null);
  assert.equal(a.requestAnimationFrame(() => runs++), null);
  b.dispose();
});

test('individual cancellation also invalidates queued work before terminal disposal', () => {
  let next = 0, count = 0;
  const callbacks = [];
  const set = fn => { callbacks.push(fn); return ++next; };
  const life = createPetLifecycle({ setTimeout: set, clearTimeout() {}, requestAnimationFrame: set, cancelAnimationFrame() {} });
  const timeout = life.setTimeout(() => count++, 1), frame = life.requestAnimationFrame(() => count++);
  life.clearTimeout(timeout); life.cancelAnimationFrame(frame);
  callbacks.forEach(fn => fn());
  assert.equal(count, 0);
  life.dispose();
});

test('removing a listener independently makes its already queued callback inert', () => {
  let callback, removes = 0, calls = 0;
  const target = { addEventListener(_name, fn) { callback = fn; }, removeEventListener() { removes++; } };
  const lifetime = createPetLifecycle({});
  const remove = lifetime.listen(target, 'change', () => calls++);
  remove(); remove(); callback(); lifetime.dispose();
  assert.equal(calls, 0);
  assert.equal(removes, 1);
});

test('independent injected timer namespaces cannot cancel another resource with the same handle', () => {
  let interval, timeout, ticks = 0, fired = 0;
  const canceled = [];
  const lifetime = createPetLifecycle({
    setInterval: fn => { interval = fn; return 1; }, clearInterval: id => canceled.push(['interval', id]),
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: id => canceled.push(['timeout', id])
  });
  lifetime.setInterval(() => ticks++, 1000);
  const handle = lifetime.setTimeout(() => fired++, 100);
  lifetime.clearTimeout(handle);
  interval(); timeout();
  assert.equal(ticks, 1);
  assert.equal(fired, 0);
  assert.deepEqual(canceled, [['timeout', 1]]);
  lifetime.dispose();
  assert.deepEqual(canceled, [['timeout', 1], ['interval', 1]]);
});

test('a canceled frame callback cannot claim a later frame reusing its host handle', () => {
  const callbacks = [], calls = [];
  const life = createPetLifecycle({ requestAnimationFrame: fn => { callbacks.push(fn); return 1; }, cancelAnimationFrame() {} });
  const old = life.requestAnimationFrame(() => calls.push('old'));
  life.cancelAnimationFrame(old);
  life.requestAnimationFrame(() => calls.push('current'));
  callbacks[0](1); callbacks[1](1);
  assert.deepEqual(calls, ['current']);
  life.dispose();
});
