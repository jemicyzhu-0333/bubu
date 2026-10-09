'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const { EventEmitter } = require('node:events');
const { createConnectionTests } = require('../src/application/ai/connection-tests');
const { createAiConnectionTesting } = require('../src/bootstrap/ai-connection-testing');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { assertIpcPayload } = require('../src/application/ipc/route-catalog');
const draft = { requestId: 'mock-http-1', model: 'synthetic-model', baseUrl: 'https://mock.example/v1', secret: 'synthetic-key-only' };

test('actual transport parses bounded local mock HTTP, rejects error envelopes, and aborts on native window events', async t => {
  let reply = { status: 200, type: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '回应' } }] }) };
  let received, calls = 0;
  const server = http.createServer((request, response) => {
    calls++;
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      assert.equal(request.headers.authorization, 'Bearer synthetic-key-only');
      const input = JSON.parse(body);
      assert.equal(input.model, 'synthetic-model');
      assert.equal(input.max_tokens, 32);
      assert.deepEqual(input.messages, [{ role: 'user', content: 'Connection test. Reply with one short word.' }]);
      received?.();
      if (reply.wait) return;
      response.writeHead(reply.status, { 'content-type': reply.type }); response.end(reply.body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'request', (url, options, callback) => {
    assert.equal(url.hostname, 'mock.example'); assert.equal(url.protocol, 'https:');
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    // Test-only HTTP bridge. Production keeps TLS and its public-address policy;
    // there is no custom TLS agent, certificate bypass or real provider traffic.
    return http.request({ host: '127.0.0.1', port: server.address().port,
      path: url.pathname, method: options.method, headers: options.headers }, callback);
  });
  const scope = createProviderRequestScope();
  const runner = createConnectionTests({ getSettings: () => ({}), getCredential: () => null, requestScope: scope });
  assert.equal((await runner.run('owner', draft)).ok, true);
  for (const [type, body] of [['text/html', '<html>login</html>'], ['application/json', ''],
    ['application/json', '{broken'], ['text/event-stream', 'data: hello\n\n'],
    ['application/json', JSON.stringify({ error: { message: 'synthetic-key-only' } })],
    ['application/json', JSON.stringify({ choices: [{ message: { role: 'user', content: 'echo' } }] })]]) {
    reply = { status: 200, type, body };
    assert.deepEqual(await runner.run('owner', draft), { ok: false, reason: 'invalid-response' });
  }
  reply = { status: 401, type: 'application/json', body: JSON.stringify({ error: { message: 'secret synthetic-key-only' } }) };
  const before = calls;
  assert.deepEqual(await runner.run('owner', draft), { ok: false, reason: 'authentication', httpStatus: 401 });
  assert.equal(calls, before + 1);
  runner.dispose();

  const routes = new Map(), window = new EventEmitter(), sender = new EventEmitter();
  sender.isDestroyed = () => false;
  window.isDestroyed = () => false;
  window.isVisible = () => true;
  const helper = createAiConnectionTesting({ credentialStore: { get: () => null },
    getSettings: () => ({}), requestScope: createProviderRequestScope(), getWindowForSender: () => window });
  helper.register((name, handler) => routes.set(name, handler));
  for (const event of ['hide', 'closed', 'render-process-gone', 'destroyed']) {
    reply = { wait: true };
    const reached = new Promise(resolve => { received = resolve; });
    const pending = routes.get('ai:test-connection')({ sender }, assertIpcPayload('ai:test-connection', draft));
    await reached;
    (['hide', 'closed'].includes(event) ? window : sender).emit(event);
    assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  }
  helper.dispose();
  assert.equal(window.listenerCount('hide'), 0);
  assert.equal(window.listenerCount('closed'), 0);
  assert.equal(sender.listenerCount('destroyed'), 0);
});

test('missing, destroyed or hidden owner window refuses before credentials or HTTP', async () => {
  for (const window of [null, { isDestroyed: () => true, isVisible: () => true },
    { isDestroyed: () => false, isVisible: () => false }]) {
    let credentials = 0;
    const sender = new EventEmitter(); sender.isDestroyed = () => false;
    const routes = new Map();
    const helper = createAiConnectionTesting({ credentialStore: { get() { credentials++; return 'synthetic'; } },
      getSettings: () => { throw new Error('must not read settings'); }, requestScope: createProviderRequestScope(),
      getWindowForSender: () => window });
    helper.register((name, handler) => routes.set(name, handler));
    assert.deepEqual(await routes.get('ai:test-connection')({ sender }, draft), { ok: false, reason: 'cancelled' });
    assert.equal(credentials, 0); helper.dispose();
  }
});
