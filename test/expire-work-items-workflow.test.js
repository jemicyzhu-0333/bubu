'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPIRE_WORK_ITEMS_WRITES,
  createExpireWorkItemsWorkflow,
  createUnitOfWork
} = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const EXPIRED_AT = Date.parse('2026-09-09T12:00:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: EXPIRED_AT });
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
  return createExpireWorkItemsWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => EXPIRED_AT },
    ...overrides
  });
}

test('expiry marks only due active work and clears its Now pointer in one commit', () => {
  const events = [];
  const repository = createRepository(baseState({
    tasks: [
      {
        id: 'due', title: '到期了', createdAt: 1,
        expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
      },
      { id: 'open', title: '没有时效', createdAt: 2, expiresAt: null, expired: false },
      {
        id: 'done', title: '已完成', createdAt: 5, done: true, completedAt: 6,
        expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
      }
    ],
    nowTaskId: 'due'
  }), events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute(), { ok: true, expiredCount: 1 });

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.deepEqual(
    persisted.state.tasks.map(task => [task.id, task.expired]),
    [['due', true], ['open', false], ['done', false]]
  );
  assert.equal(persisted.state.nowTaskId, null);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'work-items-expired',
    expiredTaskIds: ['due'],
    clearedNowTaskId: 'due',
    expiredAt: EXPIRED_AT,
    notificationRequested: true,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.equal(Object.isFrozen(events[1][1].expiredTaskIds), true);
  assert.deepEqual(EXPIRE_WORK_ITEMS_WRITES, ['tasks', 'nowTaskId']);
});

test('the work-owned expiry rule never rewrites completed or skipped snapshots', () => {
  const state = {
    tasks: [
      {
        id: 'skipped', done: false, skippedAt: 1,
        expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
      },
      {
        id: 'done', done: true, skippedAt: null,
        expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
      }
    ]
  };

  assert.deepEqual(work.taskExpiration.expireDueTasks(state, EXPIRED_AT), {
    ok: true,
    expiredTaskIds: []
  });
  assert.deepEqual(state.tasks.map(task => task.expired), [false, false]);
});

test('clock rollback never reactivates an already expired task or writes a no-op snapshot', () => {
  const initial = baseState({
    tasks: [{
      id: 'expired-clock', title: '需要显式续期', createdAt: 1,
      expiresAt: new Date(EXPIRED_AT + 86_400_000).toISOString(), expired: true
    }]
  });
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ notify: false }), { ok: true, expiredCount: 0 });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('a stale unavailable Now pointer is cleared even when no task newly expires', () => {
  const repository = createRepository(baseState({
    tasks: [{
      id: 'scheduled', title: '明天再做', createdAt: 1,
      scheduledFor: new Date(EXPIRED_AT + 60_000).toISOString()
    }],
    nowTaskId: 'scheduled'
  }));
  const facts = [];
  const workflow = createWorkflow(repository, { publish: fact => facts.push(fact) });

  assert.deepEqual(workflow.execute(), { ok: true, expiredCount: 0 });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(repository.inspect().state.nowTaskId, null);
  assert.equal(facts[0].clearedNowTaskId, 'scheduled');
  assert.deepEqual(facts[0].expiredTaskIds, []);
});

test('stale expiry checks do not enter the transition or publish effects', () => {
  const initial = baseState({
    tasks: [{
      id: 'due', title: '到期了', createdAt: 1,
      expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
    }]
  });
  const events = [];
  const repository = createRepository(initial, events);
  const workflow = createWorkflow(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(workflow.execute({ expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('post-commit expiry feedback failure cannot make expiration retryable', () => {
  const repository = createRepository(baseState({
    tasks: [{
      id: 'due', title: '到期了', createdAt: 1,
      expiresAt: new Date(EXPIRED_AT - 1).toISOString(), expired: false
    }]
  }));
  const reported = [];
  let publishedFact = null;
  const workflow = createWorkflow(repository, {
    publish: fact => {
      publishedFact = fact;
      throw new Error('notification host closed');
    },
    reportEffectError: (error, fact) => reported.push([error.message, fact.type])
  });

  assert.deepEqual(workflow.execute({ notify: false }), { ok: true, expiredCount: 1 });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(publishedFact.notificationRequested, false);
  assert.deepEqual(reported, [['notification host closed', 'work-items-expired']]);
});
