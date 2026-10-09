'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, createHarness, deferred, settle, ring, snapshot, send, sample, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
const { createPetSync } = require(path.join(ROOT, 'src/surfaces/pet/sync.mjs'));
const { createUnitOfWork, createFeedCompanionWorkflow } = require(path.join(ROOT, 'src/application'));
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { FOODS } = require('../src/pet-content');

test('real controller completes initial hydration and honors initial focused state, energy and ring', async t => {
  const contexts = [];
  const h = createHarness({ initialState: snapshot({ state: 'focused', energy: { level: 70 }, focusRing: ring() }),
    bridgeOverrides: { pet_getContextualLine: data => { contexts.push(data); return Promise.resolve(null); } } });
  t.after(() => h.runtime.stop());
  await settle();
  assert.equal(sample(h).state, 'focused'); assert.equal(sample(h).ring, 'focus');
  h.document.getElementById('petHit').dispatch('keydown', { key: 'Enter', preventDefault() {} });
  await settle(); assert.equal(contexts[0].energyLevel, 70);
});

test('genuinely newer canonical hydration repairs an earlier live field', async t => {
  const state = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise } });
  t.after(() => h.runtime.stop());
  send(h, { contextRevision: 8, baseState: 'focused', focusRing: ring() });
  state.resolve(snapshot({ contextRevision: 9, state: 'resting', focusRing: ring('break-session', 'break') })); await settle();
  assert.equal(sample(h).state, 'resting'); assert.equal(sample(h).ring, 'break');
});

test('independent unversioned channels continue after numbered context', () => {
  const handlers = {}, seen = [];
  const client = Object.fromEntries(['onPetSync','onPetCue','onPetFeedState','onPetDock','onPetPeek','onPetGaze','onPetDevtools'].map(name => [name, callback => { handlers[name] = callback; }]));
  createPetSync({ client, onSync: data => seen.push(['sync', data]), onCue: data => seen.push(['cue', data]),
    onFeedState: data => seen.push(['feed', data]), onDock: data => seen.push(['dock', data]), onPeek: data => seen.push(['peek', data]),
    onGaze: data => seen.push(['gaze', data]), onDevtools: data => seen.push(['devtools', data]) }).connect();
  handlers.onPetSync({ contextRevision: 10, baseState: 'focused' });
  const transient = { message: 'Hi', foodDrop: 'berry', presentation: { eventId: 'event-a' }, screenLocked: true, devMode: true };
  handlers.onPetSync(transient);
  handlers.onPetCue({ decisionId: 'cue-a' }); handlers.onPetFeedState({ satiation: 90 });
  handlers.onPetDock({ edge: 'right' }); handlers.onPetPeek({ peeking: true });
  handlers.onPetGaze({ x: 5, y: -5, near: true, sameDisplay: true }); handlers.onPetDevtools({ open: true });
  assert.deepEqual(seen.map(([type]) => type), ['sync','sync','cue','feed','dock','peek','gaze','devtools']);
  assert.deepEqual(seen[1][1], transient);
  assert.deepEqual(seen[6][1], { x: 1, y: -1, near: true, sameDisplay: true });
});

test('real controller accepts a live ring clear and independent lock after hydration', async t => {
  const h = createHarness({ initialState: snapshot({ state: 'focused', focusRing: ring() }) });
  t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 2, baseState: 'idle', focusRing: null });
  send(h, { screenLocked: true });
  assert.deepEqual({ state: sample(h).state, ring: sample(h).ring, locked: sample(h).locked }, { state: 'idle', ring: null, locked: true });
});

test('real controller receives a transient message then returns to latest base when suspended', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 2, baseState: 'focused' });
  send(h, { message: 'Independent feedback' });
  assert.equal(h.document.getElementById('bubble').textContent, 'Independent feedback');
  assert.equal(sample(h).state, 'talking');
  send(h, { screenLocked: true });
  assert.equal(sample(h).state, 'focused');
});

test('manual feeding publishes once after actual commit and never on receipt replay', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  let state = normalizePersistedState({}, { now });
  let revision = 0, commits = 0;
  const events = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) { state = structuredClone(candidate); revision++; commits++; return structuredClone(state); } };
  const command = createFeedCompanionWorkflow({
    unitOfWork: createUnitOfWork({ repository }), clock: { now: () => now }, foods: FOODS, publish: fact => events.push(fact)
  });
  const request = { foodId: 'berry', issuedAt: now, commandId: `${now}-control` };
  assert.equal(command.execute(request).ok, true);
  assert.equal(events.length, 1);
  assert.equal(command.execute(request).replayed, true);
  assert.equal(events.length, 1); assert.equal(revision, 1); assert.equal(commits, 1);
  assert.equal(state.pet.foodInventory.berry, 1); assert.equal(state.pet.totalFeeds, 1);
});

test('real transient expires into a later accepted base using the existing animation clock', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  send(h, { contextRevision: 8, baseState: 'focused' });
  send(h, { message: 'Independent feedback' });
  send(h, { contextRevision: 9, baseState: 'resting' });
  assert.equal(sample(h).state, 'talking');
  h.frameBy(250, 25);
  assert.ok(h.runtime.sample().animNow >= 4500);
  assert.equal(sample(h).state, 'resting');
});

test('ring with same duration and elapsed time reanchors when session identity changes', async t => {
  const h = createHarness(); t.after(() => h.runtime.stop()); await settle();
  const arc = h.document.querySelector('#focusRing .ring-arc');
  const properties = [];
  arc.style.setProperty = (name, value) => properties.push([name, value]);
  send(h, { contextRevision: 1, focusRing: ring('first-session') });
  const firstCount = properties.length; assert.ok(firstCount > 0);
  send(h, { contextRevision: 2, focusRing: ring('second-session') });
  assert.equal(properties.length, firstCount * 2, 'new session identity did not reuse the old anchor');
});

test('unchanged canonical base preserves local hungry presentation until its existing maintenance changes it', async t => {
  const h = createHarness({ initialState: snapshot({ state: 'idle', satiation: 10 }) });
  t.after(() => h.runtime.stop()); await settle();
  for (const tick of h.timers.intervals) tick(); assert.equal(sample(h).state, 'hungry');
  send(h, { contextRevision: 2, baseState: 'idle', paused: false, satiation: 10, energyLevel: 60 });
  assert.equal(sample(h).state, 'hungry');
  send(h, { contextRevision: 3, baseState: 'idle', paused: true, focusRing: { ...ring(), running: false } });
  assert.equal(sample(h).state, 'idle'); assert.equal(sample(h).paused, true);
});
