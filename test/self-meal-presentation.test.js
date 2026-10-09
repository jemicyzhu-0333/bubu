'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetFeeding } = require('../src/surfaces/pet/feeding.mjs');
const { createPetSync } = require('../src/surfaces/pet/sync.mjs');
const { createPetSpeech } = require('../src/surfaces/pet/speech.mjs');
const { FOODS } = require('../src/content/legacy-pet-content');
const meal = { foodId: 'berry', automatic: true, animation: 'happy', reaction: '本地短句', satiation: 80 };
function fixture({ calm = false } = {}) {
  const timers = new Map(), shown = [], speech = [], actions = [];
  let id = 0, feeds = 0, reads = 0, hidden = false, allowed = true, now = 0, speechCancelled = 0;
  const feeding = createPetFeeding({ client: { pet_feed: () => { feeds++; }, pet_getFeedState: () => { reads++; } },
    content: () => ({ FOODS }), clock: { read: () => now }, present: event => shown.push(event),
    say: value => { speech.push(value); return () => speechCancelled++; },
    presentAction: () => { actions.push('start'); return () => actions.push('cancel'); },
    canPresent: () => !hidden, canPresentAutomatic: () => allowed, calm: () => calm,
    scheduleReaction: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clearReaction: key => timers.delete(key) });
  return { feeding, timers, shown, speech, actions, counts: () => ({ feeds, reads, speechCancelled }),
    hidden: value => { hidden = value; }, allowed: value => { allowed = value; }, time: value => { now = value; },
    speak: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(t => t.fn()); } };
}
test('selfMeal only presents the committed meal; no feed command, getter or canonical field mutation', () => {
  const f = fixture(), handlers = {}, canonical = [];
  createPetSync({ client: { onPetSync: fn => { handlers.sync = fn; } }, onSync: value => canonical.push(value),
    onSelfMeal: value => f.feeding.presentMeal(value) }).connect();
  handlers.sync({ selfMeal: meal }); f.speak();
  assert.deepEqual(f.counts(), { feeds: 0, reads: 0, speechCancelled: 0 }); assert.deepEqual(f.speech, [meal.reaction]);
  assert.equal(canonical[0].satiation, undefined); assert.equal(f.shown[0].cancel, undefined);
  assert.equal(f.feeding.presentMeal({ ...meal, automatic: false }), false);
  assert.equal(f.feeding.presentMeal({ ...meal, foodId: 'not-food' }), false);
});
for (const reason of ['hidden', 'replaced', 'disposed', 'skin-changed']) {
  test(`${reason} physically clears delayed meal speech and cancels owned action`, () => {
    const f = fixture(); f.feeding.presentMeal(meal); const late = [...f.timers.values()][0].fn;
    f.feeding.cancel(reason); assert.equal(f.timers.size, 0); late(); assert.deepEqual(f.speech, []);
    assert.deepEqual(f.actions, ['start', 'cancel']);
  });
}
test('already-visible meal speech is owned and cancelled on hide without cancelling a newer speaker', () => {
  const classes = new Set(), timers = new Map(); let id = 0;
  const bubble = { dataset: {}, classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) } };
  const speech = createPetSpeech({ bubble, setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key) });
  const cancel = speech.sayOwned('meal', 3000); assert.equal(speech.visible(), true); cancel(); assert.equal(speech.visible(), false);
  const old = speech.sayOwned('meal', 3000); speech.say('new speaker'); old(); assert.equal(speech.visible(), true);
  assert.equal(bubble.textContent, 'new speaker'); speech.hide(); assert.equal(timers.size, 0);
});
test('policy changes suppress delayed speech and end automatic presentation', () => {
  const f = fixture(); f.feeding.presentMeal(meal); f.allowed(false); f.speak();
  assert.equal(f.feeding.advance(), true); assert.deepEqual(f.speech, []); assert.equal(f.timers.size, 0);
});
test('reduced motion keeps static feedback and text without ritual action', () => {
  const f = fixture({ calm: true }); assert.equal(f.feeding.presentMeal(meal), true); f.speak();
  assert.deepEqual(f.actions, []); assert.equal(f.shown.length, 1); assert.deepEqual(f.speech, [meal.reaction]);
  f.time(1600); f.feeding.advance(); assert.equal(f.timers.size, 0);
});
test('canonical-only sync does not create or replace a meal presentation', () => {
  const f = fixture(), handlers = {};
  createPetSync({ client: { onPetSync: fn => { handlers.sync = fn; } }, onSync() {},
    onSelfMeal: value => f.feeding.presentMeal(value) }).connect();
  handlers.sync({ selfMeal: meal }); const before = f.shown.length;
  handlers.sync({ contextRevision: 1, satiation: 80 }); handlers.sync({});
  assert.equal(f.shown.length, before); assert.equal(f.timers.size, 1);
});

for (const end of ['hidden', 'skin', 'dispose']) test(`actual pet controller selfMeal has no feed IPC and cancels on ${end}`, async t => {
  const { createHarness, settle, send, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
  let feeds = 0;
  const h = createHarness({ bridgeOverrides: { pet_feed: () => { feeds++; },
    pet_getContent: async () => ({ ...PET_CONTENT_PAYLOAD, FOODS }) } });
  t.after(() => h.runtime.stop()); await settle();
  send(h, { selfMeal: meal });
  assert.equal(feeds, 0); assert.equal([...h.timers.timeouts.values()].filter(t => t.delay === 400).length, 1);
  if (end === 'hidden') { h.document.hidden = true; h.document.dispatch('visibilitychange'); }
  if (end === 'skin') send(h, { skin: 'usagi' });
  if (end === 'dispose') h.runtime.stop();
  assert.equal([...h.timers.timeouts.values()].filter(t => t.delay === 400).length, 0); assert.equal(feeds, 0);
});

for (const mode of ['quiet', 'off']) test(`actual shared settings publication withdraws queued and visible automatic speech in ${mode}`, async t => {
  const { createHarness, settle, send, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
  const { harness, app } = require('../test-support/surface-sync-fixture');
  for (const speakFirst of [false, true]) {
    const h = createHarness({ bridgeOverrides: { pet_getContent: async () => ({ ...PET_CONTENT_PAYLOAD, FOODS }) } });
    t.after(() => h.runtime.stop()); await settle();
    const s = harness(); s.publish({ all: true }); send(h, s.message('pet')); send(h, { selfMeal: meal });
    if (speakFirst) h.fireTimeoutByDelay(400);
    const update = app.createUpdatePreferencesWorkflow({ ...s.ports, publish: s.publishFact({ settings: true }) });
    assert.equal(update.execute({ patch: { petActivityMode: mode } }).ok, true);
    const packet = s.message('pet'); assert.equal(packet.petActivityMode, mode); send(h, packet);
    assert.equal([...h.timers.timeouts.values()].filter(t => t.delay === 400).length, 0);
    if (speakFirst) assert.equal(h.document.getElementById('bubble').classList.contains('show'), false);
    else assert.notEqual(h.document.getElementById('bubble').textContent, meal.reaction);
    h.runtime.stop();
  }
});
for (const policy of [{ baseState: 'focused' }, { dnd: true }, { petActivityMode: 'quiet' }]) {
  test(`automatic static speech still obeys ${Object.keys(policy)[0]} after its ritual completes`, async t => {
    const { createHarness, settle, send, PET_CONTENT_PAYLOAD } = require('../test-support/pet-sync-fixture');
    const h = createHarness({ initialState: { motionMode: 'reduced' },
      bridgeOverrides: { pet_getContent: async () => ({ ...PET_CONTENT_PAYLOAD, FOODS }) } });
    t.after(() => h.runtime.stop()); await settle(); send(h, { selfMeal: meal }); h.fireTimeoutByDelay(400);
    h.frameBy(200, 15); assert.equal(h.document.getElementById('bubble').classList.contains('show'), true);
    send(h, policy); assert.equal(h.document.getElementById('bubble').classList.contains('show'), false);
    if (policy.baseState) assert.equal(h.runtime.sample().state, policy.baseState);
  });
}


test('automatic ritual completion has no unowned celebration while manual celebration stays intact', () => {
  let now = 0; const celebrations = [];
  const feeding = createPetFeeding({ client: { pet_feed() {} }, content: () => ({ FOODS }), clock: { read: () => now },
    present() {}, calm: () => true, onPresentationComplete: duration => celebrations.push(duration) });
  assert.equal(feeding.presentMeal(meal), true); now = 1600; feeding.advance(); assert.deepEqual(celebrations, []);
  feeding.start('happy', 'berry'); now = 3200; feeding.advance(); assert.deepEqual(celebrations, [2500]);
});
