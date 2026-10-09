'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const work = require('../src/capabilities/work');
const { createUnitOfWork } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const {
  ACTIVATE_SCHEDULED_WORK_WRITES,
  createActivateScheduledWorkCommand
} = work.activateScheduledWork;

const NOW = Date.parse('2026-09-09T12:00:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: NOW });
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
  return createActivateScheduledWorkCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    ...overrides
  });
}

test('a due reservation announces itself exactly once and never announces again', () => {
  const events = [];
  const repository = createRepository(baseState({
    tasks: [
      {
        id: 'due', title: '到点的预约', createdAt: 1,
        scheduledFor: new Date(NOW - 60_000).toISOString()
      },
      {
        id: 'later', title: '还没到点', createdAt: 2,
        scheduledFor: new Date(NOW + 60_000).toISOString()
      },
      { id: 'unscheduled', title: '没有预约', createdAt: 3 }
    ]
  }), events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute(), { ok: true, activatedCount: 1 });

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.deepEqual(
    persisted.state.tasks.map(task => [task.id, task.scheduleNotifiedAt]),
    [['due', NOW], ['later', null], ['unscheduled', null]]
  );
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'scheduled-work-activated',
    activatedTaskIds: ['due'],
    activatedAt: NOW,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(Object.isFrozen(events[1][1].activatedTaskIds), true);

  // The receipt is the whole mechanism: a second tick over the same snapshot is
  // a zero-write no-op, so a minute-by-minute watcher cannot re-notify.
  assert.deepEqual(command.execute(), { ok: true, activatedCount: 0 });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(events.length, 2);
  assert.deepEqual(ACTIVATE_SCHEDULED_WORK_WRITES, ['tasks']);
});

test('a finished, skipped or expired round is never woken by its own reservation', () => {
  const state = {
    tasks: [
      {
        id: 'done', done: true, skippedAt: null, expired: false,
        scheduledFor: new Date(NOW - 1).toISOString(), scheduleNotifiedAt: null
      },
      {
        id: 'skipped', done: false, skippedAt: NOW - 5, expired: false,
        scheduledFor: new Date(NOW - 1).toISOString(), scheduleNotifiedAt: null
      },
      {
        id: 'expired', done: false, skippedAt: null, expired: true,
        scheduledFor: new Date(NOW - 1).toISOString(), scheduleNotifiedAt: null
      },
      {
        id: 'broken-date', done: false, skippedAt: null, expired: false,
        scheduledFor: '明天早上', scheduleNotifiedAt: null
      }
    ]
  };

  assert.deepEqual(work.scheduleActivation.activateDueSchedules(state, NOW), {
    ok: true,
    activatedTaskIds: []
  });
  assert.deepEqual(state.tasks.map(task => task.scheduleNotifiedAt), [null, null, null, null]);
});

test('activation refuses an unusable instant instead of substituting the wall clock', () => {
  const repository = createRepository(baseState({
    tasks: [{
      id: 'due', title: '到点的预约', createdAt: 1,
      scheduledFor: new Date(NOW - 1).toISOString()
    }]
  }));
  const command = createCommand(repository);

  for (const bad of [Number.NaN, -1, 'now', null]) {
    assert.throws(() => command.execute({ now: bad }), /requires a valid time/);
  }
  assert.equal(repository.inspect().commits, 0);
  assert.throws(
    () => work.scheduleActivation.activateDueSchedules({}, NOW),
    /state draft with tasks/
  );
});

test('the caller-supplied instant is what lands in the snapshot, fact and context', () => {
  const events = [];
  const watcherTick = NOW - 30_000;
  const repository = createRepository(baseState({
    tasks: [{
      id: 'due', title: '到点的预约', createdAt: 1,
      scheduledFor: new Date(watcherTick - 1).toISOString()
    }]
  }), events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ now: watcherTick }), { ok: true, activatedCount: 1 });
  assert.equal(repository.inspect().state.tasks[0].scheduleNotifiedAt, watcherTick);
  assert.deepEqual(events[0][1], { now: watcherTick, expectedRevision: 0 });
  assert.equal(events[1][1].activatedAt, watcherTick);
});

test('a stale reservation check never enters the transition or publishes an effect', () => {
  const initial = baseState({
    tasks: [{
      id: 'due', title: '到点的预约', createdAt: 1,
      scheduledFor: new Date(NOW - 1).toISOString()
    }]
  });
  const events = [];
  const repository = createRepository(initial, events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('a failed reservation notification cannot make the announcement repeat', () => {
  const repository = createRepository(baseState({
    tasks: [{
      id: 'due', title: '到点的预约', createdAt: 1,
      scheduledFor: new Date(NOW - 1).toISOString()
    }]
  }));
  const reported = [];
  const command = createCommand(repository, {
    publish: () => { throw new Error('notification host closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(command.execute(), { ok: true, activatedCount: 1 });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.tasks[0].scheduleNotifiedAt, NOW);
  assert.deepEqual(reported, [['notification host closed', 'scheduled-work-activated']]);

  // The receipt was committed before the effect ran, so the lost notification is
  // lost for good rather than replayed on the next tick.
  assert.deepEqual(command.execute(), { ok: true, activatedCount: 0 });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(reported.length, 1);
});

test('activation writes only tasks and refuses to run without its ports', () => {
  const repository = createRepository(baseState({
    tasks: [
      {
        id: 'due', title: '到点的预约', createdAt: 1,
        scheduledFor: new Date(NOW - 1).toISOString()
      },
      { id: 'now-task', title: '正在做', createdAt: 2 }
    ],
    nowTaskId: 'now-task',
    xp: 12
  }));
  const before = repository.inspect().state;
  const command = createCommand(repository);

  assert.deepEqual(command.execute(), { ok: true, activatedCount: 1 });
  const after = repository.inspect().state;
  assert.deepEqual(
    Object.keys(after).filter(key => JSON.stringify(after[key]) !== JSON.stringify(before[key])),
    ['tasks']
  );
  assert.equal(after.nowTaskId, 'now-task');
  assert.equal(after.xp, 12);

  assert.throws(() => createActivateScheduledWorkCommand(), /requires a unit of work/);
  assert.throws(
    () => createActivateScheduledWorkCommand({ unitOfWork: { run: () => {} } }),
    /requires a clock/
  );
  assert.throws(
    () => createActivateScheduledWorkCommand({
      unitOfWork: { run: () => {} },
      clock: { now: () => NOW },
      publish: 'later'
    }),
    /effects must be functions/
  );
});
