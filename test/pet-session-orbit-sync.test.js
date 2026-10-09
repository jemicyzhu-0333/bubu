'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, deferred, settle, snapshot, ring, send } = require('../test-support/pet-sync-fixture');
const view = (phase = 'focus', sessionId = 'orbit') => ({ ...ring(sessionId), kind: 'focus', phase, reason: null,
  running: phase === 'focus', ...(phase === 'complete' ? { plannedMs: 0, elapsedMs: 0 } : {}) });
const status = h => h.document.getElementById('sessionStatus');
const phase = h => h.document.getElementById('stage').dataset.sessionPhase;
for (const skin of ['pink', 'usagi']) test(`${skin}: canonical icon, idle clear and panel-only activation preserve stage geometry`, async t => {
  const calls = [];
  const h = createHarness({ initialState: snapshot({ skin, state: 'focused', focusRing: ring(), sessionDisplay: view() }),
    bridgeOverrides: { pet_openPanel: () => { calls.push('panel'); }, pet_startFocus: () => { calls.push('start'); },
      pet_feed: () => { calls.push('feed'); }, pet_interaction: () => { calls.push('interaction'); } } });
  t.after(() => h.runtime.stop()); await settle();
  const hit = h.document.getElementById('petHit'), geometry = { ...hit.style };
  assert.equal(phase(h), 'focus'); assert.equal(h.document.getElementById('stage').dataset.ring, undefined);
  assert.equal(status(h).getAttribute('tabindex'), '0');
  status(h).dispatch('click', { stopPropagation() {} }); await settle(); assert.deepEqual(calls, ['panel']);
  for (const next of ['paused', 'task-completed', 'attention', 'confirm', 'break', 'complete']) {
    send(h, { sessionDisplay: view(next), skin }); assert.equal(phase(h), next);
    assert.deepEqual(hit.style, geometry);
  }
  send(h, { sessionDisplay: null, focusRing: null }); assert.equal(phase(h), undefined);
  assert.equal(status(h).getAttribute('tabindex'), '-1');
  send(h, { focusRing: ring('legacy-late') }); assert.equal(phase(h), undefined);
  assert.equal(h.document.getElementById('stage').dataset.ring, undefined, 'late compatibility updates cannot revive canonical idle');
});
for (const incoming of [7, 8]) test(`stale/equal hydration ${incoming} cannot restore completed live display`, async t => {
  const state = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise } });
  t.after(() => h.runtime.stop());
  send(h, { contextRevision: 8, sessionDisplay: null, baseState: 'idle' });
  state.resolve(snapshot({ contextRevision: incoming, sessionDisplay: view(), state: 'focused' })); await settle();
  assert.equal(phase(h), undefined); assert.equal(status(h).getAttribute('tabindex'), '-1');
});
test('newer hydration repairs canonical gaps, same revision live can supersede hydration once', async t => {
  const state = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise } }); t.after(() => h.runtime.stop());
  send(h, { contextRevision: 3, sessionDisplay: view('focus', 'old') });
  state.resolve(snapshot({ contextRevision: 9, sessionDisplay: view('paused', 'new') })); await settle();
  assert.equal(phase(h), 'paused');
  send(h, { contextRevision: 9, sessionDisplay: view('confirm') }); assert.equal(phase(h), 'confirm');
  send(h, { contextRevision: 9, sessionDisplay: null }); assert.equal(phase(h), 'confirm');
  send(h, { contextRevision: 12, sessionDisplay: view('complete') }); assert.equal(phase(h), 'complete');
  send(h, { contextRevision: 10, sessionDisplay: null, message: 'Independent feedback' });
  assert.equal(phase(h), 'complete'); assert.equal(h.document.getElementById('bubble').textContent, 'Independent feedback');
});
test('independent live completion survives newer late hydration and slow content never replays snapshot', async t => {
  const state = deferred(), content = deferred();
  const h = createHarness({ bridgeOverrides: { pet_getState: () => state.promise, pet_getContent: () => content.promise } });
  t.after(() => h.runtime.stop());
  send(h, { contextRevision: 3, sessionDisplay: view() }); send(h, { sessionDisplay: null });
  state.resolve(snapshot({ contextRevision: 9, sessionDisplay: view('break') })); await settle(); assert.equal(phase(h), undefined);
  send(h, { contextRevision: 10, sessionDisplay: view('attention') });
  content.resolve({ manifest: { cues: [] }, EXPRESSIONS: [], INTERACTIONS: { clickCount: {} } }); await settle();
  assert.equal(phase(h), 'attention');
});
for (const settings of [{ stimulationMode: 'low', motionMode: 'full' }, { stimulationMode: 'high', motionMode: 'reduced' }]) {
  test(`sensory policy before initial and live orbit ${JSON.stringify(settings)}`, async t => {
    const h = createHarness({ initialState: snapshot({ ...settings, sessionDisplay: { ...view(), plannedMs: 120000, elapsedMs: 58000 } }) });
    t.after(() => h.runtime.stop()); await settle();
    const arc = h.document.getElementById('sessionOrbitArc'); assert.equal(arc.getAttribute('stroke-dashoffset'), '75');
    send(h, { contextRevision: 1, ...settings, sessionDisplay: { ...view(), plannedMs: 120000, elapsedMs: 59000 } });
    assert.equal(arc.getAttribute('stroke-dashoffset'), '75');
  });
}
test('hidden, lock, dock and disposal remove session keyboard focus without extra schedulers', async t => {
  const h = createHarness({ initialState: snapshot({ sessionDisplay: view() }) }); t.after(() => h.runtime.stop()); await settle();
  const intervals = h.timers.intervals.length;
  const suspended = [
    [() => { h.document.hidden = true; h.document.dispatch('visibilitychange'); }, () => { h.document.hidden = false; h.document.dispatch('visibilitychange'); }],
    [() => send(h, { screenLocked: true }), () => send(h, { screenLocked: false })],
    [() => h.bridge.handlers.dock({ edge: 'left' }), () => h.bridge.handlers.dock({ edge: null })]
  ];
  for (const [hide, show] of suspended) {
    hide(); assert.equal(status(h).getAttribute('tabindex'), '-1');
    show(); h.frameBy(250); assert.equal(status(h).getAttribute('tabindex'), '0');
  }
  assert.equal(h.timers.intervals.length, intervals);
  assert.equal(h.timers.rafCallbacks.length, 1);
  h.runtime.stop(); assert.equal(status(h).getAttribute('tabindex'), '-1');
  send(h, { contextRevision: 10, sessionDisplay: view() }); assert.equal(status(h).getAttribute('tabindex'), '-1');
});

test('system reduce motion change immediately quantizes without waiting for another canonical update', async t => {
  const h = createHarness({ initialState: snapshot({ motionMode: 'balanced', sessionDisplay: { ...view(), plannedMs: 120000, elapsedMs: 58000 } }) });
  t.after(() => h.runtime.stop()); await settle();
  const arc = h.document.getElementById('sessionOrbitArc'); assert.notEqual(arc.getAttribute('stroke-dashoffset'), '75');
  h.window.setReducedMotion(true); assert.equal(arc.getAttribute('stroke-dashoffset'), '75');
  h.window.setReducedMotion(false); assert.notEqual(arc.getAttribute('stroke-dashoffset'), '75');
});
