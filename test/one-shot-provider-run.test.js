'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');

function harness(overrides = {}) {
  let time = 0;
  const timers = new Map();
  const events = [];
  let next = 0;
  const ports = { now: () => time,
    schedule(callback, delay) { const id = next++; timers.set(id, callback); events.push(['schedule', delay]); return id; },
    cancelSchedule(id) { events.push(['cancel', id]); timers.delete(id); }, ...overrides };
  return { run: createOneShotProviderRun(ports), timers, events,
    advance(ms) { time += ms; for (const callback of [...timers.values()]) callback(); } };
}
const owner = () => {};
const proposal = Object.freeze({ synthetic: true });
const local = { id: 'deterministic', run: async () => proposal };
function remote(run = async (_name, _payload, options) => { options.beforeRequest(); return proposal; }) {
  return { id: 'api', timeoutMs: 100, run };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function checkCleanup(value, timer = 'released', listener = 'released') {
  assert.deepEqual(value, { ok: timer !== 'unconfirmed' && listener !== 'unconfirmed', timer, listener });
  assert.equal(Object.isFrozen(value), true);
}
function checkFailure(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result).sort(), ['cleanup', 'ok', 'reason']);
}

for (const name of ['breakdown', 'enrich', 'unstick', 'impulse-energy', 'capture-triage']) {
  test(`${name} keeps payload identity, owner order and exact successful union`, async () => {
    const h = harness();
    const payload = Object.freeze({ input: 'SYNTHETIC' });
    const events = [];
    const result = await h.run(remote(async (task, received, options) => {
      assert.equal(task, name); assert.equal(received, payload);
      events.push('run'); options.beforeRequest(); events.push('post'); return proposal;
    }), local, name, payload, { assertCurrent: () => events.push('owner') });
    assert.deepEqual(events, ['owner', 'run', 'owner', 'owner', 'post', 'owner']);
    assert.deepEqual(result, { ok: true, proposal, provider: 'api', fallback: false, reason: null,
      cleanup: { ok: true, timer: 'released', listener: 'released' } });
    checkCleanup(result.cleanup); assert.equal(h.timers.size, 0);
  });
}

test('absent optional output limit stays absent; explicit output limit and zero repair survive', async () => {
  for (const supplied of [{}, { maxRepairAttempts: 0, maxOutputChars: 20000 }]) {
    const h = harness();
    const result = await h.run(remote(async (_name, _payload, options) => {
      assert.equal(options.maxRepairAttempts, supplied.maxRepairAttempts ?? 1);
      assert.equal(Object.hasOwn(options, 'maxOutputChars'), Object.hasOwn(supplied, 'maxOutputChars'));
      assert.equal(options.maxOutputChars, supplied.maxOutputChars);
      assert.ok(options.signal instanceof AbortSignal);
      options.beforeRequest(); return proposal;
    }), local, 'breakdown', {}, { assertCurrent: owner, ...supplied });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, false);
    assert.equal(result.provider, 'api');
  }
});

test('sixth attempt is refused by shared budget; every actual attempt has an owner check', async () => {
  let posts = 0, checks = 0;
  const result = await harness().run(remote(async (_name, _payload, options) => {
    for (let i = 0; i < 6; i++) { options.beforeRequest(); posts++; }
    return proposal;
  }), local, 'breakdown', {}, { assertCurrent: () => checks++ });
  assert.equal(posts, 5); assert.equal(checks, 15);
  assert.equal(result.fallback, true); assert.equal(result.reason, 'provider-budget');
});

test('a fake success that never called beforeRequest cannot impersonate a remote result', async () => {
  const result = await harness().run(remote(async () => proposal), local, 'breakdown', {}, { assertCurrent: owner });
  assert.equal(result.fallback, true); assert.equal(result.reason, 'provider-attempt-contract-invalid');
});

for (const [value, expected] of [[undefined, 180000], [0, 180000], [1, 1], [-3, 1], ['20', 20], [999999, 180000]]) {
  test(`timeout ${String(value)} retains integer default and clamp`, async () => {
    const h = harness();
    await h.run({ ...remote(), timeoutMs: value }, local, 'breakdown', {}, { assertCurrent: owner });
    assert.deepEqual(h.events[0], ['schedule', expected]);
  });
}
for (const timeoutMs of [0.5, NaN, Infinity, 'invalid', {}, Number.MAX_SAFE_INTEGER + 1]) {
  test('invalid synthetic timeout is rejected before provider and fallback', async () => {
    const h = harness(); let calls = 0;
    const client = { id: 'api', timeoutMs, run: () => { calls++; } };
    const result = await h.run(client, client, 'breakdown', {}, { assertCurrent: owner });
    checkFailure(result, 'run-options-invalid'); assert.equal(calls, 0);
    checkCleanup(result.cleanup, 'not-acquired', 'not-acquired'); assert.equal(h.events.length, 0);
  });
}

test('unsupported tasks and invalid options never acquire an execution', async () => {
  for (const [name, options] of [['clarify', {}], ['stub', {}], ['pet-meal', {}],
    ['breakdown', { maxRepairAttempts: 2 }], ['breakdown', { maxOutputChars: 0 }]]) {
    const h = harness();
    const result = await h.run(remote(), local, name, {}, { assertCurrent: owner, ...options });
    checkFailure(result, 'run-options-invalid'); assert.equal(h.events.length, 0);
  }
});

test('missing freshness and failing setup return bounded stage plus cleanup without any provider work', async () => {
  let calls = 0;
  const client = remote(async () => { calls++; });
  const missing = await harness().run(client, local, 'breakdown', {});
  assert.equal(missing.setupStage, 'freshness'); assert.equal(missing.reason, 'run-setup-failed');
  const badClock = await harness({ now: () => { throw new Error('PRIVATE_CLOCK'); } })
    .run(client, local, 'breakdown', {}, { assertCurrent: owner });
  assert.deepEqual(badClock, { ok: false, reason: 'run-setup-failed', setupStage: 'budget',
    cleanup: { ok: true, timer: 'not-acquired', listener: 'not-acquired' } });
  const badSchedule = await harness({ schedule: () => { throw new Error('PRIVATE_SCHEDULE'); } })
    .run(client, local, 'breakdown', {}, { assertCurrent: owner });
  assert.equal(badSchedule.setupStage, 'schedule'); checkCleanup(badSchedule.cleanup, 'not-acquired', 'released');
  assert.equal(calls, 0); assert.ok(!JSON.stringify([badClock, badSchedule]).includes('PRIVATE'));
});

test('malformed caller signal is setup failure rather than cancellation', async () => {
  for (const signal of [null, {}, { aborted: false }]) {
    const result = await harness().run(remote(), local, 'breakdown', {}, { signal, assertCurrent: owner });
    assert.deepEqual(result, { ok: false, reason: 'run-setup-failed', setupStage: 'ports',
      cleanup: { ok: true, timer: 'not-acquired', listener: 'not-acquired' } });
  }
});

test('pre-abort and admission freshness failure refuse without fallback or resources', async () => {
  const controller = new AbortController(); controller.abort();
  for (const options of [{ signal: controller.signal, assertCurrent: owner },
    { assertCurrent: () => { throw new Error('PRIVATE_OWNER'); } }]) {
    const h = harness(); let calls = 0;
    const client = remote(async () => { calls++; });
    const result = await h.run(client, client, 'breakdown', {}, options);
    checkFailure(result, 'provider-request-aborted'); assert.equal(calls, 0); assert.equal(h.events.length, 0);
  }
});

test('caller abort before first microtask prevents provider admission', async () => {
  const h = harness(), controller = new AbortController(); let calls = 0;
  const pending = h.run(remote(async () => { calls++; }), local, 'breakdown', {},
    { signal: controller.signal, assertCurrent: owner });
  controller.abort();
  checkFailure(await pending, 'provider-request-aborted'); assert.equal(calls, 0);
});

test('deadline settles an abort-ignoring provider and passes original live caller signal to local fallback', async () => {
  const h = harness(), controller = new AbortController(); let finish, saved, usages = 0;
  const traces = [];
  const pending = h.run(remote((_name, _payload, options) => {
    saved = options; options.beforeRequest(); return new Promise(resolve => { finish = resolve; });
  }), { id: 'deterministic', run: async (_name, _payload, options) => {
    assert.equal(options.signal, controller.signal); assert.equal(options.signal.aborted, false); return proposal;
  } }, 'breakdown', {}, { signal: controller.signal, assertCurrent: owner,
    onUsage: () => usages++, trace: { fallback: metadata => traces.push(metadata) } });
  await flush(); h.advance(100);
  const result = await pending;
  assert.equal(result.fallback, true); assert.equal(result.reason, 'provider-request-aborted');
  assert.equal(traces[0].abortedBy, 'deadline');
  assert.throws(() => saved.beforeRequest()); saved.onUsage({ tokens: 99 }); finish({ late: true });
  await flush(); assert.equal(usages, 0); assert.equal(h.timers.size, 0);
});

test('caller cancellation wins during remote or fallback wait and discards late output', async () => {
  for (const inFallback of [false, true]) {
    const h = harness(), controller = new AbortController(); let finish, fallbackCalls = 0;
    const deferred = new Promise(resolve => { finish = resolve; });
    const pending = h.run(remote(async (_name, _payload, options) => {
      options.beforeRequest(); if (inFallback) throw new Error('provider-timeout'); return deferred;
    }), { id: 'deterministic', run: async () => { fallbackCalls++; return deferred; } }, 'breakdown', {},
    { signal: controller.signal, assertCurrent: owner });
    await flush(); controller.abort(); finish(proposal);
    const result = await pending;
    checkFailure(result, 'provider-request-aborted'); checkCleanup(result.cleanup);
    assert.equal(fallbackCalls, inFallback ? 1 : 0);
  }
});

test('NO_FALLBACK and arbitrary local failures expose only terminal bounded unions', async () => {
  for (const [message, reason] of [['no-local-fallback', 'no-local-fallback'], ['PRIVATE_LOCAL', 'local-fallback-failed']]) {
    const result = await harness().run(remote(async () => { throw new Error('PRIVATE_REMOTE'); }),
      { id: 'none', run: async () => { throw new Error(message); } }, 'capture-triage', {}, { assertCurrent: owner });
    checkFailure(result, reason); checkCleanup(result.cleanup);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('bounded error mapping never mutates or evaluates remote private diagnostics', async () => {
  const privateError = Object.freeze(Object.assign(new Error('PRIVATE_VALIDATOR'), { stage: 'validate', modelText: 'PRIVATE_MODEL' }));
  let getters = 0;
  const getterError = {};
  for (const key of ['stage', 'message', 'code', 'stack']) Object.defineProperty(getterError, key,
    { get() { getters++; throw new Error('PRIVATE_GETTER'); } });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE_PROXY'); } });
  for (const [error, reason] of [[privateError, 'proposal-rejected'], [getterError, 'provider-failed'],
    [proxy, 'provider-failed'], [new Error('provider-http-429|PRIVATE_HTTP'), 'provider-http-error'],
    [Object.assign(new Error('PRIVATE_NETWORK'), { code: 'ECONNRESET' }), 'provider-network-error']]) {
    const result = await harness().run(remote(async () => { throw error; }), local, 'breakdown', {}, { assertCurrent: owner });
    assert.equal(result.reason, reason); assert.equal(result.fallback, true);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  assert.equal(getters, 0); assert.equal(privateError.message, 'PRIVATE_VALIDATOR');
});

test('usage, trace and cleanup faults cannot turn accepted output into fallback', async () => {
  let fallbackCalls = 0;
  const h = harness({ cancelSchedule: () => { throw new Error('PRIVATE_CLEANUP'); } });
  const result = await h.run(remote(async (_name, _payload, options) => {
    options.beforeRequest(); options.onUsage({ tokens: 1 }); return proposal;
  }), { id: 'deterministic', run: async () => { fallbackCalls++; return proposal; } }, 'breakdown', {},
  { assertCurrent: owner, onUsage: () => { throw new Error('PRIVATE_USAGE'); } });
  assert.equal(result.ok, true); assert.equal(result.fallback, false); assert.equal(fallbackCalls, 0);
  checkCleanup(result.cleanup, 'unconfirmed', 'released');
  const fallback = await harness().run(remote(async () => { throw new Error('provider-timeout'); }), local,
    'breakdown', {}, { assertCurrent: owner, trace: { fallback() { throw new Error('PRIVATE_TRACE'); } } });
  assert.equal(fallback.ok, true); assert.equal(fallback.fallback, true);
});

test('usage observation may revoke owner but cannot authorize stale output', async () => {
  let current = true;
  const result = await harness().run(remote(async (_name, _payload, options) => {
    options.beforeRequest(); options.onUsage({}); return proposal;
  }), local, 'breakdown', {}, { assertCurrent: () => { if (!current) throw new Error('stale'); },
    onUsage: () => { current = false; } });
  checkFailure(result, 'provider-request-aborted');
});

test('known remote refusal codes stay bounded and preserved on local success', async () => {
  for (const reason of ['provider-timeout', 'provider-request-aborted', 'provider-credential-missing',
    'provider-model-missing', 'invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
    'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed',
    'provider-endpoint-resolves-private', 'provider-response-invalid-json',
    'provider-response-html', 'provider-response-event-stream', 'provider-response-empty',
    'provider-response-missing-output', 'provider-response-too-large', 'provider-http-error',
    'provider-network-error', 'proposal-rejected', 'provider-budget', 'provider-output-budget']) {
    const result = await harness().run(remote(async () => { throw Object.freeze(new Error(reason)); }),
      local, 'breakdown', {}, { assertCurrent: owner });
    assert.equal(result.ok, true); assert.equal(result.reason, reason); assert.equal(result.fallback, true);
  }
});

test('listener cleanup failure is separate from successful provider output', async () => {
  const signal = { aborted: false, addEventListener() {},
    removeEventListener() { throw new Error('PRIVATE_REMOVE'); } };
  const result = await harness().run(remote(), local, 'breakdown', {}, { signal, assertCurrent: owner });
  assert.equal(result.ok, true); assert.equal(result.fallback, false);
  checkCleanup(result.cleanup, 'released', 'unconfirmed');
});

test('listener setup failure attempts cleanup and exposes no port exception', async () => {
  let removes = 0;
  const signal = { aborted: false,
    addEventListener() { throw new Error('PRIVATE_ADD'); },
    removeEventListener() { removes++; throw new Error('PRIVATE_REMOVE'); } };
  const result = await harness().run(remote(), local, 'breakdown', {}, { signal, assertCurrent: owner });
  assert.deepEqual(result, { ok: false, reason: 'run-setup-failed', setupStage: 'listener',
    cleanup: { ok: false, timer: 'not-acquired', listener: 'unconfirmed' } });
  assert.equal(removes, 1); assert.equal(Object.isFrozen(result.cleanup), true);
});

test('trace cancellation immediately before fallback prevents its builder', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await harness().run(remote(async () => { throw new Error('provider-timeout'); }),
    { id: 'deterministic', run: async () => { calls++; return proposal; } }, 'breakdown', {},
    { signal: controller.signal, assertCurrent: owner, trace: { fallback: () => controller.abort() } });
  checkFailure(result, 'provider-request-aborted'); assert.equal(calls, 0);
});

test('late usage and attempt callbacks are closed after normal remote success', async () => {
  let options, usages = 0;
  const result = await harness().run(remote(async (_name, _payload, supplied) => {
    options = supplied; supplied.beforeRequest(); return proposal;
  }), local, 'breakdown', {}, { assertCurrent: owner, onUsage: () => usages++ });
  assert.equal(result.ok, true); assert.throws(() => options.beforeRequest());
  options.onUsage({ tokens: 3 }); assert.equal(usages, 0);
});

test('owner-only invalidation inside the charge clock blocks POST after accounting without fallback', async () => {
  let current = true, inAttempt = false, attemptClocks = 0, posts = 0, fallbacks = 0;
  const events = [];
  const h = harness({ now() {
    if (inAttempt) {
      attemptClocks++;
      events.push(attemptClocks === 1 ? 'execution-check-clock' : 'charge-clock');
      if (attemptClocks === 2) current = false;
    }
    return 0;
  } });
  const result = await h.run(remote(async (_name, _payload, options) => {
    inAttempt = true;
    try { options.beforeRequest(); posts++; }
    finally { inAttempt = false; }
    return proposal;
  }), { id: 'deterministic', run: async () => { fallbacks++; return proposal; } }, 'breakdown', {},
  { assertCurrent() { events.push(current ? 'owner-current' : 'owner-stale'); if (!current) throw new Error('stale'); } });
  checkFailure(result, 'provider-request-aborted');
  assert.deepEqual(events, ['owner-current', 'owner-current', 'execution-check-clock', 'charge-clock',
    'owner-stale', 'owner-stale']);
  assert.equal(attemptClocks, 2); assert.equal(posts, 0); assert.equal(fallbacks, 0);
  checkCleanup(result.cleanup);
});
