'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, START } = require('../test-support/growth-food-fixture');
const command = require('../src/capabilities/companion/domain/food-command');

test('ticket purchases commit wallet, stock and receipt together and never spend permanent XP', () => {
  const f = fixture({ initial: { xp: 20, level: 4 } }), request = f.request('berry');
  assert.deepEqual(f.buy.execute(request), { ok: true, changed: true, replayed: false, foodId: 'berry', price: 1, foodTickets: 5, inventory: 3 });
  const state = f.read(); assert.equal(state.xp, 20); assert.equal(state.level, 4); assert.equal(state.pet.foodInventory.berry, 3);
  assert.equal(f.buy.execute(request).replayed, true); assert.equal(f.revision(), 1); assert.equal(f.effects.length, 1);
});
test('wallet, level, inventory, unsupported catalog and stale revision reject without writes', () => {
  const f = fixture(); f.edit(s => { s.pet.foodTickets = 0; }); const before = f.read();
  assert.equal(f.buy.execute(f.request('berry')).reason, 'insufficient-food-tickets');
  assert.equal(f.buy.execute(f.request('cake')).reason, 'food-locked');
  assert.equal(f.buy.execute(f.request('basic')).reason, 'unknown-food');
  assert.equal(f.buy.execute({ ...f.request('berry'), expectedRevision: 9 }).reason, 'state-revision-conflict');
  assert.deepEqual(f.read(), before);
  f.edit(s => { s.pet.foodTickets = 6; s.pet.foodInventory.berry = 999; }); const full = f.read();
  assert.equal(f.buy.execute(f.request('berry')).reason, 'food-inventory-full'); assert.deepEqual(f.read(), full); assert.equal(f.revision(), 0);
});
test('expired, excessive future skew, empty nonce and conflicting requests cannot charge a wallet', () => {
  const f = fixture(), request = f.request('berry');
  f.time(START + command.COMMAND_TTL_MS + 1); assert.equal(f.buy.execute(request).reason, 'food-command-expired');
  f.time(START - command.FUTURE_SKEW_MS - 1); assert.equal(f.buy.execute(request).reason, 'food-command-expired');
  f.time(START); assert.equal(f.buy.execute({ ...request, commandId: `${START}-` }).reason, 'invalid-food-command');
  assert.equal(f.buy.execute(request).ok, true);
  assert.equal(f.buy.execute({ ...request, foodId: 'carrot' }).reason, 'food-command-conflict');
  f.time(START + 2 * command.COMMAND_TTL_MS); assert.equal(f.buy.execute(request).replayed, true, 'retained successful receipts replay even after TTL');
  assert.equal(f.read().pet.foodTickets, 5);
});
test('receipt capacity rejects whole purchase until expired rows can be trimmed', () => {
  const f = fixture(); const result = { ok: true, foodId: 'berry', price: 1, foodTickets: 5, inventory: 3 };
  f.edit(s => { s.pet.foodCommands = Array.from({ length: 200 }, (_, i) => ({ commandId: `${START}-full${i}`, issuedAt: START, kind: 'buy', foodId: 'berry', result })); });
  const before = f.read(); assert.equal(f.buy.execute(f.request('berry')).reason, 'food-command-capacity'); assert.deepEqual(f.read(), before);
  f.time(START + command.COMMAND_TTL_MS + 1); assert.equal(f.buy.execute(f.request('berry')).ok, true);
  assert.equal(f.read().pet.foodCommands.length, 1); assert.equal(f.read().pet.foodTickets, 5);
});
test('receipt result payload is fully closed and numeric values are bounded', () => {
  const f = fixture(); f.buy.execute(f.request('berry')); const receipt = f.read().pet.foodCommands[0];
  assert.equal(command.normalizeFoodReceipts([receipt]).length, 1);
  for (const mutate of [r => { r.result.extra = true; }, r => { delete r.result.price; }, r => { r.result.foodTickets = Number.MAX_SAFE_INTEGER + 1; }, r => { r.result.inventory = 1000; }, r => { r.extra = true; }]) {
    const changed = structuredClone(receipt); mutate(changed); assert.throws(() => command.normalizeFoodReceipts([changed]), /invalid-food-receipt/);
  }
});
test('buy failure before commit preserves tickets, stock and request identity for explicit retry', () => {
  const f = fixture(), request = f.request('berry'), before = f.read(); f.fail(true);
  assert.throws(() => f.buy.execute(request), /synthetic commit refusal/); assert.deepEqual(f.read(), before); assert.equal(f.effects.length, 0);
  f.fail(false); assert.equal(f.buy.execute(request).ok, true); assert.equal(f.buy.execute(request).replayed, true);
});

test('receipt pruning followed by clock rollback cannot resurrect a previously successful purchase identity', () => {
  const f = fixture(), old = f.request('berry'); assert.equal(f.buy.execute(old).ok, true);
  f.time(START + 11 * 60000); assert.equal(f.buy.execute(f.request('berry')).ok, true);
  assert.equal(f.read().pet.foodCommands.some(row => row.commandId === old.commandId), false);
  f.time(START + 60000); const before = f.read();
  assert.equal(f.buy.execute(old).reason, 'food-command-expired'); assert.deepEqual(f.read(), before);
  f.time(START + 22 * 60000); assert.equal(f.buy.execute(f.request('berry')).ok, true);
  f.time(START + 60000); assert.equal(f.buy.execute(old).reason, 'food-command-expired');
});

test('delayed accepted purchase at TTL cannot lower rollback safety after pruning an earlier receipt', () => {
  const f = fixture(), old = f.request('berry'); assert.equal(f.buy.execute(old).ok, true);
  f.time(START + 60000); const delayed = f.request('berry');
  f.time(START + 11 * 60000); assert.equal(f.buy.execute(delayed).ok, true);
  assert.equal(f.read().pet.foodCommands.length, 1); assert.equal(f.read().pet.foodCommands[0].issuedAt, START + 60000);
  f.time(START + 30000); const before = f.read();
  assert.equal(f.buy.execute(old).reason, 'food-command-expired'); assert.deepEqual(f.read(), before);
});
