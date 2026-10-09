'use strict';
// Extra behavioral evidence against the imported native production controller.
// No production files are copied, rewritten, stubbed or source-text asserted.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, createHarness, deferred, settle, ring, snapshot, send, sample, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
const { createPetSync } = require(path.join(ROOT, 'src/surfaces/pet/sync.mjs'));

const canonical = Object.freeze({
  baseState: 'focused', paused: true, focusRing: ring('canonical'), skin: 'usagi',
  theme: { primary: '#123456', accent: '#abcdef' }, work: { start: 8, end: 17 },
  energyLevel: 80, level: 8, appearanceItemIds: ['scarf'], satiation: 85,
  stimulationMode: 'low', motionMode: 'reduced', petActivityMode: 'quiet', dnd: true, foodTickets: 9, totalFeeds: 8, foodInventory: { berry: 4 }, basicMeal: { remaining: 1, eligible: false }
});
const stale = Object.freeze({
  baseState: 'idle', paused: false, focusRing: null, skin: 'pink',
  theme: { primary: '#000000', accent: '#ffffff' }, work: { start: 10, end: 21 },
  energyLevel: 20, level: 1, appearanceItemIds: [], satiation: 10,
  stimulationMode: 'high', motionMode: 'full', petActivityMode: 'lively', dnd: false, foodTickets: 0, totalFeeds: 0, foodInventory: {}, basicMeal: { remaining: 3, eligible: true }
});

for (const revision of [8, 9]) {
  test(`canonical fields are immutable after accepted revision 9 when packet revision is ${revision}`, () => {
    let receive;
    const applied = {};
    const delivered = [];
    createPetSync({ client: { onPetSync(callback) { receive = callback; } },
      onSync(value) { Object.assign(applied, value); delivered.push(value); } }).connect();
    receive({ contextRevision: 9, ...canonical });
    const independent = { screenLocked: true, devMode: true, activityMirror: 'music',
      activityMirrorConcurrent: ['ai'], cue: { id: 'notebook' }, message: 'feedback',
      presentation: { eventId: 'one', expressionId: 'react.satisfied' }, foodDrop: 'berry',
      transientState: 'celebrating', transientDurationMs: 1000 };
    const original = { contextRevision: revision, ...stale, ...independent };
    const before = structuredClone(original);
    receive(original);
    for (const key of Object.keys(canonical)) assert.deepEqual(applied[key], canonical[key], key);
    for (const [key, value] of Object.entries(independent)) assert.deepEqual(applied[key], value, key);
    assert.deepEqual(original, before, 'received wire payload was not mutated');
    assert.equal(delivered.length, 2, 'independent payload still delivered');
  });
}

test('unversioned independent events do not make later numbered canonical context stale', () => {
  let receive;
  const applied = {};
  createPetSync({ client: { onPetSync(callback) { receive = callback; } }, onSync(value) { Object.assign(applied, value); } }).connect();
  receive({ contextRevision: 1, energyLevel: 20 });
  for (let index = 0; index < 100; index++) receive({ message: `feedback-${index}`, screenLocked: index % 2 === 0 });
  receive({ contextRevision: 2, energyLevel: 80 });
  assert.equal(applied.energyLevel, 80);
});

test('snapshot fills untouched fields while preserving a later unversioned energy owner', async t => {
  const pending = deferred(), contexts = [];
  const h = createHarness({ bridgeOverrides: { pet_getState: () => pending.promise,
    pet_getContextualLine: value => { contexts.push(value); return Promise.resolve(null); } } });
  t.after(() => h.runtime.stop());
  send(h, { energyLevel: 80 });
  pending.resolve(snapshot({ state: 'focused', paused: true, focusRing: ring(), skin: 'usagi', energy: { level: 20 } }));
  await settle();
  assert.equal(sample(h).state, 'focused');
  assert.equal(sample(h).paused, true);
  assert.equal(sample(h).ring, 'focus');
  h.document.getElementById('petHit').dispatch('keydown', { key: 'Enter', preventDefault() {} });
  await settle();
  assert.equal(contexts[0].energyLevel, 80);
});

for (const failedPhase of ['getState', 'getContent']) {
  test(`live base survives ${failedPhase} rejection during initialization`, async t => {
    const pending = deferred();
    const h = createHarness({ bridgeOverrides: failedPhase === 'getState'
      ? { pet_getState: () => pending.promise }
      : { pet_getContent: () => pending.promise } });
    t.after(() => h.runtime.stop());
    await settle();
    send(h, { contextRevision: 9, baseState: 'focused', paused: true, focusRing: ring() });
    pending.reject(new Error('synthetic hydration read failure'));
    await settle();
    assert.equal(sample(h).state, 'focused');
    assert.equal(sample(h).paused, true);
    assert.equal(sample(h).ring, 'focus');
  });
}

test('newer canonical snapshot repairs canonical fields but preserves later independent satiation', async t => {
  const pending = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => pending.promise } });
  t.after(() => h.runtime.stop());
  send(h, { contextRevision: 8, baseState: 'focused', focusRing: ring() });
  h.bridge.handlers.feed({ satiation: 85, foodTickets: 9, totalFeeds: 8, foodInventory: { berry: 4 }, basicMeal: { remaining: 1, eligible: false } });
  pending.resolve(snapshot({ contextRevision: 9, state: 'idle', focusRing: null, satiation: 10 }));
  await settle();
  assert.equal(sample(h).state, 'idle', 'newer canonical base repaired');
  assert.equal(sample(h).ring, null, 'newer canonical ring cleared');
  for (const tick of h.timers.intervals) tick();
  assert.notEqual(sample(h).state, 'hungry', 'later independent feed retains ownership');
});

test('later runtime lock and dev mode survive genuinely newer numbered hydration', async t => {
  const pending = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => pending.promise } });
  t.after(() => h.runtime.stop());
  send(h, { screenLocked: true, devMode: true });
  pending.resolve(snapshot({ contextRevision: 20, screenLocked: false, devMode: false }));
  await settle();
  assert.equal(sample(h).locked, true);
  h.bridge.handlers.devtools({ open: true });
  assert.equal(h.document.getElementById('devTools').classList.contains('show'), true);
});

test('sensory profile is established before a new ring touches presentation DOM', async t => {
  const h = createHarness({ initialState: snapshot({ stimulationMode: 'high', motionMode: 'full' }) });
  t.after(() => h.runtime.stop());
  await settle();
  const observations = [];
  const arc = h.document.querySelector('#focusRing .ring-arc');
  arc.style.setProperty = () => observations.push({ ...h.document.body.dataset });
  send(h, { contextRevision: 1, stimulationMode: 'low', motionMode: 'reduced', dnd: true, focusRing: ring() });
  assert.ok(observations.length > 0, 'ring path actually executed');
  for (const observation of observations) {
    assert.equal(observation.stimulation, 'low');
    assert.equal(observation.motion, 'reduced');
  }
});

test('stale canonical state carrying a transient returns to latest canonical base', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 9, baseState: 'resting', focusRing: ring('rest', 'break') });
  send(h, { contextRevision: 8, baseState: 'idle', transientState: 'celebrating', transientDurationMs: 1000 });
  assert.equal(sample(h).state, 'celebrating', 'independent transient delivered');
  h.frameBy(250, 8);
  assert.equal(sample(h).state, 'resting');
  assert.equal(sample(h).ring, 'break');
});

test('hydration with content pending does not lose a current paused-state owner', async t => {
  const pending = deferred();
  const h = createHarness({ initialState: snapshot({ state: 'focused', paused: false, focusRing: ring() }),
    bridgeOverrides: { pet_getContent: () => pending.promise } });
  t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 9, baseState: 'idle', paused: true, focusRing: { ...ring(), running: false } });
  pending.resolve(PET_CONTENT_PAYLOAD); await settle();
  assert.equal(sample(h).state, 'idle');
  assert.equal(sample(h).paused, true);
  assert.equal(h.document.querySelector('#focusRing .ring-arc').style['--ring-state'], 'paused');
});

test('numbered stale ring clear cannot remove a current ring while its message is delivered', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 9, baseState: 'focused', focusRing: ring('current') });
  send(h, { contextRevision: 8, focusRing: null, message: 'accepted feedback' });
  assert.equal(sample(h).ring, 'focus');
  assert.equal(h.document.getElementById('bubble').textContent, 'accepted feedback');
});

test('newer numbered hydration preserves later legacy live sensory ownership', async t => {
  const pending = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => pending.promise } });
  t.after(() => h.runtime.stop());
  send(h, { stimulationMode: 'low', motionMode: 'reduced', dnd: true });
  pending.resolve(snapshot({ contextRevision: 9, stimulationMode: 'high', motionMode: 'full', dnd: false }));
  await settle();
  assert.equal(sample(h).stimulation, 'low');
  assert.equal(sample(h).motion, 'reduced');
  send(h, { message: 'must remain silent' });
  assert.notEqual(h.document.getElementById('bubble').textContent, 'must remain silent');
});

test('later canonical live update replaces obsolete independent field ownership for newer repair', () => {
  const { createPetContextOwner } = require(path.join(ROOT, 'src/surfaces/pet/sync.mjs'));
  const owner = createPetContextOwner();
  const ticket = owner.beginHydration();
  owner.claimIndependent({ satiation: 85, foodTickets: 10 });
  assert.deepEqual(owner.live({ contextRevision: 8, satiation: 30, foodTickets: 0, totalFeeds: 0, foodInventory: {}, basicMeal: { remaining: 3, eligible: true } }),
    { contextRevision: 8, satiation: 30, foodTickets: 0, totalFeeds: 0, foodInventory: {}, basicMeal: { remaining: 3, eligible: true } });
  const repaired = owner.hydrate({ contextRevision: 9, satiation: 50, foodTickets: 20 }, ticket);
  assert.equal(repaired.satiation, 50);
  assert.equal(repaired.foodTickets, 20);
});

test('current base controls startup greeting after final menu synchronization await', async t => {
  const pending = deferred();
  const h = createHarness({ initialState: snapshot({ state: 'idle' }),
    bridgeOverrides: { pet_setMenuOpen: () => pending.promise } });
  t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 9, baseState: 'focused' });
  pending.resolve(null); await settle();
  assert.notEqual(h.document.getElementById('bubble').textContent, '我在这儿。');
  assert.equal(sample(h).state, 'focused');
});

test('legacy forcedState canonical alias owns the base against pending hydration', async t => {
  const pending = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => pending.promise } });
  t.after(() => h.runtime.stop());
  send(h, { forcedState: 'focused' });
  assert.equal(sample(h).state, 'focused', 'compatibility path actually applied');
  pending.resolve(snapshot({ state: 'idle', contextRevision: 9 }));
  await settle();
  assert.equal(sample(h).state, 'focused');
});

for (const source of ['cue', 'essential']) {
  test(`content initialization applies current policy before draining queued ${source} presentation`, async t => {
    const content = require(path.join(ROOT, 'src/pet-content.js'));
    const { adaptLegacyPetContent } = require(path.join(ROOT, 'src/core/content-pack'));
    const pending = deferred();
    const h = createHarness({ initialState: snapshot({ contextRevision: 8 }),
      bridgeOverrides: { pet_getContent: () => pending.promise } });
    t.after(() => h.runtime.stop()); await settle();
    send(h, { presentation: { eventId: `queued-${source}`, expressionId: 'react.satisfied', source, ttlMs: 4500 } });
    send(h, { contextRevision: 9, baseState: 'resting', dnd: true, stimulationMode: 'low', motionMode: 'reduced' });
    pending.resolve({ ...content, manifest: adaptLegacyPetContent(content) });
    await settle(); h.frameBy(200, 2);
    const current = h.runtime.sample();
    assert.equal(current.state, 'resting');
    if (source === 'cue') assert.notEqual(current.presentationEventId, `queued-${source}`);
    else {
      assert.equal(current.presentationEventId, `queued-${source}`);
      assert.equal(current.presentationStatic, true);
    }
  });
}
