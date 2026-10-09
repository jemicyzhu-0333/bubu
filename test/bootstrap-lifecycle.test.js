'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');

function createTimerHarness() {
  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    intervals,
    timeouts,
    setInterval(callback, delay) {
      const timer = { id: nextId++, callback, delay, cleared: false };
      intervals.set(timer.id, timer);
      return timer;
    },
    clearInterval(timer) { timer.cleared = true; },
    setTimeout(callback, delay) {
      const timer = { id: nextId++, callback, delay, cleared: false };
      timeouts.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; }
  };
}

test('named resources replace their predecessor and dispose in reverse order', () => {
  const released = [];
  const lifecycle = createLifecycleRegistry();

  lifecycle.register('first', () => released.push('first-old'));
  lifecycle.register('second', () => released.push('second'));
  lifecycle.register('first', () => released.push('first-new'));

  assert.deepEqual(released, ['first-old']);
  assert.equal(lifecycle.size, 2);
  assert.deepEqual(lifecycle.dispose(), []);
  assert.deepEqual(released, ['first-old', 'first-new', 'second']);
  assert.deepEqual(lifecycle.dispose(), []);
  assert.deepEqual(released, ['first-old', 'first-new', 'second']);
});

test('individual cleanup and missing-name clear report whether work happened', () => {
  const lifecycle = createLifecycleRegistry();
  let releaseCount = 0;
  const release = lifecycle.register('one', () => { releaseCount += 1; });

  assert.equal(release(), true);
  assert.equal(release(), false);
  assert.equal(lifecycle.clear('missing'), false);
  assert.equal(releaseCount, 1);
});

test('replacement cleanup happens before the new resource is acquired', () => {
  const events = [];
  const lifecycle = createLifecycleRegistry({
    setInterval() { events.push('acquire-new'); return {}; },
    clearInterval() {},
    setTimeout,
    clearTimeout
  });
  lifecycle.register('poll', () => events.push('release-old'));

  lifecycle.interval('poll', () => {}, 10);

  assert.deepEqual(events, ['release-old', 'acquire-new']);
});

test('timers and listeners have one owner and completed timeouts leave the registry', () => {
  const timers = createTimerHarness();
  const lifecycle = createLifecycleRegistry(timers);
  const emitter = new EventEmitter();
  const events = [];

  const firstInterval = lifecycle.interval('poll', () => events.push('old-poll'), 10);
  const secondInterval = lifecycle.interval('poll', () => events.push('new-poll'), 20);
  lifecycle.timeout('once', value => events.push(value), 30, 'timeout-fired');
  lifecycle.listen('message-listener', emitter, 'message', value => events.push(value));

  assert.equal(firstInterval.cleared, true);
  assert.equal(secondInterval.cleared, false);
  emitter.emit('message', 'heard');
  [...timers.timeouts.values()][0].callback('timeout-fired');
  assert.deepEqual(events, ['heard', 'timeout-fired']);
  assert.equal(lifecycle.size, 2);

  lifecycle.dispose();
  assert.equal(secondInterval.cleared, true);
  assert.equal(emitter.listenerCount('message'), 0);
  assert.equal([...timers.timeouts.values()][0].cleared, false);
});

test('cleanup failures are isolated and late resources are released immediately', () => {
  const released = [];
  const failures = [];
  const lifecycle = createLifecycleRegistry({
    onError: (error, resource) => failures.push([resource.name, error.message])
  });

  lifecycle.register('healthy', () => released.push('healthy'));
  lifecycle.register('broken', () => { throw new Error('cannot close'); });
  lifecycle.register('last', () => released.push('last'));

  const errors = lifecycle.dispose();
  assert.deepEqual(released, ['last', 'healthy']);
  assert.equal(errors.length, 1);
  assert.deepEqual(failures, [['broken', 'cannot close']]);

  lifecycle.register('late', () => released.push('late'));
  assert.deepEqual(released, ['last', 'healthy', 'late']);
  assert.equal(lifecycle.size, 0);
});

test('disposed registries reject new timers and listeners without acquiring them', () => {
  const timers = createTimerHarness();
  const emitter = new EventEmitter();
  const lifecycle = createLifecycleRegistry(timers);
  lifecycle.dispose();

  assert.equal(lifecycle.interval('late-interval', () => {}, 10), null);
  assert.equal(lifecycle.timeout('late-timeout', () => {}, 10), null);
  lifecycle.listen('late-listener', emitter, 'message', () => {});

  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
  assert.equal(emitter.listenerCount('message'), 0);
});
