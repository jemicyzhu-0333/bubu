'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, createHarness, deferred, settle, ring, snapshot, send, sample, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
const { createPetSync } = require(path.join(ROOT, 'src/surfaces/pet/sync.mjs'));

// Desired REV-SYNC-001 contracts. These must be genuine failing tests at CURRENT.
// Numbered packets are synthetic proposed publication metadata; current main
// does not yet include it. Legacy unnumbered hydration races below are current wire shapes.
test('contextRevision protocol rejects stale canonical fields but delivers its independent message, presentation and runtime override', () => {
  let receive;
  const applied = { energyLevel: 60, baseState: 'idle' };
  const messages = [], presentations = [];
  const sync = createPetSync({ client: { onPetSync(fn) { receive = fn; } }, onSync(data) {
    for (const key of ['energyLevel', 'baseState', 'screenLocked']) if (key in data) applied[key] = data[key];
    if (data.message) messages.push(data.message);
    if (data.presentation) presentations.push(data.presentation);
  } });
  sync.connect();
  receive({ contextRevision: 9, energyLevel: 80, baseState: 'focused' });
  const presentation = { eventId: 'independent-expression', expressionId: 'react.satisfied' };
  receive({ contextRevision: 8, energyLevel: 20, baseState: 'idle', screenLocked: true, message: 'Independent feedback', presentation });
  assert.deepEqual(messages, ['Independent feedback']);
  assert.deepEqual(presentations, [presentation]);
  assert.equal(applied.screenLocked, true);
  assert.deepEqual({ energyLevel: applied.energyLevel, baseState: applied.baseState }, { energyLevel: 80, baseState: 'focused' });
});

test('contextRevision protocol duplicate canonical revision does not roll the state back', () => {
  let receive;
  const applied = {};
  createPetSync({ client: { onPetSync(fn) { receive = fn; } }, onSync(data) { Object.assign(applied, data); } }).connect();
  receive({ contextRevision: 9, energyLevel: 80, baseState: 'focused' });
  receive({ contextRevision: 9, energyLevel: 20, baseState: 'idle' });
  assert.equal(applied.energyLevel, 80);
});

for (const phase of ['getState', 'getContent']) {
  test(`controller preserves live context while ${phase} is deferred (legacy unversioned shape)`, async t => {
    const pendingState = deferred(), pendingContent = deferred();
    let contentCalls = 0, closedMenuCalls = 0;
    const h = createHarness({ bridgeOverrides: {
      pet_getState: () => pendingState.promise,
      pet_getContent: () => { contentCalls++; return pendingContent.promise; },
      pet_setMenuOpen: () => { closedMenuCalls++; return Promise.resolve(null); }
    } });
    t.after(() => h.runtime.stop());
    const old = snapshot(); delete old.contextRevision;
    if (phase === 'getContent') { pendingState.resolve(old); await settle(); assert.equal(contentCalls, 1); }
    send(h, { energyLevel: 80, level: 8, satiation: 85, baseState: 'focused', focusRing: ring() });
    assert.equal(sample(h).state, 'focused');
    assert.equal(sample(h).ring, 'focus');
    if (phase === 'getState') pendingState.resolve(old);
    pendingContent.resolve(PET_CONTENT_PAYLOAD); await settle();
    assert.equal(closedMenuCalls, 1, 'init reached its terminal menu synchronization');
    assert.deepEqual({ state: sample(h).state, ring: sample(h).ring }, { state: 'focused', ring: 'focus' });
  });
}

for (const [label, oldRevision, liveRevision] of [['older', 8, 9], ['equal', 9, 9]]) {
  test(`${label}-contextRevision hydration cannot overwrite later live canonical context`, async t => {
    const content = deferred();
    const h = createHarness({ initialState: snapshot({ contextRevision: oldRevision }), bridgeOverrides: { pet_getContent: () => content.promise } });
    t.after(() => h.runtime.stop());
    await settle();
    send(h, { contextRevision: liveRevision, baseState: 'focused', focusRing: ring(), energyLevel: 80 });
    content.resolve(PET_CONTENT_PAYLOAD); await settle();
    assert.deepEqual({ state: sample(h).state, ring: sample(h).ring }, { state: 'focused', ring: 'focus' });
  });
}

test('newer canonical hydration does not unlock an independently locked runtime', async t => {
  const state = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise } });
  t.after(() => h.runtime.stop());
  send(h, { screenLocked: true });
  assert.equal(sample(h).locked, true);
  state.resolve(snapshot({ contextRevision: 10, screenLocked: false })); await settle();
  assert.equal(sample(h).locked, true, 'newer canonical snapshot does not own the later runtime lock');
});

test('delayed getState does not relax a later sensory tightening', async t => {
  const state = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise } });
  t.after(() => h.runtime.stop());
  send(h, { stimulationMode: 'low', motionMode: 'reduced' });
  state.resolve(snapshot({ stimulationMode: 'high', motionMode: 'full' })); await settle();
  assert.deepEqual({ stimulation: sample(h).stimulation, motion: sample(h).motion }, { stimulation: 'low', motion: 'reduced' });
});

test('delayed hydration does not resurrect a ring cleared after completion', async t => {
  const content = deferred();
  const h = createHarness({ initialState: snapshot({ state: 'focused', focusRing: ring('finished-session') }),
    bridgeOverrides: { pet_getContent: () => content.promise } });
  t.after(() => h.runtime.stop());
  await settle();
  send(h, { baseState: 'idle', focusRing: null });
  content.resolve(PET_CONTENT_PAYLOAD); await settle();
  assert.deepEqual({ state: sample(h).state, ring: sample(h).ring }, { state: 'idle', ring: null });
});

for (const phase of ['getState', 'getContent']) {
  test(`current controller energy stays at live value after ${phase} hydration`, async t => {
    const state = deferred(), content = deferred(), contexts = [];
    const h = createHarness({ bridgeOverrides: {
      pet_getState: () => state.promise, pet_getContent: () => content.promise,
      pet_getContextualLine: context => { contexts.push(context); return Promise.resolve(null); }
    } });
    t.after(() => h.runtime.stop());
    if (phase === 'getContent') { state.resolve(snapshot()); await settle(); }
    send(h, { energyLevel: 80, baseState: 'focused' });
    if (phase === 'getState') state.resolve(snapshot());
    content.resolve(PET_CONTENT_PAYLOAD); await settle();
    h.document.getElementById('petHit').dispatch('keydown', { key: 'Enter', repeat: false, preventDefault() {} });
    await settle();
    assert.equal(contexts.length, 1, 'real keyboard path reached actual contextual-line client');
    assert.equal(contexts[0].energyLevel, 80);
  });
}

test('feed-state arriving during content hydration keeps satiation ownership', async t => {
  const content = deferred();
  const h = createHarness({ initialState: snapshot({ satiation: 10 }), bridgeOverrides: { pet_getContent: () => content.promise } });
  t.after(() => h.runtime.stop());
  await settle();
  h.bridge.handlers.feed({ satiation: 85, foodInventory: {} });
  content.resolve(PET_CONTENT_PAYLOAD); await settle();
  // Actual controller's registered deterministic maintenance reads its private
  // satiation. Latest feed is 85, so it must not switch idle into hungry.
  for (const tick of h.timers.intervals) tick();
  assert.notEqual(sample(h).state, 'hungry');
});

test('contextRevision controller delivers stale-packet speech but returns to newest canonical base after transient expiry', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 9, baseState: 'focused', focusRing: ring(), energyLevel: 80 });
  send(h, { contextRevision: 8, baseState: 'idle', focusRing: null, energyLevel: 20, message: 'Independent feedback' });
  assert.equal(h.document.getElementById('bubble').textContent, 'Independent feedback');
  assert.equal(sample(h).state, 'talking', 'independent speech transient was actually delivered');
  h.frameBy(250, 25);
  assert.ok(h.runtime.sample().animNow >= 4500, 'real animation clock has passed the transient duration');
  assert.equal(sample(h).state, 'focused');
});
