'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SurpriseDirector } = require('../src/core/surprise-director');
const { defaultCompanionState } = require('../src/core/companion-state');

function harness() {
  let state = defaultCompanionState(), now = Date.UTC(2026, 9, 12, 20, 42), sequence = 0;
  let failure = null;
  const timers = new Map(), deliveries = [], delays = [];
  const cue = { id: 'egg.test', familyId: 'ambient.test', kind: 'ambient', weight: 1,
    priority: 10, cost: 1, globalCooldownMs: 0, familyCooldownMs: 0, cooldownMs: 0,
    focusAllowed: true, discoveryId: 'discovery.test', variants: [
      { id: 'default', animationId: 'workout', message: '', durationMs: 1000, assetIds: [], static: false }
    ] };
  const director = new SurpriseDirector({ manifest: { version: 1, packId: 'builtin-core', assets: [], cues: [cue] },
    loadState: () => state, saveState: next => {
      if (failure === 'before') throw new Error('save-failure');
      state = structuredClone(next);
      if (failure === 'after') throw new Error('save-failure-after-commit');
    }, clock: { now: () => now, dayKey: timestamp => new Date(timestamp).toISOString().slice(0, 10) },
    rng: () => 0, idFactory: () => 'same-decision', deliver: envelope => deliveries.push(envelope),
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, fn); delays.push(delay); return id; },
    clearTimeout: id => timers.delete(id) });
  return { director, timers, deliveries, delays, state: () => state,
    setState: next => { state = next; }, fail: value => { failure = value; },
    setNow: value => { now = value; }, advance: ms => { now += ms; },
    fire: () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); } };
}

test('a failed terminal commit keeps the original pending identity and retries settlement without presentation', () => {
  const h = harness();
  h.director.tick({ visible: true });
  const before = structuredClone(h.state());
  h.fail('before');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' }), /save-failure/);
  assert.deepEqual(h.state(), before);
  assert.equal(h.timers.size, 1);
  assert.equal(h.director.envelopes.size, 1);
  assert.equal(h.director.deliveryDeadlines.size, 1);
  h.fail(null); h.advance(100_000); h.fire();
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.ambientSpent, 0);
  assert.deepEqual(h.state().surprise.recent.map(item => [item.decisionId, item.outcome]), [['same-decision', 'rejected']]);
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.timers.size + h.director.envelopes.size + h.director.deliveryDeadlines.size, 0);
  h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' });
  assert.equal(h.state().surprise.ambientSpent, 0);
});

test('TTL save failures rearm one bounded timer, then refund exactly once when storage recovers', () => {
  const h = harness(); h.director.tick({ visible: true }); h.advance(20_000); h.fail('before');
  for (let i = 0; i < 9; i++) {
    assert.doesNotThrow(h.fire);
    assert.equal(h.timers.size, 1);
    assert.equal(h.state().surprise.pending.decisionId, 'same-decision');
    assert.equal(h.state().surprise.ambientSpent, 1);
    assert.ok(h.delays.at(-1) >= 1_000 && h.delays.at(-1) <= 30_000);
  }
  assert.equal(h.deliveries.length, 1);
  h.fail(null); h.fire();
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.ambientSpent, 0);
  assert.equal(h.state().surprise.recent.length, 1);
  assert.equal(h.timers.size, 0);
});

test('failed completion preserves the completed outcome and discovery without replay or refund', () => {
  const h = harness(); h.director.tick({ visible: true });
  for (const status of ['received', 'started']) h.director.acknowledge({ decisionId: 'same-decision', status });
  h.fail('before');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'completed' }), /save-failure/);
  assert.equal(Object.keys(h.state().collection.discoveries).length, 0);
  h.fail(null); h.advance(100_000); h.fire();
  assert.equal(h.state().surprise.recent[0].outcome, 'completed');
  assert.equal(h.state().surprise.ambientSpent, 1);
  assert.equal(Object.keys(h.state().collection.discoveries).length, 1);
  assert.equal(h.deliveries.length, 1);
});

test('restart cleanup save failure remains recoverable without re-delivery', () => {
  const h = harness(); h.director.tick({ visible: true }); h.fail('before');
  assert.throws(() => h.director.recoverAfterRestart(), /save-failure/);
  assert.equal(h.timers.size, 1);
  h.fail(null); h.fire();
  assert.equal(h.state().surprise.pending, null);
  assert.equal(h.state().surprise.ambientSpent, 0);
  assert.equal(h.director.recoverAfterRestart().cleaned, false);
  assert.equal(h.deliveries.length, 1);
});

test('a commit that succeeded before an error is observed is not refunded twice', () => {
  const h = harness(); h.director.tick({ visible: true }); h.fail('after');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' }), /after-commit/);
  assert.equal(h.state().surprise.pending, null);
  h.fail(null); h.fire();
  assert.equal(h.state().surprise.ambientSpent, 0);
  assert.equal(h.state().surprise.recent.length, 1);
  assert.equal(h.director.envelopes.size + h.director.deliveryDeadlines.size + h.timers.size, 0);
});

test('disposal invalidates a queued persistence retry', () => {
  const h = harness(); h.director.tick({ visible: true }); h.fail('before');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' }));
  const callback = h.timers.values().next().value;
  h.director.dispose(); h.fail(null); callback();
  assert.equal(h.state().surprise.pending.decisionId, 'same-decision');
  assert.equal(h.timers.size, 0);
});

test('a wall day before the persisted budget day cannot issue or spend a future-day allowance', () => {
  const h = harness(), state = h.state();
  state.surprise.budgetDay = '2026-10-13'; state.surprise.ambientSpent = 3;
  const before = structuredClone(state);
  assert.deepEqual(h.director.tick({ visible: true }), { issued: false, reason: 'budget-clock-rollback' });
  assert.deepEqual(h.state(), before);
  assert.equal(h.deliveries.length, 0);
  h.setNow(Date.UTC(2026, 9, 13, 0, 1));
  assert.equal(h.director.tick({ visible: true }).issued, true);
  assert.equal(h.state().surprise.ambientSpent, 4);
  h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' });
  assert.equal(h.state().surprise.ambientSpent, 3);
});


test('context changes and a different terminal ACK cannot replace a failed completion intent', () => {
  const h = harness(); h.director.tick({ visible: true });
  for (const status of ['received', 'started']) h.director.acknowledge({ decisionId: 'same-decision', status });
  h.fail('before');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'completed' }));
  const timer = h.timers.keys().next().value;
  h.fail(null);
  assert.equal(h.director.updateContext({ visible: true, sessionActive: true }).reason, 'settlement-pending');
  assert.equal(h.director.acknowledge({ decisionId: 'same-decision', status: 'cancelled' }).reason, 'settlement-pending');
  assert.equal(h.timers.keys().next().value, timer);
  assert.equal(h.deliveries.length, 1);
  h.fire();
  assert.equal(h.state().surprise.recent[0].outcome, 'completed');
  assert.equal(Object.keys(h.state().collection.discoveries).length, 1);
  assert.equal(h.director.settlementIntent, null);
});

test('late received/started ACK and delivery rearming cannot steal a failed rejection intent', () => {
  const h = harness(); h.director.tick({ visible: true });
  h.director.acknowledge({ decisionId: 'same-decision', status: 'received' });
  h.fail('before');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' }));
  const timer = h.timers.keys().next().value;
  h.fail(null);
  for (const status of ['received', 'started']) {
    assert.equal(h.director.acknowledge({ decisionId: 'same-decision', status }).reason, 'settlement-pending');
  }
  h.director.armDeliveryTimer('same-decision');
  assert.equal(h.timers.keys().next().value, timer);
  h.advance(20_000); h.fire();
  assert.equal(h.state().surprise.ambientSpent, 0);
  assert.equal(h.state().surprise.recent[0].outcome, 'rejected');
  assert.equal(h.deliveries.length, 1);
});


test('a new tick reconciles a committed terminal intent before replacing its queued retry timer', () => {
  const h = harness(); h.director.tick({ visible: true }); h.fail('after');
  assert.throws(() => h.director.acknowledge({ decisionId: 'same-decision', status: 'rejected' }));
  const oldCallback = h.timers.values().next().value;
  h.fail(null); h.advance(3_601_000); h.director.idFactory = () => 'new-decision';
  assert.equal(h.director.tick({ visible: true }).issued, true);
  assert.equal(h.state().surprise.pending.decisionId, 'new-decision');
  assert.deepEqual([...h.director.envelopes.keys()], ['new-decision']);
  assert.deepEqual([...h.director.deliveryDeadlines.keys()], ['new-decision']);
  assert.equal(h.director.settlementIntent, null);
  const newTimer = h.timers.keys().next().value;
  oldCallback();
  assert.equal(h.timers.keys().next().value, newTimer);
  assert.equal(h.timers.size, 1);
  assert.equal(h.state().surprise.ambientSpent, 1);
});
