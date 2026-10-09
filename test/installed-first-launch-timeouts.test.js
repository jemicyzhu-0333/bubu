'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectInspector, waitForInstalledWindow } = require('../scripts/installed-first-launch');

test('native readiness tolerates a 19-second synchronous permission inspection within one budget', async () => {
  let now = 0, probes = 0; const budgets = [];
  await waitForInstalledWindow({ async evaluate(expression, budget) {
    assert.match(expression, /isVisible\(\)/); assert.match(expression, /isLoading\(\)/);
    budgets.push(budget);
    if (probes++ === 0) { now += 19000; return false; }
    now += 50; return true;
  } }, new Promise(() => {}), { now: () => now, wait: async (_, delay) => { now += delay; return null; } });
  assert.deepEqual(budgets, [120000, 100750]);
  assert.equal(probes, 2);
});

test('readiness timeout is shared and decreasing, not reset by each false probe', async () => {
  let now = 0; const budgets = [];
  await assert.rejects(waitForInstalledWindow({ async evaluate(_, budget) { budgets.push(budget); return false; } },
    new Promise(() => {}), { budgetMs: 1000, now: () => now, wait: async (_, delay) => { now += delay; return null; } }), /readiness deadline/);
  assert.deepEqual(budgets, [1000, 750, 500, 250]);
  assert.equal(now, 1000);
});

test('a late true response cannot turn an expired readiness stage into success', async () => {
  let now = 0;
  await assert.rejects(waitForInstalledWindow({ async evaluate() { now = 1001; return true; } },
    new Promise(() => {}), { budgetMs: 1000, now: () => now }), /readiness deadline/);
});

test('the longer readiness budget still refuses early application exit', async () => {
  await assert.rejects(waitForInstalledWindow({ async evaluate() { return false; } }, Promise.resolve({ code: 0 }),
    { now: () => 0, wait: async completion => completion }), /exited before UI boot/);
});

test('readiness rejects an unbounded budget before making an inspector request', async () => {
  for (const budgetMs of [Infinity, 0, -1, 120001]) {
    await assert.rejects(waitForInstalledWindow({ evaluate() { assert.fail('must not inspect'); } }, null, { budgetMs }), /bounded readiness/);
  }
});

test('real request timer honors readiness budget, rejects a hung request, and keeps short quit default', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.WebSocket; let socket;
  class TestSocket extends EventTarget {
    constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(message) { this.last = JSON.parse(message); }
    close() {}
    respond(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: this.last.id, result: { result: { value } } }) })); }
  }
  globalThis.WebSocket = TestSocket;
  let inspector;
  try {
    inspector = await connectInspector('ws://127.0.0.1:1234/abcd-1234');
    let settled = false;
    const delayed = inspector.evaluate('readiness', 120000).then(value => { settled = true; return value; });
    t.mock.timers.tick(19000); await Promise.resolve(); assert.equal(settled, false);
    socket.respond(true); assert.equal(await delayed, true);
    const hung = inspector.evaluate('readiness', 750);
    const rejection = assert.rejects(hung, /request timeout/);
    t.mock.timers.tick(750); await rejection;
    const quit = inspector.evaluate('quit');
    const quitRejection = assert.rejects(quit, /request timeout/);
    t.mock.timers.tick(5000); await quitRejection;
    assert.throws(() => inspector.evaluate('invalid', Infinity), /bounded inspector/);
  } finally { inspector?.close(); globalThis.WebSocket = original; }
});
