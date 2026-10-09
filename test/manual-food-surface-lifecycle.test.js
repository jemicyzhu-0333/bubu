'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetFeeding } = require('../src/surfaces/pet/feeding.mjs');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const feedState = () => ({ satiation: 40, foodInventory: { berry: 2 }, totalFeeds: 0, basicMeal: { dayKey: '2026-10-07', limit: 3, remaining: 3, eligible: true, reason: null } });
function fixture(overrides = {}) {
  const sent = [], accepted = [], speech = [], rendered = [];
  let now = 1000, read = feedState, send = async () => ({ ok: true, animation: 'happy' });
  const feeding = createPetFeeding({ client: { pet_feed: request => { sent.push(request); return send(request); }, pet_getFeedState: () => read() },
    clock: { read: () => 0 }, now: () => now, nonce: () => 'fixture', present() {}, say: value => speech.push(value),
    render: value => rendered.push(value), onFeedAccepted: (...args) => accepted.push(args), ...overrides });
  return { feeding, sent, accepted, speech, rendered, setSend: value => { send = value; }, setRead: value => { read = value; }, setNow: value => { now = value; } };
}
test('actual pet feeding coalesces double click and sends a closed request identity', async () => {
  const h = fixture(), pending = deferred(); h.setSend(() => pending.promise);
  const first = h.feeding.feedPet('berry'); const second = h.feeding.feedPet('berry');
  assert.equal(h.sent.length, 1); assert.deepEqual(h.sent[0], { foodId: 'berry', commandId: '1000-fixture', issuedAt: 1000 });
  pending.resolve({ ok: true, animation: 'happy' }); await Promise.all([first, second]); assert.equal(h.accepted.length, 1);
});

test('unknown pet result retries the same identity and presents the replay once', async () => {
  const h = fixture(); h.setSend(async () => { throw new Error('transport lost after commit'); });
  await h.feeding.feedPet('berry');
  h.setSend(async () => ({ ok: true, replayed: true, animation: 'happy' }));
  await h.feeding.feedPet('berry');
  assert.deepEqual(h.sent[0], h.sent[1]); assert.equal(h.accepted.length, 1);
});
test('expired unresolved pet request cannot release its identity after failed or invalid refresh', async () => {
  const h = fixture(); h.setSend(async () => undefined); await h.feeding.feedPet('berry');
  h.setNow(601001); h.setRead(async () => { throw new Error('offline'); });
  await h.feeding.feedPet('berry'); assert.equal(h.sent.length, 1); assert.match(h.speech.at(-1), /刷新失败/);
  h.setRead(() => ({ ok: false })); await h.feeding.feedPet('berry'); assert.equal(h.sent.length, 1);
  h.setRead(feedState); await h.feeding.feedPet('berry'); assert.equal(h.sent.length, 1); assert.match(h.speech.at(-1), /核对后/);
  await h.feeding.feedPet('berry'); assert.equal(h.sent.length, 2); assert.notEqual(h.sent[0].commandId, h.sent[1].commandId);
});
test('backend expiry requires a verified refresh and a separate explicit click', async () => {
  const h = fixture(); h.setSend(async () => ({ ok: false, reason: 'food-command-expired' }));
  await h.feeding.feedPet('berry'); assert.equal(h.sent.length, 1); assert.equal(h.rendered.length, 1);
  assert.match(h.speech.at(-1), /核对后/); assert.equal(h.accepted.length, 0);
});
for (const reason of ['basic-meal-limit', 'basic-meal-not-needed', 'food-command-capacity', 'food-inventory-full', 'food-counter-capacity', 'meal-version-capacity']) {
  test(`terminal ${reason} releases the request without a meal effect`, async () => {
    const h = fixture(); h.setSend(async () => ({ ok: false, reason }));
    await h.feeding.feedPet('basic'); h.setNow(2000); await h.feeding.feedPet('basic');
    assert.notEqual(h.sent[0].commandId, h.sent[1].commandId); assert.equal(h.accepted.length, 0);
  });
}
for (const success of [true, false]) {
  test(`close/reopen ignores stale pet ${success ? 'success' : 'failure'} presentation without losing its request`, async () => {
    const h = fixture(), pending = deferred(); h.setSend(() => pending.promise);
    const operation = h.feeding.feedPet('berry'); h.feeding.cancel('menu-closed'); h.feeding.cancel('menu-open');
    pending.resolve(success ? { ok: true, animation: 'happy', reaction: 'old' } : undefined); await operation;
    assert.equal(h.accepted.length, 0); assert.equal(h.speech.length, 0); assert.equal(h.rendered.length, 0);
    h.setNow(2000); h.setSend(async () => ({ ok: true })); await h.feeding.feedPet('berry');
    assert.equal(h.sent[0].commandId === h.sent[1].commandId, !success);
  });
}
test('a failed postcommit refresh or animation does not lose a successful receipt', async () => {
  const h = fixture({ onFeedAccepted: () => { throw new Error('animation failure'); } });
  h.setRead(async () => { throw new Error('read failure'); });
  assert.equal((await h.feeding.feedPet('berry')).ok, true);
  h.setNow(2000); await h.feeding.feedPet('berry'); assert.notEqual(h.sent[0].commandId, h.sent[1].commandId);
});
test('hidden and replaced presentation do not speak late reactions', async () => {
  const reactions = []; let visible = true;
  const h = fixture({ scheduleReaction: fn => reactions.push(fn), canPresent: () => visible });
  h.setSend(async () => ({ ok: true, animation: 'happy', reaction: 'late reaction' }));
  await h.feeding.feedPet('berry'); visible = false; reactions[0](); assert.equal(h.speech.length, 0);
  visible = true; h.feeding.cancel('closed'); reactions[0](); assert.equal(h.speech.length, 0);
});
