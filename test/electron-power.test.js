'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPowerHost } = require('../src/platform/electron');

function handlers(calls, label = '') {
  return {
    onSuspend: () => calls.push(`${label}suspend`),
    onLock: () => calls.push(`${label}lock`),
    onUnlock: () => calls.push(`${label}unlock`),
    onResume: () => calls.push(`${label}resume`)
  };
}

test('power host maps the complete platform event set without exposing powerMonitor', () => {
  const powerMonitor = new EventEmitter();
  const calls = [];
  const host = createPowerHost({ powerMonitor });
  const dispose = host.subscribe(handlers(calls));

  powerMonitor.emit('suspend');
  powerMonitor.emit('lock-screen');
  powerMonitor.emit('unlock-screen');
  powerMonitor.emit('resume');

  assert.deepEqual(calls, ['suspend', 'lock', 'unlock', 'resume']);
  assert.deepEqual(Object.keys(host), ['subscribe', 'systemIdleSeconds']);
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  powerMonitor.emit('resume');
  assert.equal(calls.length, 4);
});

test('a replacement power subscription removes every previous listener', () => {
  const powerMonitor = new EventEmitter();
  const calls = [];
  const host = createPowerHost({ powerMonitor });
  const disposeFirst = host.subscribe(handlers(calls, 'old-'));
  const disposeSecond = host.subscribe(handlers(calls, 'new-'));

  powerMonitor.emit('suspend');
  assert.deepEqual(calls, ['new-suspend']);
  assert.equal(disposeFirst(), false);
  assert.equal(disposeSecond(), true);
  for (const eventName of ['suspend', 'lock-screen', 'unlock-screen', 'resume']) {
    assert.equal(powerMonitor.listenerCount(eventName), 0);
  }
});

test('power host validates the complete callback contract before subscribing', () => {
  const powerMonitor = new EventEmitter();
  const host = createPowerHost({ powerMonitor });
  const incomplete = handlers([]);
  delete incomplete.onResume;

  assert.throws(() => host.subscribe(incomplete), /only suspend, lock, unlock and resume/);
  assert.throws(() => host.subscribe({ ...handlers([]), unexpected: () => {} }), /only suspend/);
  assert.equal(powerMonitor.eventNames().length, 0);
});

test('power host rejects platform emitters that cannot remove listeners', () => {
  assert.throws(
    () => createPowerHost({ powerMonitor: { on() {} } }),
    /event removal/
  );
});
