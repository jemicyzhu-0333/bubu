'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOLVE_FOCUS_LANDING_WRITES,
  createResolveFocusLandingWorkflow,
  createUnitOfWork
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const RESOLVED_AT = Date.parse('2026-09-08T12:00:00Z');
const PROMPT = Object.freeze({
  sessionId: 'focus-1',
  taskId: 'task-1',
  completedAt: RESOLVED_AT - 1_000,
  status: 'pending'
});

function activeState(task = {}) {
  const canonical = normalizePersistedState({}, { now: RESOLVED_AT });
  return normalizePersistedState({
    ...canonical,
    tasks: [{ id: 'task-1', title: '继续任务', createdAt: 1, ...task }],
    focusLandingPrompt: PROMPT
  }, { now: RESOLVED_AT });
}

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createWorkflow(repository, overrides = {}) {
  let sequence = 0;
  return createResolveFocusLandingWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => RESOLVED_AT },
    idFactory: prefix => `${prefix}-landing-${++sequence}`,
    ...overrides
  });
}

test('saving a landing note updates work and consumes the prompt in one commit', () => {
  const events = [];
  const repository = createRepository(activeState(), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({
    sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '重新打开方案文档'
  });

  assert.deepEqual(result, { ok: true, action: 'save' });
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.focusLandingPrompt, null);
  assert.equal(persisted.state.tasks[0].nextAction, '重新打开方案文档');
  assert.equal(persisted.state.tasks[0].lastCheckpoint, '重新打开方案文档');
  assert.equal(persisted.state.tasks[0].lastCheckpointAt, RESOLVED_AT);
  assert.deepEqual(persisted.state.tasks[0].steps.map(step => step.id), ['step-landing-1']);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(events[1][1], {
    type: 'focus-landing-resolved',
    sessionId: 'focus-1',
    taskId: 'task-1',
    action: 'save',
    resolvedAt: RESOLVED_AT,
    revision: 1,
    reward: { recorded: true, awardedReward: 10, advanceGranted: false, firstAdvance: false, closeGranted: true, leveledUp: false, level: 1, xp: 10 },
    bond: { stage: 'new', stageChanged: false, bondPoints: 1, granted: 1, role: 'dango' },
    ticketsGranted: false,
    newlyUnlockedSkins: []
  });
  assert.deepEqual(RESOLVE_FOCUS_LANDING_WRITES, [
    'tasks', 'focusLandingPrompt', 'xp', 'level', 'rewardLedger', 'pet', 'companion', 'unlockedSkins'
  ]);
});

test('skipping consumes only the execution prompt and never allocates a step', () => {
  const initial = activeState({
    steps: [{ id: 'step-stable', title: '已有落点', done: false }]
  });
  const repository = createRepository(initial);
  const result = createWorkflow(repository, {
    idFactory: () => { throw new Error('skip must not allocate an ID'); }
  }).execute({ sessionId: 'focus-1', progressMade: false, action: 'skip', landingNote: null });

  assert.deepEqual(result, { ok: true, action: 'skip' });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.focusLandingPrompt, null);
  assert.deepEqual(repository.inspect().state.tasks, initial.tasks);
});

test('invalid prompts and unwritable targets preserve the pending handoff with zero writes', () => {
  const completed = activeState();
  completed.tasks[0].done = true;
  completed.tasks[0].completedAt = RESOLVED_AT - 1;
  const skipped = activeState();
  skipped.tasks[0].skippedAt = RESOLVED_AT - 1;
  const missing = activeState();
  missing.tasks = [];
  const full = activeState({
    steps: Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`, title: `步骤 ${index}`, done: true, completedAt: index + 2
    }))
  });
  const cases = [
    ['mismatch', activeState(), { sessionId: 'other', progressMade: false, action: 'skip' }, 'no-matching-focus-landing'],
    ['invalid action', activeState(), { sessionId: 'focus-1', progressMade: false, action: 'discard' }, 'invalid-action'],
    ['completed', completed, { sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '不应保存' }, 'task-completed'],
    ['skipped', skipped, { sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '不应保存' }, 'occurrence-skipped'],
    ['missing', missing, { sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '不应保存' }, 'task-not-found'],
    ['full', full, { sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '第 101 步' }, 'step-limit-reached']
  ];

  for (const [name, initial, input, reason] of cases) {
    const events = [];
    const repository = createRepository(initial, events);
    const result = createWorkflow(repository, {
      publish: fact => events.push(['publish', fact])
    }).execute(input);

    assert.deepEqual(result, { ok: false, reason }, name);
    assert.equal(repository.inspect().commits, 0, name);
    assert.deepEqual(repository.inspect().state, initial, name);
    assert.deepEqual(events, [], name);
  }
});

test('a stale landing decision cannot consume the prompt or add another step', () => {
  const repository = createRepository(activeState());
  const workflow = createWorkflow(repository);

  assert.equal(workflow.execute({
    sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '第一版', expectedRevision: 0
  }).ok, true);
  const committed = repository.inspect().state;

  assert.deepEqual(workflow.execute({
    sessionId: 'focus-1', progressMade: false, action: 'save', landingNote: '过期重试', expectedRevision: 0
  }), { ok: false, reason: 'state-revision-conflict' });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(repository.inspect().state, committed);
});

test('post-commit projection failure does not change a successful landing response', () => {
  const repository = createRepository(activeState());
  const reported = [];
  const workflow = createWorkflow(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({
    sessionId: 'focus-1', progressMade: false, action: 'skip', landingNote: null
  }), { ok: true, action: 'skip' });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'focus-landing-resolved']]);
});

test('missing or malformed progress choice never consumes a landing or allocates growth', () => {
  const initial = activeState();
  const repository = createRepository(initial);
  const workflow = createWorkflow(repository);
  for (const progressMade of [undefined, null, 'yes', 1]) {
    assert.equal(workflow.execute({ sessionId: 'focus-1', action: 'skip', progressMade }).reason, 'invalid-progress-choice');
  }
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
});
