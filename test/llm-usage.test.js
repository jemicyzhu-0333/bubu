'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { responseUsage } = require('../src/core/llm/usage');

test('chat and responses usage only exposes verified nonnegative integer token counts', () => {
  assert.deepEqual(responseUsage('chat-completions', { usage: { prompt_tokens: 10, completion_tokens: 2,
    total_tokens: 12, secret: 'not metadata' } }), { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  assert.deepEqual(responseUsage('responses', { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }),
    { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  for (const usage of [null, {}, { prompt_tokens: 10 },
    { prompt_tokens: '10', completion_tokens: 2, total_tokens: 12 },
    { prompt_tokens: 1, completion_tokens: -1, total_tokens: 0 },
    { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 2, total_tokens: Number.MAX_SAFE_INTEGER + 2 }
  ]) assert.equal(responseUsage('chat-completions', { usage }), null);
});
