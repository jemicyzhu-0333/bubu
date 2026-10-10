'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppearanceCommand } = require('../src/surfaces/popover/features/appearance-command.mjs');
const { dom } = require('../test-support/manual-growth-dom');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() { const { $ } = dom(); const command = createAppearanceCommand({ $, changed() {} }); return { $, command }; }
test('wardrobe serializes repeated choices and reset with visible pending and rejection feedback', async () => {
  const h = fixture(), pending = deferred(); let calls = 0;
  const sent = h.command.run(() => { calls++; return pending.promise; });
  await h.command.run(() => { calls++; return { ok: true }; });
  assert.equal(calls, 1); assert.equal(h.$('#wardrobeReset').disabled, true);
  assert.equal(h.$('#wardrobeStatus').textContent, '正在保存搭配…');
  pending.resolve({ ok: false, reason: 'item-locked' }); await sent;
  assert.equal(h.$('#wardrobeReset').disabled, false);
  assert.equal(h.$('#wardrobeStatus').textContent, '搭配未能保存，请稍后重试。');
  await h.command.run(async () => ({ ok: true }));
  assert.equal(h.$('#wardrobeStatus').textContent, '');
});
test('wardrobe transport uncertainty is not reported as a failed save', async () => {
  const h = fixture(); await h.command.run(async () => { throw Error('lost'); });
  assert.equal(h.$('#wardrobeStatus').textContent, '搭配结果暂未确认，重新打开后可核对。');
});
test('late wardrobe completion cannot replace status for a newer visit', async () => {
  const h = fixture(), pending = deferred(); const sent = h.command.run(() => pending.promise);
  h.command.nextVisit(); pending.resolve({ ok: false }); await sent;
  assert.notEqual(h.$('#wardrobeStatus').textContent, '搭配未能保存，请稍后重试。');
  assert.equal(h.command.busy(), false);
});
test('appearance commands remount without reviving an old receipt or duplicating its request', async () => {
  const h = fixture(), pending = deferred(); let calls = 0;
  const old = h.command.run(() => { calls++; return pending.promise; });
  h.command.dispose(); h.command.mount();
  await h.command.run(() => { calls++; return { ok: true }; });
  assert.equal(calls, 1);
  pending.resolve({ ok: false }); await old;
  assert.equal(h.$('#wardrobeStatus').textContent, '');
  await h.command.run(async () => { calls++; return { ok: true }; });
  assert.equal(calls, 2);
});
test('unknown receipt blocks every mutation across close and reopen until a canonical read succeeds', async () => {
  const { $ } = dom(); let reads = 0, allowRead = false, writes = 0;
  const command = createAppearanceCommand({ $, changed() {}, reconcile: async () => { reads++; return allowRead; } });
  await command.run(async () => { writes++; throw Error('receipt lost'); });
  assert.equal(reads, 1); assert.equal(command.busy(), true);
  assert.equal($('#wardrobeReset').disabled, true);
  await command.run(async () => { writes++; return { ok: true }; });
  assert.equal(writes, 1);
  command.nextVisit(); await Promise.resolve(); await Promise.resolve();
  assert.equal(command.busy(), true); assert.equal(reads, 2);
  assert.match($('#wardrobeStatus').textContent, /暂未确认/);
  allowRead = true; command.nextVisit(); await Promise.resolve(); await Promise.resolve();
  assert.equal(command.busy(), false); assert.equal($('#wardrobeStatus').textContent, '');
  await command.run(async () => { writes++; return { ok: true }; });
  assert.equal(writes, 2);
});
test('read-only reconciliation failure and a missing receipt never imply save failure or retry a write', async () => {
  const { $ } = dom(); let reads = 0, writes = 0;
  const command = createAppearanceCommand({ $, changed() {}, reconcile: async () => { reads++; throw Error('offline'); } });
  await command.run(async () => { writes++; return undefined; });
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(command.busy(), true);
  assert.match($('#wardrobeStatus').textContent, /暂未确认/);
  command.dispose(); command.mount(); await Promise.resolve(); await Promise.resolve();
  assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(command.busy(), true);
});
test('unknown completion from an older visit stays locked when its reconciliation becomes stale', async () => {
  const { $ } = dom(), mutation = deferred(), read = deferred(), fresh = deferred(); let reads = 0;
  const command = createAppearanceCommand({ $, changed() {}, reconcile: () => ++reads === 1 ? read.promise : fresh.promise });
  const sent = command.run(() => mutation.promise);
  command.nextVisit(); mutation.reject(Error('lost')); await Promise.resolve(); await Promise.resolve();
  command.nextVisit(); command.nextVisit();
  assert.equal(reads, 1); assert.equal(command.busy(), true);
  read.resolve(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(command.busy(), true); assert.match($('#wardrobeStatus').textContent, /暂未确认/);
  assert.equal(reads, 2, 'one fresh read serves all newer visits');
  fresh.resolve(true); await sent;
  assert.equal(command.busy(), false);
});

test('dispose and remount invalidate an older canonical read even when it returns true', async () => {
  const { $ } = dom(), read = deferred(); let reads = 0;
  const command = createAppearanceCommand({ $, changed() {}, reconcile: () => ++reads === 1 ? read.promise : false });
  const sent = command.run(async () => { throw Error('lost'); });
  await Promise.resolve(); await Promise.resolve();
  command.dispose(); command.mount();
  read.resolve(true); await sent;
  assert.equal(command.busy(), true); assert.match($('#wardrobeStatus').textContent, /暂未确认/);
});
