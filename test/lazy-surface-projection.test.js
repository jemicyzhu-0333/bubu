'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sourceState, runningState, NOW, execution, localDayKey, SKINS, PET_APPEARANCE_ITEMS } = require('../test-support/surface-sync-fixture');
const { FOODS } = require('../src/pet-content');
const { DIRTY_FIELDS, buildStateDelta } = require('../src/core/state-channel.mjs');
const { createSurfaceReadComposition } = require('../src/application/queries/surface-read-composition');
const { createPopoverStateQuery } = require('../src/application/queries/popover-state');
const { createSurfacePublisher, expandSurfaceDependencies } = require('../src/bootstrap/surface-publication');

function observed({ active = false, faults = {} } = {}) {
  const state = active ? runningState({ task: true }) : sourceState();
  const counts = { snapshot: 0, clock: 0, credential: 0, appearance: 0, history: 0, energy: 0 };
  const messages = [], errors = [];
  const readSnapshot = () => {
    counts.snapshot++;
    const value = structuredClone(state);
    for (const [key, count] of [['archivedTasks', 'history'], ['energySignals', 'energy']]) {
      const saved = value[key];
      Object.defineProperty(value, key, { enumerable: true, get() {
        counts[count]++;
        if (count === 'energy' && faults.energy) throw Error('synthetic energy failure');
        return saved;
      } });
    }
    return value;
  };
  const clock = { now: () => { counts.clock++; return NOW; }, dayKey: localDayKey };
  const composition = createSurfaceReadComposition({ readSnapshot, clock, projectSession: execution.sessionProjection.projectSession });
  const items = new Proxy(PET_APPEARANCE_ITEMS, { get(target, key, receiver) { counts.appearance++; return Reflect.get(target, key, receiver); } });
  let publisher;
  const query = createPopoverStateQuery({ readSample: composition.sample, readSnapshot,
    readRevision: () => publisher.readRevision(), clock, skins: SKINS, foods: FOODS, appearanceItems: items,
    credentialStore: { status() { counts.credential++; if (faults.credential) throw Error('synthetic credential failure'); return { configured: false }; } },
    aiDisclosure: () => ({}), schemaVersion: 18 });
  const send = surface => payload => messages.push({ surface, payload: structuredClone(payload) });
  publisher = createSurfacePublisher({ readSample: composition.sample, projectPopover: query.project, projectPet: () => ({}),
    sendPopover: send('popover'), sendQuick: send('quick'), sizeQuick: () => {}, sendPet: send('pet'), reportEffectError: error => errors.push(error) });
  return { counts, messages, errors, query, composition, publisher };
}
for (const active of [false, true]) {
  for (const dirty of [{ timeline: true }, { activity: true }, { reviews: true }, { migrationNotices: true }]) {
    test(`unrelated ${Object.keys(dirty)[0]} publication avoids private/appearance/history work with active=${active}`, () => {
      const h = observed({ active });
      for (let index = 0; index < 3; index++) h.publisher.publish(dirty);
      assert.equal(h.counts.snapshot, 3); assert.equal(h.counts.clock, 3);
      assert.equal(h.counts.credential, 0); assert.equal(h.counts.appearance, 0); assert.equal(h.counts.history, 0);
      assert.ok(h.counts.energy > 0, 'the existing shared energy and complete quick projection remain unchanged');
      assert.equal(h.messages.filter(message => message.surface === 'quick').length, 3);
      assert.ok(h.messages.filter(message => message.surface === 'quick').every(message => message.payload.delta.quickPanel));
      assert.equal(h.errors.length, 0);
    });
  }
}
test('only requested expensive branches run, once per projection and fresh for the next publication', () => {
  const h = observed({ active: true });
  const quiet = h.query.project(h.composition.sample(), { timeline: true });
  assert.equal(h.counts.credential, 0); assert.equal(h.counts.appearance, 0); assert.equal(h.counts.history, 0);
  assert.equal(quiet.ai, undefined); assert.equal(quiet.appearance, undefined); assert.equal(quiet.history, undefined);
  const settings = h.query.project(h.composition.sample(), { settings: true });
  assert.deepEqual(settings.ai.credential, { configured: false }); assert.equal(h.counts.credential, 1);
  const appearance = h.query.project(h.composition.sample(), { appearance: true });
  assert.ok(Array.isArray(appearance.appearance.wornIds)); const appearances = h.counts.appearance; assert.ok(appearances > 0);
  const history = h.query.project(h.composition.sample(), { archivedTasks: true });
  assert.ok(Array.isArray(history.archivedTasks)); assert.equal(typeof history.history.total, 'number'); assert.equal(h.counts.history, 1);
  h.publisher.publish({ settings: true }); assert.equal(h.counts.credential, 2);
  h.publisher.publish({ appearance: true }); assert.ok(h.counts.appearance > appearances);
  h.publisher.publish({ archivedTasks: true }); assert.equal(h.counts.history, 2);
});
test('full initial query materializes complete data fields and all necessary branches', () => {
  const h = observed(), full = h.query.execute();
  assert.ok(h.counts.credential > 0); assert.ok(h.counts.appearance > 0); assert.ok(h.counts.history > 0); assert.ok(h.counts.energy > 0);
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(full)).every(descriptor => !descriptor.get));
  assert.deepEqual(structuredClone(full), full);
});
for (const active of [false, true]) {
  for (const flag of ['all', ...Object.keys(DIRTY_FIELDS)]) {
    test(`lazy ${flag} delta and complete quick view equal full projection with active=${active}`, () => {
      const initial = active ? runningState({ task: true }) : sourceState();
      const expectedHarness = harness({ initial }), actual = harness({ initial });
      const full = expectedHarness.sample(), selective = harness({ initial });
      const flags = expandSurfaceDependencies({ [flag]: true });
      assert.deepEqual(buildStateDelta(selective.query.project(selective.readSample(), flags), flags), buildStateDelta(full, flags));
      full.revision = 1;
      actual.publish({ [flag]: true });
      assert.deepEqual(actual.message('popover').delta, buildStateDelta(full, expandSurfaceDependencies({ [flag]: true })));
      assert.deepEqual(actual.message('quick').delta.quickPanel, full.quickPanel);
      assert.equal(actual.message('quick').revision, 1);
    });
  }
}
test('deferred credential failure stays within its effect and subsequent full publication recovers', () => {
  const faults = { credential: true }, h = observed({ faults });
  assert.doesNotThrow(() => h.publisher.publish({ timeline: true })); assert.equal(h.errors.length, 0);
  assert.doesNotThrow(() => h.publisher.publish({ settings: true })); assert.equal(h.errors.length, 1);
  assert.ok(h.messages.filter(message => message.surface === 'quick').at(-1).payload.delta.quickPanel);
  faults.credential = false; h.publisher.publish({ all: true });
  assert.ok(h.messages.filter(message => message.surface === 'popover').at(-1).payload.delta.ai);
});


test('triage observations use existing inbox projection/deltas without changing canonical captures or historical rows', () => {
  const { createCaptureTriageStatus } = require('../src/application/ai/capture-triage-status');
  const state = sourceState();
  state.impulses = [
    { id: 'synthetic-pending', createdAt: NOW, text: 'Synthetic capture', classification: null, resolution: null },
    { id: 'synthetic-resolved', createdAt: NOW, text: 'Synthetic saved capture', classification: null,
      resolution: { action: 'keep', category: 'note', at: NOW, targetId: null } }
  ];
  const before = structuredClone(state);
  const readSnapshot = () => structuredClone(state), clock = { now: () => NOW, dayKey: localDayKey };
  const status = createCaptureTriageStatus({ readSnapshot });
  const composition = createSurfaceReadComposition({ readSnapshot, clock, projectSession: execution.sessionProjection.projectSession });
  const query = createPopoverStateQuery({ readSample: composition.sample, readSnapshot, readRevision: () => 1,
    clock, skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({}), schemaVersion: 19,
    readCaptureTriageStatus: status.read });
  const initial = query.execute();
  assert.equal(initial.impulses.length, 1);
  assert.deepEqual(initial.impulses[0].triageStatus, { state: 'unknown', reason: 'unavailable' });
  const token = status.begin({ impulseId: 'synthetic-pending', capturedAt: NOW }); status.running(token);
  const projection = query.project(composition.sample(), { impulses: true });
  const delta = buildStateDelta(projection, { impulses: true });
  assert.equal(delta.impulses[0].triageStatus.state, 'running');
  status.finish(token, { reason: 'capture-triage-unsure' });
  assert.equal(query.execute().impulses[0].triageStatus.state, 'uncertain');
  assert.deepEqual(state, before);
  assert.equal(Object.hasOwn(state.impulses[1], 'triageStatus'), false);
  status.dispose(); assert.equal(Object.hasOwn(query.execute().impulses[0], 'triageStatus'), false);
});
