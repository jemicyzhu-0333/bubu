'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('../src/capabilities/companion/contract/food-request.mjs');
const command = require('../src/capabilities/companion/domain/food-command');
const { createFoodRequestLifecycle, isFeedSnapshot, foodRequestMessage } = require('../src/surfaces/companion/food-request-lifecycle.mjs');
const { BASIC_MEAL, FOOD_ECONOMY } = require('../src/content/growth-policy.mjs');

const NOW = 1_000_000;
const state = (receipts = []) => ({ pet: { foodCommands: receipts } });
const input = (issuedAt, extra = {}) => ({ commandId: `${issuedAt}-test`, foodId: 'berry', kind: 'buy', issuedAt, now: NOW, ...extra });
const receipt = (issuedAt = NOW) => ({ commandId: `${issuedAt}-old`, foodId: 'berry', kind: 'buy', issuedAt,
  result: { ok: true, foodId: 'berry', price: 1, foodTickets: 5, inventory: 1 } });
const snapshot = () => ({ satiation: 45.5, foodInventory: {}, totalFeeds: 0, basicMeal: { remaining: 0, eligible: false } });

test('request TTL has one shared value while domain alias and distinct growth values remain stable', () => {
  assert.equal(request.FOOD_REQUEST_TTL_MS, 600000);
  assert.equal(command.COMMAND_TTL_MS, request.FOOD_REQUEST_TTL_MS);
  assert.equal(command.FUTURE_SKEW_MS, 30000);
  assert.equal(BASIC_MEAL.dailyLimit, 3); assert.equal(BASIC_MEAL.hungryAt, 45); assert.equal(BASIC_MEAL.baseline, 55);
  assert.equal(FOOD_ECONOMY.dailyTickets, 3);
});

test('command admission keeps inclusive TTL and future-skew boundaries', () => {
  for (const age of [599999, 600000, 600001]) {
    const result = command.prepareFoodCommand(state(), input(NOW - age));
    assert.equal(result.ok, age <= 600000);
    if (age > 600000) assert.equal(result.reason, 'food-command-expired');
  }
  for (const skew of [29999, 30000, 30001]) assert.equal(command.prepareFoodCommand(state(), input(NOW + skew)).ok, skew <= 30000);
});

test('retained receipts replay before expiry and conflicts or issuance rollback remain closed', () => {
  const old = receipt(0);
  const replay = command.prepareFoodCommand(state([old]), input(0, { commandId: old.commandId }));
  assert.equal(replay.ok, true); assert.equal(replay.replayed, true); assert.deepEqual(replay.result, old.result);
  assert.equal(command.prepareFoodCommand(state([old]), input(0, { commandId: old.commandId, foodId: 'rice' })).reason, 'food-command-conflict');
  const latest = receipt(NOW);
  assert.equal(command.prepareFoodCommand(state([latest]), input(NOW - 1)).reason, 'food-command-expired');
  assert.equal(command.prepareFoodCommand(state([latest]), input(NOW, { now: NOW - 1000 })).ok, true);
});

test('zero identity remains valid while dates strings fractional time and unknown food reject', () => {
  const zero = request.createFoodRequest('basic', 0, 'zero');
  assert.deepEqual(zero, { foodId: 'basic', issuedAt: 0, commandId: '0-zero' });
  assert.equal(Object.isFrozen(zero), true);
  assert.equal(command.prepareFoodCommand(state(), input(0, { now: 0 })).ok, true);
  for (const issuedAt of [null, '0', 0.5, -1, NaN, Infinity, new Date(0)]) {
    assert.throws(() => request.createFoodRequest('basic', issuedAt, 'x'), /invalid-food-request-identity/);
    assert.equal(command.prepareFoodCommand(state(), input(issuedAt)).reason, 'invalid-food-command');
  }
  assert.throws(() => request.createFoodRequest('unknown', 0, 'x'), /invalid-food-request-identity/);
});

test('receipt validation retains historical basic-meal cap and rejects old or widened shapes', () => {
  const basic = { commandId: '0-basic', kind: 'feed', foodId: 'basic', issuedAt: 0,
    result: { ok: true, foodId: 'basic', bond: null, gainedXp: 0, satiation: 55, totalFeeds: 1,
      favorite: false, animation: 'happy', reaction: '吃完了' } };
  assert.deepEqual(command.normalizeFoodReceipts([basic]), [basic]);
  for (const result of [{ ...basic.result, satiation: 55.1 }, { ...basic.result, gainedXp: 1 },
    { ...basic.result, favorite: true }, { ...basic.result, legacy: true }, { ok: true, foodId: 'basic' }]) {
    assert.throws(() => command.normalizeFoodReceipts([{ ...basic, result }]), /invalid-food-receipt/);
  }
  assert.throws(() => command.normalizeFoodReceipts([{ ...basic, extra: true }]), /invalid-food-receipt/);
});

test('renderer snapshot validation keeps its existing shallow acceptance boundary', () => {
  for (const remaining of [0, 1, 2, 3]) assert.equal(isFeedSnapshot({ ...snapshot(), basicMeal: { remaining, eligible: true } }), true);
  for (const remaining of [-1, 4, 1.5, '3', undefined, null]) assert.equal(isFeedSnapshot({ ...snapshot(), basicMeal: { remaining, eligible: true } }), false);
  assert.equal(isFeedSnapshot({ ...snapshot(), foodInventory: { unknown: 'unchecked' }, extra: true }), true);
  assert.equal(isFeedSnapshot({ ...snapshot(), foodInventory: [] }), false);
  assert.equal(isFeedSnapshot({ ...snapshot(), basicMeal: undefined }), false);
  assert.equal(isFeedSnapshot({ ...snapshot(), satiation: NaN }), false);
});

test('renderer messages retain exact existing numbers and unknown-result wording', () => {
  assert.equal(foodRequestMessage({ result: { reason: 'basic-meal-not-needed' } }), '现在还不饿，基础餐留到饱食不高于 45 时。');
  assert.equal(foodRequestMessage({ result: { reason: 'insufficient-food-tickets' } }), '食物券不足，今天首次推进后可获得 3 张。');
  assert.equal(foodRequestMessage({ unresolved: true }), '上次喂食结果尚未确认，再次点击会核对同一请求。');
  assert.equal(foodRequestMessage({ result: { reason: 'unknown' } }), '这次没有完成喂食。');
});

test('unknown request retries at exact TTL, then refreshes before a separate new request', async () => {
  let now = 1000; let nonces = 0; let refreshes = 0; const sent = [];
  const lifecycle = createFoodRequestLifecycle({ now: () => now, nonce: () => `n${++nonces}`,
    send: async value => { sent.push(value); return undefined; },
    refresh: async () => { refreshes++; return snapshot(); }, validateRefresh: isFeedSnapshot });
  assert.equal((await lifecycle.run('berry')).unresolved, true);
  now = 601000; await lifecycle.run('berry');
  assert.deepEqual(sent[1], sent[0]); assert.equal(refreshes, 0);
  now = 601001; const expired = await lifecycle.run('berry');
  assert.equal(expired.retryRequired, true); assert.equal(refreshes, 1); assert.equal(sent.length, 2);
  await lifecycle.run('berry'); assert.equal(sent.length, 3); assert.notEqual(sent[2].commandId, sent[0].commandId);
});

test('failed refresh retains uncertain identity and busy is released for explicit retry', async () => {
  let now = 1000; let valid = false; const sent = [];
  const lifecycle = createFoodRequestLifecycle({ now: () => now, nonce: () => 'identity',
    send: async value => { sent.push(value); throw new Error('unknown'); },
    refresh: async () => valid ? snapshot() : { ok: false }, validateRefresh: isFeedSnapshot });
  await lifecycle.run('berry'); now = 601001;
  assert.equal((await lifecycle.run('berry')).refreshFailed, true);
  assert.equal(lifecycle.pending('berry'), true); assert.equal(lifecycle.busy('berry'), false);
  valid = true; assert.equal((await lifecycle.run('berry')).retryRequired, true);
  assert.equal(lifecycle.pending('berry'), false); assert.equal(sent.length, 1);
});

test('terminal result classification stays independent of refresh-needed and unknown shapes', () => {
  assert.equal(request.foodRequestResolved({ ok: true }), true);
  assert.equal(request.foodRequestResolved({ ok: false, reason: 'basic-meal-limit' }), true);
  assert.equal(request.foodRequestResolved({ ok: false, reason: 'food-command-expired' }), false);
  assert.equal(request.foodRequestNeedsRefresh({ reason: 'food-command-expired' }), true);
  for (const value of [undefined, null, {}, { ok: 'true' }, { success: true }, { reason: 'unknown' }]) assert.equal(request.foodRequestResolved(value), false);
});
