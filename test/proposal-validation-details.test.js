'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, failureReason } = require('../src/core/llm');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { createPopoverMessages } = require('../src/surfaces/popover/ui/messages.mjs');
const { proposalPreviewFixture, validSteps } = require('../test-support/proposal-preview-fixture');
const { createPopoverBreakdownFeature } = require('../src/surfaces/popover/features/breakdown.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const messages = createPopoverMessages({ pad2: value => String(value).padStart(2, '0') });
const payload = { title: 'PRIVATE_USER_TASK', description: null, clarification: null };
const invalid = () => ({ steps: validSteps().map(step => ({ ...step, safeStopAfter: 'true' })), clarifyingQuestion: null });

test('real generation exhaustion preserves actual safe detail through preview and IPC serialization', async () => {
  for (const kind of ['breakdown', 'enrich']) {
    const body = kind === 'breakdown' ? invalid() : { steps: invalid().steps,
      completionCriteria: null, energy: null, estimateMinutes: null, tags: [] };
    const h = proposalPreviewFixture(body);
    const result = await h.preview[kind === 'breakdown' ? 'previewBreakdownProposal' : 'previewEnrichProposal'](payload);
    const ipcResult = structuredClone(result);
    assert.equal(ipcResult.ok, true);
    assert.equal(ipcResult.fallback, true);
    assert.equal(ipcResult.reason, 'proposal-rejected|steps[0].safeStopAfter must be boolean');
    assert.equal(messages.fallbackReasonText(ipcResult.reason), 'steps[0].safeStopAfter must be boolean');
    assert.match(messages.fallbackReasonSuffix(ipcResult), /steps\[0\]\.safeStopAfter must be boolean/);
    assert.equal(h.sent.length, 2);
    assert.match(h.sent[1].messages.at(-1).content, /steps\[0\]\.safeStopAfter must be boolean/);
    assert.equal(h.localCalls(), 1);
    assert.equal(h.timers.size, 0);
    assert.match(h.logs.join('\n'), /errorCode=proposal-rejected/);
    assert.doesNotMatch(h.logs.join('\n'), /PRIVATE|safeStopAfter|浏览|synthetic-credential/);
  }
});

test('local fallback failure retains safe provider detail separately; stale owner wins over both', async () => {
  for (const fallbackMessage of ['no-local-fallback', 'PRIVATE_LOCAL_FAILURE']) {
    const h = proposalPreviewFixture(invalid(), { fallbackError: new Error(fallbackMessage) });
    const result = structuredClone(await h.preview.previewBreakdownProposal(payload));
    assert.equal(result.ok, false);
    assert.equal(result.reason, fallbackMessage === 'no-local-fallback' ? fallbackMessage : 'local-fallback-failed');
    assert.equal(result.providerReason, 'proposal-rejected|steps[0].safeStopAfter must be boolean');
    assert.match(messages.fallbackReasonSuffix(result), /steps\[0\]\.safeStopAfter must be boolean/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  let h;
  h = proposalPreviewFixture(invalid(), { beforeReply: count => { if (count === 2) h.invalidate(); } });
  const result = await h.preview.previewBreakdownProposal(payload);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider-request-aborted');
  assert.equal(Object.hasOwn(result, 'providerReason'), false);
  assert.equal(h.localCalls(), 0);
});

test('shape failures give the local rule and never echo malformed model text', async () => {
  for (const [output, detail] of [
    ['PRIVATE_PROVIDER_BODY <script>secret</script>', 'proposal is not valid JSON'],
    [{ steps: [], clarifyingQuestion: null }, 'proposal must contain 3–7 steps'],
    [{ steps: [null, ...validSteps().slice(1)], clarifyingQuestion: null }, 'steps[0] must be an object'],
    [{ steps: validSteps().map(step => ({ ...step, safeStopAfter: false })), clarifyingQuestion: null }, 'the final step must be a safe stop']
  ]) {
    const h = proposalPreviewFixture(output);
    const result = await h.preview.previewBreakdownProposal(payload);
    assert.equal(result.reason, `proposal-rejected|${detail}`);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|script|secret/);
  }
});

test('successful repair removes prior diagnostic and preserves the remote result', async () => {
  const h = proposalPreviewFixture(count => count === 1 ? invalid() : { steps: validSteps(), clarifyingQuestion: null });
  const result = await h.preview.previewBreakdownProposal(payload);
  assert.equal(result.ok, true); assert.equal(result.fallback, false); assert.equal(result.reason, null);
  assert.equal(h.sent.length, 2); assert.equal(h.localCalls(), 0);
  assert.equal(Object.hasOwn(result, 'providerReason'), false);
});

test('spoofed validation stages, prefixed strings and executable error getters cannot expose detail', async () => {
  let getters = 0;
  const getter = {};
  for (const key of ['stage', 'message', 'code']) Object.defineProperty(getter, key, {
    get() { getters += 1; throw new Error('PRIVATE_GETTER'); }
  });
  const errors = [
    Object.assign(new Error('PRIVATE_PROVIDER_BODY'), { stage: 'validate', modelText: 'PRIVATE_MODEL' }),
    Object.assign(new Error('steps[0].safeStopAfter must be boolean'), { stage: 'validate' }),
    new Error('proposal-rejected|PRIVATE_PROVIDER_BODY'), getter,
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE_PROXY'); } })
  ];
  for (const error of errors) {
    const run = createOneShotProviderRun({ now: () => 100, schedule: () => 1, cancelSchedule() {} });
    const result = await run({ id: 'api', run: async () => { throw error; } },
      { id: 'deterministic', run: async () => ({}) }, 'breakdown', payload, { assertCurrent() {} });
    assert.ok(['proposal-rejected', 'provider-failed'].includes(result.reason));
    assert.equal(Object.hasOwn(result, 'providerReason'), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|safeStopAfter/);
  }
  assert.equal(getters, 0);
  assert.equal(failureReason(errors[0]), 'proposal-rejected');
  assert.equal(failureReason(getter), 'provider-failed');
  assert.equal(getters, 0);
});

test('both the producer and UI bound displayed detail while retaining the validator wording', async () => {
  const client = createApiClient({ baseUrl: 'https://synthetic-provider.example.test/v1', model: 'synthetic-model',
    getCredential: () => 'synthetic-credential', post: async () => ({ choices: [{ message: { content: JSON.stringify(invalid()) } }] }) });
  const error = await client.run('breakdown', payload).catch(value => value);
  assert.equal(failureReason(error), 'proposal-rejected|steps[0].safeStopAfter must be boolean');
  assert.ok(failureReason(error).length <= 'proposal-rejected|'.length + 200);
  assert.equal(messages.fallbackReasonText('proposal-rejected|' + 'x'.repeat(10000)).length, 200);
});

test('real breakdown validation detail reaches text-only UI on fallback success and failure', async t => {
  const frame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = () => {};
  t.after(() => frame ? Object.defineProperty(globalThis, 'requestAnimationFrame', frame) : delete globalThis.requestAnimationFrame);
  for (const fallbackError of [undefined, new Error('no-local-fallback')]) {
    const task = { id: 'synthetic-task', title: 'PRIVATE_TASK_TITLE' };
    const h = proposalPreviewFixture(invalid(), { fallbackError, tasks: [task] });
    const dom = createCollaborationDom();
    dom.document.createElement = () => ({ innerHTML: '', querySelector: () => ({ addEventListener() {} }) });
    dom.$('#bdSteps').appendChild = () => {};
    const feature = createPopoverBreakdownFeature({ document: dom.document, $: dom.$, $$: () => [],
      escapeHTML: value => String(value).replaceAll('<', '&lt;'), syncPressedButtons() {}, bindStepTitleField() {}, maxSteps: 100,
      surfaceClient: { previewBreakdown() {}, previewAiBreakdown: async request => structuredClone(await h.preview.previewBreakdownProposal(request)),
        dismissBreakdownProposal: async () => ({}), cancelAiRequests: async () => ({}) },
      taskActionMessage: messages.taskActionMessage, fallbackReasonText: messages.fallbackReasonText,
      isAiEnabled: () => true, activeLandingPrompt: () => null, isLandingModalOpen: () => false,
      renderLanding() {}, rememberLandingReturnFocus() {}, restoreModalFocus() {}, showTaskPanelStatus() {} });
    feature.mount();
    await feature.open(task);
    const node = dom.$(fallbackError ? '#breakdownError' : '#breakdownProvider');
    assert.match(node.textContent, /steps\[0\]\.safeStopAfter must be boolean/);
    assert.doesNotMatch(node.textContent, /PRIVATE|proposal-rejected/);
    assert.equal(node.innerHTML, '');
    feature.dispose();
  }
});
