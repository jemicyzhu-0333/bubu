'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLLABORATION_BUDGET, unicodeLength, normalizeRunBudget, createTurnBudget,
  buildBoundedContext } = require('../src/application/ai/run-budget');

test('collaboration budget is closed, bounded and independent of persistence', () => {
  assert.equal(unicodeLength('a🙂中'), 3);
  assert.equal(COLLABORATION_BUDGET.maxMessageChars, 8000);
  assert.throws(() => normalizeRunBudget({ save: true }), /field-invalid/);
  assert.throws(() => normalizeRunBudget({ deadlineMs: 180001 }), /limit-invalid/);
  assert.throws(() => normalizeRunBudget({ maxReadCalls: Infinity }), /limit-invalid/);
});

test('all reads and provider calls share a nonresetting deadline', () => {
  let at = 10;
  const budget = createTurnBudget({ now: () => at });
  for (let i = 0; i < 6; i++) assert.equal(budget.consume('read').ok, true);
  assert.equal(budget.consume('read').reason, 'read-budget');
  for (let i = 0; i < 5; i++) assert.equal(budget.consume('provider').ok, true);
  assert.equal(budget.consume('provider').reason, 'provider-budget');
  at += 180000;
  assert.equal(budget.check().reason, 'turn-deadline');
  assert.equal(budget.usage().tokens, null);
});

test('bounded context keeps newest input intact and never changes original history', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, role: 'user', content: '中'.repeat(300) }));
  const copy = structuredClone(messages);
  const result = buildBoundedContext({ messages, limits: { maxContextBytes: 2000 } });
  assert.equal(result.ok, true);
  assert.equal(result.context.messages.at(-1).id, 'm49');
  assert.equal(result.context.messages.at(-1).content, messages.at(-1).content);
  assert.ok(result.coverage.omitted > 0);
  assert.deepEqual(messages, copy);
  assert.equal(result.tokens, null);
});

test('context revocation excludes old source-dependent answers and fails closed for huge newest input', () => {
  const result = buildBoundedContext({ messages: [
    { id: 'secret', content: 'private source echoed by assistant', contextAllowed: false },
    { id: 'latest', content: 'hello' }
  ] });
  assert.equal(JSON.stringify(result).includes('private source'), false);
  assert.equal(buildBoundedContext({ messages: [{ content: 'x'.repeat(2000) }],
    limits: { maxContextBytes: 1000 } }).reason, 'context-budget');
});
