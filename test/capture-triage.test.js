'use strict';

// 随手记分拣：模型只给建议，建议挂在闪念上，去向要本人确认；情绪不影响能量。
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_TRIAGE_TASK, validateCaptureTriageResult } = require('../src/core/llm/tasks');
const { annotateImpulseTriage, normalizeImpulseTriage } = require('../src/capabilities/work/domain/impulse-inbox');
const { createTriageCaptureWorkflow } = require('../src/application/workflows/triage-capture');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { describeTriage } = require('../src/surfaces/popover/features/inbox-triage.mjs');

const valid = over => ({ category: 'task', confidence: 90, title: '回房东邮件', routineKind: null, level: null, reason: '提到要做的事', ...over });

test('the task sends only the note text and demands the fields its category needs', () => {
  assert.deepEqual(CAPTURE_TRIAGE_TASK.buildInput({ impulseText: '  明天回房东邮件 ', taskTitle: 'x' }), { impulseText: '明天回房东邮件' });
  assert.equal(validateCaptureTriageResult(valid()).title, '回房东邮件');
  assert.throws(() => validateCaptureTriageResult(valid({ title: null })), /title/);
  assert.throws(() => validateCaptureTriageResult(valid({ category: 'log', routineKind: null })), /routineKind/);
  assert.throws(() => validateCaptureTriageResult(valid({ category: 'state', level: 42 })), /level/);
  const trimmed = validateCaptureTriageResult(valid({ category: 'feeling', title: '多余', level: 35 }));
  assert.equal(trimmed.title, null);
  assert.equal(trimmed.level, null);
});

test('annotating keeps the note untouched and refuses a note that changed meanwhile', () => {
  const state = { impulses: [{ id: 'i1', text: '好困', createdAt: 1 }] };
  const triage = { category: 'state', confidence: 80, level: 35, reason: '描述状态', at: 5 };
  assert.equal(annotateImpulseTriage(state, { impulseId: 'i1', expectedText: '别的', triage }).ok, false);
  const result = annotateImpulseTriage(state, { impulseId: 'i1', expectedText: '好困', triage });
  assert.equal(result.ok, true);
  assert.equal(state.impulses[0].text, '好困');
  assert.equal(state.impulses[0].triage.level, 35);
  assert.equal(normalizeImpulseTriage({ ...triage, category: 'nonsense' }), null);
});

function workflowHarness({ settings, answer }) {
  let state = { settings, impulses: [{ id: 'i1', text: '刚喝完咖啡', createdAt: 1000 }] };
  const published = [];
  const workflow = createTriageCaptureWorkflow({
    readSnapshot: () => state,
    clock: { now: () => 2000 },
    triage: async () => answer,
    publish: fact => published.push(fact),
    unitOfWork: { run({ transition }) {
      const draft = structuredClone(state);
      const result = transition(draft);
      if (!result.ok) return result;
      state = draft;
      return { ...result, committed: true };
    } }
  });
  return { workflow, published, read: () => state };
}

const fact = { type: 'impulse-captured', impulseId: 'i1', capturedAt: 1000 };
const on = { aiBreakdownEnabled: true, aiCaptureTriageEnabled: true };

test('the workflow does nothing unless both switches are on', async () => {
  const h = workflowHarness({ settings: { aiBreakdownEnabled: true }, answer: { ok: true, triage: valid() } });
  assert.equal((await h.workflow.handleCaptured(fact)).reason, 'capture-triage-disabled');
  assert.equal(h.read().impulses[0].triage, undefined);
});

test('a confident answer is attached as a suggestion; an unsure one is dropped', async () => {
  const sure = workflowHarness({ settings: on, answer: { ok: true, triage: valid({ category: 'log', routineKind: 'stimulant', title: null }) } });
  assert.equal((await sure.workflow.handleCaptured(fact)).changed, true);
  assert.equal(sure.read().impulses[0].triage.routineKind, 'stimulant');
  assert.equal(sure.published.length, 1);
  const unsure = workflowHarness({ settings: on, answer: { ok: true, triage: valid({ confidence: 40 }) } });
  assert.equal((await unsure.workflow.handleCaptured(fact)).reason, 'capture-triage-unsure');
  assert.equal(unsure.read().impulses[0].triage, undefined);
});

test('categories have one appropriate primary action, including a missing routine and uncertainty', () => {
  const state = { routines: { items: [{ id: 'r1', title: '咖啡', kind: 'stimulant' }] } };
  for (const [category, action] of Object.entries({ task: 'next-step', routine: 'routine', log: 'log', state: 'state', feeling: 'feeling', note: 'keep' })) {
    assert.equal(describeTriage({ triage: { category } }, state).action.kind, action);
  }
  assert.equal(describeTriage({ triage: { category: 'log', routineKind: 'meal' } }, state).action.label, '创建并记一次');
  assert.equal(describeTriage({ text: '没有分拣' }, state).action.kind, 'keep');
  assert.equal(describeTriage({ triage: { category: 'task' }, classification: { category: 'feeling' } }, state).action.kind, 'feeling');
});

test('both impulse model calls go through the shared deadline runner with no local fallback', async () => {
  const { createImpulseEnergyClassifier } = require('../src/capabilities/guidance/application/impulse-energy-classifier');
  const calls = [], sent = [], timers = new Set();
  const runWithFallback = createOneShotProviderRun({ now: () => 0,
    schedule(callback) { const timer = { callback }; timers.add(timer); return timer; },
    cancelSchedule(timer) { timers.delete(timer); }
  });
  const classification = { direction: 'down', delta: -4, confidence: 80, reason: 'r' };
  const trace = { fallback: () => {} };
  const classifier = createImpulseEnergyClassifier({
    getSettings: () => ({ aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true, aiCaptureTriageEnabled: true, aiModel: 'm' }),
    credentialStore: { status: () => ({ configured: true }), get: () => 'k' },
    createApiClient: () => ({ id: 'api', run: async (name, payload, { beforeRequest }) => {
      beforeRequest();
      sent.push({ name, payload });
      if (name === 'capture-triage') throw new Error('synthetic-provider-failure');
      return classification;
    } }),
    defaultBaseUrl: 'https://example.test/v1',
    failureReason: error => error.message,
    trace,
    runWithFallback: async (client, fallback, name, payload, options) => {
      calls.push({ name, fallback: fallback.id, trace: options.trace });
      assert.equal(typeof options.assertCurrent, 'function');
      assert.equal(Object.hasOwn(options, 'beforeRequest'), false);
      return runWithFallback(client, fallback, name, payload, options);
    }
  });
  const analyzed = await classifier.analyze({ impulseText: '好累', ignored: 'not sent' });
  assert.deepEqual(analyzed, { ok: true, classification, provider: 'api',
    cleanup: { ok: true, timer: 'released', listener: 'released' } });
  const triaged = await classifier.triage({ impulseText: '好累', ignored: 'not sent' });
  assert.deepEqual(triaged, { ok: false, reason: 'no-local-fallback',
    cleanup: { ok: true, timer: 'released', listener: 'released' } });
  assert.equal(Object.isFrozen(analyzed.cleanup), true);
  assert.equal(Object.isFrozen(triaged.cleanup), true);
  assert.equal(timers.size, 0);
  assert.deepEqual(sent, [
    { name: 'impulse-energy', payload: { impulseText: '好累' } },
    { name: 'capture-triage', payload: { impulseText: '好累' } }
  ]);
  assert.deepEqual(calls.map(call => [call.name, call.fallback, call.trace === trace]),
    [['impulse-energy', 'none', true], ['capture-triage', 'none', true]]);
});
