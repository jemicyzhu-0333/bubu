'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, START } = require('../test-support/growth-food-fixture');

test('manual food commits inventory, care, role taste and a receipt once without awarding XP', () => {
  const f = fixture(); f.edit(s => { s.pet.satiation = 50; s.pet.foodInventory.fish = 1; });
  const request = f.request('fish'), result = f.feed.execute(request), state = f.read();
  assert.equal(result.ok, true); assert.equal(result.gainedXp, 0); assert.equal(result.satiation, 65);
  assert.equal(result.totalFeeds, 1); assert.equal(result.favorite, false); assert.equal(result.replayed, false);
  assert.equal(state.pet.foodInventory.fish, 0); assert.equal(state.xp, 0); assert.equal(f.revision(), 1);
  assert.equal(state.companion.relationships.dango.bondPoints, 1);
  assert.equal(state.companion.relationships.dango.foodAffinity.fish, 1);
  assert.equal(state.pet.foodCommands.length, 1); assert.equal(f.effects.length, 1);
  f.edit(s => { s.pet.satiation = 10; });
  assert.equal(f.feed.execute(request).satiation, 65, 'receipt returns original result before current state checks');
  assert.equal(f.feed.execute(request).replayed, true); assert.equal(f.revision(), 1); assert.equal(f.effects.length, 1);
});
test('invalid identities, stock, payload conflicts, and revision conflicts make no writes', () => {
  const f = fixture(), first = f.request('berry');
  assert.equal(f.feed.execute({ foodId: 'berry' }).reason, 'invalid-food-command');
  assert.equal(f.feed.execute({ ...first, commandId: 'invalid' }).reason, 'invalid-food-command');
  assert.equal(f.feed.execute(f.request('fish')).reason, 'out-of-stock');
  assert.equal(f.feed.execute(first).ok, true);
  assert.equal(f.feed.execute({ ...first, foodId: 'carrot' }).reason, 'food-command-conflict');
  assert.equal(f.buy.execute(first).reason, 'food-command-conflict');
  assert.equal(f.feed.execute({ ...f.request('berry'), expectedRevision: 0 }).reason, 'state-revision-conflict');
  assert.equal(f.revision(), 1); assert.equal(f.effects.length, 1);
});
test('manual care claim stays profile-wide while every non-basic food records its own taste', () => {
  const f = fixture(); f.edit(s => { s.pet.foodInventory.carrot = 2; });
  f.feed.execute(f.request('berry')); f.edit(s => { s.currentSkin = 'usagi'; });
  const result = f.feed.execute(f.request('carrot')), state = f.read();
  assert.equal(result.favorite, true); assert.equal(state.companion.relationships.usagi.bondPoints, 0);
  assert.equal(state.companion.relationships.usagi.foodAffinity.carrot, 1); assert.equal(state.pet.totalFeeds, 2);
  assert.equal(state.pet.foodTickets, 6); assert.equal(state.level, 1); assert.equal(state.xp, 0);
  assert.equal(Object.hasOwn(state.pet, 'dailyFeedXp'), false); assert.equal(Object.hasOwn(state.pet, 'coffeeBonusUntil'), false);
});
test('manual feeds invalidate pending advice and accepted plans and preserve fractional satiation', () => {
  const f = fixture(); f.edit(s => {
    s.pet.satiation = 45.5; s.pet.care.decision = { id: `${START}:0`, expiresAt: START + 30000, slot: 'breakfast' };
    s.pet.care.plan = { foodId: 'berry', reactionIndex: 1, slot: 'breakfast', expiresAt: START + 360000 };
    s.pet.care.nextMealAt = START + 300000;
  });
  assert.equal(f.feed.execute(f.request('berry')).satiation, 53.5);
  assert.equal(f.read().pet.care.decision, null); assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.care.nextMealAt, null);
});
test('failed commit and saturated counters roll back stock, bond, care and receipt together', () => {
  const f = fixture(), request = f.request('berry'), before = f.read(); f.fail(true);
  assert.throws(() => f.feed.execute(request), /synthetic commit refusal/); assert.deepEqual(f.read(), before); assert.equal(f.effects.length, 0);
  f.fail(false); f.edit(s => { s.pet.totalFeeds = Number.MAX_SAFE_INTEGER; }); const saturated = f.read();
  assert.equal(f.feed.execute(request).reason, 'food-counter-capacity'); assert.deepEqual(f.read(), saturated);
  f.edit(s => { s.pet.totalFeeds = 0; s.pet.care.version = Number.MAX_SAFE_INTEGER; }); const fullVersion = f.read();
  assert.equal(f.feed.execute(request).reason, 'meal-version-capacity'); assert.deepEqual(f.read(), fullVersion);
});
test('effect failure leaves success committed and replay never retries a business effect', () => {
  let effects = 0; const f = fixture({ publish() { effects++; throw new Error('closed surface'); } });
  const request = f.request('berry'); assert.equal(f.feed.execute(request).ok, true);
  assert.equal(f.feed.execute(request).replayed, true); assert.equal(effects, 1); assert.equal(f.revision(), 1);
});

test('receipt pruning followed by clock rollback cannot feed twice with the same original identity', () => {
  const f = fixture(); f.edit(s => { s.pet.foodInventory.berry = 4; });
  const old = f.request('berry'); assert.equal(f.feed.execute(old).ok, true);
  f.time(START + 11 * 60000); assert.equal(f.feed.execute(f.request('berry')).ok, true);
  assert.equal(f.read().pet.foodCommands.some(row => row.commandId === old.commandId), false);
  f.time(START + 60000); const before = f.read();
  assert.equal(f.feed.execute(old).reason, 'food-command-expired'); assert.deepEqual(f.read(), before); assert.equal(f.read().pet.totalFeeds, 2);
});

test('delayed successful food receipt blocks pruned original and out-of-order unseen identities after rollback', () => {
  const f = fixture(); f.edit(s => { s.pet.foodInventory.berry = 4; });
  const old = f.request('berry'); f.feed.execute(old);
  f.time(START + 60000); const delayed = f.request('berry');
  f.time(START + 11 * 60000); assert.equal(f.feed.execute(delayed).ok, true);
  f.time(START + 30000); const before = f.read();
  assert.equal(f.feed.execute(old).reason, 'food-command-expired');
  assert.equal(f.feed.execute(f.request('berry')).reason, 'food-command-expired');
  assert.deepEqual(f.read(), before); assert.equal(f.feed.execute(delayed).replayed, true);
});
