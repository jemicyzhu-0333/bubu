'use strict';

// 拆解 / 补全弹窗关掉时，还在等模型的请求要被掰断，而不是空跑到 180 秒截止线。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');
const { registerAiCancellation } = require('../src/bootstrap/ai-cancellation');

function preview(seen) {
  return createProposalPreview({
    getSettings: () => ({ aiBreakdownEnabled: true, aiClarifyEnabled: false, aiModel: 'm', aiBaseUrl: 'https://example.test/v1' }),
    readTasks: () => [],
    credentialStore: { status: () => ({ configured: true }), get: () => 'k' },
    proposalStore: { put: () => ({}), get: () => null, consume: () => null },
    providers: {
      createApiClient: () => ({ id: 'api', run: async () => ({}) }),
      createDeterministicClient: () => ({ id: 'deterministic', run: async () => ({}) }),
      chatCompletionsEndpoint: () => 'https://example.test/v1/chat/completions',
      describeFields: () => [],
      CLARIFY_MEMORY_FIELDS: [],
      DEFAULT_AI_BASE_URL: 'https://example.test/v1',
      runWithFallback: (_client, _fallback, _task, _payload, { signal }) => new Promise((_, reject) => {
        seen.push(signal);
        signal.addEventListener('abort', () => reject(new Error('provider-request-aborted')), { once: true });
      })
    },
    presentExpression: () => null,
    cancelExpression: () => false,
    scheduleWaiting: () => null,
    now: () => 0,
    requestTtlMs: 1000,
    timeoutMs: 1000,
    trace: { enabled: false, selection: () => {}, skipped: () => {}, result: () => {}, fallback: () => {} },
    negotiation: null
  });
}

test('closing the modal aborts every preview still waiting on the model', async () => {
  const seen = [];
  const p = preview(seen);
  const pending = [
    p.previewBreakdownProposal({ title: '写报告' }).catch(() => null),
    p.previewEnrichProposal({ title: '回邮件' }).catch(() => null)
  ];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.length, 2);
  assert.deepEqual(p.cancelPending(), { ok: true, cancelled: 2 });
  assert.ok(seen.every(signal => signal.aborted));
  await Promise.all(pending);
  assert.deepEqual(p.cancelPending(), { ok: true, cancelled: 0 });
});

test('the cancel channel takes no arguments and only reaches cancelPending', () => {
  const registered = new Map();
  registerAiCancellation((channel, handler) => registered.set(channel, handler), { cancelPending: () => ({ ok: true, cancelled: 3 }) });
  assert.deepEqual([...registered.keys()], ['ai:cancel']);
  assert.deepEqual(registered.get('ai:cancel')(), { ok: true, cancelled: 3 });
  assert.throws(() => registerAiCancellation(() => {}, {}), /proposal preview/);
});

test('the disclosed request address follows the negotiated protocol', () => {
  const { createApiClient, chatCompletionsEndpoint, DEFAULT_AI_BASE_URL, PROTOCOLS } = require('../src/core/llm');
  const negotiation = new Map();
  const build = () => createProposalPreview({
    getSettings: () => ({ aiBreakdownEnabled: true, aiModel: 'gpt-5-mini', aiBaseUrl: 'https://example.test/v1' }),
    readTasks: () => [],
    credentialStore: { status: () => ({ configured: true }), get: () => 'k' },
    proposalStore: { put: () => ({}), get: () => null, consume: () => null },
    providers: {
      createApiClient, createDeterministicClient: () => ({ id: 'deterministic', run: async () => ({}) }),
      chatCompletionsEndpoint, describeFields: () => [],
      CLARIFY_MEMORY_FIELDS: [], DEFAULT_AI_BASE_URL, runWithFallback: async () => ({})
    },
    presentExpression: () => null, cancelExpression: () => false, scheduleWaiting: () => null,
    now: () => 0, requestTtlMs: 1000, timeoutMs: 1000,
    trace: { enabled: false, selection: () => {}, skipped: () => {}, result: () => {}, fallback: () => {} },
    negotiation
  });
  assert.match(build().aiDisclosure().endpoint, /chat\/completions$/);
  negotiation.set('https://example.test/v1', PROTOCOLS.find(protocol => protocol !== PROTOCOLS[0]));
  assert.match(build().aiDisclosure().endpoint, /responses$/);
});
