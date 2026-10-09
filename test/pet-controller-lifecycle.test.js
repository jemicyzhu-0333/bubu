'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetRuntime } = require('../src/surfaces/pet/runtime.mjs');
const { createPetSurfaceClient } = require('../src/surfaces/pet/adapter/surface-client.mjs');
const { createLifecycleHarness } = require('../test-support/pet-lifecycle-fixture');
const { deferred, settle, snapshot, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');

for (const phase of ['state', 'content', 'menu']) {
  test(`terminal stop rejects late ${phase} initialization without touching the replacement owner`, async () => {
    const pending = deferred();
    const method = { state: 'pet_getState', content: 'pet_getContent', menu: 'pet_setMenuOpen' }[phase];
    const h = createLifecycleHarness({ bridgeOverrides: { [method]: () => pending.promise } });
    await settle();
    h.runtime.stop();
    const next = createPetRuntime({ environment: h.environment, clients: createPetSurfaceClient(h.window.bubu) });
    const before = h.writes(), calls = h.calls.length;
    pending.resolve(phase === 'state' ? snapshot() : phase === 'content' ? PET_CONTENT_PAYLOAD : null);
    await settle();
    assert.equal(h.writes(), before, 'old initialization cannot mutate shared DOM');
    assert.equal(h.calls.length, calls, 'old initialization cannot issue subsequent IPC');
    next.stop();
  });
}

test('stopping an active controller releases owned resources and makes captured callbacks inert', async () => {
  const h = createLifecycleHarness();
  await settle();
  const hit = h.document.getElementById('petHit');
  hit.dispatch('keydown', { key: 'Enter' });
  hit.dispatch('contextmenu');
  h.emit('onPetSync', { cue: { id: 'system.notebook-ready', at: 1 } });
  await settle();
  assert.ok(h.listenerCount() > 15);
  assert.equal(h.subscriptionCount(), 8);
  assert.ok(h.timers.size > 0);
  assert.ok(h.frames.size > 0);
  const captured = [...h.callbacks];
  h.runtime.stop();
  assert.equal(h.listenerCount(), 0, 'all DOM/media/window listeners removed');
  assert.equal(h.subscriptionCount(), 0, 'all scoped preload subscriptions removed');
  assert.equal(h.observers.size, 0, 'owned observers disconnected');
  assert.equal(h.timers.size, 0, 'all intervals and timeouts cancelled');
  assert.equal(h.frames.size, 0, 'all frames cancelled');
  const before = h.writes(), calls = h.calls.length;
  h.runtime.stop(); h.runtime.start();
  for (const callback of captured) callback();
  await settle();
  assert.equal(h.writes(), before, 'already queued callbacks cannot write');
  assert.equal(h.calls.length, calls, 'already queued callbacks cannot send IPC');
  assert.equal(h.timers.size + h.frames.size, 0, 'terminal start cannot reschedule');
});

test('a controller stopped before start remains terminal, and a fresh owner starts normally', async () => {
  const h = createLifecycleHarness({ autoStart: false });
  h.runtime.stop();
  const calls = h.calls.length;
  await h.runtime.start();
  assert.equal(h.calls.length, calls);
  const next = createPetRuntime({ environment: h.environment, clients: createPetSurfaceClient(h.window.bubu) });
  await next.start();
  assert.equal(h.subscriptionCount(), 8);
  h.emit('onPetSync', { message: 'new owner' });
  assert.equal(h.document.getElementById('bubble').textContent, 'new owner');
  next.stop();
});

for (const outcome of ['resolve', 'reject']) {
  test(`late contextual ${outcome} is silent after stop`, async () => {
    const pending = deferred();
    const h = createLifecycleHarness({ bridgeOverrides: { pet_getContextualLine: () => pending.promise } });
    await settle();
    h.document.getElementById('petHit').dispatch('keydown', { key: 'Enter' });
    await settle(); h.runtime.stop();
    const before = h.writes(), calls = h.calls.length;
    pending[outcome](outcome === 'resolve' ? 'old words' : new Error('synthetic'));
    await settle();
    assert.equal(h.writes(), before);
    assert.equal(h.calls.length, calls);
  });
}

for (const phase of ['state', 'content', 'menu']) {
  test(`late rejected ${phase} initialization cannot continue after stop`, async () => {
    const pending = deferred();
    const method = { state: 'pet_getState', content: 'pet_getContent', menu: 'pet_setMenuOpen' }[phase];
    const h = createLifecycleHarness({ bridgeOverrides: { [method]: () => pending.promise } });
    await settle(); h.runtime.stop();
    const before = h.writes(), calls = h.calls.length;
    pending.reject(new Error('synthetic initialization rejection'));
    await settle();
    assert.equal(h.writes(), before);
    assert.equal(h.calls.length, calls);
  });
}

test('pagehide terminates the runtime and repeated start shares one initialization', async () => {
  const h = createLifecycleHarness({ autoStart: false });
  const first = h.runtime.start(), again = h.runtime.start();
  assert.equal(first, again);
  await first;
  assert.equal(h.calls.filter(([name]) => name === 'pet_getState').length, 1);
  h.window.dispatch('pagehide');
  assert.equal(h.subscriptionCount() + h.listenerCount() + h.frames.size + h.timers.size, 0);
});

for (const action of ['focus', 'dnd']) for (const outcome of ['resolve', 'reject']) {
  test(`late ${action} command ${outcome} cannot change a fresh controller`, async () => {
    const pending = deferred();
    const method = action === 'focus' ? 'pet_startFocus' : 'pet_toggleDnd';
    const h = createLifecycleHarness({ bridgeOverrides: { [method]: () => pending.promise } });
    await settle();
    const button = h.document.querySelectorAll('.command-item')[0];
    button.dataset.act = action;
    button.dispatch('click');
    await settle();
    assert.equal(h.calls.filter(([name]) => name === method).length, 1);
    h.runtime.stop();
    const next = createPetRuntime({ environment: h.environment, clients: createPetSurfaceClient(h.window.bubu) });
    await next.start();
    const before = h.writes(), calls = h.calls.length;
    pending[outcome](outcome === 'resolve' ? { ok: true, dnd: false } : new Error('synthetic command rejection'));
    await settle();
    assert.equal(h.writes(), before);
    assert.equal(h.calls.length, calls);
    next.stop();
  });
}

test('stop clears owned devtools and dock presentation before a fresh controller is mounted', async () => {
  const h = createLifecycleHarness({ initialState: { devMode: true } });
  await settle();
  h.emit('onPetSync', { devMode: true });
  h.emit('onPetDevtools', { open: true });
  h.emit('onPetDock', { edge: 'right' });
  h.emit('onPetPeek', { peek: true });
  const stage = h.document.getElementById('stage');
  assert.equal(stage.classList.contains('devtools-open'), true);
  assert.equal(stage.classList.contains('is-docked'), true);
  h.runtime.stop();
  for (const name of ['devtools-open', 'dock-right', 'is-docked', 'peek']) assert.equal(stage.classList.contains(name), false, name);
  const next = createPetRuntime({ environment: h.environment, clients: createPetSurfaceClient(h.window.bubu) });
  await next.start();
  h.emit('onPetDevtools', { open: true });
  h.emit('onPetDock', { edge: 'left' });
  h.runtime.stop();
  assert.equal(stage.classList.contains('devtools-open'), true, 'repeated old stop leaves the new owner intact');
  assert.equal(stage.classList.contains('dock-left'), true);
  next.stop();
});
