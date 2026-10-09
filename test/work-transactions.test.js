'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createArchiveWorkItemWorkflow,
  createCompleteWorkItemWorkflow,
  createCompleteWorkStepWorkflow,
  createSkipWorkOccurrenceWorkflow,
  createUnitOfWork,
  createUpdateWorkItemWorkflow
} = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { stepBudgetSpent, stepBudgetKey } = require('../src/core/reward-ledger');
const { lifetimeXp } = require('../src/content/growth-policy.mjs');
const totalXp = state => lifetimeXp(state.level, state.xp);

const { taskWriteBlockReason } = work.taskState;

const NOW = Date.parse('2026-08-29T04:00:00Z');
const TODAY = '2026-08-29';

let idCounter = 0;
const createId = (prefix = 'gen') => `${prefix}-${++idCounter}`;

// Fixtures go through normalization twice on purpose. The first pass produces a
// canonical snapshot; the second one carries the current schema version, so the
// overrides take the strict path instead of the legacy task-model migration.
function stateWith(overrides = {}) {
  const base = normalizePersistedState({ lastResetDate: TODAY }, { now: NOW });
  return normalizePersistedState({ ...base, ...overrides }, { now: NOW });
}

function oneOffTask(extra = {}) {
  return {
    id: 'task-1',
    title: '写一行',
    createdAt: NOW - 1000,
    steps: [
      { id: 'step-1', title: '打开文件' },
      { id: 'step-2', title: '写第一句' }
    ],
    ...extra
  };
}

function seriesState({ strategy = 'fixed', frequency = 'daily', interval = 1, weekdays = null } = {}) {
  return stateWith({
    tasks: [{
      id: 'occ-1',
      title: '每天写一行',
      createdAt: NOW - 1000,
      plannedFor: TODAY,
      seriesId: 'series-1',
      occurrenceDate: TODAY,
      steps: [{ id: 'occ-1-step-1', title: '打开文件' }]
    }],
    recurrenceSeries: [{
      id: 'series-1',
      createdAt: NOW - 1000,
      state: 'active',
      rule: { frequency, interval, weekdays, strategy, anchorDate: TODAY },
      template: { title: '每天写一行', stepTitles: ['打开文件'], energy: 'medium', energyAuto: true },
      openTaskId: 'occ-1',
      lastOccurrenceDate: TODAY
    }]
  });
}

/**
 * Drive the work transactions through the same commit path the app uses: one
 * unit of work over a repository that normalizes every candidate snapshot. A
 * refusal is therefore provable rather than described — it leaves the commit
 * counter alone instead of merely returning an untouched clone.
 */
function createWorkRuntime(initial) {
  let persisted = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  let clockAt = NOW;
  const facts = [];
  const candidates = [];
  const repository = {
    snapshot: () => structuredClone(persisted),
    commit: (candidate, context) => {
      // Keep the draft as the transaction handed it over. The store normalizes
      // on the way in, so only this copy can show whether a transaction commits
      // a canonical snapshot or one that gets quietly repaired.
      candidates.push(structuredClone(candidate));
      persisted = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(persisted);
    },
    revision: () => revision
  };
  const ports = {
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => clockAt },
    idFactory: createId,
    publish: fact => facts.push(fact)
  };
  const commands = {
    archiveTask: createArchiveWorkItemWorkflow(ports),
    completeStep: createCompleteWorkStepWorkflow(ports),
    completeTask: createCompleteWorkItemWorkflow({ ...ports, random: () => 0.99 }),
    duplicateTask: work.duplicateWorkItem.createDuplicateWorkItemCommand(ports),
    skipOccurrence: createSkipWorkOccurrenceWorkflow(ports),
    updateSeries: work.updateRecurrenceSeries.createUpdateRecurrenceSeriesCommand(ports),
    updateTask: createUpdateWorkItemWorkflow({
      ...ports, inferEnergy: () => 'medium', suggestDuration: () => 25
    })
  };
  const runtime = {
    facts,
    commits: () => commits,
    state: () => structuredClone(persisted),
    committed: () => structuredClone(candidates.at(-1)),
    task: taskId => structuredClone(persisted.tasks.find(task => task.id === taskId)),
    series: (seriesId = 'series-1') =>
      structuredClone(persisted.recurrenceSeries.find(series => series.id === seriesId))
  };
  // The clock stays where a caller last set it, so a test only names `at` when
  // the passage of time is part of what it is checking.
  for (const [name, command] of Object.entries(commands)) {
    runtime[name] = ({ at = clockAt, ...input } = {}) => {
      clockAt = at;
      return command.execute(input);
    };
  }
  return runtime;
}

test('completing a task settles domain state and reward in one snapshot', () => {
  const fixture = stateWith({
    tasks: [oneOffTask()],
    nowTaskId: 'task-1',
    focusLandingPrompt: { sessionId: 'focus-1', taskId: 'task-1', completedAt: NOW - 10, status: 'pending' }
  });
  const runtime = createWorkRuntime(fixture);

  const result = runtime.completeTask({ taskId: 'task-1', confirmUnfinishedSteps: true });
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(runtime.commits(), 1, 'domain state and reward settle in a single commit');

  const state = runtime.state();
  assert.equal(state.tasks[0].done, true);
  assert.equal(state.tasks[0].completedAt, NOW);
  assert.equal(state.nowTaskId, null);
  assert.deepEqual(state.focusLandingPrompt, fixture.focusLandingPrompt);
  assert.equal(totalXp(state), 30);
  assert.equal(state.stats.totalTasksDone, 1);
  assert.equal(state.stats.dailyCompletions[TODAY], 1);
  assert.equal(state.lastCompletedDate, TODAY);
  // The caller keeps its own snapshot: a commit must not leak into it.
  assert.equal(fixture.tasks[0].done, false);
});

test('completion is irreversible: a finished task refuses every further write', () => {
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask({ steps: [] })] }));
  assert.equal(runtime.completeTask({ taskId: 'task-1' }).ok, true);
  assert.equal(taskWriteBlockReason(runtime.task('task-1')), 'task-completed');

  assert.equal(runtime.completeTask({ taskId: 'task-1', at: NOW + 1 }).reason, 'task-completed');
  assert.equal(
    runtime.updateTask({ taskId: 'task-1', patch: { title: '改个名' }, at: NOW + 1 }).reason,
    'task-completed'
  );
  assert.equal(
    runtime.completeStep({ taskId: 'task-1', stepId: 'step-1', at: NOW + 1 }).reason,
    'task-completed'
  );
  // Paying twice is impossible even if a retry somehow reached the ledger.
  assert.equal(runtime.commits(), 1, 'every refused write leaves the commit counter alone');
  assert.equal(totalXp(runtime.state()), 30);
});

test('finishing a task with unfinished steps needs an explicit confirmation', () => {
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask()] }));
  const refused = runtime.completeTask({ taskId: 'task-1' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'unfinished-steps-need-confirmation');
  assert.equal(refused.unfinishedCount, 2);
  assert.equal(runtime.commits(), 0);
  assert.equal(runtime.task('task-1').done, false);

  const confirmed = runtime.completeTask({ taskId: 'task-1', confirmUnfinishedSteps: true });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(runtime.task('task-1').steps.map(step => step.done), [false, false],
    'confirming does not silently mark the skipped checkpoints as done');
});

test('step completion is one-way and advances the visible next action', () => {
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask()] }));
  const first = runtime.completeStep({ taskId: 'task-1', stepId: 'step-1' });
  assert.equal(first.ok, true);
  assert.equal(first.awarded, 30);
  assert.equal(runtime.task('task-1').steps[0].done, true);
  assert.equal(totalXp(runtime.state()), 30);
  assert.equal(runtime.task('task-1').nextAction, '写第一句');

  const again = runtime.completeStep({ taskId: 'task-1', stepId: 'step-1', at: NOW + 1000 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'step-completed');
  assert.equal(runtime.commits(), 1);
  assert.equal(totalXp(runtime.state()), 30);

  runtime.completeStep({ taskId: 'task-1', stepId: 'step-2', at: NOW + 2000 });
  assert.equal(runtime.task('task-1').nextAction, null);
});

test('one task earns only one daily unit regardless of checkpoint count', () => {
  // Splitting work finer is a planning aid, never extra daily growth units.
  const stepCount = 8;
  const steps = Array.from({ length: stepCount }, (_, index) => ({
    id: `step-${index + 1}`, title: `第 ${index + 1} 步`
  }));
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask({ steps })] }));

  const awards = [];
  let last = null;
  for (const step of steps) {
    last = runtime.completeStep({ taskId: 'task-1', stepId: step.id });
    assert.equal(last.ok, true, `${step.id} must still be recorded once the budget is gone`);
    awards.push(last.awarded);
  }

  const state = runtime.state();
  assert.equal(totalXp(state), 30);
  assert.equal(awards.reduce((total, award) => total + award, 0), 30);
  assert.equal(awards.at(-1), 0, 'the overflow checkpoint is recorded with a zero payout');
  assert.equal(last.advanceGranted, false);
  assert.deepEqual(state.tasks[0].steps.map(step => step.done), steps.map(() => true));
});

test('a fresh next-day step earns a daily unit despite the prior task day', () => {
  const nextDay = Date.parse('2026-08-30T04:00:00Z');
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask({ steps: [
    { id: 'step-1', title: '一' }, { id: 'step-2', title: '二' },
    { id: 'step-3', title: '三' }, { id: 'step-4', title: '四' },
    { id: 'step-5', title: '五' }, { id: 'step-6', title: '六' }
  ] })] }));

  for (const stepId of ['step-1', 'step-2', 'step-3', 'step-4', 'step-5']) {
    runtime.completeStep({ taskId: 'task-1', stepId });
  }
  assert.equal(totalXp(runtime.state()), 30);

  const across = runtime.completeStep({ taskId: 'task-1', stepId: 'step-6', at: nextDay });
  assert.equal(across.ok, true);
  assert.equal(across.awarded, 30, 'a distinct next-day step is a real daily advance');
  assert.equal(across.advanceGranted, true);
  assert.equal(totalXp(runtime.state()), 60);
});

test('completing an occurrence generates exactly one successor and keeps its history', () => {
  const runtime = createWorkRuntime(seriesState());
  const result = runtime.completeTask({ taskId: 'occ-1', confirmUnfinishedSteps: true });

  assert.equal(result.ok, true);
  assert.equal(result.nextOccurrenceDate, '2026-08-30');
  assert.equal(runtime.commits(), 1);
  const state = runtime.state();
  assert.equal(state.tasks.filter(task => task.seriesId === 'series-1' && !task.done).length, 1);

  const series = runtime.series();
  assert.equal(series.lastOccurrenceDate, '2026-08-30');

  const successor = runtime.task(series.openTaskId);
  assert.equal(successor.occurrenceDate, '2026-08-30');
  assert.equal(successor.done, false);
  assert.equal(successor.focusedMs, 0);
  assert.equal(successor.completionCycle, 0);
  assert.notEqual(successor.steps[0].id, 'occ-1-step-1',
    'a successor gets brand new step identities so it earns its own rewards');
  // Yesterday's finished round stays exactly as it was.
  const finished = runtime.task('occ-1');
  assert.equal(finished.done, true);
  assert.equal(finished.occurrenceDate, TODAY);
});

test('a fresh occurrence earns its own daily unit without reviving legacy step budgets', () => {
  const runtime = createWorkRuntime(seriesState());
  const first = runtime.completeStep({ taskId: 'occ-1', stepId: 'occ-1-step-1' });
  assert.equal(first.awarded, 30);
  const closedOccurrence = runtime.task('occ-1');

  runtime.completeTask({ taskId: 'occ-1', at: NOW + 10 });
  const successor = runtime.task(runtime.series().openTaskId);
  const nextDay = Date.parse('2026-08-30T04:00:00Z');
  const second = runtime.completeStep({
    taskId: successor.id, stepId: successor.steps[0].id, at: nextDay
  });

  assert.equal(second.awarded, 30);
  const ledger = runtime.state().rewardLedger;
  assert.equal(stepBudgetSpent(ledger, stepBudgetKey(successor, '2026-08-30')), 0);
  assert.equal(
    stepBudgetSpent(ledger, stepBudgetKey(closedOccurrence, TODAY)),
    0,
    'daily growth never writes the obsolete occurrence allowance'
  );
});

test('skipping an occurrence pays nothing, counts as no day of use, and still moves on', () => {
  const runtime = createWorkRuntime(seriesState());
  const result = runtime.skipOccurrence({ taskId: 'occ-1' });

  assert.equal(result.ok, true);
  assert.equal(result.nextOccurrenceDate, '2026-08-30');
  assert.equal(runtime.task('occ-1').skippedAt, NOW);
  const state = runtime.state();
  assert.equal(state.xp, 0);
  assert.equal('streak' in state, false);
  assert.equal(state.lastCompletedDate, null);
  assert.equal(state.stats.totalTasksDone, 0);
  assert.equal(taskWriteBlockReason(runtime.task('occ-1')), 'occurrence-skipped');

  assert.equal(runtime.skipOccurrence({ taskId: 'task-1' }).reason, 'task-not-found');
  const oneOff = createWorkRuntime(stateWith({ tasks: [oneOffTask()] }));
  assert.equal(oneOff.skipOccurrence({ taskId: 'task-1' }).reason, 'task-not-recurring');
  assert.equal(oneOff.commits(), 0);
});

const refreshSeries = (draft, input) =>
  work.seriesRefresh.refreshSeriesOccurrences(draft, input, { createId });

test('missing several periods collapses into one next date and never stacks debt', () => {
  const stale = seriesState();
  stale.tasks = [];
  stale.recurrenceSeries[0].openTaskId = null;
  stale.recurrenceSeries[0].lastOccurrenceDate = '2026-08-19';

  const result = refreshSeries(stale, { now: NOW, today: TODAY });
  assert.equal(result.generatedTaskIds.length, 1);
  const series = stale.recurrenceSeries[0];
  // Catching up lands on today, not tomorrow: a returning user should find
  // today's round waiting instead of an empty day.
  assert.equal(series.lastOccurrenceDate, TODAY);
  assert.equal(series.missedCount, 9, 'skipped slots are counted, not turned into nine open tasks');
  assert.equal(stale.tasks.length, 1);
  assert.equal(stale.tasks[0].occurrenceDate, TODAY);
});

test('a still-open occurrence keeps its place across the local-day boundary', () => {
  const open = seriesState();
  const result = refreshSeries(open, { now: NOW + 86_400_000, today: '2026-08-30' });

  assert.deepEqual(result.generatedTaskIds, []);
  assert.equal(open.tasks.length, 1);
  assert.equal(open.tasks[0].id, 'occ-1');
  assert.equal(open.recurrenceSeries[0].missedCount, 0, 'coming back late is not a miss');
});

test('an after-completion series waits for the user instead of the calendar', () => {
  const relative = seriesState({ strategy: 'after-completion', frequency: 'weekly', interval: 1 });
  const untouched = refreshSeries(structuredClone(relative), { now: NOW, today: '2026-09-30' });
  assert.deepEqual(untouched.generatedTaskIds, [],
    'a relative rule never generates from the clock alone');

  const runtime = createWorkRuntime(relative);
  const completed = runtime.completeTask({ taskId: 'occ-1', confirmUnfinishedSteps: true });
  assert.equal(completed.nextOccurrenceDate, '2026-09-05');
});

test('a late completion advances an after-completion series from the actual completion day', () => {
  const runtime = createWorkRuntime(
    seriesState({ strategy: 'after-completion', frequency: 'daily', interval: 2 })
  );
  const completedAt = Date.parse('2026-09-03T12:00:00Z');

  const completed = runtime.completeTask({
    taskId: 'occ-1', confirmUnfinishedSteps: true, at: completedAt
  });

  assert.equal(completed.nextOccurrenceDate, '2026-09-05');
  assert.equal(runtime.series().missedCount, 0,
    'waiting to complete a relative occurrence is not a skipped recurrence slot');
});

test('a late skip advances an after-completion series from the actual skip day', () => {
  const runtime = createWorkRuntime(
    seriesState({ strategy: 'after-completion', frequency: 'daily', interval: 3 })
  );
  const skippedAt = Date.parse('2026-09-04T12:00:00Z');

  const skipped = runtime.skipOccurrence({ taskId: 'occ-1', at: skippedAt });

  assert.equal(skipped.nextOccurrenceDate, '2026-09-07');
  assert.equal(runtime.series().missedCount, 0,
    'closing a relative occurrence late does not create synthetic missed slots');
});

test('completing a round clears a stale missed count so it never reads as a permanent debt', () => {
  // A past gap left the series reading "漏了 5 轮". missedCount is otherwise a
  // monotonic accumulator, so without a reset the nudge would keep showing 5
  // even after the user resumes doing the round every single day. Engaging with
  // today's round means the user is caught up: the count must drop to zero.
  const stale = seriesState();
  stale.recurrenceSeries[0].missedCount = 5;
  const runtime = createWorkRuntime(stale);

  const completed = runtime.completeTask({ taskId: 'occ-1', confirmUnfinishedSteps: true });

  assert.equal(completed.ok, true);
  assert.equal(runtime.series().missedCount, 0,
    'doing the round zeroes the behind-count instead of leaving it stuck forever');
});

test('skipping a round clears a stale missed count the same way completion does', () => {
  const stale = seriesState();
  stale.recurrenceSeries[0].missedCount = 3;
  const runtime = createWorkRuntime(stale);

  const skipped = runtime.skipOccurrence({ taskId: 'occ-1' });

  assert.equal(skipped.ok, true);
  assert.equal(runtime.series().missedCount, 0,
    'a deliberate skip is engagement, not a miss: the behind-count resets');
});

test('a paused or ended series stops generating without losing its history', () => {
  for (const closedState of ['paused', 'ended']) {
    const runtime = createWorkRuntime(seriesState());
    const closed = runtime.updateSeries({ seriesId: 'series-1', seriesState: closedState });
    assert.equal(closed.ok, true);
    assert.equal(closed.series.state, closedState);
    assert.equal(closed.series.endedAt, closedState === 'ended' ? NOW : null);

    const completed = runtime.completeTask({
      taskId: 'occ-1', confirmUnfinishedSteps: true, at: NOW + 10
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.nextOccurrenceDate, null);
    assert.equal(runtime.task('occ-1').done, true);
    assert.equal(runtime.series().openTaskId, null);
  }
});

test('resuming a closed paused series materializes exactly one useful occurrence', () => {
  const paused = seriesState({ strategy: 'fixed', frequency: 'daily', interval: 1 });
  paused.recurrenceSeries[0].state = 'paused';
  paused.tasks[0].done = true;
  paused.tasks[0].completedAt = Date.parse('2026-08-30T12:00:00Z');
  paused.recurrenceSeries[0].openTaskId = null;
  paused.recurrenceSeries[0].lastOccurrenceDate = '2026-08-20';

  const runtime = createWorkRuntime(paused);
  const resumed = runtime.updateSeries({ seriesId: 'series-1', seriesState: 'active' });

  assert.equal(resumed.ok, true);
  assert.equal(resumed.nextOccurrenceDate, TODAY);
  const open = runtime.state().tasks
    .filter(task => task.seriesId === 'series-1' && !task.done && !task.skippedAt);
  assert.equal(open.length, 1);
  const series = runtime.series();
  assert.equal(series.openTaskId, open[0].id);
  assert.equal(open[0].occurrenceDate, TODAY);
  assert.equal(series.missedCount, 8);
});

test('resuming an after-completion series uses the actual close day and ended stays terminal', () => {
  const closed = seriesState({ strategy: 'after-completion', frequency: 'daily', interval: 3 });
  closed.recurrenceSeries[0].state = 'paused';
  closed.tasks[0].done = true;
  closed.tasks[0].completedAt = Date.parse('2026-08-28T12:00:00Z');
  closed.recurrenceSeries[0].openTaskId = null;

  const resumed = createWorkRuntime(closed).updateSeries({
    seriesId: 'series-1', seriesState: 'active'
  });
  assert.equal(resumed.nextOccurrenceDate, '2026-08-31',
    'a relative rule counts from the day the previous round actually closed');

  const ended = structuredClone(closed);
  ended.recurrenceSeries[0].state = 'ended';
  ended.recurrenceSeries[0].endedAt = NOW - 1;
  const terminal = createWorkRuntime(ended);
  const rejected = terminal.updateSeries({ seriesId: 'series-1', seriesState: 'active' });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'series-ended');
  assert.equal(terminal.commits(), 0);
  assert.equal(terminal.series().state, 'ended');
});

test('series edits retain their anchor and reject non-canonical domain input', () => {
  const runtime = createWorkRuntime(seriesState());
  const updated = runtime.updateSeries({
    seriesId: 'series-1',
    rule: { frequency: 'daily', interval: 2, weekdays: null, strategy: 'fixed' }
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.series.rule.anchorDate, TODAY, 'an edit re-times the grid, it does not move it');
  assert.equal(updated.series.rule.interval, 2);

  const malformed = runtime.updateSeries({ seriesId: 'series-1', rule: { anchorDate: null } });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'invalid-recurrence-rule');

  const invalidState = runtime.updateSeries({ seriesId: 'series-1', seriesState: 'deleted' });
  assert.equal(invalidState.reason, 'invalid-series-state');
  assert.equal(runtime.commits(), 1, 'only the canonical edit ever reached the store');
  assert.equal(runtime.series().rule.interval, 2);
});

test('editing a recurring occurrence separates this round from the template', () => {
  const thisRound = createWorkRuntime(seriesState());
  const current = thisRound.updateTask({
    taskId: 'occ-1', patch: { title: '今天只写标题' }, scope: 'current'
  });
  assert.equal(current.ok, true);
  assert.equal(thisRound.task('occ-1').title, '今天只写标题');
  assert.equal(thisRound.series().template.title, '每天写一行');

  const everyRound = createWorkRuntime(seriesState());
  everyRound.updateTask({
    taskId: 'occ-1', patch: { title: '改成写两行' }, scope: 'current-and-future'
  });
  assert.equal(everyRound.task('occ-1').title, '改成写两行');
  assert.equal(everyRound.series().template.title, '改成写两行');

  const unscoped = createWorkRuntime(seriesState());
  assert.equal(
    unscoped.updateTask({ taskId: 'occ-1', patch: { title: '没说范围' } }).reason,
    'recurrence-scope-required'
  );
  assert.equal(unscoped.commits(), 0);
});

test('step edits are operations on stable identities and refuse finished checkpoints', () => {
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask()] }));
  runtime.completeStep({ taskId: 'task-1', stepId: 'step-1' });

  assert.equal(runtime.updateTask({
    taskId: 'task-1', patch: { steps: [{ op: 'remove', stepId: 'step-1' }] }
  }).reason, 'step-completed');
  assert.equal(runtime.updateTask({
    taskId: 'task-1', patch: { steps: [{ op: 'rename', stepId: 'step-1', title: '改名' }] }
  }).reason, 'step-completed');

  const added = runtime.updateTask({
    taskId: 'task-1', patch: { steps: [{ op: 'add', title: '写第二句' }] }
  });
  assert.equal(added.ok, true);
  assert.equal(added.task.steps.length, 3);
  assert.equal(added.task.steps.at(-1).done, false);

  const stepIds = added.task.steps.map(step => step.id);
  const reordered = runtime.updateTask({
    taskId: 'task-1', patch: { steps: [{ op: 'reorder', stepIds: [...stepIds].reverse() }] }
  });
  assert.deepEqual(reordered.task.steps.map(step => step.id), [...stepIds].reverse());
  // A partial list would make the resulting order depend on hidden state.
  assert.equal(runtime.updateTask({
    taskId: 'task-1', patch: { steps: [{ op: 'reorder', stepIds: ['step-1'] }] }
  }).reason, 'step-order-mismatch');
  assert.equal(runtime.commits(), 3, 'each refusal left the store exactly where it was');
});

test('one edit that both adds and reorders only survives when the reorder runs first', () => {
  // Operations are applied in array order, so the position of `add` decides
  // whether the whole transaction lands. Whoever folds a form into this list has
  // to know that; this test is where they can read it off.
  const swapped = ['step-2', 'step-1'];
  const runtime = createWorkRuntime(stateWith({ tasks: [oneOffTask()] }));

  // `add` first grows the step list, so the reorder that follows is measured
  // against a list holding an id the caller could not have known. The whole
  // patch is refused — including the reorder that was fine on its own.
  const addFirst = runtime.updateTask({
    taskId: 'task-1',
    patch: { steps: [{ op: 'add', title: '再写一句' }, { op: 'reorder', stepIds: swapped }] }
  });
  assert.equal(addFirst.ok, false);
  assert.equal(addFirst.reason, 'step-order-mismatch');
  assert.deepEqual(runtime.task('task-1').steps.map(step => step.title), ['打开文件', '写第一句'],
    'a refused transaction leaves nothing behind, not even the successful half');

  // The refusal also has to unwind the plain fields patched alongside the steps,
  // or the user keeps half an edit.
  const withFields = runtime.updateTask({
    taskId: 'task-1',
    patch: {
      title: '改了标题',
      deadline: '2026-09-01T00:00:00.000Z',
      steps: [{ op: 'add', title: '再写一句' }, { op: 'reorder', stepIds: swapped }]
    }
  });
  assert.equal(withFields.ok, false);
  assert.equal(runtime.task('task-1').title, '写一行');
  assert.equal(runtime.task('task-1').deadline, null);
  assert.equal(runtime.commits(), 0);

  // Reorder first, append after: the new checkpoint lands at the end, which is
  // the only position `add` can express.
  const reorderFirst = runtime.updateTask({
    taskId: 'task-1',
    patch: { steps: [{ op: 'reorder', stepIds: swapped }, { op: 'add', title: '再写一句' }] }
  });
  assert.equal(reorderFirst.ok, true);
  assert.deepEqual(reorderFirst.task.steps.map(step => step.title),
    ['写第一句', '打开文件', '再写一句']);

  // Same for a removal: it shortens the list before the reorder measures it, so
  // the id list must already exclude the removed checkpoint.
  const removeThenReorder = createWorkRuntime(stateWith({ tasks: [oneOffTask()] })).updateTask({
    taskId: 'task-1',
    patch: { steps: [{ op: 'remove', stepId: 'step-1' }, { op: 'reorder', stepIds: ['step-2'] }] }
  });
  assert.equal(removeThenReorder.ok, true);
  assert.deepEqual(removeThenReorder.task.steps.map(step => step.id), ['step-2']);
});

test('renewing an expiry is the only way the expired marker clears', () => {
  const expired = stateWith({
    tasks: [oneOffTask({ steps: [], expiresAt: '2026-08-28T00:00:00Z', expired: true })]
  });

  const renewed = createWorkRuntime(expired).updateTask({
    taskId: 'task-1', patch: { expiresAt: '2026-09-05T00:00:00.000Z' }
  });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.task.expired, false);
  assert.equal(renewed.task.expiresAt, '2026-09-05T00:00:00.000Z');

  const cleared = createWorkRuntime(expired).updateTask({
    taskId: 'task-1', patch: { expiresAt: null }
  });
  assert.equal(cleared.task.expiresAt, null);
  assert.equal(cleared.task.expired, false);
});

test('duplicating a task carries the plan forward and the history nowhere', () => {
  const runtime = createWorkRuntime(stateWith({
    tasks: [oneOffTask({ steps: [{ id: 'step-1', title: '打开文件' }] })]
  }));
  runtime.completeTask({ taskId: 'task-1', confirmUnfinishedSteps: true });
  const copy = runtime.duplicateTask({ taskId: 'task-1', at: NOW + 1000 });

  assert.equal(copy.ok, true);
  assert.notEqual(copy.task.id, 'task-1');
  assert.equal(copy.task.title, '写一行');
  assert.equal(copy.task.done, false);
  assert.equal(copy.task.completedAt, null);
  assert.equal(copy.task.seriesId, null);
  assert.equal(copy.task.occurrenceDate, null);
  assert.notEqual(copy.task.steps[0].id, 'step-1');
  assert.equal(copy.task.steps[0].done, false);
  assert.equal(totalXp(runtime.state()), 30, 'a duplicate is not a second completion');
});

test('archiving preserves recurrence ownership and only moves sealed occurrences to history', () => {
  const runtime = createWorkRuntime(seriesState());
  const rejected = runtime.archiveTask({ taskId: 'occ-1', reason: 'manual' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'open-recurrence-occurrence');
  assert.equal(runtime.commits(), 0);
  assert.deepEqual(runtime.state().archivedTasks, []);

  const completed = runtime.completeTask({ taskId: 'occ-1', confirmUnfinishedSteps: true });
  const successorId = runtime.series().openTaskId;
  assert.equal(runtime.task(successorId).occurrenceDate, completed.nextOccurrenceDate);

  const archived = runtime.archiveTask({ taskId: 'occ-1', reason: 'manual', at: NOW + 1 });
  assert.equal(archived.ok, true);
  const state = runtime.state();
  assert.equal(state.archivedTasks[0].id, 'occ-1');
  assert.ok(state.tasks.some(task => task.id === successorId));
  assert.equal(state.recurrenceSeries[0].openTaskId, successorId,
    'moving finished history out must not disturb the round the user is on');
  const committed = runtime.committed();
  assert.deepEqual(normalizePersistedState(committed, { now: NOW + 2 }), committed);
});

test('every transaction result survives strict startup normalization', () => {
  const completing = createWorkRuntime(seriesState());
  completing.completeTask({ taskId: 'occ-1', confirmUnfinishedSteps: true });

  const skipping = createWorkRuntime(seriesState());
  skipping.skipOccurrence({ taskId: 'occ-1' });

  const editing = createWorkRuntime(seriesState());
  editing.updateTask({
    taskId: 'occ-1', patch: { tags: ['写作'], estimateMinutes: 20 }, scope: 'current-and-future'
  });

  for (const runtime of [completing, skipping, editing]) {
    assert.equal(runtime.commits(), 1);
    const committed = runtime.committed();
    assert.deepEqual(
      normalizePersistedState(committed, { now: NOW + 5000 }),
      committed,
      'a transaction must commit a canonical snapshot, not one that needs repair on restart'
    );
  }
});
