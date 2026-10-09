'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createAgentSignalServer, agentSignalPort, RATE_LIMIT } = require('../src/platform/activity/agent-signal-server');

function request(port, { method = 'POST', url, headers = {}, body } = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0));
    if (body) req.write(body);
    req.end();
  });
}

test('the loopback receiver accepts only the bodiless plugin request and rate-limits', async () => {
  assert.equal(agentSignalPort('production'), 47614);
  assert.equal(agentSignalPort('development'), 47615);
  const events = [];
  const server = createAgentSignalServer({ port: 47999, onEvent: event => { events.push(event); return event.source !== 'refused'; } });
  assert.equal((await server.start()).ok, true);
  const header = { 'X-Bubu-Agent': '1' };
  assert.equal(await request(47999, { url: '/v1/agent/qoder/prompt', headers: header }), 204);
  assert.equal(await request(47999, { url: '/v1/agent/refused/prompt', headers: header }), 404, 'the sink decides what is valid');
  assert.equal(await request(47999, { url: '/v1/agent/Bad_Name/prompt', headers: header }), 404);
  assert.equal(await request(47999, { url: '/v1/agent/qoder/prompt' }), 404, 'header required');
  assert.equal(await request(47999, { url: '/v1/agent/qoder/prompt', headers: { ...header, Origin: 'https://example.com' } }), 404, 'browsers refused');
  assert.equal(await request(47999, { method: 'GET', url: '/v1/agent/qoder/prompt', headers: header }), 404);
  assert.equal(await request(47999, { method: 'OPTIONS', url: '/v1/agent/qoder/prompt' }), 405, 'no preflight is granted');
  assert.equal(await request(47999, { url: '/v1/agent/qoder/prompt', headers: { ...header, 'Content-Length': '5' }, body: 'hello' }), 404, 'no bodies');
  assert.deepEqual(events.map(event => `${event.source}/${event.event}`), ['qoder/prompt', 'refused/prompt']);
  let last = 0;
  for (let i = 0; i < RATE_LIMIT; i += 1) last = await request(47999, { url: '/v1/agent/qoder/stop', headers: header });
  assert.equal(last, 429);
  const clash = createAgentSignalServer({ port: 47999, onEvent: () => true });
  assert.deepEqual(await clash.start(), { ok: false, reason: 'port-in-use' });
  server.stop();
  assert.equal(server.isListening(), false);
});

function deferredReceiver() {
  const candidates = [], events = [], errors = [];
  const receiver = createAgentSignalServer({ port: 47614,
    onEvent: event => { events.push(event); return true; }, onError: error => errors.push(error),
    createServer: handle => {
      const candidate = new EventEmitter();
      Object.assign(candidate, { handle, closes: 0, listening: false,
        listen(options, ready) { this.options = options; this.ready = () => { this.listening = true; ready(); }; },
        close() { this.closes += 1; this.listening = false; }
      });
      candidates.push(candidate);
      return candidate;
    }
  });
  return { receiver, candidates, events, errors };
}

test('stopping a pending receiver closes it immediately and settles its start', async () => {
  const h = deferredReceiver();
  const completions = [];
  h.receiver.start().then(value => completions.push(value));
  assert.equal(h.receiver.isListening(), false);
  h.receiver.stop();
  await Promise.resolve();
  assert.equal(h.candidates[0].closes, 1);
  assert.deepEqual(completions, [{ ok: false, reason: 'stopped' }]);
  h.candidates[0].ready();
  assert.equal(h.candidates[0].listening, false, 'a stale listen callback cannot leave its socket open');
  assert.equal(h.receiver.isListening(), false);
});

test('a restarted receiver ignores stale listen, error and request callbacks', async () => {
  const h = deferredReceiver();
  h.receiver.start();
  h.receiver.stop();
  const started = h.receiver.start();
  h.candidates[1].ready();
  assert.deepEqual(await started, { ok: true, port: 47614 });
  h.candidates[0].ready();
  h.candidates[0].emit('error', new Error('late listener error'));
  assert.equal(h.candidates[0].listening, false);
  assert.equal(h.candidates[1].listening, true);
  assert.equal(h.receiver.isListening(), true);
  assert.deepEqual(h.errors, []);

  let status;
  h.candidates[0].handle({ method: 'POST', url: '/v1/agent/codex/prompt',
    headers: { 'x-bubu-agent': '1' }, resume() {} }, { writeHead(code) { status = code; }, end() {} });
  assert.equal(status, 404);
  assert.deepEqual(h.events, []);
  h.receiver.stop();
  assert.equal(h.candidates[1].listening, false);
});

test('repeated starts share one pending listener and preserve current errors', async () => {
  const h = deferredReceiver();
  const first = h.receiver.start();
  const second = h.receiver.start();
  assert.equal(h.candidates.length, 1);
  const failure = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  h.candidates[0].emit('error', failure);
  assert.deepEqual(await first, { ok: false, reason: 'port-in-use' });
  assert.deepEqual(await second, { ok: false, reason: 'port-in-use' });
  assert.deepEqual(h.errors, [failure]);
  const restarted = h.receiver.start();
  h.candidates[1].ready();
  assert.deepEqual(await restarted, { ok: true, port: 47614 });
  h.receiver.stop();
});

test('rapid stop and restart leave only the current real loopback listener open', async t => {
  const candidates = [];
  const receiver = createAgentSignalServer({ port: 0, onEvent: () => true,
    createServer: handle => { const candidate = http.createServer(handle); candidates.push(candidate); return candidate; }
  });
  t.after(() => { receiver.stop(); for (const candidate of candidates) candidate.close(); });
  const cancelled = receiver.start();
  receiver.stop();
  const started = receiver.start();
  assert.deepEqual(await cancelled, { ok: false, reason: 'stopped' });
  assert.equal((await started).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(candidates[0].listening, false);
  assert.equal(candidates[1].listening, true);
  assert.equal(receiver.isListening(), true);
});
