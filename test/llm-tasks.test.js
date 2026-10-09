'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TURNS,
  BREAKDOWN_TASK,
  ENRICH_TASK,
  UNSTICK_TASK,
  CLARIFY_TASK,
  TASKS,
  BREAKDOWN_FIELDS,
  ENRICH_FIELDS,
  UNSTICK_FIELDS,
  CLARIFY_FIELDS,
  IMPULSE_ENERGY_FIELDS,
  IMPULSE_ENERGY_TASK,
  IMPULSE_ENERGY_INSTRUCTION,
  BREAKDOWN_INSTRUCTION,
  ENRICH_INSTRUCTION,
  OUTBOUND_BLOCKERS
} = require('../src/core/llm/tasks');
const { describeFields } = require('../src/core/llm');
const { MAX_STEPS, MIN_STEPS } = require('../src/core/breakdown-proposal');

// 会发送哪些字段是任务的属性，和 buildInput() 定义在同一个对象里。旧实现把这句
// 承诺挂在 provider 上，于是“披露的字段”和“实际发送的字段”能各自演化——这一条
// 让漂移变成结构上不可能，而不是靠记得同时改两处。
test('what is disclosed is exactly what is sent, for every task', () => {
  for (const [name, task] of Object.entries(TASKS)) {
    const sent = Object.keys(task.buildInput({
      mode: 'talk', context: { messages: [], summary: null, data: [] },
      availableReads: { tools: [], taskIds: [], fromDay: null, toDay: null },
      character: 'dango', satiation: 45.5, meal: 'breakfast', foods: ['berry'], favorite: 'berry',
      title: 't',
      existingTags: [],
      impulseText: '午睡后现在清醒多了'
    })).sort();
    assert.deepEqual(sent, [...task.fields].sort(), `${name}: 发出去的字段必须与 fields 一字不差`);
    assert.deepEqual([...describeFields(name)], [...task.fields], `${name}: 出口暴露的就是任务自己声明的`);
  }
  assert.deepEqual([...BREAKDOWN_FIELDS], ['title', 'description', 'clarification', 'blocker']);
  assert.deepEqual([...ENRICH_FIELDS], ['title', 'description', 'clarification', 'existingTags']);
  assert.deepEqual([...UNSTICK_FIELDS], ['title', 'steps', 'note', 'taskEnergyDemand']);
  assert.deepEqual([...CLARIFY_FIELDS], ['transcript', 'turnIndex', 'maxTurns']);
  assert.deepEqual([...IMPULSE_ENERGY_FIELDS], ['impulseText']);
  assert.throws(() => describeFields('nope'), /unknown llm task/);
});

test('impulse energy classification is conservative, bounded and discloses only note text', () => {
  assert.deepEqual(IMPULSE_ENERGY_TASK.buildInput({
    impulseText: '  一点都不想上班，做不进去事情  ',
    taskTitle: '不得发送',
    userProfile: { diagnosis: '不得发送' }
  }), { impulseText: '一点都不想上班，做不进去事情' });
  assert.match(IMPULSE_ENERGY_INSTRUCTION, /non-clinical/);
  assert.match(IMPULSE_ENERGY_INSTRUCTION, /must be neutral with delta 0/);
  assert.match(IMPULSE_ENERGY_INSTRUCTION, /Never quote or closely paraphrase private details/);

  assert.deepEqual(IMPULSE_ENERGY_TASK.validate({
    direction: 'down', delta: -6, confidence: 86, reason: '当前投入困难'
  }), {
    direction: 'down', delta: -6, confidence: 86, reason: '当前投入困难'
  });
  assert.throws(() => IMPULSE_ENERGY_TASK.validate({
    direction: 'up', delta: 13, confidence: 90, reason: '越界'
  }), /delta/);
  assert.throws(() => IMPULSE_ENERGY_TASK.validate({
    direction: 'neutral', delta: 1, confidence: 90, reason: '方向矛盾'
  }), /disagree/);
});

// 卡点是“卡住了”弹窗里用户已经回答过的事实。不传给模型就等于让它猜：提示词里
// 已经在谈 blocker，却没有输入通道。而一个能装任意字串的字段会让“会发送哪些
// 字段”这句承诺变成空话，所以出网边界上只放行六个已知卡点。
test('the blocker travels with a breakdown request, and only as one of six known values', () => {
  assert.match(BREAKDOWN_INSTRUCTION, /When blocker is present/);
  const sent = payload => BREAKDOWN_TASK.buildInput(payload);
  assert.equal(sent({ title: '写周报' }).blocker, null);
  for (const blocker of OUTBOUND_BLOCKERS) {
    assert.equal(sent({ title: 't', blocker }).blocker, blocker);
  }
  for (const rogue of ['用户的私密笔记', 'TOO-BIG', '', null, 42, { blocker: 'x' }]) {
    assert.equal(sent({ title: 't', blocker: rogue }).blocker, null, `${JSON.stringify(rogue)} 不得透传`);
  }
});

// 模型看不到 PRODUCT.md，所以每一条我们依赖的规则都得跟着请求一起走。
test('both instructions carry the start-friction and situation constraints the model cannot read from the docs', () => {
  for (const [name, instruction] of [['breakdown', BREAKDOWN_INSTRUCTION], ['enrich', ENRICH_INSTRUCTION]]) {
    assert.match(instruction, /finds it hard to get started and is often interrupted/, name);
    assert.match(instruction, /startable in under two minutes/, name);
    assert.match(instruction, /safe to abandon/, name);
    assert.match(instruction, /never coach, praise, encourage or moralise/, name);
    assert.match(instruction, /Never speculate about why the task is hard/, name);
    assert.match(instruction, /same language as the task title/, name);
    assert.match(instruction, /this specific situation/, name);
    // 标题是用户自己写下的事实，模型改写它就等于把被规划的东西换成它的猜测。
    assert.match(instruction, /[Nn]ever restate, translate/, name);
    // 字段语义只在 schema 里有一份，提示词负责把模型指过去。
    assert.match(instruction, /described in the schema/, name);
  }
});

// 提示词不再复述 schema 里已经写清楚的字段规则。两处各写一遍就是两边开始漂的
// 方式，而且散文那份还不一定会上线——旧的 json_object 分支把 schema 整个丢掉了。
test('field rules live in the schema only, never duplicated as prose in the instruction', () => {
  for (const [name, instruction] of [['breakdown', BREAKDOWN_INSTRUCTION], ['enrich', ENRICH_INSTRUCTION]]) {
    for (const leaked of [/dependsOn/, /safeStopAfter/, /estimateMinutes/, /completionCriteria/, /at most 3/]) {
      assert.doesNotMatch(instruction, leaked, `${name}: ${leaked} 的规则应该只在 schema 的 description 里`);
    }
  }
});

test('each task asks for its own schema, and the enrich schema is scoped to the tags on hand', () => {
  const breakdown = BREAKDOWN_TASK.buildSchema({});
  assert.equal(breakdown.properties.steps.minItems, MIN_STEPS);
  assert.equal(breakdown.properties.steps.maxItems, MAX_STEPS);
  assert.ok(breakdown.properties.clarifyingQuestion);
  assert.equal(breakdown.properties.tags, undefined, 'breakdown 不问标签');

  const withTags = ENRICH_TASK.buildSchema({ existingTags: ['工作', '生活'] });
  assert.deepEqual(withTags.properties.tags.items.enum, ['工作', '生活']);
  assert.equal(withTags.properties.clarifyingQuestion, undefined, 'enrich 不问澄清问题');
  // 标题绝对不在 enrich 的 schema 里：那是用户写下的唯一事实。
  assert.equal(withTags.properties.title, undefined);

  const withoutTags = ENRICH_TASK.buildSchema({ existingTags: [] });
  assert.equal(withoutTags.properties.tags.maxItems, 0, 'enum: [] 不是合法 JSON Schema，空集合必须收敛成 maxItems 0');
});

// 端到端的修复：模型给 1-based 编号、多送一个字段、把估时写成字串、造一个不存在
// 的标签——这一整份在旧实现里会整份作废，现在应该修好后通过校验。
test('a realistically messy answer is repaired into something the validator accepts', () => {
  const payload = { title: '明天要去西双版纳了，什么都没准备呢', existingTags: ['出行'] };
  const raw = JSON.stringify({
    steps: [
      { title: '打开手机备忘录，写下要带的东西', dependsOn: null, safeStopAfter: true },
      { title: '把身份证和钱包放进包的外层口袋', dependsOn: 1, safeStopAfter: true },
      { title: '给手机和充电宝接上充电器', dependsOn: 1, safeStopAfter: true, note: '多余字段' }
    ],
    completionCriteria: '证件、电子设备和基本衣物已装进包里并开始充电。',
    energy: 'Medium',
    estimateMinutes: '40',
    tags: ['出行', '凭空造的标签'],
    extra: '模型多说的一句'
  });

  const repaired = ENRICH_TASK.validate(ENRICH_TASK.repair(raw, payload), payload);
  assert.deepEqual(repaired.steps.map(step => step.dependsOn), [null, 0, 0], '1-based 被翻译成数组下标');
  assert.equal(repaired.energy, 'medium', '大小写被放宽');
  assert.equal(repaired.estimateMinutes, 40, '字串整数被归一');
  assert.deepEqual(repaired.tags, ['出行'], '凭空造的标签被裁掉，用户词表没有被扩张');
  assert.equal(repaired.steps.length, 3);
});

// 缺字段补 null 而不是让整份作废：null 是这四个字段各自的合法取值，意思正是
// “这一项没能填上”，与模型漏写它时的实际情况一致。
test('a field the model simply omitted becomes null instead of voiding the answer', () => {
  const payload = { title: '写周报', existingTags: [] };
  const raw = JSON.stringify({
    steps: [
      { title: '打开周报文档', dependsOn: null, safeStopAfter: true },
      { title: '写完本周三件事', dependsOn: 0, safeStopAfter: true },
      { title: '保存并发出', dependsOn: 1, safeStopAfter: true }
    ]
  });
  const repaired = ENRICH_TASK.validate(ENRICH_TASK.repair(raw, payload), payload);
  assert.equal(repaired.completionCriteria, null);
  assert.equal(repaired.energy, null);
  assert.equal(repaired.estimateMinutes, null);
  assert.deepEqual(repaired.tags, []);
});

// Runtime validation checks structure; wording quality stays with the model and
// the person's editable draft rather than a language-specific action dictionary.
test('wording passes through repair unchanged while structural bounds still fail', () => {
  const payload = { title: '写周报', existingTags: [] };
  const nounOnly = JSON.stringify({
    steps: [
      { title: '项目文件', dependsOn: null, safeStopAfter: true },
      { title: '打开周报文档', dependsOn: 0, safeStopAfter: true },
      { title: '保存并发出', dependsOn: 1, safeStopAfter: true }
    ],
    completionCriteria: null, energy: null, estimateMinutes: null, tags: []
  });
  assert.equal(ENRICH_TASK.validate(ENRICH_TASK.repair(nounOnly, payload), payload).steps[0].title, '项目文件');

  const tooMany = JSON.stringify({
    steps: Array.from({ length: MAX_STEPS + 1 }, (_, index) => ({
      title: `完成第 ${index + 1} 件事`, dependsOn: index === 0 ? null : index - 1, safeStopAfter: true
    })),
    completionCriteria: null, energy: null, estimateMinutes: null, tags: []
  });
  assert.throws(() => ENRICH_TASK.validate(ENRICH_TASK.repair(tooMany, payload), payload), /steps/);
});

test('unstick validates an exact useful shape and truncates bounded copy and split count', () => {
  const result = UNSTICK_TASK.validate({
    nextAction: `打开文档${'写'.repeat(80)}`,
    why: `先恢复上下文${'。'.repeat(100)}`,
    fallbackAction: `只写标题${'。'.repeat(80)}`,
    splitSteps: ['打开文档', '找到上次落点', '写下一句', '不应保留']
  });
  assert.equal(result.nextAction.length, 60);
  assert.equal(result.why.length, 80);
  assert.equal(result.fallbackAction.length, 60);
  assert.deepEqual(result.splitSteps, ['打开文档', '找到上次落点', '写下一句']);
  assert.throws(() => UNSTICK_TASK.validate({
    nextAction: '   ', why: '', fallbackAction: '', splitSteps: []
  }), /nextAction/);
  assert.throws(() => UNSTICK_TASK.validate({
    nextAction: '打开文档', why: '', fallbackAction: '', splitSteps: [], extra: true
  }), /unknown or missing fields/);
});

test('clarify is a strict union and ready reuses the shared breakdown step rules', () => {
  const needMore = CLARIFY_TASK.validate({
    status: 'need-more', question: '要交付什么形式？', missing: ['交付形式']
  }, { turnIndex: 0 });
  assert.equal(needMore.status, 'need-more');
  assert.throws(() => CLARIFY_TASK.validate({
    status: 'waiting', question: '要做什么？', missing: []
  }, { turnIndex: 0 }), /status/);
  assert.equal(CLARIFY_TASK.validate({
    status: 'need-more', question: '交给谁？什么时候交？', missing: ['对象', '时间']
  }, { turnIndex: 0 }).question, '交给谁？什么时候交？');

  const nounOnly = [
    { title: '项目文件', dependsOn: null, safeStopAfter: true },
    { title: '打开周报文档', dependsOn: 0, safeStopAfter: true },
    { title: '保存并发出', dependsOn: 1, safeStopAfter: true }
  ];
  assert.deepEqual(BREAKDOWN_TASK.validate({ steps: nounOnly, clarifyingQuestion: null }).steps, nounOnly);
  assert.deepEqual(CLARIFY_TASK.validate({
    status: 'ready',
    proposal: { title: '写周报', steps: nounOnly, estimateMinutes: 25, energy: 'high', notes: null }
  }, { turnIndex: 0 }).proposal.steps, nounOnly);
});

test('clarify uses a six-turn zero-based budget and refuses another question on index five', () => {
  assert.equal(MAX_TURNS, 6);
  const input = CLARIFY_TASK.buildInput({
    transcript: [{ role: 'user', content: '写周报' }],
    turnIndex: MAX_TURNS - 1,
    maxTurns: 999
  });
  assert.equal(input.turnIndex, 5);
  assert.equal(input.maxTurns, 6);
  assert.throws(() => CLARIFY_TASK.validate({
    status: 'need-more', question: '还需要补充什么？', missing: ['细节']
  }, input), /must return ready at the turn limit/);
});

// 严格模式要求根节点是 object；oneOf 根让每一轮澄清先吃一个 400 再降档。
test('the clarify schema has an object root and a flat answer folds back into the strict union', () => {
  const schema = CLARIFY_TASK.buildSchema({});
  assert.equal(schema.type, 'object');
  assert.equal(schema.oneOf, undefined);
  assert.equal(schema.anyOf, undefined);
  assert.deepEqual([...schema.required].sort(), ['missing', 'proposal', 'question', 'status']);
  assert.equal(schema.additionalProperties, false);

  const needMore = CLARIFY_TASK.validate(CLARIFY_TASK.repair(JSON.stringify({
    status: 'need-more', question: '要交付什么形式？', missing: null, proposal: null
  })), { turnIndex: 0 });
  assert.deepEqual(needMore, { status: 'need-more', question: '要交付什么形式？', missing: [] });

  const steps = [
    { title: '打开周报文档', dependsOn: null, safeStopAfter: true },
    { title: '填三条本周进展', dependsOn: 0, safeStopAfter: true },
    { title: '保存并发出', dependsOn: 1, safeStopAfter: true }
  ];
  const ready = CLARIFY_TASK.validate(CLARIFY_TASK.repair(JSON.stringify({
    status: 'ready', question: null, missing: null,
    proposal: { title: '写周报', steps, estimateMinutes: 25, energy: 'medium', notes: null }
  })), { turnIndex: 0 });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.proposal.steps.length, 3);
});

test('ordinary step titles and noun phrases pass without lexical rejection', () => {
  const steps = titles => titles.map((title, index) => ({ title, dependsOn: index ? index - 1 : null, safeStopAfter: true }));
  for (const title of ['填三条进展', '把数据贴进表格', '给老板打电话', '改第二段', 'Draft the intro', '起草邀请函']) {
    assert.doesNotThrow(() => BREAKDOWN_TASK.validate({
      steps: steps(['打开文档', title, '保存']), clarifyingQuestion: null
    }), title);
  }
  assert.equal(BREAKDOWN_TASK.validate({
    steps: steps(['项目文件', '打开文档', '保存']), clarifyingQuestion: null
  }).steps[0].title, '项目文件');
});

// 使用者有没有某种状况是他自己的事：任何会发给模型的提示词都不写诊断名称，也不让模型去推断。
test('no instruction sent to a model names a diagnosis', () => {
  const { TASKS } = require('../src/core/llm/tasks');
  for (const [name, task] of Object.entries(TASKS)) {
    assert.doesNotMatch(String(task.instruction), /ADHD|attention[- ]deficit|autis|dyslex|depress|anxiety/i, `${name} names a condition`);
  }
});

test('unstick separates task effort from current self-report and estimate', () => {
  const output = UNSTICK_TASK.buildInput({ title: '写报告', steps: [], note: null,
    taskEnergyDemand: 'high', energy: 'low', userSelfReport: { level: 90 },
    currentPlanningEstimate: { level: 80 } });
  assert.equal(output.taskEnergyDemand, 'high');
  assert.equal(Object.hasOwn(output, 'energy'), false);
  assert.equal(Object.hasOwn(output, 'userSelfReport'), false);
  assert.equal(Object.hasOwn(output, 'currentPlanningEstimate'), false);
  assert.match(UNSTICK_TASK.instruction, /not the person's current energy/);
  assert.match(UNSTICK_TASK.instruction, /Do not infer either/);
});
