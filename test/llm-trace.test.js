'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLlmTrace, formatFields, NO_LLM_TRACE } = require('../src/core/llm/trace');
const { postJson, DEFAULT_TIMEOUT_MS, ProviderHttpError } = require('../src/core/llm/transport');
const { createApiClient, createDeterministicClient } = require('../src/core/llm');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { buildDeterministicProposal } = require('../src/core/breakdown-proposal');

function providerHarness() {
  let now = 0;
  const timers = new Set();
  const runWithFallback = createOneShotProviderRun({
    now: () => now,
    schedule(callback, delay) { const timer = { callback, at: now + delay }; timers.add(timer); return timer; },
    cancelSchedule(timer) { timers.delete(timer); }
  });
  return { runWithFallback, timers, advance(ms) {
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback(); }
  } };
}

function collector(options = {}) {
  const lines = [];
  const trace = createLlmTrace({ enabled: true, sink: line => lines.push(line), now: () => 0, ...options });
  return { trace, lines, text: () => lines.join('\n') };
}

function deterministic() {
  return createDeterministicClient({
    breakdown: () => buildDeterministicProposal([
      { title: '打开文件' }, { title: '写第一句' }, { title: '保存草稿' }
    ])
  });
}

test('a trace is silent unless explicitly enabled, and stays callable when off', () => {
  const written = [];
  const off = createLlmTrace({ sink: line => written.push(line) });
  assert.equal(off.enabled, false);
  off.selection({ provider: 'api' });
  const span = off.begin({ kind: 'enrich' });
  span.request({ endpoint: 'https://example.com/v1/responses', body: { model: 'x' } });
  span.resolved('93.184.216.34', 4);
  span.status(200, 'application/json');
  span.body('private response');
  span.output('private output');
  span.note('private note');
  span.done({ outputChars: 14 });
  span.failed(new Error('private failure'));
  off.skipped({ reason: 'provider-credential-missing' });
  off.fallback({ reason: 'provider-timeout' });
  off.result({ status: 'ready' });
  assert.deepEqual(written, []);
  assert.deepEqual(Object.keys(off).sort(), Object.keys(NO_LLM_TRACE).sort());
});

test('an enabled trace records only bounded round-trip metadata', () => {
  let time = 1000;
  const { trace, lines } = collector({ now: () => time });
  const span = trace.begin({ kind: 'enrich', provider: 'api', protocol: 'chat-completions', model: 'private-model' });
  span.request({
    endpoint: 'https://private.example/v1/chat/completions', timeoutMs: 8000,
    body: { messages: [{ role: 'system', content: '私人提示词' }] }
  });
  span.resolved('93.184.216.34', 4);
  time = 1040;
  span.status(200, 'application/json');
  span.body('private response');
  span.output('private output');
  time = 1055;
  span.done({ outputChars: 14, repairAttempts: 1 });
  assert.deepEqual(lines, [
    '[llm] begin kind=enrich provider=api requestId=1',
    '[llm] request requestId=1 timeoutMs=8000',
    '[llm] resolved requestId=1',
    '[llm] response requestId=1 elapsedMs=40 statusCode=200',
    '[llm] response-size requestId=1 responseChars=16',
    '[llm] output-size requestId=1 outputChars=14',
    '[llm] ok requestId=1 repairAttempts=1 outputChars=14 elapsedMs=55'
  ]);
});

test('private content never reaches any enabled sink, including attempted payload opt-ins', () => {
  const privateValues = [
    '下周向家人解释私人债务', '记忆里保存的医院名字', '今天心情很差请保密',
    'tool-payload-private-value', 'sk-live-000111222333444555', 'raw-provider-exception',
    'private-request-id', 'https://private-host.example/private-path?token=secret-query'
  ];
  const raw = privateValues.join('\n');
  for (const options of [
    {}, { maxBodyChars: 200_000 }, { includeBody: true, logPayloads: true, mode: 'content' }
  ]) {
    const { trace, lines, text } = collector(options);
    const fields = {
      requestId: privateValues[6], kind: raw, task: raw, provider: raw, from: raw, to: raw,
      status: raw, abortedBy: raw, count: raw, outputChars: raw, statusCode: raw,
      reason: raw, model: raw, baseUrl: privateValues[7], endpoint: privateValues[7],
      title: raw, message: raw, body: { content: raw }, toolPayload: { result: raw },
      authorization: `Bearer ${privateValues[4]}`
    };
    trace.selection(fields);
    trace.skipped(fields);
    trace.fallback(fields);
    trace.result(fields);
    const span = trace.begin(fields);
    span.request(fields);
    span.resolved(raw, raw);
    span.status(raw, raw);
    span.body(raw);
    span.output(raw);
    span.note(raw);
    span.done(fields);
    const error = Object.assign(new Error(raw), { stack: raw, detail: raw, modelText: raw, code: raw });
    span.failed(error, fields);
    for (const value of privateValues) assert.ok(!text().includes(value), `private value leaked: ${value}`);
    assert.ok(lines.every(line => !line.includes('\n')), 'the sink receives single metadata lines only');
    assert.match(text(), /errorCode=provider-failed/);
    assert.match(text(), /responseChars=\d+/);
    assert.doesNotMatch(text(), /Bearer|stack|title=|model=|endpoint=|body=|reason=/);
  }
});

test('ignored objects and accessor fields are never serialized or evaluated', () => {
  const fail = () => { throw new Error('private accessor must never run'); };
  const fields = { body: { toJSON: fail }, outputChars: { toString: fail }, note: { toString: fail } };
  for (const key of ['provider', 'reason', 'title', 'messageCount', 'endpoint']) {
    Object.defineProperty(fields, key, { get: fail, enumerable: true });
  }
  const error = {};
  for (const key of ['message', 'stack', 'code', 'stage', 'statusCode']) {
    Object.defineProperty(error, key, { get: fail });
  }
  const { trace, text } = collector();
  assert.doesNotThrow(() => {
    trace.selection(fields);
    trace.fallback(fields);
    const span = trace.begin(fields);
    span.request(fields);
    span.body(fields);
    span.output(fields);
    span.note(fields);
    span.done(fields);
    span.failed(error, fields);
  });
  assert.doesNotMatch(text(), /private accessor/);
  assert.match(text(), /errorCode=provider-failed/);
});

test('errors are mapped to closed codes without stacks, validator text or provider echoes', () => {
  const secret = 'PRIVATE_CONTENT_WITHOUT_A_SECRET_PATTERN';
  const cases = [
    [new Error('provider-request-aborted'), 'provider-request-aborted'],
    [new Error('provider-timeout'), 'provider-timeout'],
    [new ProviderHttpError(429, secret), 'provider-http-error'],
    [Object.assign(new Error(secret), { stage: 'validate', modelText: secret }), 'proposal-rejected'],
    [Object.assign(new Error(secret), { code: 'ECONNRESET' }), 'provider-network-error'],
    [new Error('provider model is required'), 'provider-model-missing'],
    [new Error(secret), 'provider-failed'],
    [{ message: { toString: () => secret } }, 'provider-failed'],
    [`proposal-rejected|${secret}`, 'proposal-rejected'],
    [`provider-http-401|${secret}`, 'provider-http-error'],
    [`provider-timeout\n${secret}`, 'provider-failed']
  ];
  for (const [error, expected] of cases) {
    const { trace, text } = collector();
    trace.begin({ kind: 'clarify' }).failed(error, { abortedBy: 'caller' });
    const reason = typeof error === 'string' ? error : error.message;
    trace.fallback({ reason });
    assert.match(text(), new RegExp(`failed .*errorCode=${expected}(?:\\s|$)`));
    assert.ok(!text().includes(secret));
    assert.doesNotMatch(text(), /llm-trace\.test\.js|stack|Error:|reason=/);
  }
});

test('metadata requires safe enums and finite nonnegative integer counts', () => {
  assert.equal(formatFields({
    task: 'enrich', provider: 'api', status: 'ready', count: 2, toolCount: 1, statusCode: 204,
    timeoutMs: Infinity, outputChars: -1, inputChars: '21', repairAttempts: 0.5,
    requestId: Number.MAX_SAFE_INTEGER + 1, model: 'secret', reason: 'provider-timeout'
  }), 'task=enrich provider=api status=ready toolCount=1 count=2 statusCode=204 errorCode=provider-timeout');
  assert.equal(formatFields({ kind: 'arbitrary-tool', provider: 'https://private', statusCode: 999 }), '');
  assert.equal(formatFields(Object.create({ provider: 'api', title: 'private' })), '');
  assert.equal(formatFields(null), '');
});

test('request IDs are generated locally and do not accept caller-provided content', () => {
  const { trace, text } = collector();
  const first = trace.begin({ requestId: 'private-correlation-id' });
  const second = trace.begin({ requestId: 999 });
  first.done({ requestId: 998 });
  second.done({ requestId: 997 });
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.match(text(), /ok requestId=1 elapsedMs=0/);
  assert.match(text(), /ok requestId=2 elapsedMs=0/);
  assert.doesNotMatch(text(), /private-correlation-id|99[789]/);
});

test('outbound intent is logged before endpoint validation without leaking the endpoint', async () => {
  const { trace, text } = collector();
  const span = trace.begin({ task: 'breakdown', provider: 'api' });
  await assert.rejects(
    postJson('https://localhost/v1/chat/completions?private=somebody', { model: 'm' }, { span }),
    /provider-endpoint-host-not-allowed/
  );
  assert.match(text(), new RegExp(`request requestId=1 timeoutMs=${DEFAULT_TIMEOUT_MS}`));
  assert.doesNotMatch(text(), /localhost|somebody|response statusCode=/);
});

test('real generation and fallback logging drops private input, model output and HTTP details', async () => {
  const { runWithFallback, timers } = providerHarness();
  const secret = '私人会话与记忆_canary';
  const { trace, text } = collector();
  const client = createApiClient({
    baseUrl: 'https://example.com/v1', model: secret, getCredential: () => secret, trace,
    post: async (_endpoint, _body, { span }) => {
      span.request({ endpoint: `https://example.com/${secret}`, body: _body });
      span.status(500, secret);
      span.body(secret);
      throw new ProviderHttpError(500, secret);
    }
  });
  const result = await runWithFallback(client, deterministic(), 'breakdown', { title: secret }, { trace, assertCurrent() {} });
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'provider-http-error');
  assert.deepEqual(result.cleanup, { ok: true, timer: 'released', listener: 'released' });
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(timers.size, 0);
  assert.match(text(), /failed .*errorCode=provider-http-error/);
  assert.match(text(), /fallback .*errorCode=provider-http-error/);
  assert.ok(!text().includes(secret));
});

test('fallback metadata distinguishes the deadline from caller cancellation', async () => {
  const { runWithFallback, timers, advance } = providerHarness();
  const fallback = deterministic();
  const hanging = {
    id: 'api', timeoutMs: 5,
    run: (_name, _payload, { signal, beforeRequest }) => new Promise((_, reject) => {
      beforeRequest();
      signal.addEventListener('abort', () => reject(new Error('provider-request-aborted')), { once: true });
    })
  };
  const deadline = collector();
  const deadlinePending = runWithFallback(hanging, fallback, 'breakdown', { title: '写周报' }, {
    trace: deadline.trace, assertCurrent() {}
  });
  await Promise.resolve();
  advance(5);
  const timedOut = await deadlinePending;
  assert.equal(timedOut.ok, true);
  assert.equal(timedOut.fallback, true);
  assert.equal(timedOut.reason, 'provider-request-aborted');
  assert.deepEqual(timedOut.cleanup, { ok: true, timer: 'released', listener: 'released' });
  assert.equal(Object.isFrozen(timedOut.cleanup), true);
  assert.match(deadline.text(), /fallback task=breakdown from=api to=deterministic abortedBy=deadline deadlineMs=5 errorCode=provider-request-aborted/);
  const cancelled = collector();
  const caller = new AbortController();
  const pending = runWithFallback({ ...hanging, timeoutMs: 8000 }, fallback, 'breakdown', { title: '写周报' }, {
    trace: cancelled.trace, signal: caller.signal, assertCurrent() {}
  });
  caller.abort();
  const refused = await pending;
  assert.deepEqual(refused, { ok: false, reason: 'provider-request-aborted',
    cleanup: { ok: true, timer: 'released', listener: 'released' } });
  assert.equal(Object.isFrozen(refused.cleanup), true);
  assert.equal(timers.size, 0);
  assert.match(cancelled.text(), /abortedBy=caller/);
  assert.doesNotMatch(cancelled.text(), /abortedBy=deadline|写周报/);
});

test('the trace sink is injected and core imports no platform module', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/core/llm/trace.js'), 'utf8');
  assert.ok(!/require\(/.test(source));
  assert.equal((source.match(/process\.stdout/g) || []).length, 1);
});
