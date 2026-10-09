'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');
const { createImpulseEnergyClassifier } = require('../src/capabilities/guidance/application/impulse-energy-classifier');
const { createUnitOfWork, createAnalyzeImpulseEnergyWorkflow, createTriageCaptureWorkflow } = require('../src/application');
const preferences = require('../src/capabilities/preferences');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const tick = () => new Promise(resolve => setImmediate(resolve));
const clock = { now: () => Date.UTC(2026, 9, 7, 12) };
const answers = {
  breakdown: { steps: [], clarifyingQuestion: null },
  enrich: { steps: [], completionCriteria: 'Synthetic', energy: 'medium', estimateMinutes: 10, tags: [] },
  unstick: { nextAction: 'Synthetic action', why: 'Synthetic', fallbackAction: 'Synthetic local', splitSteps: [] },
  'impulse-energy': { direction: 'up', delta: 4, confidence: 90, reason: 'Synthetic' },
  'capture-triage': { category: 'note', title: null, routineKind: null, level: null, confidence: 90, reason: 'Synthetic' }
};
function harness({ cancelExpression = () => {} } = {}) {
  let state = { settings: preferences.normalizeSettings({ aiBreakdownEnabled: true, aiClarifyEnabled: true,
    aiMemoryEnabled: true, aiImpulseEnergyEnabled: true, aiCaptureTriageEnabled: true,
    aiModel: 'test-model', aiBaseUrl: 'https://example.test/v1' }), tasks: [],
    impulses: [{ id: 'i', text: 'Synthetic capture', createdAt: clock.now() }], energySignals: [] };
  let revision = 0, failCommit = false, credentialFailure = false, configured = true, stored = 0, ids = 0;
  const requestScope = createProviderRequestScope(), pending = [], handlers = new Map(), timers = new Set();
  const runWithFallback = createOneShotProviderRun({ now: clock.now,
    schedule(callback) { const timer = { callback }; timers.add(timer); return timer; },
    cancelSchedule(timer) { timers.delete(timer); }
  });
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: value => { if (failCommit) throw new Error('synthetic-commit-failure'); state = structuredClone(value); revision++; return repository.snapshot(); } };
  const unitOfWork = createUnitOfWork({ repository });
  const getSettings = () => repository.snapshot().settings;
  const credentialStore = { status: () => ({ configured, available: true }), get: () => configured ? 'synthetic-key' : null,
    set: () => { if (credentialFailure) throw new Error('synthetic-credential-failure'); configured = true; return true; },
    clear: () => { if (credentialFailure) throw new Error('synthetic-credential-failure'); const removed = configured; configured = false; return removed; } };
  const createApiClient = () => ({ id: 'api', endpoint: 'https://example.test/v1/chat/completions',
    run: (name, _payload, options = {}) => {
      options.beforeRequest();
      return new Promise(resolve => pending.push({ name, options, resolve: () => resolve(answers[name]) }));
    } });
  const collaboration = createAiCollaboration({ requestScope, readSnapshot: repository.snapshot,
    storage: { ownerId: 'test-owner', close() {} }, factStore: null, credentialStore, getSettings,
    now: clock.now, idFactory: kind => `${kind}-${++ids}`, clientFactory: createApiClient });
  collaboration.register((name, handler) => handlers.set(name, handler), {
    updatePreferencesCommand: require('../src/application').createUpdatePreferencesWorkflow({ unitOfWork, clock }),
    readEnvironmentCredential: () => 'synthetic-environment-key'
  });
  const preview = createProposalPreview({ requestScope, getSettings, readTasks: () => [], credentialStore,
    proposalStore: { put(proposal) { stored++; return { id: `p-${stored}`, expiresAt: clock.now() + 1000, proposal }; }, get: () => null },
    providers: { createApiClient, runWithFallback, DEFAULT_AI_BASE_URL: 'https://example.test/v1',
      createDeterministicClient: () => ({ id: 'deterministic', run: async name => answers[name] }) },
    trace: { enabled: false, result() {}, fallback() {} }, now: clock.now,
    presentExpression() {}, cancelExpression, scheduleWaiting() {}, requestTtlMs: 1000 });
  const classifier = createImpulseEnergyClassifier({ requestScope, getSettings, credentialStore, createApiClient,
    defaultBaseUrl: 'https://example.test/v1', runWithFallback });
  const workflowOptions = { requestScope, unitOfWork, readSnapshot: repository.snapshot, clock };
  const energy = createAnalyzeImpulseEnergyWorkflow({ ...workflowOptions, classify: classifier.analyze });
  const triage = createTriageCaptureWorkflow({ ...workflowOptions, triage: classifier.triage });
  const fact = { type: 'impulse-captured', impulseId: 'i', capturedAt: clock.now() };
  const start = () => [preview.previewBreakdownProposal({ title: 'Synthetic' }),
    preview.previewEnrichProposal({ title: 'Synthetic' }), preview.suggestUnstick(),
    energy.handleCaptured(fact), triage.handleCaptured(fact)].map(p => p.catch(error => ({ ok: false, reason: error.message })));
  return { requestScope, handlers, preview, classifier, collaboration, pending, timers, start, getSettings,
    update: patch => handlers.get('settings:update')({}, patch), stored: () => stored, snapshot: repository.snapshot,
    failCommit: value => { failCommit = value; }, failCredential: value => { credentialFailure = value; } };
}
const changes = [
  ['AI off', { aiBreakdownEnabled: false }], ['AI off-on', { aiBreakdownEnabled: false }, true],
  ['clarify off', { aiClarifyEnabled: false }], ['memory off', { aiMemoryEnabled: false }],
  ['energy off', { aiImpulseEnergyEnabled: false }], ['triage off', { aiCaptureTriageEnabled: false }],
  ['model changed back', { aiModel: 'other-model' }, true], ['endpoint changed back', { aiBaseUrl: 'https://other.test/v1' }, true]
];
for (const [name, patch, restore] of changes) {
  test(`${name} via real settings handler cancels all five requests and rejects late writes`, async t => {
    const h = harness(); t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
    const before = h.getSettings(), pending = h.start(); await tick(); assert.equal(h.pending.length, 5);
    assert.equal(h.update(patch).ok, true);
    if (restore) assert.equal(h.update(Object.fromEntries(Object.keys(patch).map(key => [key, before[key]]))).ok, true);
    assert.ok(h.pending.every(request => request.options.signal?.aborted));
    h.pending.forEach(request => request.resolve()); const results = await Promise.all(pending);
    assert.ok(results.every(result => !result.ok || result.changed === false)); assert.equal(h.stored(), 0);
    for (const result of results.slice(0, 3)) {
      assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted',
        cleanup: { ok: true, timer: 'released', listener: 'released' } });
      assert.equal(Object.isFrozen(result.cleanup), true);
    }
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.snapshot().energySignals, []); assert.equal(h.snapshot().impulses[0].triage, undefined);
    assert.ok(h.pending.every(request => getEventListeners(request.options.signal, 'abort').length === 0));
  });
}
for (const name of ['ai:credential-import', 'ai:clear-credential']) {
  test(`successful ${name} invalidates provider leases and existing collaboration grants`, async t => {
    const h = harness(); t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
    const opened = h.collaboration.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
    const fingerprint = h.collaboration.getProvider().fingerprint;
    const pending = h.start(); await tick();
    assert.equal(h.handlers.get(name)({}, {}).ok, true);
    assert.ok(h.pending.every(request => request.options.signal?.aborted));
    assert.equal(h.collaboration.grants.resolve({ conversationId: opened.conversation.id, scopeGrantId: opened.scopeGrantId,
      providerId: fingerprint, authorizationGeneration: 0 }).ok, false);
    h.pending.forEach(request => request.resolve()); await Promise.all(pending); assert.equal(h.stored(), 0);
  });
}
test('failed commit, invalid/unrelated/no-op settings, and failed credentials preserve legitimate requests', async t => {
  const h = harness(); t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
  const pending = h.start(); await tick();
  h.failCommit(true); assert.throws(() => h.update({ aiBreakdownEnabled: false }), /synthetic-commit-failure/); h.failCommit(false);
  assert.equal(h.update({ aiBreakdownEnabled: 'invalid' }).ok, false);
  assert.equal(h.update({ dnd: true }).ok, true); assert.equal(h.update({ aiBreakdownEnabled: true }).ok, true);
  h.failCredential(true);
  assert.equal(h.handlers.get('ai:credential-import')({}, { secret: 'synthetic-new' }).ok, false);
  try { assert.equal(h.handlers.get('ai:clear-credential')().ok, false); } catch (error) { assert.match(error.message, /synthetic-credential-failure/); }
  assert.ok(h.pending.every(request => !request.options.signal?.aborted));
  h.pending.forEach(request => request.resolve()); const results = await Promise.all(pending);
  assert.ok(results.every(result => result.ok)); assert.equal(h.stored(), 2);
});
test('feature-only changes preserve conversation grants; a fresh request after re-enable succeeds', async t => {
  const h = harness(); t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
  const opened = h.collaboration.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  const fingerprint = h.collaboration.getProvider().fingerprint;
  h.update({ aiImpulseEnergyEnabled: false, aiCaptureTriageEnabled: false });
  assert.equal(h.collaboration.getProvider().fingerprint, fingerprint);
  assert.equal(h.collaboration.grants.resolve({ conversationId: opened.conversation.id, scopeGrantId: opened.scopeGrantId,
    providerId: fingerprint, authorizationGeneration: 0 }).ok, true);
  h.update({ aiBreakdownEnabled: false }); h.update({ aiBreakdownEnabled: true });
  const pending = h.preview.previewBreakdownProposal({ title: 'New generation' });
  await tick(); h.pending.at(-1).resolve(); assert.equal((await pending).ok, true); assert.equal(h.stored(), 1);
});
test('modal cancellation and collaboration dispose discard late proposals including unstick', async t => {
  for (const dispose of [false, true]) {
    const h = harness(), pending = h.start();
    t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); }); await tick();
    if (dispose) h.collaboration.dispose(); else assert.equal(h.preview.cancelPending().cancelled, 3);
    assert.ok(h.pending.slice(0, 3).every(request => request.options.signal?.aborted));
    h.pending.forEach(request => request.resolve()); const results = await Promise.all(pending);
    assert.ok(results.slice(0, 3).every(result => !result.ok)); assert.equal(h.stored(), 0);
    h.collaboration.dispose();
  }
});
test('classifier requires a bounded runner and refuses late results through that runner', async t => {
  assert.throws(() => createImpulseEnergyClassifier({
    getSettings: () => ({}), credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic-key' },
    createApiClient: () => assert.fail('missing runner must be rejected before client creation'),
    defaultBaseUrl: 'https://example.test/v1'
  }), /requires a bounded provider runner/);
  const h = harness(); t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
  const results = [h.classifier.analyze({ impulseText: 'Synthetic' }), h.classifier.triage({ impulseText: 'Synthetic' })];
  await tick(); assert.ok(h.pending.every(r => r.options.signal && typeof r.options.beforeRequest === 'function'));
  h.requestScope.invalidate(); h.pending.forEach(request => request.resolve());
  for (const result of await Promise.all(results)) {
    assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted',
      cleanup: { ok: true, timer: 'released', listener: 'released' } });
    assert.equal(Object.isFrozen(result.cleanup), true);
  }
  assert.equal(h.timers.size, 0);
});
for (const kind of ['energy', 'triage']) {
  test(`${kind} rechecks the lease between resolved classifier and canonical commit`, async () => {
    const requestScope = createProviderRequestScope(); let commits = 0;
    const state = { settings: { aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true, aiCaptureTriageEnabled: true },
      impulses: [{ id: 'i', text: 'Synthetic', createdAt: clock.now() }], energySignals: [] };
    const answer = kind === 'energy' ? { ok: true, classification: answers['impulse-energy'] } : { ok: true, triage: answers['capture-triage'] };
    const classify = () => Promise.resolve(answer).then(value => { queueMicrotask(() => requestScope.invalidate()); return value; });
    const options = { requestScope, clock, readSnapshot: () => state,
      unitOfWork: { run({ transition }) { commits++; return { ...transition(state), committed: true }; } } };
    const workflow = kind === 'energy' ? createAnalyzeImpulseEnergyWorkflow({ ...options, classify })
      : createTriageCaptureWorkflow({ ...options, triage: classify });
    const result = await workflow.handleCaptured({ type: 'impulse-captured', impulseId: 'i', capturedAt: clock.now() });
    assert.equal(result.changed, false); assert.equal(commits, 0);
  });
}

test('revocation between generated proposal and store.put cannot create a stale confirmation slot', async t => {
  const h = harness({ cancelExpression: () => queueMicrotask(() => h.requestScope.invalidate()) });
  t.after(() => { h.pending.forEach(request => request.resolve()); h.collaboration.dispose(); });
  const pending = h.preview.previewBreakdownProposal({ title: 'Synthetic' });
  await tick(); h.pending.at(-1).resolve();
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: 'provider-request-aborted',
    cleanup: { ok: true, timer: 'released', listener: 'released' } });
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(h.stored(), 0); assert.equal(h.timers.size, 0);
});

test('same-value safety settings keep provider work but retain the existing collaboration grant invalidation', () => {
  const h = harness(), lease = h.requestScope.begin();
  const opened = h.collaboration.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  const fingerprint = h.collaboration.getProvider().fingerprint;
  assert.equal(h.update({ aiBreakdownEnabled: true }).ok, true);
  lease.assertCurrent(); assert.equal(lease.signal.aborted, false);
  assert.equal(h.collaboration.grants.resolve({ conversationId: opened.conversation.id, scopeGrantId: opened.scopeGrantId,
    providerId: fingerprint, authorizationGeneration: 0 }).ok, false);
  lease.release(); h.collaboration.dispose();
});
