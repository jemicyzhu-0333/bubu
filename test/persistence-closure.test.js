'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePersistedState, LIMITS } = require('../src/platform/persistence/persisted-schema');
const {
  createClarifyWorkItemWorkflow,
  createResolveImpulseWorkflow,
  createWorkItemDraft,
  createResolveFocusLandingWorkflow,
  createUnitOfWork,
  createUpdateWorkItemWorkflow
} = require('../src/application');
const execution = require('../src/capabilities/execution');
const work = require('../src/capabilities/work');

class FixedDate extends Date {
  static now() { return 1_000; }
}

function canonicalState(raw = {}) {
  return normalizePersistedState(raw, { now: 500 });
}

function assertCanonical(state, message) {
  // Persistence crosses a JSON boundary; it also removes VM-realm prototypes
  // introduced by the extracted production-function harness below.
  const serialized = JSON.parse(JSON.stringify(state));
  assert.deepEqual(normalizePersistedState(serialized, { now: 5_000 }), serialized, message);
}

let generatedIds = 0;

function creationPorts() {
  return {
    idFactory: (prefix = 'task') => `${prefix}-${++generatedIds}`,
    inferEnergy: () => 'medium',
    suggestDuration: () => 25
  };
}

function createTaskDraft(state, task, options = {}) {
  return createWorkItemDraft(state, {
    task,
    createdAt: FixedDate.now(),
    breakdown: options.breakdown === true,
    selectAsNow: options.selectAsNow !== false
  }, creationPorts());
}

function canonicalRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      state = normalizePersistedState(candidate, context);
      revision += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => structuredClone(state)
  };
}

test('the shared work-creation transition emits a canonical task', () => {
  const state = canonicalState();
  const { ok, task } = createTaskDraft(state, {
    title: '写方案', energy: 'auto',
    steps: [{ title: '打开文档' }]
  }, { breakdown: true });

  assert.equal(ok, true);
  assert.equal(task.lastSelectedAt, null);
  assert.equal(task.lastStartedAt, null);
  assert.equal(task.lastAvoidedAt, null);
  assert.equal(task.blocker, null);
  assert.equal(task.lastCheckpoint, null);
  assert.equal(task.lastCheckpointAt, null);
  assert.equal(task.archivedAt, null);
  assert.equal(task.archiveReason, null);
  // A captured task carries no date it was not given: the four planning fields
  // answer four different questions and none of them has a default.
  assert.deepEqual(
    [task.plannedFor, task.scheduledFor, task.deadline, task.expiresAt],
    [null, null, null, null]
  );
  assertCanonical(state, 'new task state must not acquire missing fields on the next launch');
});

test('a new recurring task writes its series and first occurrence as one canonical snapshot', () => {
  const state = canonicalState();
  const { ok, task, series } = createTaskDraft(state, {
    title: '每周一三写一行',
    energy: 'auto',
    plannedFor: '2026-09-01',
    scheduledFor: '2026-09-02T01:00:00.000Z',
    deadline: '2026-09-02T12:00:00.000Z',
    expiresAt: '2026-09-03T12:00:00.000Z',
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3], strategy: 'fixed' },
    steps: [{ title: '打开文档' }]
  });

  assert.equal(ok, true);
  assert.equal(series.state, 'active');
  // 2026-09-01 is a Tuesday, so the first round opens on the Wednesday rather
  // than making the user wait a week for a rule they set up today.
  assert.equal(task.occurrenceDate, '2026-09-02');
  assert.equal(task.plannedFor, '2026-09-02');
  assert.equal(task.scheduledFor, '2026-09-02T01:00:00.000Z');
  assert.equal(task.deadline, '2026-09-02T12:00:00.000Z');
  assert.equal(task.expiresAt, '2026-09-03T12:00:00.000Z');
  assert.equal(series.openTaskId, task.id);
  assert.equal(series.lastOccurrenceDate, task.occurrenceDate);
  assert.deepEqual(series.template.stepTitles, ['打开文档']);
  assertCanonical(state, 'a series and its occurrence must satisfy the persisted invariants immediately');
});

test('new or updated expired tasks cannot survive as the persisted Now task', () => {
  const expiredAt = new Date(900).toISOString();
  const createdState = canonicalState();
  createTaskDraft(createdState, {
    title: '已过期任务', energy: 'auto', expiresAt: expiredAt, steps: []
  });
  assert.equal(createdState.nowTaskId, null);
  assertCanonical(createdState, 'an already expired task must be canonical without becoming Now');

  let persisted = canonicalState({
    tasks: [{
      id: 'task-1', title: '当前任务', createdAt: 100,
      expiresAt: new Date(5_000).toISOString()
    }],
    nowTaskId: 'task-1'
  });
  let revision = 0;
  let commits = 0;
  const repository = {
    snapshot: () => structuredClone(persisted),
    commit: (candidate, context) => {
      persisted = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(persisted);
    },
    revision: () => revision
  };
  const workflow = createUpdateWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => FixedDate.now() },
    idFactory: (prefix = 'task') => `${prefix}-${++generatedIds}`,
    inferEnergy: () => 'medium',
    suggestDuration: () => 25,
    publish: () => {}
  });
  const updated = workflow.execute({
    taskId: 'task-1', patch: { expiresAt: expiredAt }
  });
  assert.equal(updated.ok, true);
  assert.equal(commits, 1);
  assert.equal(persisted.nowTaskId, null);
  assertCanonical(persisted, 'an update that expires Now must clear the stale Now identity atomically');
});

test('the someday impulse outcome reuses canonical task creation before archiving', () => {
  const repository = canonicalRepository(canonicalState({
    impulses: [{ id: 'impulse-1', text: '以后学习新工具', createdAt: 100 }]
  }));
  const workflow = createResolveImpulseWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => FixedDate.now() },
    ...creationPorts(),
    suggestNextStep: title => ({ title: `打开：${title}` }),
    nextWorkStart: () => 3_600_000
  });

  const result = workflow.execute({ impulseId: 'impulse-1', action: 'someday' });
  const persisted = repository.inspect();
  assert.equal(result.ok, true);
  assert.equal(persisted.tasks.length, 0);
  assert.equal(persisted.impulses.filter(item => !item.resolution).length, 0);
  assert.equal(persisted.impulses[0].resolution.action, 'someday');
  assert.equal(persisted.archivedTasks.length, 1);
  assert.equal(persisted.archivedTasks[0].archiveReason, 'someday');
  assert.equal(persisted.archivedTasks[0].expiresAt, null);
  assertCanonical(persisted, 'someday archive must already have the complete canonical task shape');
});

test('new impulse records are canonical at their first write', () => {
  const repository = canonicalRepository(canonicalState());
  const command = work.captureImpulse.createCaptureImpulseCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => FixedDate.now() },
    idFactory: () => 'impulse-1'
  });

  assert.deepEqual(command.execute({ text: '突然想到的事' }), { ok: true });
  const persisted = repository.inspect();
  assert.equal(persisted.impulses.length, 1);
  assert.equal(persisted.impulses[0].text, '突然想到的事');
  assertCanonical(persisted, 'a newly captured impulse must round-trip without repair');
});

test('new quick-start decisions and focus landing prompts are canonical at creation', () => {
  const persisted = canonicalState({
    tasks: [{ id: 'task-1', title: '继续任务', done: false, createdAt: 100 }]
  });
  execution.sessionSettlement.recordCompletionHandoff(persisted, {
    completed: true,
    kind: 'quick-start',
    sessionId: 'quick-1',
    taskId: 'task-1',
    endedAt: 1_000,
    elapsedMs: 120_000
  });
  assert.deepEqual({ ...persisted.quickStartDecision }, {
    sessionId: 'quick-1', taskId: 'task-1', completedAt: 1_000,
    elapsedMs: 120_000, status: 'pending', resolvedAt: null
  });
  assertCanonical(persisted, 'pending quick-start decision must not gain resolvedAt on restart');

  execution.sessionSettlement.recordCompletionHandoff(persisted, {
    completed: true,
    kind: 'focus',
    sessionId: 'focus-1',
    taskId: 'task-1',
    endedAt: 1_000
  }, {
    landingTaskAvailable: true
  });
  assert.deepEqual({ ...persisted.focusLandingPrompt }, {
    sessionId: 'focus-1', taskId: 'task-1', completedAt: 1_000, status: 'pending'
  });
  assertCanonical(persisted, 'a newly created focus landing prompt must round-trip unchanged');
});

test('landing notes append only canonical steps and refuse terminal or full tasks without mutation', () => {
  let nextId = 0;
  const ports = { createId: prefix => `${prefix}-${++nextId}` };
  const applyLandingNoteToState = (state, taskId, landingNote) => work.taskClarification
    .applyLandingNote(state, { taskId, landingNote, now: 1_000 }, ports);

  const active = canonicalState({
    tasks: [{ id: 'task-1', title: '继续任务', done: false, createdAt: 100 }]
  });
  assert.equal(applyLandingNoteToState(active, 'task-1', '打开文件').ok, true);
  assert.deepEqual(active.tasks[0].steps[0], {
    id: 'step-1', title: '打开文件', done: false, completedAt: null, completionCycle: 0
  });
  assertCanonical(active, 'a landing note must be safe to persist before the next launch');

  const full = canonicalState({
    tasks: [{
      id: 'task-full', title: '已经有很多步骤', done: false, createdAt: 100,
      steps: Array.from({ length: LIMITS.STEPS }, (_, index) => ({
        id: `existing-${index}`, title: `步骤 ${index}`, done: true, completedAt: 200 + index
      }))
    }]
  });
  const fullBefore = JSON.parse(JSON.stringify(full));
  assert.equal(
    applyLandingNoteToState(full, 'task-full', '不能再插入').reason,
    'step-limit-reached'
  );
  assert.deepEqual(full, fullBefore, 'hitting the step limit must be a zero-write refusal');

  const skipped = {
    tasks: [{ id: 'occ-skipped', done: false, skippedAt: 500, steps: [] }]
  };
  const skippedBefore = JSON.parse(JSON.stringify(skipped));
  assert.equal(
    applyLandingNoteToState(skipped, 'occ-skipped', '不应写入').reason,
    'occurrence-skipped'
  );
  assert.deepEqual(skipped, skippedBefore);
});

test('clarifying Now preserves terminal states, enforces the step cap, and commits canonical data', () => {
  let persisted = canonicalState({
    tasks: [{ id: 'task-1', title: '写方案', done: false, createdAt: 100 }]
  });
  let revision = 0;
  let commits = 0;
  let nextId = 0;
  const repository = {
    snapshot: () => structuredClone(persisted),
    commit: (candidate, context) => {
      persisted = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(persisted);
    },
    revision: () => revision
  };
  const workflow = createClarifyWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => FixedDate.now() },
    idFactory: prefix => `${prefix}-${++nextId}`,
    suggestNextAction: () => '默认下一步'
  });

  const clarified = workflow.execute({
    taskId: 'task-1', blocker: '入口太多', nextAction: '先写标题'
  });
  assert.equal(clarified.ok, true);
  assert.equal(persisted.tasks[0].steps[0].completedAt, null);
  assert.equal(persisted.tasks[0].updatedAt, 1_000);
  assertCanonical(persisted, 'clarifying Now must commit a canonical snapshot');

  persisted = canonicalState({
    tasks: [{ id: 'task-done', title: '已完成', done: true, completedAt: 800, createdAt: 100 }]
  });
  const commitsBeforeTerminal = commits;
  assert.equal(workflow.execute({
    taskId: 'task-done', blocker: '无', nextAction: '不应写入'
  }).reason, 'task-completed');
  assert.equal(commits, commitsBeforeTerminal);

  persisted = {
    tasks: [{ id: 'occ-skipped', title: '已跳过', done: false, skippedAt: 800, steps: [] }]
  };
  assert.equal(workflow.execute({
    taskId: 'occ-skipped', blocker: '无', nextAction: '不应写入'
  }).reason, 'occurrence-skipped');
  assert.equal(commits, commitsBeforeTerminal);

  persisted = canonicalState({
    tasks: [{
      id: 'task-full', title: '步骤已满', done: false, createdAt: 100,
      steps: Array.from({ length: LIMITS.STEPS }, (_, index) => ({
        id: `step-${index}`, title: `步骤 ${index}`, done: true, completedAt: 200 + index
      }))
    }]
  });
  const fullBefore = JSON.parse(JSON.stringify(persisted));
  assert.equal(workflow.execute({
    taskId: 'task-full', blocker: '太多', nextAction: '第 101 步'
  }).reason, 'step-limit-reached');
  assert.equal(commits, commitsBeforeTerminal);
  assert.deepEqual(persisted, fullBefore, 'a rejected clarify request must not partially persist blocker/nextAction');
});

test('resolving a focus landing prompt persists null and a second resolve is a no-op', () => {
  let persisted = canonicalState({
    tasks: [{ id: 'task-1', title: '继续任务', done: false, createdAt: 100 }],
    focusLandingPrompt: {
      sessionId: 'focus-1', taskId: 'task-1', completedAt: 900, status: 'pending'
    }
  });
  let revision = 0;
  let commits = 0;
  const dirtyEvents = [];
  const repository = {
    snapshot: () => structuredClone(persisted),
    commit: (candidate, context) => {
      persisted = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(persisted);
    },
    revision: () => revision
  };
  const workflow = createResolveFocusLandingWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 1_000 },
    idFactory: () => { throw new Error('skip must not allocate a landing step'); },
    publish: fact => dirtyEvents.push(fact)
  });

  assert.deepEqual(workflow.execute({
    sessionId: 'focus-1', action: 'skip', progressMade: false, landingNote: null
  }), { ok: true, action: 'skip' });
  assert.equal(persisted.focusLandingPrompt, null);
  assert.equal(commits, 1);
  assert.equal(dirtyEvents.length, 1);
  assertCanonical(persisted, 'resolved prompts must persist as canonical null');

  assert.deepEqual(workflow.execute({
    sessionId: 'focus-1', action: 'skip', progressMade: false, landingNote: null
  }), { ok: false, reason: 'no-matching-focus-landing' });
  assert.equal(commits, 1);
});
