'use strict';

// Actual callers, execution adapter and request scope with synthetic ports only.
// The workflow sink below is a fake: this file does not prove canonical commits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');
const { createImpulseEnergyClassifier } = require('../src/capabilities/guidance/application/impulse-energy-classifier');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');

const RELEASED = { ok: true, timer: 'released', listener: 'released' };
const answers = {
  breakdown: { steps: [{ title: 'Open synthetic draft', done: false }], clarifyingQuestion: null },
  enrich: { steps: [], completionCriteria: 'Synthetic criterion', energy: 'medium', estimateMinutes: 10, tags: ['work'] },
  unstick: { nextAction: 'Open synthetic draft', why: 'Synthetic reason', fallbackAction: 'Read one line', splitSteps: [] },
  'impulse-energy': { direction: 'down', delta: -4, confidence: 90, reason: 'Synthetic state' },
  'capture-triage': { category: 'note', title: null, routineKind: null, level: null, confidence: 90, reason: 'Synthetic note' }
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const events = [], requests = [], localRequests = [], outcomes = [], slots = new Map(), timers = new Map();
  const activeLeases = new Set(), realScope = createProviderRequestScope(), started = deferred();
  const state = {
    settings: { aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true, aiCaptureTriageEnabled: true,
      aiModel: 'synthetic-model', aiBaseUrl: 'https://example.test/v1', ...options.settings },
    configured: options.configured !== false,
    tasks: options.tasks || []
  };
  let at = 100, leaseId = 0, timerId = 0, slotId = 0, statusCalls = 0;
  const scope = {
    begin({ checkCurrent } = {}) {
      const id = ++leaseId;
      events.push(`lease.begin:${id}`);
      const lease = realScope.begin({ checkCurrent });
      activeLeases.add(id);
      return {
        signal: lease.signal,
        assertCurrent() { events.push(`lease.assert:${id}`); lease.assertCurrent(); },
        release() { events.push(`lease.release:${id}`); activeLeases.delete(id); lease.release(); }
      };
    },
    invalidate() { events.push('scope.invalidate'); realScope.invalidate(); }
  };
  const run = createOneShotProviderRun({
    now: () => at,
    schedule(callback, delay) {
      events.push(`timer.schedule:${delay}`);
      if (options.scheduleError) throw options.scheduleError;
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    cancelSchedule(id) {
      events.push('timer.cancel');
      options.onDispose?.(h);
      if (options.cleanupError) throw options.cleanupError;
      timers.delete(id);
    }
  });
  const runWithFallback = async (...args) => {
    events.push(`runner:${args[2]}`);
    assert.equal(typeof args[4].assertCurrent, 'function');
    assert.equal(Object.hasOwn(args[4], 'beforeRequest'), false);
    const outcome = await run(...args);
    outcomes.push(outcome);
    return outcome;
  };
  const credentialStore = {
    status() {
      statusCalls += 1;
      if (statusCalls === options.statusErrorAt) {
        events.push(`credential.status-error:${statusCalls}`);
        throw options.statusError;
      }
      return { configured: state.configured };
    },
    get: () => 'synthetic-credential'
  };
  const createApiClient = () => {
    events.push('client.remote');
    if (options.clientError) throw options.clientError;
    return {
      id: 'api', timeoutMs: 50,
      run(name, payload, nativeOptions) {
        events.push(`provider.remote:${name}`);
        assert.equal(activeLeases.size > 0, true);
        assert.equal(nativeOptions.maxRepairAttempts, 1);
        assert.equal(Object.hasOwn(nativeOptions, 'maxOutputChars'), false);
        const request = { name, payload, options: nativeOptions };
        requests.push(request);
        nativeOptions.beforeRequest();
        events.push(`post:${name}`);
        started.resolve(request);
        return options.remote ? options.remote(request, h) : answers[name];
      }
    };
  };
  const providers = {
    createApiClient, runWithFallback,
    createDeterministicClient() {
      events.push('client.local');
      return { id: 'deterministic', async run(name, payload, nativeOptions) {
        events.push(`provider.local:${name}`);
        localRequests.push({ name, payload, options: nativeOptions });
        return options.local ? options.local({ name, payload, options: nativeOptions }, h) : answers[name];
      } };
    },
    DEFAULT_AI_BASE_URL: 'https://example.test/v1',
    chatCompletionsEndpoint: () => 'https://example.test/v1/chat/completions',
    describeFields: () => [], CLARIFY_MEMORY_FIELDS: []
  };
  const trace = {
    enabled: options.traceEnabled === true,
    selection() { if (options.traceError) throw options.traceError; },
    skipped() { if (options.traceError) throw options.traceError; },
    fallback() { events.push('trace.fallback'); },
    result(value) {
      events.push(`trace.result:${value.kind}`);
      options.onResult?.(h);
      if (options.traceError) throw options.traceError;
    }
  };
  const preview = createProposalPreview({
    getSettings: () => state.settings, readTasks: () => state.tasks,
    credentialStore, requestScope: scope, providers, trace, now: () => at,
    timeoutMs: 50, requestTtlMs: 1000,
    proposalStore: {
      put(proposal, context) {
        events.push(`slot.put:${context.kind}`);
        if (state.settings.aiBreakdownEnabled && state.configured) assert.equal(activeLeases.size > 0, true);
        if (options.storeError) throw options.storeError;
        const stored = { id: `p${++slotId}`, expiresAt: at + 1000, proposal };
        slots.set(stored.id, stored);
        return stored;
      },
      get(id) { events.push(`slot.get:${id}`); return slots.get(id); }
    },
    presentExpression(name) { events.push(`present:${name}`); return 'request-expression'; },
    cancelExpression(_id, reason) { events.push(`cancel:${reason}`); options.onCancelExpression?.(h); },
    scheduleWaiting(id, callback, delay) {
      events.push(`waiting.schedule:${id}:${delay}`);
      h.waiting.push(callback);
      return { unref() { events.push('waiting.unref'); } };
    }
  });
  const classifierOptions = {
    getSettings: () => state.settings, requestScope: scope, credentialStore, createApiClient,
    defaultBaseUrl: 'https://example.test/v1', runWithFallback, trace, timeoutMs: 50
  };
  const classifier = createImpulseEnergyClassifier(classifierOptions);
  const h = {
    events, requests, localRequests, outcomes, slots, timers, activeLeases, scope, state, preview,
    classifier, classifierOptions, started: started.promise, waiting: [],
    deadline() {
      at += 50;
      for (const callback of [...timers.values()]) callback();
    }
  };
  return h;
}

function lifecycle(h) { return h.events.filter(event => !event.startsWith('lease.assert:')); }
function checkReleased(h, result) {
  assert.deepEqual(result.cleanup, RELEASED);
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(h.activeLeases.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.events.filter(event => event === 'timer.cancel').length, 1);
}

test('breakdown keeps payload identity, slot order, cleanup and the full caller lease', async () => {
  const h = harness(), payload = { title: 'Synthetic title', description: 'Synthetic detail' };
  const result = await h.preview.previewBreakdownProposal(payload);
  assert.equal(h.requests[0].payload, payload);
  assert.equal(result.steps, answers.breakdown.steps);
  assert.deepEqual(result, { ok: true, proposalId: 'p1', provider: 'api', fallback: false, reason: null,
    steps: answers.breakdown.steps, clarifyingQuestion: null, expiresAt: 1100, cleanup: RELEASED });
  assert.deepEqual(lifecycle(h), [
    'lease.begin:1', 'client.local', 'client.remote', 'present:system.processing', 'runner:breakdown',
    'timer.schedule:50', 'provider.remote:breakdown', 'post:breakdown', 'timer.cancel', 'cancel:request-ended',
    'slot.put:breakdown', 'trace.result:breakdown', 'slot.get:p1', 'present:work.waiting', 'lease.release:1'
  ]);
  // Admission, pre/post-charge native attempt and post-wait are explicit samples.
  assert.equal(h.events.filter(event => event === 'lease.assert:1').length, 8);
  checkReleased(h, result);
});

test('enrich sends only canonical tag choices and preserves the provider success shape', async () => {
  const h = harness({ tasks: [{ id: 'a', tags: ['work', 'home'] }, { id: 'b', tags: ['work'] }] });
  const result = await h.preview.previewEnrichProposal({ title: 'Synthetic', description: 'Detail', existingTags: ['untrusted'] });
  assert.deepEqual(h.requests[0].payload, { title: 'Synthetic', description: 'Detail', existingTags: ['work', 'home'] });
  assert.deepEqual(result, { ok: true, proposalId: 'p1', provider: 'api', fallback: false, reason: null,
    ...answers.enrich, expiresAt: 1100, cleanup: RELEASED });
  assert.equal(h.events.some(event => event.startsWith('waiting.')), false);
  checkReleased(h, result);
});

test('unstick preserves canonical step completion and never occupies a proposal slot', async () => {
  const task = { id: 'task', title: 'Canonical title', energy: 'low', done: false,
    steps: [{ id: 's1', title: 'Finished', done: true }, { id: 's2', title: 'Next', done: false }] };
  const before = structuredClone(task), h = harness({ tasks: [task] });
  const result = await h.preview.suggestUnstick({ taskId: 'task', note: 'Synthetic stuck note', title: 'Untrusted', steps: [] });
  assert.deepEqual(h.requests[0].payload, {
    title: task.title, steps: task.steps, note: 'Synthetic stuck note', taskEnergyDemand: 'low'
  });
  assert.equal(h.requests[0].payload.steps, task.steps);
  assert.deepEqual(task, before);
  assert.deepEqual(result, { ok: true, provider: 'api', fallback: false, reason: null, ...answers.unstick, cleanup: RELEASED });
  assert.equal(h.slots.size, 0);
  assert.equal(h.events.some(event => event.startsWith('slot.')), false);
  checkReleased(h, result);
});

for (const [label, options, fallback, reason] of [
  ['disabled', { settings: { aiBreakdownEnabled: false } }, false, null],
  ['missing credential', { configured: false }, true, 'provider-credential-missing'],
  ['missing model', { clientError: new Error('provider-model-missing') }, true, 'provider-model-missing']
]) {
  test(`preview ${label} retains deterministic metadata without execution cleanup`, async () => {
    const h = harness(options), result = await h.preview.previewEnrichProposal({ title: 'Synthetic' });
    assert.deepEqual(result, { ok: true, proposalId: 'p1', provider: 'deterministic', fallback, reason,
      ...answers.enrich, expiresAt: 1100 });
    assert.equal(h.requests.length, 0);
    assert.equal(h.localRequests.length, 1);
    assert.equal(h.events.some(event => event.startsWith('runner:') || event.startsWith('timer.')), false);
    assert.equal(h.activeLeases.size, 0);
  });
}

test('ordinary failure preserves enrich fallback flags, payload identity and cleanup', async () => {
  const h = harness({ remote() { throw new Error('private synthetic provider detail'); } });
  const result = await h.preview.previewEnrichProposal({ title: 'Synthetic' });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'deterministic');
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'provider-failed');
  assert.equal(h.localRequests[0].payload, h.requests[0].payload);
  assert.equal(h.localRequests[0].options.signal.aborted, false);
  assert.deepEqual(lifecycle(h), [
    'lease.begin:1', 'client.local', 'client.remote', 'present:system.processing', 'runner:enrich',
    'timer.schedule:50', 'provider.remote:enrich', 'post:enrich', 'trace.fallback', 'provider.local:enrich',
    'timer.cancel', 'cancel:request-ended', 'slot.put:enrich', 'trace.result:enrich', 'lease.release:1'
  ]);
  checkReleased(h, result);
});

test('breakdown fallback keeps unavailable-before-waiting presentation order', async () => {
  const h = harness({ remote() { throw new Error('provider-timeout'); } });
  const result = await h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  assert.equal(result.reason, 'provider-timeout');
  assert.equal(result.fallback, true);
  assert.deepEqual(lifecycle(h).slice(-6), [
    'slot.put:breakdown', 'trace.result:breakdown', 'present:system.unavailable',
    'waiting.schedule:p1:2200', 'waiting.unref', 'lease.release:1'
  ]);
  h.waiting[0]();
  assert.deepEqual(h.events.slice(-2), ['slot.get:p1', 'present:work.waiting']);
  h.slots.clear();
  h.waiting[0]();
  assert.equal(h.events.at(-1), 'slot.get:p1');
  checkReleased(h, result);
});

for (const [reason, tasks] of [
  ['task-not-found', []], ['task-completed', [{ id: 'task', done: true }]],
  ['occurrence-skipped', [{ id: 'task', skippedAt: 1 }]]
]) {
  test(`initial ${reason} refusal acquires no provider execution`, async () => {
    const h = harness({ tasks }), result = await h.preview.previewBreakdownProposal({ taskId: 'task', title: 'Synthetic' });
    assert.deepEqual(result, { ok: false, reason });
    assert.deepEqual(lifecycle(h), ['lease.begin:1', 'lease.release:1']);
    assert.equal(h.slots.size, 0);
  });
}

for (const [reason, change] of [
  ['task-not-found', h => { h.state.tasks = []; }],
  ['task-completed', h => { h.state.tasks[0].done = true; }],
  ['occurrence-skipped', h => { h.state.tasks[0].skippedAt = 1; }],
  ['proposal-target-changed', h => { h.state.tasks[0].title = 'Changed'; }]
]) {
  test(`post-provider ${reason} refusal preserves cleanup and creates no slot`, async () => {
    const h = harness({ tasks: [{ id: 'task', title: 'Original', done: false }],
      remote(request, current) { change(current); return answers[request.name]; } });
    const result = await h.preview.previewBreakdownProposal({ taskId: 'task', title: 'Original' });
    assert.deepEqual(result, { ok: false, reason, cleanup: RELEASED });
    assert.equal(h.slots.size, 0);
    assert.deepEqual(lifecycle(h).slice(-3), ['timer.cancel', 'cancel:request-ended', 'lease.release:1']);
    checkReleased(h, result);
  });
}

for (const [label, option] of [
  ['provider return to generation', 'onDispose'],
  ['generation return to proposal slot', 'onCancelExpression']
]) {
  test(`revocation in the ${label} gap keeps cleanup and blocks the slot`, async () => {
    const h = harness({ [option](current) { current.scope.invalidate(); } });
    const result = await h.preview.previewBreakdownProposal({ title: 'Synthetic' });
    assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
    assert.equal(h.slots.size, 0);
    assert.equal(h.localRequests.length, 0);
    checkReleased(h, result);
  });
}

test('final preview freshness refusal preserves cleanup without claiming an earlier slot write never happened', async () => {
  const h = harness({ onResult(current) { queueMicrotask(() => current.scope.invalidate()); } });
  const result = await h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
  assert.equal(h.slots.size, 1);
  assert.equal(h.events.filter(event => event === 'slot.put:breakdown').length, 1);
  checkReleased(h, result);
});

test('proposal-store failure rejects unchanged instead of becoming a bounded zero-write refusal', async () => {
  const failure = new Error('synthetic store failure'), h = harness({ storeError: failure });
  await assert.rejects(h.preview.previewBreakdownProposal({ title: 'Synthetic' }), error => error === failure);
  assert.equal(h.events.filter(event => event === 'slot.put:breakdown').length, 1);
  assert.equal(h.outcomes[0].ok, true);
  assert.equal(h.localRequests.length, 0);
  assert.equal(h.activeLeases.size, 0);
  assert.equal(h.timers.size, 0);
});

test('bounded cancellation survives final preview checks and late provider settlement', async () => {
  const remote = deferred(), h = harness({ remote: () => remote.promise });
  const pending = h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  const request = await h.started;
  assert.deepEqual(h.preview.cancelPending(), { ok: true, cancelled: 1 });
  const result = await pending;
  assert.equal(result, h.outcomes[0]);
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
  remote.resolve(answers.breakdown);
  await Promise.resolve();
  assert.throws(() => request.options.beforeRequest());
  assert.equal(h.slots.size, 0);
  assert.equal(h.localRequests.length, 0);
  assert.deepEqual(h.preview.cancelPending(), { ok: true, cancelled: 0 });
  checkReleased(h, result);
});

test('cancellation before the guarded provider microtask starts prevents its invocation', async () => {
  const h = harness();
  const pending = h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  assert.deepEqual(h.preview.cancelPending(), { ok: true, cancelled: 1 });
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
  assert.equal(h.requests.length, 0);
  assert.equal(h.localRequests.length, 0);
  assert.equal(h.slots.size, 0);
  checkReleased(h, result);
});

test('cancellation while local fallback is pending cannot become a proposal slot', async () => {
  const local = deferred(), fallbackStarted = deferred();
  const h = harness({ remote() { throw new Error('provider-timeout'); },
    local() { fallbackStarted.resolve(); return local.promise; } });
  const pending = h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  await fallbackStarted.promise;
  assert.equal(h.activeLeases.size, 1);
  h.scope.invalidate();
  local.resolve(answers.breakdown);
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
  assert.equal(h.localRequests.length, 1);
  assert.equal(h.slots.size, 0);
  checkReleased(h, result);
});

test('a shared deadline permits local fallback while keeping the original lease until the preview ends', async () => {
  const remote = deferred(), h = harness({ remote: () => remote.promise });
  const pending = h.preview.previewEnrichProposal({ title: 'Synthetic' });
  const request = await h.started;
  h.deadline();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'provider-request-aborted');
  assert.equal(result.fallback, true);
  assert.equal(request.options.signal.aborted, true);
  assert.equal(h.localRequests[0].options.signal.aborted, false);
  remote.resolve(answers.enrich);
  await Promise.resolve();
  assert.equal(h.slots.size, 1);
  checkReleased(h, result);
});

test('uncertain cleanup remains a successful proposal and never triggers another provider or fallback', async () => {
  const h = harness({ cleanupError: new Error('private cleanup detail') });
  const result = await h.preview.previewEnrichProposal({ title: 'Synthetic' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleanup, { ok: false, timer: 'unconfirmed', listener: 'released' });
  assert.equal(h.slots.size, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.localRequests.length, 0);
  assert.equal(h.activeLeases.size, 0);
  assert.equal(h.events.filter(event => event === 'timer.cancel').length, 1);
});

test('throwing selection and result observers do not discard a valid proposal or retry its provider', async () => {
  const h = harness({ traceEnabled: true, traceError: new Error('private observation detail') });
  const result = await h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  assert.equal(result.ok, true);
  assert.equal(result.fallback, false);
  assert.equal(h.slots.size, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.localRequests.length, 0);
  checkReleased(h, result);
});

test('observer-only credential metadata failure does not discard the authoritative provider selection', async () => {
  // Calls 1–4 are request admission/current checks; 5 selects the provider.
  // The second status read inside generation is call 6, for trace metadata.
  const h = harness({ traceEnabled: true, statusErrorAt: 6, statusError: new Error('private observer status detail') });
  const result = await h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  assert.deepEqual(lifecycle(h).slice(0, 5), [
    'lease.begin:1', 'client.local', 'client.remote', 'client.remote', 'credential.status-error:6'
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'api');
  assert.equal(result.fallback, false);
  assert.equal(h.slots.size, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.localRequests.length, 0);
  checkReleased(h, result);
});

test('authoritative credential selection failure still rejects outside the observation guard', async () => {
  const failure = new Error('synthetic authoritative status failure');
  const h = harness({ traceEnabled: true, statusErrorAt: 5, statusError: failure });
  await assert.rejects(h.preview.previewBreakdownProposal({ title: 'Synthetic' }), error => error === failure);
  assert.deepEqual(lifecycle(h), [
    'lease.begin:1', 'client.local', 'credential.status-error:5', 'lease.release:1'
  ]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.localRequests.length, 0);
  assert.equal(h.slots.size, 0);
  assert.equal(h.activeLeases.size, 0);
});

for (const method of ['analyze', 'triage']) {
  const name = method === 'analyze' ? 'impulse-energy' : 'capture-triage';
  const resultKey = method === 'analyze' ? 'classification' : 'triage';
  test(`${name} requires bounded injection and sends only impulseText`, async () => {
    const h = harness();
    assert.throws(() => createImpulseEnergyClassifier({ ...h.classifierOptions, runWithFallback: undefined }), /bounded provider runner/);
    const result = await h.classifier[method]({ impulseText: 'Synthetic capture', taskTitle: 'Not sent', privateDetail: 'Not sent' });
    assert.deepEqual(h.requests[0].payload, { impulseText: 'Synthetic capture' });
    assert.deepEqual(result, { ok: true, [resultKey]: answers[name], provider: 'api', cleanup: RELEASED });
    assert.equal(result[resultKey], answers[name]);
    assert.deepEqual(lifecycle(h), ['lease.begin:1', 'client.remote', `runner:${name}`, 'timer.schedule:50',
      `provider.remote:${name}`, `post:${name}`, 'timer.cancel', 'lease.release:1']);
    assert.equal(h.events.filter(event => event === 'lease.assert:1').length, 6);
    checkReleased(h, result);
  });

  test(`${name} retains NO_FALLBACK and returns the bounded failure unchanged`, async () => {
    const h = harness({ remote() { throw new Error('private provider text'); } });
    const result = await h.classifier[method]({ impulseText: 'Synthetic' });
    assert.equal(result, h.outcomes[0]);
    assert.deepEqual(result, { ok: false, reason: 'no-local-fallback', cleanup: RELEASED });
    assert.equal(Object.hasOwn(result, resultKey), false);
    assert.equal(h.localRequests.length, 0);
    checkReleased(h, result);
  });

  test(`${name} post-adapter freshness refusal preserves cleanup`, async () => {
    const h = harness({ onDispose(current) { current.scope.invalidate(); } });
    const result = await h.classifier[method]({ impulseText: 'Synthetic' });
    assert.equal(h.outcomes[0].ok, true);
    assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
    checkReleased(h, result);
  });
}

test('classifier purpose switches stay independent and missing credentials acquire no execution', async () => {
  const allOff = harness({ settings: { aiBreakdownEnabled: false } });
  assert.deepEqual(await allOff.classifier.analyze({ impulseText: 'Synthetic' }), { ok: false, reason: 'impulse-energy-disabled' });
  assert.deepEqual(await allOff.classifier.triage({ impulseText: 'Synthetic' }), { ok: false, reason: 'capture-triage-disabled' });
  assert.deepEqual(allOff.events, []);
  const energyOff = harness({ settings: { aiImpulseEnergyEnabled: false } });
  assert.deepEqual(await energyOff.classifier.analyze({ impulseText: 'Synthetic' }), { ok: false, reason: 'impulse-energy-disabled' });
  assert.deepEqual(energyOff.events, []);
  assert.equal((await energyOff.classifier.triage({ impulseText: 'Synthetic' })).ok, true);
  const triageOff = harness({ settings: { aiCaptureTriageEnabled: false } });
  assert.deepEqual(await triageOff.classifier.triage({ impulseText: 'Synthetic' }), { ok: false, reason: 'capture-triage-disabled' });
  assert.deepEqual(triageOff.events, []);
  assert.equal((await triageOff.classifier.analyze({ impulseText: 'Synthetic' })).ok, true);
  const missing = harness({ configured: false });
  assert.deepEqual(await missing.classifier.analyze({ impulseText: 'Synthetic' }), { ok: false, reason: 'provider-credential-missing' });
  assert.deepEqual(missing.events, []);
});

for (const [name, invoke] of [
  ['breakdown', h => h.preview.previewBreakdownProposal({ title: 'Synthetic' })],
  ['energy', h => h.classifier.analyze({ impulseText: 'Synthetic' })],
  ['triage', h => h.classifier.triage({ impulseText: 'Synthetic' })]
]) {
  test(`${name} setup failure retains its exact union and releases the caller lease`, async () => {
    const h = harness({ scheduleError: new Error('private scheduler detail') });
    const result = await invoke(h);
    assert.equal(result, h.outcomes[0]);
    assert.deepEqual(result, { ok: false, reason: 'run-setup-failed', setupStage: 'schedule',
      cleanup: { ok: true, timer: 'not-acquired', listener: 'released' } });
    assert.equal(h.requests.length, 0);
    assert.equal(h.localRequests.length, 0);
    assert.equal(h.slots.size, 0);
    assert.equal(h.activeLeases.size, 0);
    assert.equal(h.timers.size, 0);
  });
}

for (const [label, change] of [
  ['off/on', h => { h.state.settings = { ...h.state.settings, aiBreakdownEnabled: false }; }],
  ['model changed back', h => { h.state.settings = { ...h.state.settings, aiModel: 'other' }; }],
  ['credential success invalidation', () => {}]
]) {
  test(`${label} cannot revive a request after request-scope invalidation`, async () => {
    const remote = deferred(), h = harness({ remote: () => remote.promise });
    const before = h.state.settings;
    const pending = h.classifier.analyze({ impulseText: 'Synthetic' });
    await h.started;
    change(h);
    h.scope.invalidate();
    h.state.settings = before;
    const result = await pending;
    remote.resolve(answers['impulse-energy']);
    assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
    checkReleased(h, result);
  });
}

test('the fake owner sink keeps an outer lease through classification and refuses a revoked apply gap', async () => {
  const h = harness(), outer = h.scope.begin({ checkCurrent: () => true }), writes = [];
  async function fakeWorkflowSink() {
    try {
      const result = await h.classifier.triage({ impulseText: 'Synthetic' });
      assert.equal(h.activeLeases.size, 1);
      assert.equal(result.ok, true);
      h.scope.invalidate();
      try { outer.assertCurrent(); }
      catch (_) { return { ok: false, reason: 'provider-request-aborted', cleanup: result.cleanup }; }
      writes.push(result.triage);
      return result;
    } finally { outer.release(); }
  }
  const result = await fakeWorkflowSink();
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted', cleanup: RELEASED });
  assert.deepEqual(writes, []);
  assert.deepEqual(lifecycle(h).slice(-4), ['timer.cancel', 'lease.release:2', 'scope.invalidate', 'lease.release:1']);
  assert.equal(h.activeLeases.size, 0);
});
