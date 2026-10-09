'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { probeConnection, connectionFailure } = require('../src/core/llm');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { createConnectionTests } = require('../src/application/ai/connection-tests');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const chat = text => ({ choices: [{ message: { role: 'assistant', content: text } }] });
const draft = { requestId: 'probe-1', model: 'test-model', baseUrl: 'https://example.com/v1' };
function setup(options = {}) {
  const requestScope = createProviderRequestScope();
  const settings = { aiBaseUrl: draft.baseUrl, aiBreakdownEnabled: false };
  let credentialReads = 0, calls = [];
  const runner = createConnectionTests({ requestScope, getSettings: () => settings,
    getCredential: () => { credentialReads++; return 'synthetic-key'; },
    probe: async value => { calls.push(value); return { protocol: 'chat-completions' }; }, ...options });
  return { runner, requestScope, settings, calls, credentialReads: () => credentialReads };
}
const aborting = ({ signal }) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(new Error('provider-request-aborted')), { once: true });
});

test('connection IPC is closed, popover-only and shares model/HTTPS input validation', () => {
  assert.deepEqual(allowedSurfacesFor('ai:test-connection'), ['popover']);
  assert.deepEqual(allowedSurfacesFor('ai:cancel-connection-test'), ['popover']);
  assert.equal(validateIpcPayload('ai:test-connection', draft).ok, true);
  const canonical = validateIpcPayload('ai:test-connection', { ...draft, baseUrl: `${draft.baseUrl}/responses` });
  assert.equal(canonical.value.baseUrl, draft.baseUrl);
  for (const patch of [{ arbitrary: 1 }, { model: '' }, { model: 'x'.repeat(81) },
    { baseUrl: 'http://example.com' }, { baseUrl: 'https://user:secret@example.com' },
    { secret: 'hello world' }, { secret: 's'.repeat(4097) },
    { requestId: 'wrong id' }, { requestId: undefined }]) {
    assert.equal(validateIpcPayload('ai:test-connection', { ...draft, ...patch }).ok, false, JSON.stringify(Object.keys(patch)));
  }
  assert.equal(validateIpcPayload('ai:cancel-connection-test', { requestId: 'test', secret: 'x' }).ok, false);
});

test('explicit draft test works with AI off but does not mutate settings or read a saved key when supplied', async () => {
  const h = setup();
  const before = JSON.stringify(h.settings);
  assert.equal(h.calls.length, 0, 'construction cannot make requests');
  const result = await h.runner.run('owner', { ...draft, secret: 'synthetic-draft-key' });
  assert.equal(result.ok, true);
  assert.equal(h.calls[0].apiKey, 'synthetic-draft-key');
  assert.equal(h.credentialReads(), 0);
  assert.equal(JSON.stringify(h.settings), before);
  assert.equal(JSON.stringify(result).includes('synthetic'), false);
  h.runner.dispose();
});

test('saved key is read only for identical canonical endpoint; changing host or query requires typed key', async () => {
  const h = setup();
  assert.equal((await h.runner.run('owner', { ...draft, baseUrl: `${draft.baseUrl}/chat/completions` })).ok, true);
  for (const baseUrl of ['https://other.example/v1', `${draft.baseUrl}?tenant=another`, 'https://example.com/other']) {
    const result = await h.runner.run('owner', { ...draft, baseUrl });
    assert.equal(result.reason, 'draft-credential-required');
  }
  assert.equal(h.credentialReads(), 1);
  assert.equal((await h.runner.run('owner', { ...draft, baseUrl: 'https://other.example/v1', secret: 'synthetic-other' })).ok, true);
  h.runner.dispose();
});

test('missing credentials and unsupported endpoint fail without a network request', async () => {
  const h = setup({ getCredential: () => null });
  assert.equal((await h.runner.run('owner', draft)).reason, 'credential-missing');
  assert.equal((await h.runner.run('owner', { ...draft, baseUrl: 'http://localhost' })).reason, 'endpoint-blocked');
  assert.equal(h.calls.length, 0);
});

test('one active request per sender, cancellation identity cannot cancel a newer/different owner', async () => {
  const h = setup({ probe: aborting });
  const waiting = h.runner.run('owner', draft);
  assert.equal((await h.runner.run('owner', { ...draft, requestId: 'probe-2' })).reason, 'busy');
  assert.equal(h.runner.cancel('other-owner', draft.requestId).cancelled, false);
  assert.equal(h.runner.cancel('owner', 'probe-old').cancelled, false);
  assert.equal(h.runner.cancel('owner', draft.requestId).cancelled, true);
  assert.equal((await waiting).reason, 'cancelled');
  h.runner.dispose();
});

test('shared provider change, lifecycle disposal and owner closing cancel in-flight requests', async () => {
  for (const action of ['invalidate', 'dispose', 'cancelOwner']) {
    const h = setup({ probe: aborting });
    const waiting = h.runner.run('owner', draft);
    if (action === 'invalidate') h.requestScope.invalidate();
    else h.runner[action]('owner');
    assert.equal((await waiting).reason, 'cancelled');
    h.runner.dispose();
  }
});

test('a total deadline reports timeout and releases the owner', async () => {
  const h = setup({ probe: aborting, timeoutMs: 5 });
  assert.equal((await h.runner.run('owner', draft)).reason, 'timeout');
  assert.equal((await h.runner.run('owner', draft)).reason, 'timeout');
  h.runner.dispose();
});

test('late response after cancellation cannot become success', async () => {
  let resolve;
  const h = setup({ probe: () => new Promise(done => { resolve = done; }) });
  const waiting = h.runner.run('owner', draft);
  h.runner.cancel('owner', draft.requestId);
  resolve({ protocol: 'chat-completions' });
  assert.equal((await waiting).reason, 'cancelled');
});

test('probe sends only fixed text and bounded output, accepts arbitrary generated language without semantic gating', async () => {
  const calls = [];
  const result = await probeConnection({ ...draft, apiKey: 'synthetic-key', post: async (...args) => {
    calls.push(args); return chat('你好');
  } });
  assert.equal(result.protocol, 'chat-completions');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].max_tokens, 32);
  assert.deepEqual(calls[0][1].messages, [{ role: 'user', content: 'Connection test. Reply with one short word.' }]);
  assert.equal(calls[0][2].span, undefined, 'no trace receives test content or credentials');
});

test('probe negotiates Responses only on missing route, and token-limit compatibility only on an explicit rejection', async () => {
  let calls = 0;
  const result = await probeConnection({ ...draft, apiKey: 'synthetic', post: async (url, body) => {
    calls++;
    if (calls === 1) { assert.equal(body.max_tokens, 32); throw new ProviderHttpError(400, 'max_tokens is unsupported'); }
    if (calls === 2) { assert.equal(body.max_completion_tokens, 32); throw new ProviderHttpError(404, 'route missing'); }
    assert.match(url, /\/responses$/);
    assert.equal(body.max_output_tokens, 32);
    return { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ready' }] }] };
  } });
  assert.equal(result.protocol, 'responses'); assert.equal(calls, 3);
});

test('probe refuses empty, malformed, error, non-assistant, queued and oversized outputs', async () => {
  for (const response of [null, {}, chat(' '), chat('x'.repeat(4097)),
    { ...chat('hello'), error: { message: 'synthetic-key' } },
    { choices: [{ message: { role: 'user', content: 'echoed input' } }] },
    { ...chat('text'), status: 'queued' }, { ...chat('text'), status: 'failed' }]) {
    await assert.rejects(probeConnection({ ...draft, post: async () => response }), /provider-response-/);
  }
});

test('auth/quota/provider errors do not retry and never expose raw provider detail or secrets', async () => {
  for (const [status, reason] of [[401, 'authentication'], [403, 'permission'], [429, 'rate-limit'], [503, 'provider-unavailable']]) {
    let calls = 0;
    const h = setup({ probe: options => probeConnection({ ...options, post: async () => {
      calls++; throw new ProviderHttpError(status, 'Bearer synthetic-key https://secret@example.com echoed secret');
    } }) });
    assert.deepEqual(await h.runner.run('owner', draft), { ok: false, reason, httpStatus: status });
    assert.equal(calls, 1); h.runner.dispose();
  }
  assert.deepEqual(connectionFailure(new Error('api key: synthetic-secret')), { reason: 'request-failed' });
  assert.deepEqual(connectionFailure(Object.assign(new Error('secret'), { code: 'ENOTFOUND' })), { reason: 'dns' });
  assert.deepEqual(connectionFailure(Object.assign(new Error('secret'), { code: 'CERT_HAS_EXPIRED' })), { reason: 'tls' });
});

test('real transport endpoint policy is enforced before injectable network work', async () => {
  let calls = 0;
  for (const baseUrl of ['http://example.com/v1', 'https://localhost/v1', 'https://example.com:444/v1', 'https://10.0.0.1/v1']) {
    await assert.rejects(probeConnection({ ...draft, baseUrl, post: async () => { calls++; return chat('yes'); } }));
  }
  assert.equal(calls, 0);
});

test('Unicode draft URL can expand to a legal canonical URL and reuse its identically routed saved key', async () => {
  const rawUrl = `https://example.com/${'中'.repeat(70)}`;
  const decoded = validateIpcPayload('ai:test-connection', { ...draft, baseUrl: rawUrl });
  assert.equal(decoded.ok, true);
  assert.ok(decoded.value.baseUrl.length > 200);
  const h = setup();
  h.settings.aiBaseUrl = decoded.value.baseUrl;
  assert.equal((await h.runner.run('owner', decoded.value)).ok, true);
  assert.equal(h.credentialReads(), 1);
  h.runner.dispose();
});

test('Responses extraction cannot take echoed user text or a top-level shadow instead of the validated assistant', async () => {
  const responses = [
    { output_text: 'shadow', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] }] },
    { output: [
      { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'echo' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] }
    ] }
  ];
  for (const response of responses) await assert.rejects(probeConnection({ ...draft, post: async url => {
    if (url.endsWith('/chat/completions')) throw new ProviderHttpError(404, 'missing');
    return response;
  } }), /provider-response-empty/);
});

test('hostile exception getters cannot escape the finite failure contract', () => {
  const error = {};
  Object.defineProperty(error, 'message', { get() { throw new Error('synthetic-secret'); } });
  Object.defineProperty(error, 'code', { get() { throw new Error('synthetic-secret'); } });
  assert.deepEqual(connectionFailure(error), { reason: 'request-failed' });
});
