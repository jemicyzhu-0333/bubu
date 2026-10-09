'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const UPDATED_AT = Date.parse('2026-09-08T14:00:00Z');
const CLOSED_ON = '2026-09-01';

function sourceState() {
  const canonical = normalizePersistedState({}, { now: UPDATED_AT });
  return normalizePersistedState({
    ...canonical,
    tasks: [{
      id: 'occurrence-old',
      title: '每日整理',
      createdAt: UPDATED_AT - 10_000,
      done: true,
      completedAt: Date.parse('2026-09-01T12:00:00Z'),
      seriesId: 'series-1',
      occurrenceDate: CLOSED_ON,
      steps: [{ id: 'step-old', title: '打开清单', done: true, completedAt: UPDATED_AT - 9_000 }]
    }],
    recurrenceSeries: [{
      id: 'series-1',
      createdAt: UPDATED_AT - 20_000,
      updatedAt: UPDATED_AT - 10_000,
      state: 'paused',
      rule: {
        frequency: 'daily', interval: 1, weekdays: null, strategy: 'fixed', anchorDate: CLOSED_ON
      },
      template: {
        title: '每日整理',
        description: null,
        stepTitles: ['打开清单'],
        tags: [],
        energy: 'medium',
        energyAuto: true,
        estimateMinutes: 15
      },
      openTaskId: null,
      lastOccurrenceDate: CLOSED_ON,
      missedCount: 0
    }]
  }, { now: UPDATED_AT });
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

function createCommand(repository, overrides = {}) {
  let sequence = 0;
  return work.updateRecurrenceSeries.createUpdateRecurrenceSeriesCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => UPDATED_AT },
    idFactory: prefix => `${prefix}-next-${++sequence}`,
    ...overrides
  });
}

test('series validation rejects a compound change before mutating its draft', () => {
  const state = sourceState();
  const before = structuredClone(state);

  const result = work.seriesUpdating.updateSeries(state, {
    seriesId: 'series-1',
    rule: { frequency: 'daily', interval: 2, weekdays: null, strategy: 'fixed' },
    state: 'deleted',
    now: UPDATED_AT
  });

  assert.deepEqual(result, { ok: false, reason: 'invalid-series-state' });
  assert.deepEqual(state, before);
});

test('resuming a closed series creates at most one occurrence in one commit', () => {
  const events = [];
  const repository = createRepository(sourceState(), events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  const result = command.execute({ seriesId: 'series-1', seriesState: 'active' });

  assert.equal(result.ok, true);
  assert.equal(result.series.state, 'active');
  assert.equal(result.nextOccurrenceDate, '2026-09-08');
  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  const open = persisted.state.tasks.filter(task => (
    task.seriesId === 'series-1' && !task.done && !task.skippedAt
  ));
  assert.equal(open.length, 1);
  assert.equal(result.series.openTaskId, open[0].id);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'recurrence-series-updated',
    seriesId: 'series-1',
    nextOccurrenceDate: '2026-09-08',
    updatedAt: UPDATED_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(
    work.updateRecurrenceSeries.UPDATE_RECURRENCE_SERIES_WRITES,
    ['tasks', 'recurrenceSeries']
  );
});

test('rule edits preserve the anchor and do not manufacture an occurrence', () => {
  const initial = sourceState();
  initial.recurrenceSeries[0].state = 'active';
  initial.recurrenceSeries[0].openTaskId = 'occurrence-old';
  initial.tasks[0].done = false;
  initial.tasks[0].completedAt = null;
  const repository = createRepository(initial);
  const command = createCommand(repository);

  const result = command.execute({
    seriesId: 'series-1',
    rule: { frequency: 'daily', interval: 2, weekdays: null, strategy: 'fixed' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.series.rule.anchorDate, CLOSED_ON);
  assert.equal(result.series.rule.interval, 2);
  assert.equal(result.nextOccurrenceDate, null);
  assert.equal(repository.inspect().state.tasks.length, 1);
  assert.equal(repository.inspect().commits, 1);
});

test('missing, terminal and stale series updates perform zero writes and effects', () => {
  const events = [];
  const initial = sourceState();
  initial.recurrenceSeries[0].state = 'ended';
  initial.recurrenceSeries[0].endedAt = UPDATED_AT - 1;
  const repository = createRepository(initial, events);
  let idCalls = 0;
  const command = createCommand(repository, {
    idFactory: prefix => `${prefix}-${++idCalls}`,
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ seriesId: 'missing', seriesState: 'active' }), {
    ok: false,
    reason: 'series-not-found'
  });
  assert.deepEqual(command.execute({ seriesId: 'series-1', seriesState: 'active' }), {
    ok: false,
    reason: 'series-ended'
  });
  assert.deepEqual(command.execute({
    seriesId: 'series-1', seriesState: 'ended', expectedRevision: 1
  }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(idCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('post-commit projection failure cannot make a series update retryable', () => {
  const repository = createRepository(sourceState());
  const reported = [];
  const command = createCommand(repository, {
    publish: () => { throw new Error('renderer closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  const result = command.execute({ seriesId: 'series-1', seriesState: 'active' });

  assert.equal(result.ok, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(reported, [['renderer closed', 'recurrence-series-updated']]);
});
