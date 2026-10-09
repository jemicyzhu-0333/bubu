'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateProposal,
  buildDeterministicProposal,
  MAX_SERIALIZED_BYTES,
  ACTION_WORDS,
  PROPOSAL_JSON_SCHEMA
} = require('../src/core/breakdown-proposal');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const sharedStepContract = require('../src/core/llm/validate-steps');

// 这份测试只管领域契约：一份 proposal 什么样子才算合法。怎么把它问出来、
// 怎么发出网、拿到不合法的东西怎么修，在 test/llm-*.test.js 里。

function proposal(count = 3) {
  return {
    steps: Array.from({ length: count }, (_, index) => ({
      title: index === 0 ? '打开项目' : `检查第 ${index + 1} 步`,
      dependsOn: index === 0 ? null : index - 1,
      safeStopAfter: index === count - 1
    })),
    clarifyingQuestion: null
  };
}

test('proposal schema is closed, bounded and requires action-first ordered steps', () => {
  assert.equal(validateProposal(proposal()).steps.length, 3);
  assert.throws(() => validateProposal({ ...proposal(), hidden: true }), /unknown/);
  assert.throws(() => validateProposal(proposal(2)), /3–7/);
  assert.throws(() => validateProposal(proposal(8)), /3–7/);
  const lateDependency = proposal();
  lateDependency.steps[1].dependsOn = 2;
  assert.throws(() => validateProposal(lateDependency), /earlier/);
  const nounOnly = proposal();
  nounOnly.steps[0].title = '项目文件';
  assert.throws(() => validateProposal(nounOnly), /action/);
  const noSafeStop = proposal();
  noSafeStop.steps.forEach(step => { step.safeStopAfter = false; });
  assert.throws(() => validateProposal(noSafeStop), /final step must be a safe stop/);
  assert.throws(() => validateProposal(JSON.stringify({ ...proposal(), pad: 'x'.repeat(MAX_SERIALIZED_BYTES) })), /8 KB/);
});

test('schema and runtime validation use the same shared step contract', () => {
  const stepSchema = PROPOSAL_JSON_SCHEMA.properties.steps;
  assert.strictEqual(ACTION_WORDS, sharedStepContract.ACTION_WORDS);
  assert.equal(stepSchema.minItems, sharedStepContract.MIN_STEPS);
  assert.equal(stepSchema.maxItems, sharedStepContract.MAX_STEPS);
  assert.equal(stepSchema.items.properties.title.maxLength, sharedStepContract.MAX_STEP_TITLE);
  assert.equal(stepSchema.items.properties.dependsOn.description, sharedStepContract.DEPENDS_ON_DESCRIPTION);
  assert.equal(stepSchema.items.properties.safeStopAfter.description, sharedStepContract.SAFE_STOP_DESCRIPTION);
});

// 中文语序里动词很少落在第一个字上。一份前缀白名单会把下面这些完全可用的步骤
// 整份否掉（一步不合格就全部回退），而“买东西、订车票、打包行李”这类非办公
// 任务过去一个动词都不在词表里，结果是“AI 就是从来不生效”。
test('an action anywhere in the title counts, and a bare noun phrase still does not', () => {
  const withTitles = titles => validateProposal({
    steps: titles.map((title, index) => ({
      title,
      dependsOn: index === 0 ? null : index - 1,
      safeStopAfter: index === titles.length - 1
    })),
    clarifyingQuestion: null
  });
  assert.equal(withTitles(['提前查看西双版纳天气', '把要带的衣物列出来', '机票和酒店预订好']).steps.length, 3);
  assert.doesNotThrow(() => withTitles(['买防晒霜和驱蚊液', '订接机车辆', '行李打包完']));
  // 只有名词的一行仍然不是步骤，而且错误里要能看到是哪一句。
  assert.throws(() => withTitles(['行李清单', '打开背包', '收尾并保存']), /must name an action: 行李清单/);
});

test('deterministic fallback conforms and proposal storage is memory-only, bounded and expiring', () => {
  const fallback = buildDeterministicProposal([{ title: '打开文件' }, { title: '写第一句' }, { title: '保存草稿' }]);
  assert.equal(fallback.steps.length, 3);
  let now = 1000;
  let id = 0;
  const store = new ProposalStore({ max: 2, ttlMs: 100, now: () => now, idFactory: () => `proposal-${++id}` });
  store.put(fallback, { title: '任务一' });
  store.put(fallback, { title: '任务二' });
  store.put(fallback, { title: '任务三' });
  assert.equal(store.size, 2);
  assert.equal(store.get('proposal-1'), null);
  now += 101;
  assert.equal(store.size, 0);
});

// 一次真实事故的回归：dependsOn 的“0 起数组下标”只写在校验器里，schema 和提示词
// 都没提编号方式，模型于是给了 1-based，steps[1] 自己依赖自己，一份可用的建议整份
// 作废。字段说明必须留在 schema 上——那是唯一会跟着请求一起上线的地方。
test('every field carries its own semantics, so no convention lives only in the validator', () => {
  const step = PROPOSAL_JSON_SCHEMA.properties.steps.items.properties;
  assert.match(step.dependsOn.description, /[Zz]ero-based index/);
  assert.match(step.dependsOn.description, /strictly less than/);
  assert.match(step.dependsOn.description, /first step is always null/);
  assert.match(step.safeStopAfter.description, /final step must always be true/);
  for (const [name, field] of [
    ['title', step.title],
    ['safeStopAfter', step.safeStopAfter],
    ['steps', PROPOSAL_JSON_SCHEMA.properties.steps],
    ['clarifyingQuestion', PROPOSAL_JSON_SCHEMA.properties.clarifyingQuestion]
  ]) {
    assert.ok(typeof field.description === 'string' && field.description.length > 20, `${name} 必须自带说明`);
  }
});
