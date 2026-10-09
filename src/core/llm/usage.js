'use strict';

// Only provider-reported counts cross this boundary. Missing/partial telemetry
// stays unknown; different tokenizers and prices cannot be inferred from text.
function responseUsage(protocol, response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const inputTokens = protocol === 'responses' ? usage.input_tokens : usage.prompt_tokens;
  const outputTokens = protocol === 'responses' ? usage.output_tokens : usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  if (![inputTokens, outputTokens, totalTokens].every(value => Number.isSafeInteger(value) && value >= 0)
      || !Number.isSafeInteger(inputTokens + outputTokens) || inputTokens + outputTokens !== totalTokens) return null;
  return Object.freeze({ inputTokens, outputTokens, totalTokens });
}
module.exports = { responseUsage };
