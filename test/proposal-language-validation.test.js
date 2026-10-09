'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BREAKDOWN_TASK, ENRICH_TASK, CLARIFY_TASK } = require('../src/core/llm/tasks');
const { COLLABORATION_TASK, validateTaskDraft } = require('../src/core/llm/collaboration-task');
const { validateSteps } = require('../src/core/llm/validate-steps');
const { buildDeterministicProposal } = require('../src/core/breakdown-proposal');
const { buildDeterministicEnrich } = require('../src/core/enrich-proposal');

const steps = title => [
  { title, dependsOn: null, safeStopAfter: false },
  { title: '记录当前结果', dependsOn: 0, safeStopAfter: false },
  { title: '保存草稿', dependsOn: 1, safeStopAfter: true }
];
const draft = source => ({ title: '任务草稿', steps: source, estimateMinutes: 25, energy: 'medium', notes: null });

for (const title of [
  '浏览论文摘要', '浏览素材文件夹', 'Inspect the repository',
  'リポジトリの構成を把握する', '저장소 구조를 살펴보기',
  'تصفح ملخص الورقة', 'Изучить структуру репозитория', 'शोधपत्र का सार देखें',
  '项目文件'
]) {
  test(`all task proposal paths preserve wording without semantic rejection: ${title}`, () => {
    const source = steps(title);
    const cases = [
      [BREAKDOWN_TASK, { steps: source, clarifyingQuestion: null }, {}, value => value.steps],
      [ENRICH_TASK, { steps: source, completionCriteria: null, energy: 'medium', estimateMinutes: 25, tags: [] },
        { existingTags: [] }, value => value.steps],
      [CLARIFY_TASK, { status: 'ready', proposal: draft(source) }, { turnIndex: 0 }, value => value.proposal.steps],
      [COLLABORATION_TASK, { type: 'changeProposal', answer: '这是可编辑的草稿。', readRequest: null,
        changeProposal: draft(source) }, {}, value => value.changeProposal.steps]
    ];
    for (const [task, value, payload, selectSteps] of cases) {
      assert.deepEqual(selectSteps(task.validate(value, payload)), source, `${task.name} direct validation`);
      const repaired = task.repair(JSON.stringify(value), payload);
      assert.deepEqual(selectSteps(task.validate(repaired, payload)), source, `${task.name} repaired output`);
    }
  });
}

test('shared and collaboration steps retain closed shape, types, text limits and dependency rules', () => {
  const validators = [
    ['proposal', validateSteps],
    ['collaboration', source => validateTaskDraft(draft(source)).steps]
  ];
  const invalid = [
    source => { source[0] = null; },
    source => { source[0] = []; },
    source => { source[0] = new Date(0); },
    source => { delete source[0].title; },
    source => { source[0].confirmed = true; },
    source => { source[0].title = ''; },
    source => { source[0].title = ' \n\t '; },
    source => { source[0].title = null; },
    source => { source[0].title = 123; },
    source => { source[0].title = false; },
    source => { source[0].title = ['浏览论文摘要']; },
    source => { source[0].title = { text: '浏览论文摘要' }; },
    source => { source[0].title = '文'.repeat(201); },
    source => { source[0].dependsOn = 0; },
    source => { source[1].dependsOn = 1; },
    source => { source[1].dependsOn = 2; },
    source => { source[1].dependsOn = -1; },
    source => { source[1].dependsOn = 0.5; },
    source => { source[1].dependsOn = '0'; },
    source => { source[1].dependsOn = undefined; },
    source => { source[0].safeStopAfter = 'true'; },
    source => { source[0].safeStopAfter = null; },
    source => { delete source[0].safeStopAfter; },
    source => { source[2].safeStopAfter = false; }
  ];
  for (const [name, validate] of validators) {
    for (const [index, mutate] of invalid.entries()) {
      const source = steps('浏览论文摘要');
      mutate(source);
      assert.throws(() => validate(source), `${name} malformed case ${index}`);
    }
    for (const source of [null, {}, 'steps', [], Array(8).fill(steps('浏览论文摘要')[2])]) {
      assert.throws(() => validate(source), `${name} invalid step collection`);
    }
    const atLimit = steps('文'.repeat(200));
    assert.deepEqual(validate(atLimit), atLimit, `${name} maximum-length text`);
    const independent = steps('浏览素材文件夹').map(step => ({ ...step, dependsOn: null }));
    assert.deepEqual(validate(independent), independent, `${name} independent steps`);
  }
  assert.throws(() => validateSteps(steps('浏览论文摘要').slice(1)), /3–7/);
  assert.equal(validateTaskDraft(draft([{ title: '浏览论文摘要', dependsOn: null, safeStopAfter: true }])).steps.length, 1);
});

test('collaboration draft retains root fields, estimate, energy, notes and title limits', () => {
  for (const patch of [
    { applied: true }, { title: '' }, { title: '文'.repeat(101) },
    { estimateMinutes: 0 }, { estimateMinutes: 481 }, { estimateMinutes: 2.5 }, { estimateMinutes: '25' },
    { energy: 'extreme' }, { notes: '' }, { notes: '文'.repeat(1001) }, { notes: 123 }
  ]) assert.throws(() => validateTaskDraft({ ...draft(steps('Inspect the repository')), ...patch }));
  for (const estimateMinutes of [1, 480, null]) {
    assert.equal(validateTaskDraft({ ...draft(steps('浏览论文摘要')), estimateMinutes }).estimateMinutes, estimateMinutes);
  }
});

test('deterministic builders preserve source wording and retain structural padding', () => {
  for (const title of ['浏览论文摘要', '浏览素材文件夹', 'Inspect the repository', '项目文件',
    'リポジトリの構成を把握する', '저장소 구조를 살펴보기', 'تصفح ملخص الورقة',
    'Изучить структуру репозитория', 'शोधपत्र का सार देखें']) {
    for (const source of [[title], [{ title }]]) {
      const before = structuredClone(source);
      for (const value of [buildDeterministicProposal(source), buildDeterministicEnrich({ steps: source })]) {
        assert.deepEqual(value.steps.map(step => step.title), [title, '检查当前结果', '检查当前结果']);
        assert.deepEqual(value.steps.map(step => step.dependsOn), [null, 0, 1]);
        assert.deepEqual(value.steps.map(step => step.safeStopAfter), [false, false, true]);
      }
      assert.deepEqual(source, before, 'source input is not mutated');
    }
  }
  for (const contract of [require('../src/core/llm/validate-steps'), require('../src/core/breakdown-proposal')]) {
    assert.equal(Object.hasOwn(contract, 'ACTION_WORDS'), false);
    assert.equal(Object.hasOwn(contract, 'ACTION_PATTERN'), false);
  }
});

test('clarify preserves equivalent question text across punctuation and scripts', () => {
  for (const question of [
    '标题是“草稿？”还是“终稿？”？', 'Does the title say “Draft?” or “Final?”?',
    '「下書き？」と「完成版？」のどちらですか？', '제목이 “초안?”인가요, “최종?”인가요?',
    'هل العنوان «مسودة؟» أم «نهائي؟»؟', 'Название «Черновик?» или «Итог?»?',
    'शीर्षक “मसौदा?” है या “अंतिम?”?', '选哪一个', 'Which one'
  ]) {
    const value = { status: 'need-more', question, missing: ['标题'] };
    assert.deepEqual(CLARIFY_TASK.validate(value, { turnIndex: 0 }), value);
    assert.deepEqual(CLARIFY_TASK.validate(CLARIFY_TASK.repair(JSON.stringify(value)), { turnIndex: 0 }), value);
  }
});

test('clarify keeps response shape, bounded fields and round budgets after punctuation removal', () => {
  const value = { status: 'need-more', question: '标题是“草稿？”还是“终稿？”？', missing: ['标题'] };
  for (const patch of [
    { status: 'waiting' }, { question: '' }, { question: ' \n\t ' }, { question: null },
    { question: 123 }, { question: '文'.repeat(61) }, { questions: ['标题？'] },
    { missing: null }, { missing: Array(4).fill('标题') }, { missing: [''] }, { missing: ['文'.repeat(61)] }
  ]) assert.throws(() => CLARIFY_TASK.validate({ ...value, ...patch }, { turnIndex: 0 }));
  const absent = { ...value };
  delete absent.question;
  assert.throws(() => CLARIFY_TASK.validate(absent, { turnIndex: 0 }), /unknown or missing fields/);
  assert.throws(() => CLARIFY_TASK.validate(value, { turnIndex: 5 }), /must return ready at the turn limit/);
  assert.equal(CLARIFY_TASK.validate(value, { turnIndex: 4 }).question, value.question);
});
