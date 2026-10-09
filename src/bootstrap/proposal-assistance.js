'use strict';
const { guidance } = require('../capabilities');
const {
  createApiClient, createDeterministicClient, chatCompletionsEndpoint,
  describeFields, CLARIFY_MEMORY_FIELDS, DEFAULT_AI_BASE_URL
} = require('../core/llm');
const { createOneShotProviderRun } = require('../application/ai/one-shot-provider-run');

// Concrete provider selection stays in composition; guidance receives narrow ports.
function createProposalAssistance(options) {
  const runWithFallback = createOneShotProviderRun({
    now: options.now, schedule: setTimeout, cancelSchedule: clearTimeout
  });
  return guidance.proposalPreview.createProposalPreview({ ...options, providers: {
    createApiClient, createDeterministicClient, chatCompletionsEndpoint,
    describeFields, CLARIFY_MEMORY_FIELDS, DEFAULT_AI_BASE_URL, runWithFallback
  } });
}
module.exports = { createProposalAssistance };
