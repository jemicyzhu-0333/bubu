'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiDiagnosticsRuntime } = require('../src/bootstrap/ai-diagnostics');
const { createImpulseEnergyClassifier } = require('../src/capabilities/guidance/application/impulse-energy-classifier');
const { createApiClient, failureReason } = require('../src/core/llm');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { createTriageCaptureWorkflow } = require('../src/application/workflows/triage-capture');
const { createAnalyzeImpulseEnergyWorkflow } = require('../src/application/workflows/analyze-impulse-energy');
const FACT = { type: 'impulse-captured', impulseId: 'synthetic-source', capturedAt: 1000 };
const valid = { category: 'state', confidence: 90, title: null, routineKind: null, level: 35, reason: 'Synthetic state' };
function fixture({ answer = valid, diagnosticsOn = true, failCommit = false, throwCommit = false } = {}) {
  let state = { settings: { aiBreakdownEnabled: true, aiCaptureTriageEnabled: true, aiImpulseEnergyEnabled: true, aiModel: 'synthetic-test' },
    impulses: [{ id: FACT.impulseId, text: 'Synthetic private source', createdAt: 1000 }], energySignals: [], tasks: [] }, posts = 0, writes = 0;
  const diagnostics = createAiDiagnosticsRuntime({ readSnapshot: () => state, now: () => 2000, schedule: () => 1, cancelSchedule() {},
    metadata: { bubuCapabilities: { schemaVersion: 1, aiDiagnostics: true } } });
  if (diagnosticsOn) diagnostics.start();
  const requestScope = createProviderRequestScope({ onInvalidate: diagnostics.stop });
  const classifier = createImpulseEnergyClassifier({ requestScope, getSettings: () => state.settings,
    credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic-not-a-secret' },
    createApiClient: options => createApiClient({ ...options, post: async () => {
      posts++; return { choices: [{ message: { content: JSON.stringify(answer) } }] };
    } }), defaultBaseUrl: 'https://synthetic.invalid', failureReason, timeoutMs: 1000,
    runWithFallback: createOneShotProviderRun({ now: () => 2000, schedule: () => 1, cancelSchedule() {} })
  });
  const ports = { diagnostics, requestScope, readSnapshot: () => state, clock: { now: () => 2000 },
    unitOfWork: { run({ transition }) {
      if (throwCommit) throw new Error('synthetic unconfirmed commit');
      if (failCommit) return { ok: false, committed: false, reason: 'state-revision-conflict' };
      const candidate = structuredClone(state), result = transition(candidate);
      if (result.ok !== false) { state = candidate; writes++; }
      return { ...result, ok: result.ok !== false, committed: result.ok !== false, revision: writes };
    } }, publish() {} };
  return { diagnostics, requestScope, triage: createTriageCaptureWorkflow({ ...ports, triage: classifier.triage }),
    energy: createAnalyzeImpulseEnergyWorkflow({ ...ports, classify: classifier.analyze }),
    counts: () => ({ posts, writes }), read: () => state,
    detail: () => diagnostics.detail({ id: diagnostics.list().records[0]?.id }).record };
}
test('real fake-provider pipeline preserves original/repaired/validated and committed outcome without added calls', async () => {
  for (const diagnosticsOn of [false, true]) {
    const f = fixture({ diagnosticsOn, answer: { ...valid, confidence: '90' } });
    const result = await f.triage.handleCaptured(FACT);
    assert.equal(result.changed, true); assert.deepEqual(f.counts(), { posts: 1, writes: 1 });
    if (!diagnosticsOn) { assert.equal(f.diagnostics.status().count, 0); continue; }
    const record = f.detail(); assert.equal(record.outcome.code, 'suggestion-saved');
    assert.deepEqual(record.events.map(event => event.phase), ['attempt', 'output', 'repaired', 'validated', 'gate', 'application']);
    assert.equal(JSON.parse(record.events[1].data.text).confidence, '90'); assert.equal(record.events[2].data.value.confidence, 90);
    assert.equal(record.events[4].data.minimum, 60);
  }
});
test('low confidence is valid model output but no apply; invalid output records both actual repair attempts', async () => {
  const low = fixture({ answer: { ...valid, confidence: 59 } }); await low.triage.handleCaptured(FACT);
  assert.deepEqual(low.counts(), { posts: 1, writes: 0 }); assert.equal(low.detail().outcome.code, 'capture-triage-unsure');
  const invalid = fixture({ answer: { ...valid, level: 999 } }); await invalid.triage.handleCaptured(FACT);
  assert.deepEqual(invalid.counts(), { posts: 2, writes: 0 });
  assert.equal(invalid.detail().events.filter(event => event.phase === 'output').length, 2);
  assert.equal(invalid.detail().events.filter(event => event.phase === 'rejected').length, 2);
  assert.equal(invalid.detail().events.find(event => event.phase === 'rejected').data.field, 'level');
  assert.equal(invalid.detail().outcome.changed, false);
});
test('successful generation is not successful commit, and unknown commit stays unknown', async () => {
  const failed = fixture({ failCommit: true }); await failed.triage.handleCaptured(FACT);
  assert.equal(failed.detail().outcome.changed, false); assert.notEqual(failed.detail().outcome.code, 'suggestion-saved');
  const unknown = fixture({ throwCommit: true }); await assert.rejects(unknown.triage.handleCaptured(FACT));
  assert.equal(unknown.detail().outcome.changed, null);
});
test('energy uses its separate threshold and shows only actual recorded delta, unknown effective contribution', async () => {
  const f = fixture({ answer: { direction: 'down', delta: -8, confidence: 90, reason: 'Synthetic tired state' } });
  const result = await f.energy.handleCaptured(FACT); assert.equal(result.changed, true);
  assert.deepEqual(f.counts(), { posts: 1, writes: 1 });
  const record = f.detail(), energy = record.events.find(event => event.phase === 'energy').data;
  assert.equal(record.outcome.code, 'energy-signal-recorded'); assert.equal(energy.recordedDelta, -8);
  assert.equal(energy.effectiveContribution, null); assert.equal(record.events.find(event => event.phase === 'gate').data.minimum, 70);
  f.requestScope.invalidate(); assert.equal(f.diagnostics.status().active, false); assert.equal(f.diagnostics.status().count, 0);
});

test('breakdown, enrich and unstick share passive phases; legacy proposal command success does not invent a commit receipt', async () => {
  const llm = require('../src/core/llm');
  const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');
  const { ProposalStore } = require('../src/application/ai/proposal-store');
  const { createApplyGuidanceProposalWorkflow } = require('../src/application/workflows/apply-guidance-proposal');
  const { validateEnrichProposal } = require('../src/core/enrich-proposal');
  const { validateProposal } = require('../src/core/breakdown-proposal');
  const steps = [0, 1, 2].map(index => ({ title: `Synthetic step ${index}`, dependsOn: index ? index - 1 : null, safeStopAfter: index === 2 }));
  for (const task of ['breakdown', 'enrich', 'unstick']) {
    const state = { tasks: [], impulses: [] };
    const diagnostics = createAiDiagnosticsRuntime({ readSnapshot: () => state, now: () => 2000, schedule: () => 1, cancelSchedule() {},
      metadata: { bubuCapabilities: { schemaVersion: 1, aiDiagnostics: true } } });
    diagnostics.start(); let posts = 0;
    const answer = task === 'breakdown' ? { steps, clarifyingQuestion: null }
      : task === 'enrich' ? { steps, completionCriteria: null, energy: 'low', estimateMinutes: 20, tags: [] }
        : { nextAction: 'Synthetic next action', why: 'Synthetic explanation', fallbackAction: 'Synthetic alternative', splitSteps: [] };
    const proposalStore = new ProposalStore({ now: () => 2000, validate: (proposal, context) => context.kind === 'enrich'
      ? validateEnrichProposal(proposal, { allowedTags: [] }) : validateProposal(proposal) });
    const preview = createProposalPreview({ diagnostics, getSettings: () => ({ aiBreakdownEnabled: true, aiModel: 'synthetic-test' }),
      readTasks: () => [], credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic-not-a-secret' },
      proposalStore, requestScope: createProviderRequestScope(), presentExpression() {}, cancelExpression() {}, scheduleWaiting() {},
      now: () => 2000, requestTtlMs: 1000, providers: { ...llm, DEFAULT_AI_BASE_URL: 'https://synthetic.invalid',
        createApiClient: options => llm.createApiClient({ ...options, post: async () => { posts++; return { choices: [{ message: { content: JSON.stringify(answer) } }] }; } }),
        runWithFallback: createOneShotProviderRun({ now: () => 2000, schedule: () => 1, cancelSchedule() {} }) }
    });
    const result = await (task === 'breakdown' ? preview.previewBreakdownProposal({ title: 'Synthetic task' })
      : task === 'enrich' ? preview.previewEnrichProposal({ title: 'Synthetic task' }) : preview.suggestUnstick({ note: 'Synthetic blocker' }));
    assert.equal(result.ok, true); assert.equal(posts, 1);
    let record = diagnostics.detail({ id: diagnostics.list().records[0].id }).record;
    assert.equal(record.events.filter(event => event.phase === 'output').length, 1);
    assert.equal(record.events.filter(event => event.phase === 'validated').length, 1);
    if (task === 'breakdown') {
      const apply = createApplyGuidanceProposalWorkflow({ proposalStore, diagnostics,
        createWorkItemCommand: { execute: () => ({ ok: true, task: { id: 'synthetic-new-task' } }) },
        updateWorkItemWorkflow: { execute() { throw new Error('unexpected existing task'); } },
        consumeBreakdownProposal: id => proposalStore.consume(id) });
      assert.equal(apply.execute({ proposalId: result.proposalId, steps }).ok, true);
      record = diagnostics.detail({ id: record.id }).record;
      assert.equal(record.outcome.code, 'proposal-command-succeeded'); assert.equal(record.outcome.changed, null);
    }
    diagnostics.dispose();
  }
});
