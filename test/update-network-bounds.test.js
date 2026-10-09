'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { HttpExecutor, CancellationToken } = require('builder-util-runtime');
const { createBoundedUpdateNetwork } = require('../src/platform/electron/update-network-bounds');
function fixture({ body = ['hello'], status = 200, headers = {}, stall = false, limit = 16 } = {}) {
  const requests = [], timers = [];
  class Executor extends HttpExecutor {
    createRequest(options, callback) {
      const request = new EventEmitter(); request.aborted = false;
      const response = new PassThrough(); Object.assign(response, { headers, statusCode: status, statusMessage: 'fixture' });
      request.abort = () => { if (request.aborted) return; request.aborted = true; response.destroy(); request.emit('aborted'); request.emit('close'); };
      request.end = () => {
        queueMicrotask(() => {
          if (request.aborted || stall) return;
          callback(response);
          queueMicrotask(() => { if (request.aborted) return; for (const chunk of body) { if (!request.aborted) response.write(chunk); } if (!request.aborted) response.end(); });
        });
      };
      response.once('end', () => { request.completed = true; request.emit('close'); });
      requests.push(request); return request;
    }
  }
  const network = createBoundedUpdateNetwork(new Executor(), { metadataLimit: limit,
    setTimer: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, clearTimer: timer => { timer.cleared = true; } });
  const check = () => network.run(() => network.executor.request({ protocol: 'https:', hostname: 'github.com', path: '/fixture' }), { timeoutMs: 30_000 });
  return { network, requests, timers, check };
}
test('official metadata parser receives only bounded streams; oversized declared/chunked bodies abort', async () => {
  const good = fixture(); assert.equal(await good.check(), 'hello'); assert.equal(good.timers[0].cleared, true);
  for (const options of [{ headers: { 'content-length': '999' } }, { body: ['1234567890', '1234567890'] }]) {
    const h = fixture(options); await assert.rejects(h.check()); assert.ok(h.requests.every(request => request.aborted));
  }
});
test('a stalled real HttpExecutor request is cancelled by total deadline and disposal, with no new overlapping scope', async () => {
  for (const close of [false, true]) {
    const h = fixture({ stall: true }); const checking = h.check();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.requests.length, 1);
    await assert.rejects(h.check(), /busy/);
    if (close) h.network.close(); else h.timers[0].fn();
    await assert.rejects(checking); assert.equal(h.requests[0].aborted, true);
    await new Promise(resolve => setImmediate(resolve));
    if (close) await assert.rejects(h.check(), /busy/);
  }
});
test('early HTTP errors abort unconsumed response bodies and clear the operation deadline', async () => {
  const h = fixture({ status: 404, body: ['unconsumed error response'] });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(h.check()); assert.equal(h.requests[i].aborted, true); assert.equal(h.timers[i].cleared, true);
  }
});
test('package byte bound applies before consumer writes, retains checksum-independent cancellation', async () => {
  const h = fixture({ body: ['1234', '5678'], limit: 50 });
  const token = new CancellationToken(), received = [];
  const run = h.network.run(() => new Promise((resolve, reject) => {
    const request = h.network.executor.createRequest({ hostname: 'github.com', path: '/package' }, response => {
      response.on('data', chunk => received.push(chunk)); response.on('error', reject); response.on('end', resolve);
    }); request.on('aborted', () => reject(new Error('aborted'))); request.end();
  }), { timeoutMs: 600_000, maxBytes: 4, token });
  await assert.rejects(run); assert.equal(Buffer.concat(received).toString(), '1234');
  assert.ok(h.requests[0].aborted || h.requests[0].completed);
  assert.equal(token.cancelled, true);
});
