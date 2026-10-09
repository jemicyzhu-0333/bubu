'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');

test('the standing disclosure counts the memory fields only while the memory switch is on', () => {
  const settings = { aiBreakdownEnabled: false, aiMemoryEnabled: false };
  const preview = createProposalPreview({
    getSettings: () => settings,
    readTasks: () => [],
    credentialStore: { status: () => ({ configured: false }), get: () => null },
    proposalStore: { put: () => ({}), get: () => null, consume: () => null },
    providers: {
      createApiClient: () => ({ id: 'api' }),
      createDeterministicClient: () => ({ id: 'deterministic', run: async () => ({}) }),
      chatCompletionsEndpoint: () => 'https://example.test/v1/chat/completions',
      describeFields: name => [`${name}-field`],
      CLARIFY_MEMORY_FIELDS: ['memories', 'activityDigest'],
      DEFAULT_AI_BASE_URL: 'https://example.test/v1',
      runWithFallback: async () => ({})
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
  assert.deepEqual(preview.aiDisclosure().fields,
    ['breakdown-field', 'enrich-field', 'unstick-field', 'clarify-field']);
  settings.aiMemoryEnabled = true;
  assert.deepEqual(preview.aiDisclosure().fields,
    ['breakdown-field', 'enrich-field', 'unstick-field', 'clarify-field', 'memories', 'activityDigest']);
});
