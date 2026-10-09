'use strict';

const assert = require('node:assert/strict');
const llm = require('../src/core/llm');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { createProposalPreview } = require('../src/capabilities/guidance/application/proposal-preview');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const { validateProposal } = require('../src/core/breakdown-proposal');
const { validateEnrichProposal } = require('../src/core/enrich-proposal');

// Real generator, owner, store and preview; only the provider POST is fake.
// No DNS, credentials, live profile or paid service is used by this fixture.
function proposalPreviewFixture(output, { fallbackError, beforeReply, clientError, tasks = [] } = {}) {
  const sent = [], logs = [], timers = new Set();
  let localCalls = 0, current = true;
  const trace = llm.createLlmTrace({ enabled: true, sink: line => logs.push(line), now: () => 100 });
  const settings = { aiBreakdownEnabled: true, aiModel: 'synthetic-model',
    aiBaseUrl: 'https://synthetic-provider.example.test/v1' };
  const run = createOneShotProviderRun({ now: () => 100,
    schedule: callback => { timers.add(callback); return callback; },
    cancelSchedule: handle => timers.delete(handle) });
  const providers = { ...llm,
    createApiClient(options) {
      return llm.createApiClient({ ...options, post: async (_endpoint, body) => {
        sent.push(structuredClone(body));
        assert.ok(sent.length <= 2, 'at most one repair attempt');
        if (beforeReply) beforeReply(sent.length);
        if (clientError) throw clientError;
        const reply = typeof output === 'function' ? output(sent.length) : output;
        return { choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] };
      } });
    },
    createDeterministicClient(builders) {
      const local = llm.createDeterministicClient(builders);
      return { ...local, async run(...args) {
        localCalls += 1;
        if (fallbackError) throw fallbackError;
        return local.run(...args);
      } };
    },
    runWithFallback: (remote, local, name, payload, options) => run(remote, local, name, payload, {
      ...options, assertCurrent() { options.assertCurrent(); if (!current) throw new Error('synthetic-stale'); }
    })
  };
  const preview = createProposalPreview({
    getSettings: () => settings, readTasks: () => tasks,
    credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic-credential' },
    providers, proposalStore: new ProposalStore({ now: () => 100, idFactory: () => 'synthetic-proposal',
      validate: (proposal, context) => context.kind === 'enrich'
        ? validateEnrichProposal(proposal, { allowedTags: context.allowedTags }) : validateProposal(proposal) }),
    presentExpression: () => null, cancelExpression: () => false,
    scheduleWaiting: () => null, now: () => 100, requestTtlMs: 1000,
    timeoutMs: 1000, trace, negotiation: new Map()
  });
  return { preview, sent, logs, timers, invalidate: () => { current = false; },
    localCalls: () => localCalls };
}

function validSteps() {
  return ['浏览论文摘要', 'Inspect the repository', '資料の概要'].map((title, index) => ({
    title, dependsOn: index ? index - 1 : null, safeStopAfter: true
  }));
}

module.exports = { proposalPreviewFixture, validSteps };
