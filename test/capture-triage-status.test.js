'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureTriageStatus, MAX_CAPTURE_TRIAGE_STATUSES } = require('../src/application/ai/capture-triage-status');
const { createTriageCaptureWorkflow } = require('../src/application/workflows/triage-capture');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const note = (id = 'synthetic') => ({ id, createdAt: 1000, text: 'Synthetic private capture', classification: null, resolution: null });
const fact = id => ({ type: 'impulse-captured', impulseId: id, capturedAt: 1000 });
const unknown = { state: 'unknown', reason: 'unavailable' };

function registry() {
  const state = { impulses: [note()] }, events = [];
  const status = createCaptureTriageStatus({ readSnapshot: () => state, publish: () => events.push('status') });
  return { state, status, events };
}

test('registry is read-only, private, bounded and honest about restart/eviction', () => {
  const h = registry(), original = structuredClone(h.state);
  assert.deepEqual(h.status.read(h.state.impulses[0]), unknown);
  const token = h.status.begin(fact('synthetic')); h.status.running(token);
  assert.deepEqual(h.status.read(h.state.impulses[0]), { state: 'running', reason: 'running' });
  assert.equal(JSON.stringify(token).includes('Synthetic private'), false);
  for (let i = 0; i < MAX_CAPTURE_TRIAGE_STATUSES; i++) {
    h.state.impulses.push(note(`n-${i}`)); h.status.begin(fact(`n-${i}`));
  }
  assert.deepEqual(h.status.read(h.state.impulses[0]), unknown);
  h.status.finish(token, { reason: 'provider-timeout' });
  assert.deepEqual(h.status.read(h.state.impulses[0]), unknown, 'evicted late run stays unknown');
  assert.deepEqual(h.state.impulses[0], original.impulses[0]);
  const fresh = createCaptureTriageStatus({ readSnapshot: () => h.state });
  assert.deepEqual(fresh.read(h.state.impulses[0]), unknown);
});

test('only the current run and exact source can update status; reads cannot resurrect removed runs', () => {
  for (const mutate of [
    item => { item.text = 'Synthetic replacement'; },
    item => { item.createdAt++; },
    item => { item.classification = { category: 'feeling' }; },
    item => { item.resolution = { action: 'keep' }; },
    item => { item.triage = { category: 'note' }; }
  ]) {
    const h = registry(), first = h.status.begin(fact('synthetic')), second = h.status.begin(fact('synthetic'));
    h.status.running(second); h.status.finish(first, { reason: 'provider-timeout' });
    assert.equal(h.status.read(h.state.impulses[0]).state, 'running');
    mutate(h.state.impulses[0]); h.status.finish(second, { reason: 'provider-timeout' });
    assert.ok([null, 'unknown'].includes(h.status.read(h.state.impulses[0])?.state ?? null));
    h.state.impulses = [note()];
    assert.deepEqual(h.status.read(h.state.impulses[0]), unknown);
  }
  const h = registry(), token = h.status.begin(fact('synthetic'));
  h.state.impulses = []; h.status.finish(token, { reason: 'provider-timeout' });
  h.state.impulses = [note()]; assert.deepEqual(h.status.read(h.state.impulses[0]), unknown);
  h.status.dispose(); h.status.running(token); h.status.finish(token, { reason: 'provider-timeout' });
  assert.equal(h.status.begin(fact('synthetic')), null); assert.equal(h.status.read(note()), null);
});

test('result states are closed and error prose never enters the registry', () => {
  const cases = [
    [{ reason: 'capture-triage-disabled' }, 'skipped', 'disabled'],
    [{ reason: 'capture-triage-unsure' }, 'uncertain', 'uncertain'],
    [{ reason: 'provider-request-aborted', failureCode: 'provider-timeout' }, 'interrupted', 'cancelled'],
    [{ reason: 'no-local-fallback', failureCode: 'provider-timeout' }, 'failed', 'provider-timeout'],
    [{ reason: 'https://private.invalid/secret', failureCode: 'Synthetic private response' }, 'failed', 'provider-failed']
  ];
  for (const [result, state, reason] of cases) {
    const h = registry(), token = h.status.begin(fact('synthetic'));
    h.status.finish(token, result);
    assert.deepEqual(h.status.read(note()), { state, reason });
    assert.ok(Object.isFrozen(h.status.read(note())));
  }
});

function workflow({ answer, settings = { aiBreakdownEnabled: true, aiCaptureTriageEnabled: true } } = {}) {
  let state = { settings, impulses: [note()] }, calls = 0, writes = 0;
  const statuses = [], requestScope = createProviderRequestScope();
  let runner;
  runner = createTriageCaptureWorkflow({ readSnapshot: () => state, clock: { now: () => 2000 }, requestScope,
    triage: async (_input, observers) => { calls++; return typeof answer === 'function' ? answer(observers) : answer; },
    publishStatus: () => statuses.push(runner.readStatus(state.impulses[0])),
    unitOfWork: { run({ transition }) { const next = structuredClone(state), result = transition(next);
      if (result.ok) { state = next; writes++; } return { ...result, committed: result.ok }; } }
  });
  return { runner, requestScope, statuses, read: () => state, calls: () => calls, writes: () => writes };
}

test('workflow observes running and terminal outcomes without adding calls or writes', async () => {
  for (const [answer, expected] of [
    [{ ok: false, reason: 'no-local-fallback', failureCode: 'provider-timeout' }, 'failed'],
    [{ ok: true, triage: { category: 'feeling', confidence: 59 } }, 'uncertain']
  ]) {
    const h = workflow({ answer }); await h.runner.handleCaptured(fact('synthetic'));
    assert.deepEqual(h.statuses.map(value => value.state), ['running', expected]);
    assert.equal(h.calls(), 1); assert.equal(h.writes(), 0);
    assert.equal(Object.hasOwn(h.read().impulses[0], 'triageStatus'), false);
  }
  const disabled = workflow({ settings: { aiBreakdownEnabled: false } });
  await disabled.runner.handleCaptured(fact('synthetic'));
  assert.equal(disabled.calls(), 0); assert.equal(disabled.writes(), 0);
  assert.deepEqual(disabled.statuses, [{ state: 'skipped', reason: 'disabled' }]);
});

test('accepted output remains canonical only after commit, while opt-out and disposal cannot leave running status', async () => {
  const answer = { ok: true, triage: { category: 'feeling', confidence: 95, at: 2000 } };
  const good = workflow({ answer }); await good.runner.handleCaptured(fact('synthetic'));
  assert.equal(good.writes(), 1); assert.equal(good.read().impulses[0].triage.category, 'feeling');
  assert.equal(good.runner.readStatus(good.read().impulses[0]), null);
  for (const dispose of [false, true]) {
    let resolve;
    const h = workflow({ answer: () => new Promise(done => { resolve = done; }) });
    const pending = h.runner.handleCaptured(fact('synthetic'));
    if (dispose) h.runner.dispose(); else h.requestScope.invalidate();
    resolve(answer); await pending;
    assert.equal(h.calls(), 1);
    if (dispose) assert.equal(h.runner.readStatus(h.read().impulses[0]), null);
    else { assert.equal(h.writes(), 0); assert.equal(h.runner.readStatus(note()).state, 'interrupted'); }
  }
});


test('workflow preserves safe provider observations separately from the unchanged provider failure', async () => {
  const h = workflow({ answer: observers => {
    observers.onFailure({ reason: 'provider-timeout' });
    return { ok: false, reason: 'no-local-fallback' };
  } });
  const result = await h.runner.handleCaptured(fact('synthetic'));
  assert.equal(result.reason, 'no-local-fallback');
  assert.deepEqual(h.runner.readStatus(note()), { state: 'failed', reason: 'provider-timeout' });
  assert.equal(h.calls(), 1); assert.equal(h.writes(), 0);
});

test('observability faults and missing sources cannot produce new requests or retain private exceptions', () => {
  const status = createCaptureTriageStatus({ readSnapshot() { throw Error('Synthetic private read failure'); } });
  assert.equal(status.begin(fact('synthetic')), null);
  assert.deepEqual(status.read(note()), unknown);
  status.finish(null, { reason: 'provider-timeout' });
  const h = registry(), token = h.status.begin(fact('synthetic'));
  h.status.running(token); h.status.finish(token, { reason: 'capture-triage-disabled' });
  assert.deepEqual(h.status.read(note()), { state: 'interrupted', reason: 'cancelled' }, 'opt-out after starting is not labeled never enabled');
});
