'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultCompanionState } = require('../src/core/companion-state');
const { SurpriseDirector } = require('../src/core/surprise-director');

function manifest() {
  return { version: 1, packId: 'builtin-core', assets: [], cues: [{
    id: 'egg.test', familyId: 'ambient.test', kind: 'ambient', weight: 1, priority: 10, cost: 1,
    globalCooldownMs: 0, familyCooldownMs: 0, cooldownMs: 0, focusAllowed: true,
    discoveryId: 'discovery.test',
    variants: [
      { id: 'default', animationId: 'workout', message: 'hi', durationMs: 1000, assetIds: [], static: false },
      { id: 'static', animationId: 'static-pose', message: 'hi', durationMs: 1000, assetIds: [], static: true }
    ]
  }] };
}

function harness(initial = defaultCompanionState()) {
  let state = structuredClone(initial);
  let now = 1000;
  let monotonicNow = 0;
  const deliveries = [];
  const timers = [];
  const director = new SurpriseDirector({
    manifest: manifest(),
    loadState: () => state,
    saveState: next => { state = structuredClone(next); },
    clock: { now: () => now, dayKey: () => '2026-08-31' },
    monotonicClock: { now: () => monotonicNow },
    rng: () => 0,
    idFactory: () => 'decision-test',
    retryDelayMs: 100,
    ttlMs: 500,
    deliver: envelope => deliveries.push(envelope),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {}
  });
  return {
    director, deliveries, timers,
    state: () => state,
    setNow: value => { now = value; },
    setMonotonicNow: value => { monotonicNow = value; },
    runNext: () => { const timer = timers.shift(); assert.ok(timer); timer.callback(); return timer; }
  };
}

const context = { visible: true, activityMode: 'balanced' };

test('ACK transitions are monotonic and duplicate or out-of-order delivery is harmless', () => {
  const h = harness();
  const issued = h.director.tick(context);
  assert.equal(issued.issued, true);
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'started' }).reason, 'out-of-order');
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'received' }).status, 'received');
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'received' }).duplicate, true);
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'started' }).status, 'started');
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'received' }).duplicate, true);
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'completed' }).status, 'completed');
  assert.equal(h.director.acknowledge({ decisionId: 'decision-test', status: 'completed' }).duplicate, true);
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().collection.discoveries['discovery.test'], 1000);
});

test('an unacknowledged cue is retried twice and then cancelled at TTL', () => {
  const h = harness();
  h.director.tick(context);
  assert.equal(h.deliveries.length, 1);
  h.setNow(1100); h.runNext();
  assert.equal(h.deliveries.length, 2);
  assert.deepEqual(h.deliveries[1], h.deliveries[0]);
  h.setNow(1200); h.runNext();
  assert.equal(h.deliveries.length, 3);
  assert.deepEqual(h.deliveries[2], h.deliveries[0]);
  assert.equal(h.state().surprise.pending.attempts, 3);
  h.setNow(1500); h.runNext();
  assert.equal(h.deliveries.length, 3);
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.recent.at(-1).outcome, 'cancelled');
});

test('a wall-clock rollback cannot extend a cue beyond its monotonic TTL', () => {
  const h = harness();
  h.director.tick(context);
  h.setNow(500);
  h.setMonotonicNow(500);
  h.runNext();
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.recent.at(-1).finishedAt, 1000);
});

test('restart cleanup cancels persisted work without replaying it', () => {
  const state = defaultCompanionState();
  state.surprise.pending = {
    decisionId: 'old-decision', cueId: 'egg.test', familyId: 'ambient.test',
    issuedAt: 500, expiresAt: 1000, status: 'started', attempts: 1
  };
  const h = harness(state);
  const result = h.director.recoverAfterRestart();
  assert.equal(result.cleaned, true);
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.recent[0].outcome, 'cancelled');
});

test('policy changes cancel only cues that become disallowed', () => {
  const h = harness();
  h.director.tick({ ...context, focused: true });
  assert.equal(h.director.updateContext({ ...context, focused: true }).cancelled, false);
  const result = h.director.updateContext({ ...context, dnd: true });
  assert.equal(result.cancelled, true);
  assert.equal(result.reason, 'dnd');
  assert.equal(h.deliveries.at(-1).cancel, true);
  assert.equal(h.state().surprise.recent.at(-1).outcome, 'cancelled');
});
