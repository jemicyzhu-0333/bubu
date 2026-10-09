'use strict';

// Separately admitted, non-pure import fixture. The real client imports the
// transport module, but every client below has a counted fake post. Run only
// under the independently sealed DNS/HTTPS/socket-denying protocol gate.
// ARCHITECTURE「AI 与 LLM」: negotiation and repair share the same POST budget.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, createLlmTrace } = require('../src/core/llm');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');

const BASE_URL = 'https://synthetic-provider.example.test/v1';
const MODEL = 'synthetic-protocol-model';
const CREDENTIAL = 'synthetic-protocol-credential';
const TASK = 'impulse-energy';
const PAYLOAD = Object.freeze({ impulseText: 'Synthetic present-energy note.' });
const PROPOSAL = Object.freeze({ direction: 'up', delta: 4, confidence: 85, reason: 'Synthetic energy report' });
const VALID = JSON.stringify(PROPOSAL);
const INVALID = JSON.stringify({ ...PROPOSAL, delta: -4 });
const LOCAL = Object.freeze({ syntheticLocalResult: true });
const CLEANUP = Object.freeze({ ok: true, timer: 'released', listener: 'released' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function callerSignal() {
  let aborted = false;
  let adds = 0;
  let removes = 0;
  const listeners = new Map();
  const signal = {
    get aborted() { return aborted; },
    addEventListener(type, callback, options) {
      assert.equal(type, 'abort');
      adds += 1;
      listeners.set(callback, options);
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'abort');
      removes += 1;
      listeners.delete(callback);
    }
  };
  return {
    signal,
    get adds() { return adds; },
    get removes() { return removes; },
    get listeners() { return listeners.size; },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const [callback, options] of [...listeners]) {
        if (options?.once) listeners.delete(callback);
        callback();
      }
    }
  };
}

function reply(body, text) {
  return body.input
    ? { output_text: text }
    : { choices: [{ message: { content: text } }] };
}

function schemaRejection() {
  return new ProviderHttpError(400, 'Unsupported parameter: response_format');
}

function ladder(last = VALID) {
  return [
    schemaRejection(),
    new ProviderHttpError(404, 'Synthetic route absent'),
    schemaRejection(),
    INVALID,
    last
  ];
}

function fixture(replies, { timeoutMs = 1000, fallback, clientTrace } = {}) {
  const caller = callerSignal();
  const negotiation = new Map();
  const sent = [];
  const events = [];
  const fallbacks = [];
  const traceEvents = [];
  const timers = new Map();
  const scheduled = [];
  const canceled = [];
  let at = 100;
  let nextHandle = 0;
  let credentialCalls = 0;
  const runWithFallback = createOneShotProviderRun({
    now: () => at,
    schedule(callback, ms) {
      const handle = nextHandle++;
      scheduled.push({ handle, ms });
      timers.set(handle, { callback, due: at + ms });
      return handle;
    },
    cancelSchedule(handle) {
      canceled.push(handle);
      timers.delete(handle);
    }
  });
  // This is the only API-client construction in the fixture. There is no
  // optional/default transport path and no real DNS, socket or HTTP operation.
  const client = createApiClient({
    baseUrl: BASE_URL,
    model: MODEL,
    timeoutMs,
    negotiation,
    trace: clientTrace,
    getCredential() { credentialCalls += 1; return CREDENTIAL; },
    async post(endpoint, body, options) {
      const index = sent.length;
      events.push(`post:${index + 1}`);
      sent.push({ endpoint, body: JSON.parse(JSON.stringify(body)), options,
        cacheBefore: [...negotiation] });
      assert.equal(options.apiKey, CREDENTIAL);
      assert.equal(body.model, MODEL);
      assert.notEqual(options.signal, caller.signal);
      assert.equal(options.signal.aborted, false);
      assert.equal(options.timeoutMs, client.timeoutMs);
      assert.ok(index < replies.length, 'unexpected fake POST');
      const item = replies[index];
      if (typeof item === 'function') return item({ endpoint, body, options });
      if (item instanceof Error) throw item;
      return reply(body, item);
    }
  });
  const fallbackClient = {
    id: 'deterministic',
    async run(name, payload, options) {
      events.push('fallback');
      fallbacks.push({ name, payload, options });
      return fallback ? fallback({ name, payload, options }) : LOCAL;
    }
  };
  function assertCurrent() {
    events.push('freshness');
    if (caller.signal.aborted) throw new Error('provider-request-aborted');
  }
  return {
    caller, client, fallbackClient, negotiation, sent, events, fallbacks,
    scheduled, canceled, timers, traceEvents,
    get credentialCalls() { return credentialCalls; },
    run(options = {}, selectedClient = client) {
      return runWithFallback(selectedClient, fallbackClient, TASK, PAYLOAD, {
        signal: caller.signal,
        assertCurrent,
        trace: { fallback: fields => traceEvents.push(fields) },
        ...options
      });
    },
    fireDeadline() {
      assert.equal(timers.size, 1);
      const [handle, timer] = [...timers][0];
      at = timer.due;
      timers.delete(handle);
      timer.callback();
    }
  };
}

function assertReleased(f, result, runs = 1) {
  assert.deepEqual(result.cleanup, CLEANUP);
  assert.ok(Object.isFrozen(result.cleanup));
  assert.equal(f.timers.size, 0);
  assert.equal(f.scheduled.length, runs);
  assert.deepEqual(f.canceled, f.scheduled.map(timer => timer.handle));
  assert.equal(f.caller.adds, runs);
  assert.equal(f.caller.removes, runs);
  assert.equal(f.caller.listeners, 0);
}

function assertRemoteSuccess(result) {
  assert.deepEqual(result, {
    ok: true, proposal: PROPOSAL, provider: 'api', fallback: false,
    reason: null, cleanup: CLEANUP
  });
}

function assertLocalSuccess(result, reason) {
  assert.deepEqual(result, {
    ok: true, proposal: LOCAL, provider: 'deterministic', fallback: true,
    reason, cleanup: CLEANUP
  });
}

function modes(f) {
  return f.sent.map(({ endpoint, body }) => [
    endpoint.slice(BASE_URL.length),
    body.input ? body.text.format.type : body.response_format.type
  ]);
}

test('five charged native POSTs cover schema, route, schema, rejection and one repair; valid cache is warm', async () => {
  const f = fixture([...ladder(), VALID]);
  const result = await f.run();
  assertRemoteSuccess(result);
  assert.equal(f.sent.length, 5);
  assert.equal(f.credentialCalls, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.deepEqual(modes(f), [
    ['/chat/completions', 'json_schema'],
    ['/chat/completions', 'json_object'],
    ['/responses', 'json_schema'],
    ['/responses', 'json_object'],
    ['/responses', 'json_object']
  ]);
  assert.deepEqual(f.events, [
    'freshness',
    'freshness', 'freshness', 'post:1',
    'freshness', 'freshness', 'post:2',
    'freshness', 'freshness', 'post:3',
    'freshness', 'freshness', 'post:4',
    'freshness', 'freshness', 'post:5',
    'freshness'
  ], 'admission, owner assertions before and after each POST charge, then post-wait freshness');
  assert.ok(f.sent.every(request => request.cacheBefore.length === 0));
  assert.ok(f.sent.every(request => request.options.signal === f.sent[0].options.signal));
  assert.deepEqual(f.scheduled.map(timer => timer.ms), [f.client.timeoutMs]);
  assert.equal(f.sent[0].body.messages[1].content, JSON.stringify(PAYLOAD));
  const repaired = f.sent[4].body.input;
  assert.equal(repaired.at(-2).role, 'assistant');
  assert.equal(repaired.at(-2).content, INVALID);
  assert.match(repaired.at(-1).content, /impulse energy direction and delta disagree/);
  assert.equal(repaired.length, f.sent[3].body.input.length + 2);
  assert.deepEqual([...f.negotiation], [
    [BASE_URL, 'responses'],
    [`${BASE_URL}#schema-mode:responses`, 'json_object']
  ]);
  assertReleased(f, result);

  const warm = await f.run();
  assertRemoteSuccess(warm);
  assert.equal(f.sent.length, 6, 'a separate invocation gets its own POST allowance');
  assert.deepEqual(modes(f).at(-1), ['/responses', 'json_object']);
  assert.equal(f.sent[5].body.input.length, f.sent[3].body.input.length);
  assert.equal(f.credentialCalls, 2);
  assertReleased(f, warm, 2);
});

test('a sixth native attempt is refused before fake post when a client requests two generations in one run', async () => {
  const f = fixture([...ladder(), VALID]);
  let generations = 0;
  // The ordinary one-repair ladder needs at most five attempts. This deliberate
  // composite port calls the actual generator again under the SAME controls;
  // it neither copies negotiation nor invents a second accounting callback.
  const composite = {
    id: f.client.id,
    timeoutMs: f.client.timeoutMs,
    async run(name, payload, options) {
      generations += 1;
      await f.client.run(name, payload, options);
      generations += 1;
      return f.client.run(name, payload, options);
    }
  };
  const result = await f.run({}, composite);
  assertLocalSuccess(result, 'provider-budget');
  assert.equal(generations, 2);
  assert.equal(f.credentialCalls, 2);
  assert.equal(f.sent.length, 5, 'the sixth actual generator beforeRequest never reaches post');
  assert.equal(f.fallbacks.length, 1);
  assert.equal(f.traceEvents[0].reason, 'provider-budget');
  assert.equal(f.fallbacks[0].options.signal, f.caller.signal);
  assertReleased(f, result);
});

test('unsuccessful model validation never caches a negotiated route or schema mode', async () => {
  const f = fixture([...ladder(INVALID), ...ladder()]);
  const rejected = await f.run();
  assertLocalSuccess(rejected, 'proposal-rejected');
  assert.equal(f.sent.length, 5);
  assert.deepEqual([...f.negotiation], []);
  assert.ok(f.sent.every(request => request.cacheBefore.length === 0));
  assertReleased(f, rejected);

  const next = await f.run();
  assertRemoteSuccess(next);
  assert.equal(f.sent.length, 10);
  assert.deepEqual(modes(f).slice(5), modes(f).slice(0, 5));
  assert.ok(f.sent.every(request => request.cacheBefore.length === 0));
  assertReleased(f, next, 2);
});

test('ordinary HTTP failures do not negotiate or retry and expose only the bounded reason', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const f = fixture([
      new ProviderHttpError(status, 'Synthetic private response_format detail'), VALID
    ]);
    const result = await f.run();
    assertLocalSuccess(result, 'provider-http-error');
    assert.equal(f.sent.length, 1, `HTTP ${status} must stop immediately`);
    assert.equal(f.fallbacks.length, 1);
    assert.deepEqual([...f.negotiation], []);
    assert.equal(f.traceEvents[0].reason, 'provider-http-error');
    assert.equal(JSON.stringify(result).includes('Synthetic private'), false);
    assertReleased(f, result);
  }
});

test('caller cancellation during schema negotiation prevents the second POST and local fallback', async () => {
  let f;
  f = fixture([
    () => { f.caller.abort(); throw schemaRejection(); },
    VALID
  ]);
  const result = await f.run();
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: CLEANUP });
  assert.equal(f.sent.length, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.deepEqual([...f.negotiation], []);
  assert.equal(f.sent[0].options.signal.aborted, true);
  assertReleased(f, result);
});

test('deadline interrupts an abort-ignoring POST; fallback receives the live original caller signal', async () => {
  const posted = deferred();
  const delayed = deferred();
  const usage = [];
  let f;
  f = fixture([() => { posted.resolve(); return delayed.promise; }], {
    timeoutMs: 1375,
    fallback({ name, payload, options }) {
      assert.equal(name, TASK);
      assert.equal(payload, PAYLOAD);
      assert.equal(options.signal, f.caller.signal);
      assert.equal(options.signal.aborted, false);
      assert.equal(f.sent[0].options.signal.aborted, true);
      return LOCAL;
    }
  });
  const pending = f.run({ onUsage: value => usage.push(value) });
  await posted.promise;
  assert.deepEqual(f.scheduled.map(timer => timer.ms), [1375]);
  f.fireDeadline();
  const result = await pending;
  assertLocalSuccess(result, 'provider-request-aborted');
  assert.equal(f.fallbacks.length, 1);
  assert.equal(f.traceEvents[0].abortedBy, 'deadline');
  assert.equal(f.traceEvents[0].reason, 'provider-request-aborted');
  assert.equal(f.traceEvents[0].deadlineMs, 1375);
  assertReleased(f, result);

  delayed.resolve({ choices: [{ message: { content: VALID } }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  await delayed.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.sent.length, 1);
  assert.equal(f.fallbacks.length, 1);
  assert.deepEqual([...f.negotiation], []);
  assert.deepEqual(usage, []);
  assertLocalSuccess(result, 'provider-request-aborted');
  assertReleased(f, result);
});

test('zero feedback repair still permits protocol/schema negotiation and first-pass format repair', async () => {
  const formatted = JSON.stringify({
    direction: 'UP', delta: '4', confidence: '85', reason: PROPOSAL.reason,
    ignoredSyntheticField: true
  });
  const f = fixture([schemaRejection(), new ProviderHttpError(404, 'Route absent'), schemaRejection(), formatted]);
  const result = await f.run({ maxRepairAttempts: 0 });
  assertRemoteSuccess(result);
  assert.equal(f.sent.length, 4);
  assert.deepEqual(modes(f), [
    ['/chat/completions', 'json_schema'], ['/chat/completions', 'json_object'],
    ['/responses', 'json_schema'], ['/responses', 'json_object']
  ]);
  assert.ok(f.sent.every(({ body }) => (body.input || body.messages).every(message => message.role !== 'assistant')));
  assertReleased(f, result);
});

test('zero feedback repair refuses invalid negotiated output without a fifth POST or cache entry', async () => {
  const f = fixture(ladder());
  const result = await f.run({ maxRepairAttempts: 0 });
  assertLocalSuccess(result, 'proposal-rejected');
  assert.equal(f.sent.length, 4);
  assert.equal(f.fallbacks.length, 1);
  assert.deepEqual([...f.negotiation], []);
  assertReleased(f, result);
});

test('an enabled real trace with a throwing sink preserves one-POST validated success', async () => {
  let sinkCalls = 0;
  const clientTrace = createLlmTrace({
    enabled: true,
    now: () => 100,
    sink() { sinkCalls += 1; throw new Error('Synthetic private sink failure'); }
  });
  const f = fixture([VALID], { clientTrace });
  const result = await f.run();
  assertRemoteSuccess(result);
  assert.equal(sinkCalls, 3, 'begin, output and successful completion are observations');
  assert.equal(f.sent.length, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.deepEqual(f.traceEvents, []);
  assertReleased(f, result);
});

test('an enabled real trace with a throwing clock omits elapsed time and preserves one-POST success', async () => {
  const lines = [];
  let clockCalls = 0;
  const clientTrace = createLlmTrace({
    enabled: true,
    now() { clockCalls += 1; throw new Error('Synthetic private clock failure'); },
    sink: line => lines.push(line)
  });
  const f = fixture([VALID], { clientTrace });
  const result = await f.run();
  assertRemoteSuccess(result);
  assert.equal(clockCalls, 2, 'start and completion trace samples both fail independently');
  assert.equal(lines.length, 3);
  assert.ok(lines.some(line => line.startsWith('[llm] ok ')));
  assert.ok(lines.every(line => !line.includes('elapsedMs=')), 'unknown elapsed time is not invented as zero');
  for (const forbidden of [CREDENTIAL, BASE_URL, MODEL, PAYLOAD.impulseText, PROPOSAL.reason, 'Synthetic private']) {
    assert.ok(lines.every(line => !line.includes(forbidden)));
  }
  assert.equal(f.sent.length, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.deepEqual(f.traceEvents, []);
  assertReleased(f, result);
});
