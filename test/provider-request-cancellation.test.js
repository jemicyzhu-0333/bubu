'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, getEventListeners } = require('node:events');
const https = require('node:https');
const { generateStructured } = require('../src/core/llm/generate');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { postJson, ProviderHttpError } = require('../src/core/llm/transport');
const task = { name: 'stub', schemaName: 'stub', instruction: 'Synthetic test',
  buildSchema: () => ({ type: 'object' }), buildInput: () => ({}),
  repair: JSON.parse, validate: value => value };
const response = { choices: [{ message: { content: '{"ok":true}' } }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
function generate(extra) {
  return generateStructured({ task, model: 'fake', baseUrl: 'https://example.test/v1', ...extra });
}
function providerHarness() {
  const timers = new Set();
  const runWithFallback = createOneShotProviderRun({
    now: () => 0,
    schedule(callback) { const timer = { callback }; timers.add(timer); return timer; },
    cancelSchedule(timer) { timers.delete(timer); }
  });
  return { runWithFallback, timers };
}

test('pre-cancelled generation never calls POST even without beforeRequest', async () => {
  const controller = new AbortController(); controller.abort(); let posts = 0;
  await assert.rejects(generate({ signal: controller.signal, post: async () => { posts++; return response; } }), /provider-request-aborted/);
  assert.equal(posts, 0);
});
for (const outcome of ['success', 'schema', 'protocol', 'repair']) {
  test(`cancel after one POST discards ${outcome} without retry or usage`, async () => {
    const controller = new AbortController(), negotiation = new Map(); let posts = 0, usage = 0, attempts = 0;
    await assert.rejects(generate({ signal: controller.signal, negotiation, onUsage: () => usage++,
      beforeRequest: () => attempts++, post: async () => {
        posts++; controller.abort();
        if (outcome === 'schema') throw new ProviderHttpError(400, 'Unsupported parameter: response_format');
        if (outcome === 'protocol') throw new ProviderHttpError(404, 'Not found');
        return outcome === 'repair' ? { choices: [{ message: { content: 'invalid' } }] } : response;
      } }), /provider-request-aborted/);
    assert.equal(posts, 1); assert.equal(attempts, 1); assert.equal(usage, 0); assert.equal(negotiation.size, 0);
  });
}
test('late success without beforeRequest is cancelled', async () => {
  const controller = new AbortController();
  await assert.rejects(generate({ signal: controller.signal,
    post: async () => { controller.abort(); return response; } }), /provider-request-aborted/);
});
test('bounded fallback charges native attempts separately from explicit owner freshness checkpoints', async () => {
  const { runWithFallback, timers } = providerHarness();
  let attempts = 0, posts = 0, freshness = 0;
  const client = { id: 'api', run: (_name, _payload, options) => generate({ ...options,
    beforeRequest: () => { attempts++; options.beforeRequest(); },
    post: async () => {
      posts++; if (posts === 1) throw new ProviderHttpError(400, 'Unsupported parameter: response_format');
      return response;
    } }) };
  const result = await runWithFallback(client, { id: 'local', run: () => assert.fail('unexpected fallback') },
    'breakdown', {}, { assertCurrent: () => { freshness++; } });
  assert.equal(result.ok, true);
  assert.equal(result.fallback, false); assert.equal(posts, 2); assert.equal(attempts, 2);
  assert.equal(freshness, 6, 'admission, owner checks before and after each of two native charges, and returned remote result');
  assert.deepEqual(result.cleanup, { ok: true, timer: 'released', listener: 'released' });
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(timers.size, 0);
});
test('fallback pre-abort calls neither client nor local builder and leaves no listener', async () => {
  const { runWithFallback, timers } = providerHarness();
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const client = { id: 'fake', run: async () => { calls++; assert.fail('pre-aborted invocation must not run'); } };
  const result = await runWithFallback(client, client, 'breakdown', {}, { signal: controller.signal, assertCurrent() {} });
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted',
    cleanup: { ok: true, timer: 'not-acquired', listener: 'not-acquired' } });
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(calls, 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(timers.size, 0);
});
test('fallback refuses late provider and local completions after caller cancellation', async () => {
  for (const local of [false, true]) {
    const { runWithFallback, timers } = providerHarness();
    const controller = new AbortController(); let resolve, calls = 0;
    const pending = new Promise(r => { resolve = r; });
    const client = { id: 'api', run: async (_name, _payload, { beforeRequest }) => {
      beforeRequest(); if (local) throw new Error('offline'); return pending;
    } };
    const fallback = { id: 'local', run: async () => { calls++; return pending; } };
    const result = runWithFallback(client, fallback, 'breakdown', {}, { signal: controller.signal, assertCurrent() {} });
    await tick(); controller.abort(); resolve({ old: true });
    const refused = await result;
    assert.deepEqual(refused, { ok: false, reason: 'provider-request-aborted',
      cleanup: { ok: true, timer: 'released', listener: 'released' } });
    assert.equal(Object.isFrozen(refused.cleanup), true);
    assert.equal(calls, local ? 1 : 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(timers.size, 0);
  }
});
function fakeHttps(t) {
  let opens = 0, sends = 0;
  t.mock.method(https, 'request', () => {
    opens++;
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = error => { queueMicrotask(() => request.emit('error', error)); return request; };
    request.end = () => { sends++; };
    return request;
  });
  return () => ({ opens, sends });
}
test('transport pre-abort performs zero DNS and HTTP work', async t => {
  const counts = fakeHttps(t), controller = new AbortController(); let lookups = 0;
  controller.abort();
  await assert.rejects(postJson('https://example.test/v1', {}, { signal: controller.signal,
    lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; } }), /provider-request-aborted/);
  assert.equal(lookups, 0); assert.deepEqual(counts(), { opens: 0, sends: 0 });
});
for (const lateFailure of [false, true]) {
  test(`DNS cancellation settles before lookup and ignores late ${lateFailure ? 'rejection' : 'resolution'}`, async t => {
    const counts = fakeHttps(t), controller = new AbortController(); let finishDns, settled = false;
    const dns = new Promise((resolve, reject) => { finishDns = () => lateFailure ? reject(new Error('late-dns')) : resolve([{ address: '8.8.8.8', family: 4 }]); });
    const result = postJson('https://example.test/v1', {}, { signal: controller.signal, lookup: () => dns });
    const observed = result.then(value => { settled = true; return value; }, error => { settled = true; return error; });
    controller.abort(); await tick();
    const settledBeforeDns = settled;
    finishDns(); await tick();
    const error = await observed;
    assert.equal(settledBeforeDns, true); assert.match(error.message, /provider-request-aborted/);
    assert.deepEqual(counts(), { opens: 0, sends: 0 });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('the attempt guard can revoke before POST without spending a second callback', async () => {
  const controller = new AbortController(); let attempts = 0, posts = 0;
  await assert.rejects(generate({ signal: controller.signal,
    beforeRequest: () => { attempts++; controller.abort(); },
    post: async () => { posts++; return response; } }), /provider-request-aborted/);
  assert.equal(attempts, 1); assert.equal(posts, 0);
});
test('transport cleans deadline and signal listener on successful response and keeps pinned lookup', async t => {
  const controller = new AbortController(), timers = new Set();
  const originalSet = global.setTimeout, originalClear = global.clearTimeout;
  t.mock.method(global, 'setTimeout', (...args) => { const id = originalSet(...args); timers.add(id); return id; });
  t.mock.method(global, 'clearTimeout', id => { timers.delete(id); return originalClear(id); });
  let opened = 0, ended = 0, socketTimeout;
  t.mock.method(https, 'request', (_url, options, receive) => {
    opened++; const request = new EventEmitter();
    options.lookup('example.test', { all: true }, (error, addresses) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    request.setTimeout = value => { socketTimeout = value; return request; };
    request.end = () => { ended++; queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
      receive(response); response.emit('data', Buffer.from('{"ok":true}')); response.emit('end');
    }); };
    return request;
  });
  assert.deepEqual(await postJson('https://example.test/v1', {}, { signal: controller.signal,
    lookup: async () => [{ address: '8.8.8.8', family: 4 }] }), { ok: true });
  assert.equal(opened, 1); assert.equal(ended, 1); assert.equal(socketTimeout, 0);
  assert.equal(timers.size, 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('DNS is bounded by the transport deadline even without an outer fallback runner', async t => {
  const counts = fakeHttps(t), controller = new AbortController();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = postJson('https://example.test/v1', {}, { timeoutMs: 1000, signal: controller.signal,
    lookup: () => new Promise(() => {}) });
  const rejection = assert.rejects(pending, /provider-timeout/);
  t.mock.timers.tick(1000); await rejection;
  assert.deepEqual(counts(), { opens: 0, sends: 0 }); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a cancellation during usage or validation cannot accept or cache a generated result', async () => {
  for (const phase of ['usage', 'validation']) {
    const controller = new AbortController(), negotiation = new Map();
    await assert.rejects(generate({ signal: controller.signal, negotiation,
      task: { ...task, validate: value => { if (phase === 'validation') controller.abort(); return value; } },
      onUsage: () => { if (phase === 'usage') controller.abort(); }, post: async () => response }), /provider-request-aborted/);
    assert.equal(negotiation.size, 0);
  }
});
