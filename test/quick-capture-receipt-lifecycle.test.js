'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, deferred, settle, emit } = require('../test-support/quick-push-fixture');

test('saved capture does not erase a newer input or hide its panel', async t => {
  const pending = deferred();
  const h = await harness(t, { client: { addImpulse: () => pending.promise } });
  h.$('#impInput').value = 'original'; h.capture();
  h.$('#impInput').value = 'new text'; emit(h.$('#impInput'), 'input');
  pending.resolve({ ok: true }); await settle();
  assert.equal(h.$('#impInput').value, 'new text');
  assert.equal(h.calls.filter(([name]) => name === 'hide').length, 0);
  assert.equal(h.$('#panelStatus').textContent, '记好了，新的输入仍保留。');
});

for (const failure of ['reject', 'refuse']) test(`capture hide ${failure} preserves save receipt and permits new capture`, async t => {
  let saves = 0;
  const h = await harness(t, { client: {
    addImpulse: async () => { saves++; return { ok: true }; },
    hideImpulse: async () => { if (failure === 'reject') throw Error('unavailable'); return { ok: false }; }
  } });
  h.$('#impInput').value = 'first'; h.capture(); await settle();
  assert.equal(h.$('#panelStatus').textContent, '记好了，窗口未能关闭。');
  assert.equal(h.$('#impInput').value, '');
  h.$('#impInput').value = 'second'; h.capture(); await settle();
  assert.equal(saves, 2);
});

test('new capture typed during the saved animation prevents automatic dismissal', async t => {
  const h = await harness(t, { deferTimeouts: true });
  h.$('#impInput').value = 'first'; h.capture(); await settle();
  h.$('#impInput').value = 'new text'; emit(h.$('#impInput'), 'input');
  h.flushTimers(); await settle();
  assert.equal(h.$('#impInput').value, 'new text');
  assert.equal(h.calls.filter(([name]) => name === 'hide').length, 0);
});
for (const receipt of [null, undefined, {}]) test(`capture with missing receipt ${JSON.stringify(receipt)} never claims saved`, async t => {
  const h = await harness(t, { client: { addImpulse: async () => receipt } });
  h.$('#impInput').value = 'unconfirmed'; h.capture(); await settle();
  assert.equal(h.$('#impInput').value, 'unconfirmed');
  assert.equal(h.calls.some(([name]) => name === 'hide'), false);
  assert.equal(h.$('#panelStatus').textContent, '操作结果暂未确认，请到主面板核对。');
});
test('capture transport failure keeps input and asks for verification instead of duplicate retry', async t => {
  const h = await harness(t, { client: { addImpulse: async () => { throw Error('receipt lost'); } } });
  h.$('#impInput').value = 'unconfirmed'; h.capture(); await settle();
  assert.equal(h.$('#impInput').value, 'unconfirmed');
  assert.equal(h.$('#panelStatus').textContent, '操作结果暂未确认，请到主面板核对。');
  assert.equal(h.calls.some(([name]) => name === 'hide'), false);
});
for (const result of [{ ok: true }, null]) test(`blur/reopen cannot resubmit an unchanged pending or ${result ? 'saved' : 'unknown'} capture`, async t => {
  const pending = deferred(); let saves = 0;
  const h = await harness(t, { client: { addImpulse: () => { saves++; return pending.promise; } } });
  h.$('#impInput').value = 'one draft'; h.capture();
  h.events.get('blur')(); h.events.get('focus')(); await settle();
  h.capture(); await settle(); assert.equal(saves, 1);
  assert.equal(h.$('#panelStatus').textContent, '正在保存…');
  pending.resolve(result); await settle(); h.capture(); await settle();
  assert.equal(saves, 1);
  assert.equal(h.$('#impInput').value, result ? '' : 'one draft');
  assert.equal(h.$('#panelStatus').textContent, result ? '记好了' : '操作结果暂未确认，请到主面板核对。');
});
test('a definite capture refusal permits retry of the unchanged draft', async t => {
  let saves = 0;
  const h = await harness(t, { client: { addImpulse: async () => { saves++; return { ok: false, reason: 'revision-conflict' }; } } });
  h.$('#impInput').value = 'retryable'; h.capture(); await settle(); h.capture(); await settle();
  assert.equal(saves, 2); assert.equal(h.$('#impInput').value, 'retryable');
});
test('unknown capture transport is not resent unchanged after reopening', async t => {
  let saves = 0;
  const h = await harness(t, { client: { addImpulse: async () => { saves++; throw Error('lost after possible commit'); } } });
  h.$('#impInput').value = 'uncertain'; h.capture(); await settle();
  h.events.get('blur')(); h.events.get('focus')(); await settle(); h.capture(); await settle();
  assert.equal(saves, 1); assert.equal(h.$('#impInput').value, 'uncertain');
});
test('a deliberately retyped identical capture is an independent draft', async t => {
  const pending = deferred(); let saves = 0;
  const h = await harness(t, { client: { addImpulse: () => { saves++; return pending.promise; } } });
  h.$('#impInput').value = 'same note'; h.capture();
  h.events.get('blur')(); h.events.get('focus')(); await settle();
  pending.resolve({ ok: true }); await settle();
  h.$('#impInput').value = ''; emit(h.$('#impInput'), 'input');
  h.$('#impInput').value = 'same note'; emit(h.$('#impInput'), 'input');
  h.capture(); await settle(); assert.equal(saves, 2);
});
test('disposing an old panel cannot apply its capture receipt to a newly mounted surface owner', async t => {
  const pending = deferred();
  const old = await harness(t, { client: { addImpulse: () => pending.promise } });
  old.$('#impInput').value = 'old draft'; old.capture(); old.feature.dispose();
  const next = await harness(t); next.$('#impInput').value = 'independent';
  pending.resolve({ ok: true }); await settle();
  assert.equal(next.$('#impInput').value, 'independent'); assert.equal(next.calls.length, 0);
  next.capture(); await settle(); assert.deepEqual(next.calls[0], ['capture', 'independent']);
});
