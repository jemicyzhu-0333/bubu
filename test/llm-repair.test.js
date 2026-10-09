'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseJsonObject,
  dropUnknownKeys,
  coerceInteger,
  coerceEnum,
  keepAllowed,
  looksOneBased,
  repairStepDependencies
} = require('../src/core/llm/repair');
const { ENERGY_LEVELS } = require('../src/core/enrich-proposal');

function steps(dependsOn) {
  return dependsOn.map((value, index) => ({
    title: `第 ${index + 1} 步`,
    dependsOn: value,
    safeStopAfter: true
  }));
}

// 这份测试钉住的是一次真实事故。模型给出的正是下面这组 dependsOn：它按“依赖第 1
// 步”的人类编号在写，而校验器要 0 起的数组下标，于是 steps[1] 变成自己依赖自己，
// 一份花了 13 秒、精准贴合用户处境的 5 步建议整份作废，界面上只剩“AI 未生效”。
test('the one-based numbering a model naturally writes is translated, not rejected', () => {
  const asShipped = steps([null, 1, 1, 1, 2]);
  assert.equal(looksOneBased(asShipped), true);
  assert.deepEqual(
    repairStepDependencies(asShipped).map(step => step.dependsOn),
    [null, 0, 0, 0, 1]
  );
});

// 宁可不修也不能改错一份本来合法的答案：出现 0 就说明模型在用 0 起下标，
// 而一份已经全部合法的答案不该被整体减一。位移与“修不动就置 null”是两件事：
// 不位移不代表越界的那一项就能留着。
test('a correct zero-based answer is never shifted, and neither is an ambiguous one', () => {
  const rebased = values => repairStepDependencies(steps(values)).map(step => step.dependsOn);

  assert.equal(looksOneBased(steps([null, 0, 1, 2])), false, '已经全部合法');
  assert.deepEqual(rebased([null, 0, 1, 2]), [null, 0, 1, 2]);

  assert.equal(looksOneBased(steps([null, null, null])), false, '没有任何依赖时无证据可据');
  assert.deepEqual(rebased([null, null, null]), [null, null, null]);

  // 出现 0 就说明是 0-based，所以不位移；但 steps[3].dependsOn=3 在 0-based 下仍然
  // 是自指，那一项单独置 null，其余三项不受影响。
  assert.equal(looksOneBased(steps([null, 0, 0, 3])), false);
  assert.deepEqual(rebased([null, 0, 0, 3]), [null, 0, 0, null]);

  // 首步就带依赖，两种编号下都不成立（第一步前面没有步骤）。
  assert.equal(looksOneBased(steps([2, null, null])), false);
  assert.deepEqual(rebased([2, null, null]), [null, null, null]);
});

// 修不动的依赖置 null，而不是抛错。null 本来就是 schema 里“这一步不依赖别人”的
// 合法取值，而一条错的排序提示用户点一下就能改；整份回退是 40 秒加一份与处境
// 无关的通用模板。
test('a dependency that cannot be salvaged becomes null instead of killing the proposal', () => {
  assert.deepEqual(
    repairStepDependencies(steps([null, 0, 99, -3, 'nonsense'])).map(step => step.dependsOn),
    [null, 0, null, null, null]
  );
  // "1" 和 1.0 都是模型在表达同一个整数，先归一再判编号。
  assert.deepEqual(
    repairStepDependencies(steps([null, '1', 1.0, 1])).map(step => step.dependsOn),
    [null, 0, 0, 0]
  );
  assert.deepEqual(repairStepDependencies('not an array'), 'not an array');
});

// 模型即使被要求只输出 JSON，也常把它裹进 ```json 围栏，或在前面加一句
// “好的，这是结果：”。裸 JSON.parse 在这里失败，而失败的代价是整份回退。
test('JSON arrives wrapped in fences and prose, and still parses', () => {
  const payload = { steps: [], clarifyingQuestion: null };
  const text = JSON.stringify(payload);
  for (const wrapped of [
    text,
    `\`\`\`json\n${text}\n\`\`\``,
    `\`\`\`\n${text}\n\`\`\``,
    `好的，这是结果：\n${text}`,
    `${text}\n\n以上就是全部步骤。`
  ]) {
    assert.deepEqual(parseJsonObject(wrapped), payload, JSON.stringify(wrapped.slice(0, 24)));
  }
  assert.deepEqual(parseJsonObject(payload), payload, '已经是对象就原样返回');
  assert.throws(() => parseJsonObject('这次我不想回答'), /not valid JSON/);
  assert.throws(() => parseJsonObject(42), /not valid JSON/);
  assert.throws(() => parseJsonObject(`{"a":"${'x'.repeat(200)}"}`, 100), /exceeds/);
});

// `additionalProperties: false` 是给模型的约束，不是给我们自己的自毁开关：
// 模型多送一个 `notes` 字段，不构成把它其余答对的部分丢掉的理由。
test('an extra field is dropped rather than voiding everything answered correctly', () => {
  assert.deepEqual(
    dropUnknownKeys({ title: '打开仓库', dependsOn: null, safeStopAfter: true, notes: '顺便说一句' },
      ['title', 'dependsOn', 'safeStopAfter']),
    { title: '打开仓库', dependsOn: null, safeStopAfter: true }
  );
  // 缺字段不在这里补：补什么值是任务层的判断，这里只负责不放行未知键。
  assert.deepEqual(dropUnknownKeys({ title: 'x' }, ['title', 'dependsOn']), { title: 'x' });
  assert.deepEqual(dropUnknownKeys(null, ['title']), null);
  assert.deepEqual(dropUnknownKeys([1, 2], ['title']), [1, 2]);
});

test('integers written as strings are accepted, but a number is never invented', () => {
  assert.equal(coerceInteger(40), 40);
  assert.equal(coerceInteger('40'), 40);
  assert.equal(coerceInteger(' 40 '), 40);
  assert.equal(coerceInteger(39.6), 40);
  // 带单位说明模型没听懂字段，回灌错误比替它编一个数字好。
  assert.equal(coerceInteger('40 minutes'), '40 minutes');
  assert.equal(coerceInteger('大约一小时'), '大约一小时');
  assert.equal(coerceInteger(null), null);
});

// 枚举只放宽大小写和首尾空白。同义词不做映射：把 "moderate" 映成 "medium"
// 是我们在替模型下判断，而这个字段会直接决定用户看到的投入建议。
test('enum casing is forgiven but synonyms are not guessed', () => {
  assert.equal(coerceEnum('Medium', ENERGY_LEVELS), 'medium');
  assert.equal(coerceEnum(' HIGH ', ENERGY_LEVELS), 'high');
  assert.equal(coerceEnum('moderate', ENERGY_LEVELS), 'moderate', '认不出来就原样上交，让校验器拒绝');
  assert.equal(coerceEnum(null, ENERGY_LEVELS), null);
});

// “不扩张用户的标签词表”是产品承诺，裁掉就已经兑现了——不必把整份建议一起扔掉。
// 旧实现在这里抛错，于是模型凭空造一个标签就能让 5 条可用步骤全部消失。
test('an invented tag is dropped, which keeps the promise without discarding the steps', () => {
  assert.deepEqual(keepAllowed(['工作', '生活'], ['工作', '生活', '学习']), ['工作', '生活']);
  assert.deepEqual(keepAllowed(['工作', '凭空造的'], ['工作']), ['工作']);
  assert.deepEqual(keepAllowed([' 工作 '], ['工作']), ['工作'], '首尾空白不算另一个标签');
  assert.deepEqual(keepAllowed(['工作', '工作'], ['工作']), ['工作'], '重复只留一份');
  assert.deepEqual(keepAllowed([], ['工作']), []);
  assert.deepEqual(keepAllowed(['任意'], []), [], '用户还没有标签时只能是空数组');
  assert.deepEqual(keepAllowed('not an array', ['工作']), 'not an array');
});
