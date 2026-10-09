'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../src/core/llm/tasks');
const { PROPOSAL_JSON_SCHEMA } = require('../src/core/breakdown-proposal');
const { PET_MEAL_TASK } = require('../src/core/llm/pet-meal-task');
const { COLLABORATION_TASK } = require('../src/core/llm/collaboration-task');

const steps = () => [
  { title: '打开文件', dependsOn: null, safeStopAfter: false },
  { title: '写内容', dependsOn: 0, safeStopAfter: false },
  { title: '保存文件', dependsOn: 1, safeStopAfter: true }
];
const input = () => ({ title: '任务', description: '', clarification: null, blocker: 'unclear', existingTags: [' 工作 ', '工作'],
  impulseText: '现在感觉清醒', mode: 'talk', context: { messages: [], summary: null, data: [] },
  availableReads: { tools: [], taskIds: [], fromDay: null, toDay: null },
  character: 'dango', satiation: 45.5, meal: 'breakfast', foods: ['berry'], favorite: 'berry' });

test('closed eight-task registry retains order and singleton descriptor identity', () => {
  assert.deepEqual(Object.keys(tasks.TASKS), ['pet-meal', 'collaborate', 'breakdown', 'enrich', 'unstick', 'clarify', 'impulse-energy', 'capture-triage']);
  assert.equal(Object.isFrozen(tasks.TASKS), true);
  const descriptors = [PET_MEAL_TASK, COLLABORATION_TASK, tasks.BREAKDOWN_TASK, tasks.ENRICH_TASK,
    tasks.UNSTICK_TASK, tasks.CLARIFY_TASK, tasks.IMPULSE_ENERGY_TASK, tasks.CAPTURE_TRIAGE_TASK];
  assert.deepEqual(Object.values(tasks.TASKS), descriptors);
  for (const [index, task] of Object.values(tasks.TASKS).entries()) {
    assert.equal(task, descriptors[index]);
    assert.equal(Object.isFrozen(task), true);
    assert.equal(Object.isFrozen(task.fields), true);
  }
});

test('facade retains exact ordered public exports', () => {
  assert.deepEqual(Object.keys(tasks), [
    'MAX_TURNS', 'MAX_UNSTICK_ACTION', 'MAX_UNSTICK_WHY', 'MAX_UNSTICK_SPLIT_STEPS',
    'MAX_CLARIFY_QUESTION', 'MAX_CLARIFY_MISSING', 'MAX_CLARIFY_MEMORIES', 'MAX_CLARIFY_MEMORY_BODY',
    'MAX_IMPULSE_ENERGY_TEXT', 'MAX_IMPULSE_ENERGY_REASON', 'START_FRICTION_CONTEXT', 'SCENARIO_CONTEXT',
    'BREAKDOWN_INSTRUCTION', 'ENRICH_INSTRUCTION', 'UNSTICK_INSTRUCTION', 'CLARIFY_INSTRUCTION',
    'IMPULSE_ENERGY_INSTRUCTION', 'BREAKDOWN_FIELDS', 'ENRICH_FIELDS', 'UNSTICK_FIELDS', 'CLARIFY_FIELDS',
    'CLARIFY_MEMORY_FIELDS', 'IMPULSE_ENERGY_FIELDS', 'CLARIFY_DIGEST_FIELDS', 'OUTBOUND_BLOCKERS',
    'normalizeOutboundBlocker', 'normalizeTurnIndex', 'atClarifyTurnLimit', 'normalizeClarifyMemories',
    'normalizeClarifyActivityDigest', 'describeClarifyFields', 'validateUnstickResult', 'validateClarifyResult',
    'validateImpulseEnergyResult', 'BREAKDOWN_TASK', 'ENRICH_TASK', 'UNSTICK_TASK', 'CLARIFY_TASK',
    'IMPULSE_ENERGY_TASK', 'CAPTURE_TRIAGE_TASK', 'CAPTURE_TRIAGE_CATEGORIES', 'CAPTURE_TRIAGE_LEVELS',
    'CAPTURE_TRIAGE_FIELDS', 'validateCaptureTriageResult', 'TASKS'
  ]);
});

test('singleton schemas preserve clarify steps alias while enrich schema stays fresh', () => {
  assert.equal(tasks.BREAKDOWN_TASK.buildSchema(), PROPOSAL_JSON_SCHEMA);
  const clarify = tasks.CLARIFY_TASK.buildSchema();
  assert.equal(clarify, tasks.CLARIFY_TASK.buildSchema());
  assert.equal(clarify.properties.proposal.anyOf[1].properties.steps, PROPOSAL_JSON_SCHEMA.properties.steps);
  assert.notEqual(tasks.ENRICH_TASK.buildSchema({ existingTags: [] }), tasks.ENRICH_TASK.buildSchema({ existingTags: [] }));
  assert.equal(Object.isFrozen(clarify), true);
  assert.equal(Object.isFrozen(clarify.properties), false);
  assert.equal(tasks.UNSTICK_TASK.validate, tasks.validateUnstickResult);
  assert.equal(tasks.IMPULSE_ENERGY_TASK.validate, tasks.validateImpulseEnergyResult);
  assert.equal(tasks.CAPTURE_TRIAGE_TASK.validate, tasks.validateCaptureTriageResult);
});

test('every static disclosure matches outbound keys and descriptor instruction identity', () => {
  for (const task of Object.values(tasks.TASKS)) assert.deepEqual(Object.keys(task.buildInput(input())), [...task.fields]);
  for (const family of ['BREAKDOWN', 'ENRICH', 'UNSTICK', 'CLARIFY', 'IMPULSE_ENERGY']) {
    assert.equal(tasks[`${family}_TASK`].fields, tasks[`${family}_FIELDS`]);
    assert.equal(tasks[`${family}_TASK`].instruction, tasks[`${family}_INSTRUCTION`]);
  }
  assert.deepEqual(tasks.BREAKDOWN_TASK.buildInput({ title: 't', blocker: 'unrecognized' }), { title: 't', description: null, clarification: null, blocker: null });
});

test('clarify conditional memory disclosure preserves absent versus provided keys', () => {
  const absent = tasks.CLARIFY_TASK.buildInput({ memories: [], activityDigest: null });
  assert.deepEqual(Object.keys(absent), ['transcript', 'turnIndex', 'maxTurns']);
  const payload = { memories: [{ id: 'private-id', kind: 'preference', subject: ' topic ', body: ' fact ', confidence: 99 }], activityDigest: {} };
  const value = tasks.CLARIFY_TASK.buildInput(payload);
  assert.deepEqual(Object.keys(value), ['transcript', 'turnIndex', 'maxTurns', 'memories', 'activityDigest']);
  assert.deepEqual(tasks.describeClarifyFields(payload), Object.keys(value));
  assert.equal(Object.isFrozen(tasks.describeClarifyFields(payload)), true);
  assert.deepEqual(value.memories, [{ kind: 'preference', subject: 'topic', body: 'fact' }]);
  assert.deepEqual(value.activityDigest, { days: 7, focusMinutes: 0, sessionCount: 0, completedTaskCount: 0, abandonedSessionCount: 0, streakDays: 0, topTasks: [] });
});

test('clarify bounds transcript memory and digest without changing the turn budget', () => {
  const value = tasks.CLARIFY_TASK.buildInput({ turnIndex: 99,
    transcript: Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'unknown', content: `${i} ` + 'x'.repeat(2100) })),
    memories: Array.from({ length: 10 }, () => ({ kind: 'x'.repeat(50), subject: 's'.repeat(210), body: 'b'.repeat(510) })),
    activityDigest: { days: 99, focusMinutes: '1.7', topTasks: Array(8).fill('t'.repeat(110)) } });
  assert.equal(value.maxTurns, 6); assert.equal(value.turnIndex, 6);
  assert.equal(value.transcript.length, 12); assert.equal(value.transcript[0].role, 'user');
  assert.equal(value.transcript[0].content.startsWith('2 '), true); assert.equal(value.transcript[0].content.length, 2000);
  assert.equal(value.memories.length, 8); assert.equal(value.memories[0].kind.length, 40);
  assert.equal(value.memories[0].subject.length, 200); assert.equal(value.memories[0].body.length, 500);
  assert.equal(value.activityDigest.days, 30); assert.equal(value.activityDigest.focusMinutes, 2);
  assert.equal(value.activityDigest.topTasks.length, 5); assert.equal(value.activityDigest.topTasks[0].length, 100);
});

test('clarify flat wire repairs to internal variants and rejects final-turn questioning', () => {
  const needMore = tasks.CLARIFY_TASK.repair({ status: 'need-more', question: '哪个文件？', missing: null, proposal: null });
  assert.deepEqual(needMore, { status: 'need-more', question: '哪个文件？', missing: [] });
  assert.equal(tasks.CLARIFY_TASK.validate(needMore, { turnIndex: 4 }).status, 'need-more');
  assert.throws(() => tasks.CLARIFY_TASK.validate(needMore, { turnIndex: 5 }), /clarify must return ready at the turn limit/);
  const ready = tasks.CLARIFY_TASK.repair({ status: 'ready', question: null, missing: null, proposal: {
    title: '任务', steps: steps(), estimateMinutes: '25', energy: ' LOW ', notes: undefined
  } });
  assert.equal(tasks.CLARIFY_TASK.validate(ready, { turnIndex: 5 }).proposal.estimateMinutes, 25);
  assert.equal(ready.proposal.energy, 'low'); assert.equal(ready.proposal.notes, null);
});

test('breakdown repair retains step dependency normalization and unknown-field pruning', () => {
  const raw = { steps: steps().map((step, i) => ({ ...step, dependsOn: i ? String(i) : null, extra: true })), extra: true };
  const repaired = tasks.BREAKDOWN_TASK.repair('```json\n' + JSON.stringify(raw) + '\n```');
  assert.deepEqual(repaired, { steps: steps(), clarifyingQuestion: null });
  assert.deepEqual(tasks.BREAKDOWN_TASK.validate(repaired), repaired);
});

test('enrich repair retains coercion and allowed tag vocabulary', () => {
  const payload = { existingTags: [' 工作 ', '工作'] };
  const repaired = tasks.ENRICH_TASK.repair({ steps: steps(), energy: ' LOW ', estimateMinutes: '25', tags: ['工作', 'new', '工作'] }, payload);
  assert.deepEqual(repaired, { steps: steps(), completionCriteria: null, energy: 'low', estimateMinutes: 25, tags: ['工作'] });
  assert.deepEqual(tasks.ENRICH_TASK.validate(repaired, payload), repaired);
});

test('unstick preserves truncation and excludes unsupported energy data', () => {
  const value = tasks.UNSTICK_TASK.buildInput({ title: 't', steps: [{ title: ' step ', done: 1, extra: true }], note: ' n ', taskEnergyDemand: 'high', energy: 99 });
  assert.deepEqual(value, { title: 't', steps: [{ title: 'step', done: true }], note: 'n', taskEnergyDemand: 'high' });
  const validated = tasks.UNSTICK_TASK.validate({ nextAction: 'x'.repeat(80), why: 'y'.repeat(100), fallbackAction: '', splitSteps: Array(5).fill('s'.repeat(90)) });
  assert.equal(validated.nextAction.length, 60); assert.equal(validated.why.length, 80);
  assert.equal(validated.splitSteps.length, 3); assert.equal(validated.splitSteps[0].length, 60);
});

test('impulse energy retains closed input and direction/delta consistency', () => {
  assert.deepEqual(tasks.IMPULSE_ENERGY_TASK.buildInput({ impulseText: 'x'.repeat(501), privateExtra: 'secret' }), { impulseText: 'x'.repeat(500) });
  const repaired = tasks.IMPULSE_ENERGY_TASK.repair({ direction: ' UP ', delta: '2', confidence: '80', reason: '明确报告', extra: true });
  assert.deepEqual(tasks.IMPULSE_ENERGY_TASK.validate(repaired), { direction: 'up', delta: 2, confidence: 80, reason: '明确报告' });
  assert.throws(() => tasks.IMPULSE_ENERGY_TASK.validate({ ...repaired, direction: 'neutral' }), /direction and delta disagree/);
});

test('capture triage retains category-specific nulling and required state level', () => {
  const note = tasks.CAPTURE_TRIAGE_TASK.validate({ category: 'note', confidence: 50, title: 'unused', routineKind: 'meal', level: 80, reason: '记录' });
  assert.deepEqual(note, { category: 'note', confidence: 50, title: null, routineKind: null, level: null, reason: '记录' });
  const repaired = tasks.CAPTURE_TRIAGE_TASK.repair({ category: ' STATE ', confidence: '90', routineKind: null, level: '65', reason: '明确状态' });
  assert.equal(tasks.CAPTURE_TRIAGE_TASK.validate(repaired).level, 65);
  assert.throws(() => tasks.CAPTURE_TRIAGE_TASK.validate({ ...repaired, level: 60 }), /level is required/);
});
