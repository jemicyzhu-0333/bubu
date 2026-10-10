'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, createLlmTrace } = require('../src/core/llm');
const { generateStructured } = require('../src/core/llm/generate');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { diagnosticRejection, diagnosticTransport } = require('../src/core/llm/diagnostic-observation');

const energy = { direction: 'up', delta: 5, confidence: 80, reason: 'Current state' };
const triage = { category: 'state', confidence: 80, title: null, routineKind: null, level: 65, reason: 'Current state' };
const steps = ['Open document', 'Write text', 'Save document'].map((title, index) =>
  ({ title, dependsOn: index ? index - 1 : null, safeStopAfter: index === 2 }));

function recording() {
  const events = [];
  return { events, diagnostics: { observe(phase, data) { events.push({ phase, ...data }); } } };
}

function clientHarness(replies) {
  let credentialReads = 0;
  const requests = [];
  const client = createApiClient({ model: 'PRIVATE_MODEL', baseUrl: 'https://private.example.test/v1',
    getCredential() { credentialReads++; return 'PRIVATE_KEY'; },
    async post(endpoint, request) {
      requests.push({ endpoint, request });
      const reply = replies[requests.length - 1];
      if (reply instanceof Error) throw reply;
      return request.input ? { output_text: reply, reasoning: 'PRIVATE_REASONING' }
        : { choices: [{ message: { content: reply, reasoning_content: 'PRIVATE_REASONING' } }], raw: 'PRIVATE_HTTP' };
    }
  });
  return { client, requests, credentialReads: () => credentialReads };
}

function stubHarness(replies, overrides = {}) {
  const calls = { post: 0, repair: 0, validate: 0 };
  const task = {
    name: 'capture-triage', schemaName: 'test', instruction: 'PRIVATE_PROMPT',
    buildSchema: () => ({ type: 'object' }), buildInput: () => ({ title: 'PRIVATE_INPUT' }),
    repair(text) { calls.repair++; return JSON.parse(text); },
    validate(value) { calls.validate++; return value; }, ...overrides
  };
  return { calls, run: options => generateStructured({ task, model: 'PRIVATE_MODEL',
    baseUrl: 'https://private.example.test/v1', apiKey: 'PRIVATE_KEY',
    post(endpoint, request) {
      const reply = replies[calls.post++];
      if (reply instanceof Error) throw reply;
      return request.input ? { output_text: reply } : { choices: [{ message: { content: reply } }] };
    }, ...options }) };
}

for (const [name, value, payload] of [
  ['capture-triage', triage, { impulseText: 'PRIVATE_INPUT' }],
  ['impulse-energy', energy, { impulseText: 'PRIVATE_INPUT' }],
  ['breakdown', { steps, clarifyingQuestion: null }, { title: 'PRIVATE_INPUT' }],
  ['enrich', { steps, completionCriteria: null, energy: 'low', estimateMinutes: 20, tags: [] },
    { title: 'PRIVATE_INPUT', existingTags: [] }]
]) {
  test(`${name}: per-run observations add no requests or credentials reads and retain the original result`, async () => {
    const harness = clientHarness([JSON.stringify(value), JSON.stringify(value)]);
    const { events, diagnostics } = recording();
    const observed = await harness.client.run(name, payload, { diagnostics });
    const ordinary = await harness.client.run(name, payload);
    assert.deepEqual(observed, ordinary);
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.credentialReads(), 2);
    assert.deepEqual(events.map(event => event.phase), ['attempt', 'output', 'repaired', 'validated']);
    assert.deepEqual(events.at(-1).value, observed);
    assert.notEqual(events.at(-1).value, observed);
    for (const event of events) {
      assert.equal(event.attempt, 1);
      assert.equal(event.repairAttempts, 0);
      assert.equal(event.protocol, 'chat-completions');
      assert.equal(event.mode, 'json_schema');
      assert.doesNotMatch(JSON.stringify(event), /PRIVATE_(?:KEY|MODEL|INPUT|PROMPT|HTTP|REASONING)|private\.example/);
    }
  });
}

test('the exact extracted text, repaired candidate and validated projection remain distinct', async () => {
  const text = `\`\`\`json\n${JSON.stringify({ ...triage, category: 'STATE', confidence: '80',
    title: 'Discarded title', routineKind: 'meal', level: '65', extra: 'Discarded extra' })}\n\`\`\``;
  const { client } = clientHarness([text]);
  const { events, diagnostics } = recording();
  assert.deepEqual(await client.run('capture-triage', { impulseText: 'PRIVATE_INPUT' }, { diagnostics }), triage);
  assert.equal(events[1].text, text);
  assert.equal(events[2].value.category, 'state');
  assert.equal(events[2].value.title, 'Discarded title');
  assert.equal(events[2].value.routineKind, 'meal');
  assert.equal(events[2].value.extra, undefined);
  assert.deepEqual(events[3].value, triage);
});

test('retry output stays separate and repair/validate each execute once at their original site', async () => {
  const { events, diagnostics } = recording();
  let repaired = 0, validated = 0;
  const stub = stubHarness(['{"confidence":101}', '{"confidence":80}'], {
    repair(text) { repaired++; return JSON.parse(text); },
    validate(value) {
      validated++;
      if (value.confidence > 100) throw new RangeError('capture triage confidence is invalid');
      return value;
    }
  });
  assert.deepEqual(await stub.run({ diagnostics }), { confidence: 80 });
  assert.equal(stub.calls.post, 2);
  assert.equal(repaired, 2);
  assert.equal(validated, 2);
  assert.deepEqual(events.filter(event => event.phase === 'output').map(event =>
    [event.text, event.attempt, event.repairAttempts]), [['{"confidence":101}', 1, 0], ['{"confidence":80}', 2, 1]]);
  assert.deepEqual(events.find(event => event.phase === 'rejected'), {
    phase: 'rejected', protocol: 'chat-completions', mode: 'json_schema', attempt: 1, repairAttempts: 0,
    code: 'proposal-field-invalid', field: 'confidence'
  });
});

test('protocol and mode negotiation preserve attempts without consuming repair attempts', async () => {
  const stub = stubHarness([new ProviderHttpError(400, 'Unsupported response_format PRIVATE_DETAIL'),
    new ProviderHttpError(404, 'PRIVATE_ROUTE'), '{"ok":true}']);
  const { events, diagnostics } = recording();
  assert.deepEqual(await stub.run({ diagnostics }), { ok: true });
  assert.equal(stub.calls.post, 3);
  assert.deepEqual(events.filter(event => event.phase === 'attempt').map(event =>
    [event.attempt, event.repairAttempts, event.protocol, event.mode]), [
    [1, 0, 'chat-completions', 'json_schema'], [2, 0, 'chat-completions', 'json_object'],
    [3, 0, 'responses', 'json_schema']
  ]);
  assert.deepEqual(events.filter(event => event.phase === 'transport').map(event => [event.code, event.statusCode]),
    [['provider-http-error', 400], ['provider-http-error', 404]]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_/);
});

test('at most five attempts are observed without lowering the existing generation budget', async () => {
  const stub = stubHarness([new ProviderHttpError(400, 'Unsupported response_format'),
    new ProviderHttpError(404, 'route missing'), new ProviderHttpError(400, 'Unsupported response_format'),
    '{"ok":false}', '{"ok":false}', '{"ok":false}', '{"ok":true}'], {
    validate(value) { if (!value.ok) throw new Error('capture triage confidence is invalid'); return value; }
  });
  const { events, diagnostics } = recording();
  assert.deepEqual(await stub.run({ diagnostics, maxRepairAttempts: 3 }), { ok: true });
  assert.equal(stub.calls.post, 7);
  assert.equal(Math.max(...events.map(event => event.attempt)), 5);
  assert.equal(events.filter(event => event.phase === 'attempt').length, 5);
});

test('throwing, rejecting and hostile thenable observers cannot retry or replace a valid outcome', async () => {
  for (const observe of [
    () => { throw new Error('PRIVATE_OBSERVER'); },
    () => Promise.reject(new Error('PRIVATE_OBSERVER')),
    () => ({ get then() { throw new Error('PRIVATE_OBSERVER_GETTER'); } })
  ]) {
    const stub = stubHarness(['{"ok":true}']);
    assert.deepEqual(await stub.run({ diagnostics: { observe } }), { ok: true });
    assert.deepEqual(stub.calls, { post: 1, repair: 1, validate: 1 });
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('observer accessors and revoked proxies are ignored without reading getters', async () => {
  let getters = 0;
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const options = [
    { get diagnostics() { getters++; throw new Error('PRIVATE_OPTIONS'); } },
    { diagnostics: { get observe() { getters++; throw new Error('PRIVATE_OBSERVER'); } } },
    { diagnostics: revoked.proxy },
    { diagnostics: new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE_PROXY'); } }) }
  ];
  for (const runOptions of options) {
    const { client, requests } = clientHarness([JSON.stringify(energy)]);
    assert.deepEqual(await client.run('impulse-energy', { impulseText: 'PRIVATE_INPUT' }, runOptions), energy);
    assert.equal(requests.length, 1);
  }
  assert.equal(getters, 0);
});

test('observer snapshots cannot mutate the candidate, validated result or negotiated mode', async () => {
  const candidate = { nested: { ok: true } };
  let seen;
  const stub = stubHarness(['{}'], { repair: () => candidate, validate(value) { seen = value; return value; } });
  const result = await stub.run({ diagnostics: { observe(phase, data) {
    if (data.value) data.value.nested.ok = false;
    else data.mode = 'json_object';
  } } });
  assert.equal(result, candidate);
  assert.equal(seen, candidate);
  assert.deepEqual(candidate, { nested: { ok: true } });
  assert.equal(stub.calls.post, 1);
});

test('candidate copying never calls getters or toJSON and never changes validation', async () => {
  let getters = 0, serializations = 0;
  const candidate = { ok: true };
  Object.defineProperty(candidate, 'toJSON', { value() { serializations++; throw new Error('PRIVATE_SERIALIZE'); } });
  Object.defineProperty(candidate, 'secret', { enumerable: true, get() { getters++; throw new Error('PRIVATE_GETTER'); } });
  const stub = stubHarness(['{}'], { repair: () => candidate, validate: value => value });
  const { events, diagnostics } = recording();
  assert.equal(await stub.run({ diagnostics }), candidate);
  assert.deepEqual(events.map(event => event.phase), ['attempt', 'output']);
  assert.equal(getters, 0);
  assert.equal(serializations, 0);
  assert.equal(stub.calls.post, 1);
});

test('cancelled requests cannot deliver a late output, rejection or transport observation', async () => {
  for (const failed of [false, true]) {
    const controller = new AbortController();
    let finish;
    const { events, diagnostics } = recording();
    const stub = stubHarness([]);
    const run = stub.run({ signal: controller.signal, diagnostics,
      post: () => new Promise((resolve, reject) => { finish = failed ? reject : resolve; }) });
    controller.abort();
    finish(failed ? new ProviderHttpError(404, 'PRIVATE_LATE_ERROR')
      : { choices: [{ message: { content: 'PRIVATE_LATE_OUTPUT' } }] });
    await assert.rejects(run, /provider-request-aborted/);
    assert.deepEqual(events.map(event => event.phase), ['attempt']);
    assert.equal(stub.calls.repair, 0);
  }
  const controller = new AbortController(); controller.abort();
  const stub = stubHarness(['{}']);
  const { events, diagnostics } = recording();
  await assert.rejects(stub.run({ signal: controller.signal, diagnostics }), /provider-request-aborted/);
  assert.deepEqual(events, []);
  assert.equal(stub.calls.post, 0);
});

test('cancellation from usage or validation suppresses later content observations', async () => {
  for (const phase of ['usage', 'validation']) {
    const controller = new AbortController();
    const { events, diagnostics } = recording();
    const stub = stubHarness(['{}'], { validate(value) { if (phase === 'validation') controller.abort(); return value; } });
    await assert.rejects(stub.run({ signal: controller.signal, diagnostics,
      onUsage() { if (phase === 'usage') controller.abort(); } }), /provider-request-aborted/);
    assert.deepEqual(events.map(event => event.phase), phase === 'usage'
      ? ['attempt'] : ['attempt', 'output', 'repaired']);
  }
});

test('unknown validator/provider errors never leak messages, model text, stacks or arbitrary fields', async () => {
  for (const local of [false, true]) {
    const error = Object.assign(new Error('PRIVATE_ERROR'), { code: 'PRIVATE_CODE', stack: 'PRIVATE_STACK',
      modelText: 'PRIVATE_MODEL_TEXT', stage: 'validate', detail: 'PRIVATE_DETAIL', statusCode: 'PRIVATE_STATUS' });
    const stub = stubHarness(local ? ['{}'] : [error], local ? { validate() { throw error; } } : {});
    const { events, diagnostics } = recording();
    await assert.rejects(stub.run({ diagnostics, maxRepairAttempts: 0 }), /PRIVATE_ERROR/);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_/);
    assert.equal(events.at(-1).phase, local ? 'rejected' : 'transport');
    assert.equal(events.at(-1).code, local ? 'proposal-rejected' : 'provider-failed');
  }
});

test('trusted rejection mapping is task-scoped, bounded and accessor-free', () => {
  const cases = [
    ['capture-triage', 'capture triage level is required', 'proposal-field-required', 'level'],
    ['impulse-energy', 'impulse energy direction and delta disagree', 'proposal-direction-delta-disagree', 'delta'],
    ['breakdown', 'steps[6].safeStopAfter must be boolean', 'proposal-field-invalid', 'steps[6].safeStopAfter'],
    ['enrich', 'estimateMinutes is invalid', 'proposal-field-invalid', 'estimateMinutes'],
    ['enrich', 'proposal must contain 3–7 steps', 'proposal-step-count-invalid', 'steps'],
    ['capture-triage', 'proposal is not valid JSON', 'proposal-json-invalid', undefined]
  ];
  for (const [task, message, code, field] of cases) assert.deepEqual(diagnosticRejection(task, new Error(message)),
    field ? { code, field } : { code });
  for (const message of ['steps[7].title is invalid', 'steps[9999].title is invalid', 'energy is invalid PRIVATE_VALUE']) {
    assert.deepEqual(diagnosticRejection('enrich', new Error(message)), { code: 'proposal-rejected' });
  }
  assert.deepEqual(diagnosticRejection('capture-triage', new Error('energy is invalid')), { code: 'proposal-rejected' });
  let reads = 0;
  const malicious = { get message() { reads++; throw new Error('PRIVATE'); }, get statusCode() { reads++; return 401; } };
  assert.deepEqual(diagnosticRejection('capture-triage', malicious), { code: 'proposal-rejected' });
  assert.deepEqual(diagnosticTransport(malicious), { code: 'provider-failed' });
  assert.equal(reads, 0);
});

test('content observations do not broaden the existing metadata-only trace', async () => {
  const lines = [];
  const stub = stubHarness(['{"text":"PRIVATE_OUTPUT"}']);
  const { events, diagnostics } = recording();
  await stub.run({ diagnostics, trace: createLlmTrace({ enabled: true, now: () => 0, sink: line => lines.push(line) }) });
  assert.match(events.find(event => event.phase === 'output').text, /PRIVATE_OUTPUT/);
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_|private\.example|text=/);
  assert.ok(lines.some(line => line.includes('outputChars=')));
});
