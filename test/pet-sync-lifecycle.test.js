'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createPetSync } = require('../src/surfaces/pet/sync.mjs');

const EVENTS = Object.freeze({
  onInterfacePreferences: 'settings:interface-changed',
  onPetSync: 'pet:sync', onPetViewport: 'pet:viewport', onPetFeedState: 'pet:feedState',
  onPetDock: 'pet:dock', onPetPeek: 'pet:peek', onPetCue: 'pet:cue',
  onPetGaze: 'pet:gaze', onPetDevtools: 'pet:devtools'
});
const SYNC_EVENTS = Object.entries(EVENTS).filter(([name]) => !['onPetViewport', 'onInterfacePreferences'].includes(name));
const COMMANDS = Object.freeze({
  getInterfacePreferences: 'settings:get-interface',
  pet_getBounds: 'pet:getBounds', pet_setPosition: 'pet:setPosition', pet_savePosition: 'pet:savePosition',
  pet_dragStart: 'pet:dragStart', pet_dragEnd: 'pet:dragEnd', pet_getFeedState: 'pet:getFeedState',
  pet_feed: 'pet:feed', pet_interaction: 'pet:interaction', pet_setMenuOpen: 'pet:setMenuOpen',
  pet_getState: 'pet:getState', pet_getContent: 'pet:getContent', pet_getContextualLine: 'pet:getContextualLine',
  pet_setState: 'pet:setState', pet_updateRuntime: 'pet:updateRuntime', pet_ackCue: 'pet:cueAck',
  pet_startFocus: 'pet:startFocus', pet_openImpulse: 'pet:openImpulse', pet_openPanel: 'pet:openPanel',
  pet_toggleDnd: 'pet:toggleDnd', pet_hide: 'pet:hide'
});

function preloadFixture() {
  const ipc = new EventEmitter();
  const invokes = [], removals = [];
  ipc.invoke = (channel, ...args) => { invokes.push({ channel, args }); return Promise.resolve(null); };
  const removeListener = ipc.removeListener.bind(ipc);
  ipc.removeListener = (channel, listener) => { removals.push({ channel, listener }); return removeListener(channel, listener); };
  ipc.removeAllListeners = () => { throw new Error('broad listener removal is forbidden'); };
  let client;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload-pet.js'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron', 'preload receives only a synthetic Electron port');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(key, value) {
        assert.equal(key, 'bubu'); assert.equal(client, undefined); client = value;
      } } };
    }
  }, { filename: 'preload-pet.js' });
  return { ipc, client, invokes, removals };
}

function handlers(seen) {
  return Object.fromEntries(['onSync', 'onDock', 'onPeek', 'onCue', 'onFeedState', 'onGaze', 'onDevtools', 'onSelfMeal']
    .map(name => [name, value => seen.push([name, value])]));
}

test('pet preload preserves the exact closed API and command channels', async () => {
  const f = preloadFixture();
  assert.deepEqual(Object.keys(f.client).sort(), [...Object.keys(COMMANDS), ...Object.keys(EVENTS)].sort());
  for (const [name, channel] of Object.entries(COMMANDS)) {
    await f.client[name]({ fixture: true }, 12);
    assert.equal(f.invokes.at(-1).channel, channel);
  }
  assert.equal(f.ipc.eventNames().length, 0);
});

for (const [name, channel] of Object.entries(EVENTS)) {
  test(`${name} strips the event and releases only its own subscription, including queued callbacks`, () => {
    const f = preloadFixture(), first = [], second = [], unrelated = [];
    const existing = (...args) => unrelated.push(args);
    f.ipc.on(channel, existing);
    const unsubscribe = f.client[name]((...args) => first.push(args));
    const queued = f.ipc.listeners(channel).at(-1);
    const otherUnsubscribe = f.client[name]((...args) => second.push(args));
    const data = { token: name }, event = { sender: 'must not reach renderer' };
    f.ipc.emit(channel, event, data);
    assert.deepEqual(first, [[data]]);
    assert.deepEqual(second, [[data]]);
    assert.equal(typeof unsubscribe, 'function', 'subscription returns its narrow unsubscribe');
    unsubscribe(); unsubscribe();
    assert.equal(f.removals.length, 1, 'unsubscribe is idempotent');
    assert.equal(f.removals[0].channel, channel);
    assert.equal(f.removals[0].listener, queued);
    queued(event, { token: 'already queued' });
    f.ipc.emit(channel, event, data);
    assert.equal(first.length, 1, 'released listeners remain inert if already queued');
    assert.equal(second.length, 2, 'another owner stays subscribed');
    assert.equal(unrelated.length, 2, 'pre-existing subscriptions stay registered');
    otherUnsubscribe();
    assert.deepEqual(f.ipc.listeners(channel), [existing]);
  });
}

test('pet sync connect is idempotent and each live fact is delivered once', () => {
  const f = preloadFixture(), seen = [];
  const sync = createPetSync({ client: f.client, ...handlers(seen) });
  assert.deepEqual(sync.connect(), { connected: true });
  assert.deepEqual(sync.connect(), { connected: true });
  for (const [, channel] of SYNC_EVENTS) assert.equal(f.ipc.listenerCount(channel), 1, channel);
  const meal = { id: 'one-meal' };
  f.ipc.emit('pet:sync', {}, { contextRevision: 9, baseState: 'focused', selfMeal: meal });
  assert.deepEqual(seen.map(([name]) => name), ['onSync', 'onSelfMeal']);
  assert.equal(seen[1][1], meal);
  sync.dispose();
});

test('pet sync terminal dispose releases all owned channels and suppresses queued events and hydration', async () => {
  const f = preloadFixture(), seen = [], unrelated = [];
  for (const [, channel] of SYNC_EVENTS) f.ipc.on(channel, () => unrelated.push(channel));
  const sync = createPetSync({ client: f.client, ...handlers(seen) });
  sync.connect();
  const queued = SYNC_EVENTS.map(([, channel]) => f.ipc.listeners(channel).at(-1));
  const ticket = sync.beginHydration();
  const hydration = Promise.resolve().then(() => sync.hydrate({ contextRevision: 10, state: 'focused' }, ticket));
  sync.dispose(); sync.dispose();
  assert.equal(f.removals.length, SYNC_EVENTS.length, 'every owned subscription removed once');
  assert.deepEqual(sync.connect(), { connected: false }, 'disposed instance never reconnects');
  assert.equal(sync.beginHydration(), null, 'disposed instance cannot issue another hydration ticket');
  sync.claimIndependent({ energyLevel: 80 });
  for (const callback of queued) callback({}, { selfMeal: { id: 'old' }, x: 1 });
  for (const [, channel] of SYNC_EVENTS) {
    assert.equal(f.ipc.listenerCount(channel), 1, 'unrelated listener retained');
    f.ipc.emit(channel, {}, { contextRevision: 11 });
  }
  await hydration;
  assert.deepEqual(seen, []);
  assert.equal(unrelated.length, SYNC_EVENTS.length);
});

test('pet sync callback guard also protects clients without unsubscribe support', () => {
  const captured = {}, seen = [];
  const client = Object.fromEntries(SYNC_EVENTS.map(([name]) => [name, callback => { captured[name] = callback; }]));
  const sync = createPetSync({ client, ...handlers(seen) });
  sync.connect(); sync.dispose();
  for (const callback of Object.values(captured)) callback({ selfMeal: { id: 'old' }, x: 1 });
  sync.hydrate({ contextRevision: 1, state: 'focused' }, 0);
  assert.deepEqual(seen, []);
});

test('pet sync forwards existing callback results while live and returns undefined after disposal', () => {
  const captured = {}, delivered = [];
  const client = Object.fromEntries(SYNC_EVENTS.map(([name]) => [name, callback => { captured[name] = callback; }]));
  const result = { ok: true, queued: true };
  const sync = createPetSync({ client, ...Object.fromEntries(['onDock', 'onPeek', 'onCue', 'onGaze', 'onDevtools']
    .map(name => [name, value => { delivered.push([name, value]); return result; }])) });
  sync.connect();
  const methods = ['onPetDock', 'onPetPeek', 'onPetCue', 'onPetGaze', 'onPetDevtools'];
  for (const method of methods) assert.equal(captured[method]({ x: 1 }), result, method);
  assert.equal(delivered.length, methods.length);
  sync.dispose();
  for (const method of methods) assert.equal(captured[method]({ x: 1 }), undefined, method);
  assert.equal(delivered.length, methods.length, 'terminal callbacks neither run nor return a stale result');
});

test('disposing during sync delivery suppresses the remaining selfMeal callback', () => {
  const f = preloadFixture(), seen = [];
  const sync = createPetSync({ client: f.client, onSync() { seen.push('sync'); sync.dispose(); },
    onSelfMeal() { seen.push('meal'); } });
  sync.connect();
  f.ipc.emit('pet:sync', {}, { selfMeal: { id: 'old' } });
  assert.deepEqual(seen, ['sync']);
});

test('a fresh sync owner starts independently of disposed callbacks and canonical revision', () => {
  const f = preloadFixture(), oldSeen = [], freshSeen = [];
  const old = createPetSync({ client: f.client, ...handlers(oldSeen) });
  old.connect();
  f.ipc.emit('pet:sync', {}, { contextRevision: 100, baseState: 'focused' });
  const queued = f.ipc.listeners('pet:sync')[0];
  old.dispose();
  const fresh = createPetSync({ client: f.client, ...handlers(freshSeen) });
  fresh.connect();
  f.ipc.emit('pet:sync', {}, { contextRevision: 1, baseState: 'resting', sessionDisplay: null });
  queued({}, { contextRevision: 101, baseState: 'idle', selfMeal: { id: 'old' } });
  old.hydrate({ contextRevision: 102, state: 'idle' }, 0);
  old.dispose();
  assert.equal(f.ipc.listenerCount('pet:sync'), 1);
  assert.equal(oldSeen.length, 1);
  assert.deepEqual(freshSeen, [['onSync', { contextRevision: 1, baseState: 'resting', sessionDisplay: null }]]);
  fresh.dispose();
});

test('sync disposal before connect is terminal and makes no subscriptions', () => {
  const f = preloadFixture(), seen = [];
  const sync = createPetSync({ client: f.client, ...handlers(seen) });
  sync.dispose(); sync.dispose();
  assert.deepEqual(sync.connect(), { connected: false });
  sync.hydrate({ contextRevision: 1, state: 'focused' }, 0);
  assert.deepEqual(f.ipc.eventNames(), []);
  assert.deepEqual(seen, []);
});

test('sync disposal during registration releases the just-returned subscription and stops registering', () => {
  let receive, removed = 0, laterRegistrations = 0;
  const client = { onPetSync(callback) {
    receive = callback; callback({ contextRevision: 1 }); return () => { removed++; };
  }, onPetDock() { laterRegistrations++; } };
  const sync = createPetSync({ client, onSync() { sync.dispose(); } });
  assert.deepEqual(sync.connect(), { connected: false });
  receive({ contextRevision: 2 });
  sync.dispose();
  assert.equal(removed, 1);
  assert.equal(laterRegistrations, 0);
});

test('registration failure releases prior subscriptions and leaves the sync owner terminal', () => {
  const f = preloadFixture();
  const sync = createPetSync({ client: { ...f.client, onPetDock() { throw new Error('registration failed'); } } });
  assert.throws(() => sync.connect(), /registration failed/);
  assert.equal(f.ipc.listenerCount('pet:sync'), 0);
  assert.deepEqual(sync.connect(), { connected: false });
});

test('one faulty unsubscribe cannot prevent the remaining owned listeners from being released', () => {
  const f = preloadFixture(), seen = [], calls = [];
  const client = { ...f.client, onPetSync(callback) {
    f.client.onPetSync(callback);
    return () => { calls.push('failed'); throw new Error('synthetic unsubscribe failure'); };
  } };
  const sync = createPetSync({ client, ...handlers(seen) });
  sync.connect();
  assert.doesNotThrow(() => sync.dispose());
  sync.dispose();
  assert.deepEqual(calls, ['failed']);
  for (const [name, channel] of SYNC_EVENTS) {
    assert.equal(f.ipc.listenerCount(channel), name === 'onPetSync' ? 1 : 0);
    f.ipc.emit(channel, {}, { contextRevision: 1 });
  }
  assert.deepEqual(seen, [], 'even a listener that failed to unlink is terminally inert');
});

test('live sync keeps canonical ordering, independent facts, and explicit session orbit clears', () => {
  const f = preloadFixture(), seen = [], state = {};
  const sync = createPetSync({ client: f.client, onSync(value) { Object.assign(state, value); seen.push(value); } });
  sync.connect();
  const ticket = sync.beginHydration();
  const display = { sessionId: 'current', phase: 'focus', elapsedMs: 59000 };
  f.ipc.emit('pet:sync', {}, { contextRevision: 9, baseState: 'focused', sessionDisplay: display, motionMode: 'reduced' });
  f.ipc.emit('pet:sync', {}, { contextRevision: 8, baseState: 'idle', sessionDisplay: null, message: 'independent', screenLocked: true });
  sync.hydrate({ contextRevision: 9, state: 'resting', sessionDisplay: null, screenLocked: false }, ticket);
  assert.equal(state.baseState, 'focused');
  assert.equal(state.sessionDisplay, display);
  assert.equal(state.screenLocked, true);
  assert.equal(state.message, 'independent');
  f.ipc.emit('pet:sync', {}, { sessionDisplay: null });
  sync.hydrate({ contextRevision: 10, state: 'resting', sessionDisplay: display }, ticket);
  assert.equal(state.baseState, 'resting');
  assert.equal(state.sessionDisplay, null, 'later independent orbit clear survives canonical repair');
  assert.equal(state.motionMode, 'reduced');
  assert.equal(seen.length, 5);
  sync.dispose();
});
