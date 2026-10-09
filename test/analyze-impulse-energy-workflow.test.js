'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAnalyzeImpulseEnergyWorkflow,
  createUnitOfWork
} = require('../src/application');

const CAPTURED_AT = Date.parse('2026-09-27T12:00:00Z');
const FACT = Object.freeze({
  type: 'impulse-captured',
  impulseId: 'impulse-1',
  capturedAt: CAPTURED_AT,
  revision: 1
});

function stateWithImpulse(overrides = {}) {
  return {
    settings: { aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true },
    impulses: [{ id: 'impulse-1', text: '午睡过了，现在状态不错', createdAt: CAPTURED_AT }],
    energySignals: [],
    ...overrides
  };
}

function repositoryFrom(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    replace: candidate => {
      state = structuredClone(candidate);
      revision += 1;
    },
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function workflowFor(repository, classify, overrides = {}) {
  return createAnalyzeImpulseEnergyWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    readSnapshot: repository.snapshot,
    clock: { now: () => CAPTURED_AT + 60_000 },
    classify,
    ...overrides
  });
}

test('only the source impulse text reaches the classifier and a confident result becomes a bounded signal', async () => {
  const repository = repositoryFrom(stateWithImpulse());
  const requests = [];
  const published = [];
  const workflow = workflowFor(repository, async payload => {
    requests.push(payload);
    return {
      ok: true,
      provider: 'test',
      classification: { direction: 'up', delta: 7, confidence: 88, reason: '午睡后自述状态不错' }
    };
  }, { publish: fact => published.push(fact) });

  const result = await workflow.handleCaptured(FACT);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(requests, [{ impulseText: '午睡过了，现在状态不错' }]);
  assert.deepEqual(Object.keys(repository.inspect().state.energySignals[0]).sort(), [
    'at', 'confidence', 'delta', 'id', 'reason', 'referenceId', 'source'
  ]);
  assert.equal(repository.inspect().state.energySignals[0].delta, 7);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(published[0].type, 'impulse-energy-recorded');
});

test('neutral, low-confidence and provider failures leave the curve unchanged', async () => {
  for (const answer of [
    { ok: true, classification: { direction: 'neutral', delta: 0, confidence: 99, reason: '没有明确状态' } },
    { ok: true, classification: { direction: 'down', delta: -5, confidence: 69, reason: '证据不足' } },
    { ok: false, reason: 'provider-timeout' }
  ]) {
    const repository = repositoryFrom(stateWithImpulse());
    const result = await workflowFor(repository, async () => answer).handleCaptured(FACT);
    assert.equal(result.changed, false);
    assert.equal(repository.inspect().commits, 0);
    assert.deepEqual(repository.inspect().state.energySignals, []);
  }
});

test('a late model response is discarded after deletion, text change or settings opt-out', async () => {
  for (const mutate of [
    state => { state.impulses = []; },
    state => { state.impulses[0].text = '已经改成另一句话'; },
    state => { state.settings.aiImpulseEnergyEnabled = false; }
  ]) {
    const repository = repositoryFrom(stateWithImpulse());
    const waiting = deferred();
    const workflow = workflowFor(repository, () => waiting.promise);
    const pending = workflow.handleCaptured(FACT);
    const next = repository.snapshot();
    mutate(next);
    repository.replace(next);
    waiting.resolve({
      ok: true,
      classification: { direction: 'down', delta: -8, confidence: 91, reason: '明确表达无法投入' }
    });

    const result = await pending;
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'impulse-stale');
    assert.equal(repository.inspect().commits, 0);
    assert.deepEqual(repository.inspect().state.energySignals, []);
  }
});

test('a response arriving after the thirty-minute freshness window is discarded', async () => {
  const repository = repositoryFrom(stateWithImpulse());
  let reads = 0;
  const workflow = workflowFor(repository, async () => ({
    ok: true,
    classification: { direction: 'up', delta: 6, confidence: 90, reason: '明确自述已恢复' }
  }), {
    clock: {
      now: () => (reads++ === 0
        ? CAPTURED_AT + 60_000
        : CAPTURED_AT + 30 * 60_000 + 1)
    }
  });

  const result = await workflow.handleCaptured(FACT);
  assert.deepEqual(result, { ok: true, changed: false, reason: 'impulse-stale' });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state.energySignals, []);
});
