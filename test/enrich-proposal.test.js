'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_COMPLETION_CRITERIA,
  MAX_SUGGESTED_TAGS,
  MIN_ESTIMATE_MINUTES,
  MAX_ESTIMATE_MINUTES,
  buildEnrichJsonSchema,
  normalizeAllowedTags,
  validateEnrichProposal,
  buildDeterministicEnrich
} = require('../src/core/enrich-proposal');
const { MAX_SERIALIZED_BYTES } = require('../src/core/breakdown-proposal');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const sharedStepContract = require('../src/core/llm/validate-steps');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

// 这份测试只管领域契约：一份 enrich 建议什么样子才算合法。提示词、协议、
// 降级与修复在 test/llm-*.test.js 里。

function enrich(overrides = {}) {
  return {
    steps: [
      { title: '打开仓库', dependsOn: null, safeStopAfter: false },
      { title: '检查失败的用例', dependsOn: 0, safeStopAfter: false },
      { title: '记录结论', dependsOn: 1, safeStopAfter: true }
    ],
    completionCriteria: '失败的用例重新跑通并写下原因',
    energy: 'medium',
    estimateMinutes: 45,
    tags: [],
    ...overrides
  };
}

test('the enrich schema is closed, bounded and never asks the model for a title', () => {
  const schema = buildEnrichJsonSchema(['工作', '写作']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    [...schema.required].sort(),
    ['completionCriteria', 'energy', 'estimateMinutes', 'steps', 'tags']
  );
  // 标题是用户写下的事实，不是模型的输出：协议层里根本没有这个字段可填。
  assert.equal(schema.properties.title, undefined);
  assert.equal(schema.properties.steps.items.additionalProperties, false);
  assert.equal(schema.properties.steps.minItems, sharedStepContract.MIN_STEPS);
  assert.equal(schema.properties.steps.maxItems, sharedStepContract.MAX_STEPS);
  assert.equal(schema.properties.steps.items.properties.title.maxLength, sharedStepContract.MAX_STEP_TITLE);
  assert.equal(
    schema.properties.steps.items.properties.safeStopAfter.description,
    sharedStepContract.SAFE_STOP_DESCRIPTION
  );
  assert.equal(schema.properties.completionCriteria.anyOf[1].maxLength, MAX_COMPLETION_CRITERIA);
  assert.deepEqual(schema.properties.energy.anyOf[1].enum, ['low', 'medium', 'high']);
  assert.equal(schema.properties.estimateMinutes.anyOf[1].minimum, MIN_ESTIMATE_MINUTES);
  assert.equal(schema.properties.estimateMinutes.anyOf[1].maximum, MAX_ESTIMATE_MINUTES);
});

test('the tag vocabulary is locked in the schema and an empty set cannot be widened', () => {
  const withTags = buildEnrichJsonSchema(['工作', '写作', '工作']);
  assert.equal(withTags.properties.tags.maxItems, MAX_SUGGESTED_TAGS);
  // 去重后按 enum 锁死：模型物理上无法造出一个新标签。
  assert.deepEqual(withTags.properties.tags.items.enum, ['工作', '写作']);

  // `enum: []` 不是合法 JSON Schema，会静默退化成“任意字符串”。没有候选标签时
  // 必须降成 maxItems: 0，也就是这一轮不许提标签。
  const empty = buildEnrichJsonSchema([]);
  assert.equal(empty.properties.tags.maxItems, 0);
  assert.equal(empty.properties.tags.items.enum, undefined);
  assert.deepEqual(normalizeAllowedTags(['  工作 ', '工作', '', null, 42]), ['工作']);
  assert.deepEqual(normalizeAllowedTags('工作'), []);
});

test('validation rejects unknown fields, unowned tags and out-of-range planning values', () => {
  const accepted = validateEnrichProposal(enrich({ tags: ['工作'] }), { allowedTags: ['工作', '写作'] });
  assert.equal(accepted.steps.length, 3);
  assert.deepEqual(accepted.tags, ['工作']);
  assert.equal(Object.isFrozen(accepted), true);

  assert.throws(() => validateEnrichProposal({ ...enrich(), title: '换个标题' }), /unknown or missing/);
  const missingField = enrich();
  delete missingField.tags;
  assert.throws(() => validateEnrichProposal(missingField), /unknown or missing/);

  // schema 之外再复核一遍：一个无视 schema 的 provider 也不能扩张标签体系。
  assert.throws(
    () => validateEnrichProposal(enrich({ tags: ['新标签'] }), { allowedTags: ['工作'] }),
    /existing tags/
  );
  assert.throws(() => validateEnrichProposal(enrich({ tags: ['工作'] }), { allowedTags: [] }), /existing tags/);
  assert.throws(
    () => validateEnrichProposal(enrich({ tags: ['工作', '写作', '阅读', '运动'] }), { allowedTags: ['工作', '写作', '阅读', '运动'] }),
    /at most 3/
  );

  assert.throws(() => validateEnrichProposal(enrich({ energy: 'extreme' })), /energy/);
  assert.throws(() => validateEnrichProposal(enrich({ estimateMinutes: 4 })), /estimateMinutes/);
  assert.throws(() => validateEnrichProposal(enrich({ estimateMinutes: 481 })), /estimateMinutes/);
  assert.throws(() => validateEnrichProposal(enrich({ estimateMinutes: 30.5 })), /estimateMinutes/);
  assert.throws(() => validateEnrichProposal(enrich({ completionCriteria: 'x'.repeat(201) })), /completionCriteria/);
  assert.throws(() => validateEnrichProposal(enrich({ completionCriteria: '   ' })), /completionCriteria/);

  // 空值是允许的答案：“不知道”比编一个数字诚实。
  const blank = validateEnrichProposal(enrich({ completionCriteria: null, energy: null, estimateMinutes: null }));
  assert.deepEqual(
    [blank.completionCriteria, blank.energy, blank.estimateMinutes, blank.tags],
    [null, null, null, []]
  );
});

test('enrich steps keep the breakdown step contract: bounded, action-first and forward-only', () => {
  assert.throws(() => validateEnrichProposal(enrich({ steps: enrich().steps.slice(0, 2) })), /3–7/);
  assert.throws(() => validateEnrichProposal(enrich({
    steps: Array.from({ length: 8 }, (_, index) => ({
      title: index === 0 ? '打开仓库' : `检查第 ${index + 1} 处`,
      dependsOn: index === 0 ? null : index - 1,
      safeStopAfter: index === 7
    }))
  })), /3–7/);

  const nounOnly = enrich();
  nounOnly.steps[0].title = '仓库分支';
  assert.throws(() => validateEnrichProposal(nounOnly), /action/);

  const forwardDependency = enrich();
  forwardDependency.steps[1].dependsOn = 2;
  assert.throws(() => validateEnrichProposal(forwardDependency), /earlier step/);

  const extraStepField = enrich();
  extraStepField.steps[0].note = '额外说明';
  assert.throws(() => validateEnrichProposal(extraStepField), /unknown or missing/);

  const noSafeStop = enrich();
  noSafeStop.steps.forEach(step => { step.safeStopAfter = false; });
  assert.throws(() => validateEnrichProposal(noSafeStop), /final step must be a safe stop/);

  assert.throws(
    () => validateEnrichProposal(JSON.stringify({ ...enrich(), pad: 'x'.repeat(MAX_SERIALIZED_BYTES) })),
    /8 KB/
  );
  assert.throws(() => validateEnrichProposal('{'), /not valid JSON/);
});

test('switching AI off still produces a real suggestion from local rules', () => {
  const fallback = buildDeterministicEnrich({
    steps: [{ title: '打开草稿' }, { title: '写第一段' }],
    energy: 'low',
    estimateMinutes: 25
  });
  // 关掉 AI 的人拿到的不是空白表单：步骤、能量、估时都来自应用已有的本地规则。
  assert.equal(fallback.steps.length, 3);
  assert.equal(fallback.energy, 'low');
  assert.equal(fallback.estimateMinutes, 25);
  assert.equal(fallback.steps.at(-1).safeStopAfter, true);
  assert.equal(fallback.steps[0].dependsOn, null);
  assert.equal(fallback.steps[1].dependsOn, 0);
  // 完成标准与标签只有人能给：本地规则不猜，也不借此扩张标签体系。
  assert.equal(fallback.completionCriteria, null);
  assert.deepEqual(fallback.tags, []);

  // 名词化的本地步骤会被补上动作前缀，否则它过不了自己的校验。
  assert.equal(buildDeterministicEnrich({ steps: ['周报草稿'] }).steps[0].title, '完成：周报草稿');
  const clamped = buildDeterministicEnrich({ steps: ['打开草稿'], estimateMinutes: 9_999, energy: 'extreme' });
  assert.equal(clamped.estimateMinutes, MAX_ESTIMATE_MINUTES);
  assert.equal(clamped.energy, null);
  assert.equal(buildDeterministicEnrich({}).steps.length, 3);
});


test('one proposal store keeps both kinds apart so an enrich answer cannot be applied as a breakdown', () => {
  let now = 1_000;
  let id = 0;
  const store = new ProposalStore({
    max: 2,
    ttlMs: 100,
    now: () => now,
    idFactory: () => `proposal-${++id}`,
    validate: (proposal, context) => {
      assert.equal(context.kind, 'enrich');
      return validateEnrichProposal(proposal, { allowedTags: context.allowedTags });
    }
  });
  const stored = store.put(enrich({ tags: ['工作'] }), {
    kind: 'enrich', title: '验证 OCR 效果', taskId: 'task-1', allowedTags: ['工作']
  });
  assert.equal(store.get(stored.id).context.kind, 'enrich');
  assert.equal(store.get(stored.id).context.taskId, 'task-1');
  assert.deepEqual([...store.get(stored.id).context.allowedTags], ['工作']);

  // 建议是只读的，而且会过期：它永远不是 canonical state 的一部分。
  assert.equal(Object.isFrozen(store.get(stored.id).proposal), true);
  now += 101;
  assert.equal(store.get(stored.id), null);
  assert.equal(store.size, 0);
});
