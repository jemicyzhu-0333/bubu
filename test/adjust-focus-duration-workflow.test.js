'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUnitOfWork,
  createAdjustFocusDurationWorkflow,
  ADJUST_FOCUS_DURATION_WRITES
} = require('../src/application');
const execution = require('../src/capabilities/execution');

const MINUTE = 60 * 1000;
const STARTED_AT = Date.parse('2026-09-08T09:00:00Z');

function runningFocus(minutes = 25) {
  return execution.focusSession.startFocus(
    execution.focusSession.createIdleSession(STARTED_AT),
    { taskId: 'task-1', minutes, now: STARTED_AT, sessionId: 'focus-1' }
  ).session;
}

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

test('duration adjustment commits execution and preference state atomically before publishing', () => {
  const adjustedAt = STARTED_AT + 10 * MINUTE;
  const events = [];
  const repository = createRepository({
    focusSession: runningFocus(25),
    settings: { pomodoroMinutes: 25, lastChosenFocusMinutes: 25, dnd: false },
    tasks: [{ id: 'task-1' }]
  }, events);
  const workflow = createAdjustFocusDurationWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => adjustedAt },
    publish: fact => events.push(['publish', fact])
  });

  const result = workflow.execute({ minutes: 60 });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.session.sessionId, 'focus-1');
  assert.equal(result.session.plannedDurationMs, 60 * MINUTE);
  assert.equal(result.session.elapsedMs, 10 * MINUTE);
  assert.equal(result.session.remainingMs, 50 * MINUTE);
  assert.deepEqual(ADJUST_FOCUS_DURATION_WRITES, ['focusSession', 'settings']);
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.focusSession.plannedDurationMs, 60 * MINUTE);
  assert.equal(repository.inspect().state.settings.lastChosenFocusMinutes, 60);
  assert.deepEqual(repository.inspect().state.tasks, [{ id: 'task-1' }]);
  assert.equal(events[0][0], 'commit');
  assert.deepEqual(events[0][1], { now: adjustedAt, expectedRevision: 0 });
  assert.equal(events[1][0], 'publish');
  assert.equal(events[1][1].type, 'focus-duration-adjusted');
  assert.equal(events[1][1].minutes, 60);
});

test('invalid and no-op duration changes perform zero writes and publish no effects', () => {
  const adjustedAt = STARTED_AT + 20 * MINUTE;
  const events = [];
  const repository = createRepository({
    focusSession: runningFocus(60),
    settings: { pomodoroMinutes: 25, lastChosenFocusMinutes: null }
  }, events);
  const workflow = createAdjustFocusDurationWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => adjustedAt },
    publish: fact => events.push(['publish', fact])
  });

  const rejected = workflow.execute({ minutes: 20 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'duration-below-invested');
  assert.equal(rejected.minMinutes, 20);
  assert.equal(rejected.session.plannedDurationMs, 60 * MINUTE);

  const unchanged = workflow.execute({ minutes: 60 });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(repository.inspect().commits, 0);
  assert.equal(repository.inspect().state.settings.lastChosenFocusMinutes, null);
  assert.deepEqual(events, []);
});

test('post-commit failures are reported without hiding success or skipping later effects', () => {
  const adjustedAt = STARTED_AT + 5 * MINUTE;
  const events = [];
  const repository = createRepository({
    focusSession: runningFocus(25),
    settings: { pomodoroMinutes: 25, lastChosenFocusMinutes: 25 }
  }, events);
  const workflow = createAdjustFocusDurationWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => adjustedAt },
    synchronize: fact => {
      events.push(['synchronize', fact]);
      throw new Error('clock unavailable');
    },
    publish: fact => events.push(['publish', fact]),
    reportEffectError: (error, fact) => {
      events.push(['report', error.message, fact.type]);
      throw new Error('logger unavailable');
    }
  });

  const result = workflow.execute({ minutes: 45 });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'synchronize', 'report', 'publish']);
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(events[1][1], events[3][1]);
});

test('revision conflicts perform zero writes and skip all post-commit effects', () => {
  const events = [];
  const repository = createRepository({
    focusSession: runningFocus(25),
    settings: { pomodoroMinutes: 25, lastChosenFocusMinutes: 25 }
  }, events);
  const workflow = createAdjustFocusDurationWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => STARTED_AT },
    synchronize: fact => events.push(['synchronize', fact]),
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ minutes: 45, expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});
