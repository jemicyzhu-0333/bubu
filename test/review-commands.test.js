'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createResolveReviewWorkflow } = require('../src/application');
const guidance = require('../src/capabilities/guidance');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const NOW = Date.parse('2026-09-01T21:15:00');

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function initialState() {
  return normalizePersistedState({
    reviews: { pending: [] },
    tasks: [{ id: 'deadline', title: '发稿', createdAt: NOW, deadline: new Date(NOW + 3600000).toISOString() }]
  }, { now: NOW });
}

test('review materialization is idempotent and publishes only after a commit', () => {
  const repository = createRepository(initialState());
  const events = [];
  const command = guidance.materializeDueReviews.createMaterializeDueReviewsCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    publish: fact => events.push(fact)
  });

  const first = command.execute({ workStartHour: 10, workEndHour: 21 });
  const second = command.execute({ workStartHour: 10, workEndHour: 21 });

  // Yesterday had no activity in this fixture, so only today's two cards appear.
  assert.deepEqual(first.created.map(card => card.id).sort(),
    ['review:closeout:2026-09-01', 'review:startup:2026-09-01']);
  assert.equal(first.changed, true);
  assert.equal(second.created.length, 0);
  assert.equal(second.changed, false);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event.type), ['reviews-materialized']);
});

test('review resolution atomically plans only rendered startup candidates', () => {
  const state = initialState();
  state.reviews.pending = [{
    id: 'review:startup:2026-09-01', kind: 'startup', dayKey: '2026-09-01',
    createdAt: NOW, status: 'pending', progress: 0
  }];
  // 很早以前建的、没有计划也没有截止：不在“今天先做这几件”里。
  state.tasks.push({ id: 'unrelated', title: '无关事项', createdAt: NOW - 30 * 86400000, plannedFor: null });
  const repository = createRepository(state);
  const events = [];
  const workflow = createResolveReviewWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    publish: fact => events.push(fact)
  });

  const result = workflow.execute({
    id: 'review:startup:2026-09-01', action: 'done',
    confirmedTaskIds: ['deadline', 'unrelated']
  });

  const persisted = repository.inspect();
  assert.equal(result.ok, true);
  assert.equal(result.updatedTasks, undefined);
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks.find(task => task.id === 'deadline').plannedFor, '2026-09-01');
  assert.equal(persisted.state.tasks.find(task => task.id === 'unrelated').plannedFor, null);
  assert.deepEqual(events[0].updatedTasks, ['deadline']);
  // 确认的第一件直接成为“现在”。
  assert.equal(persisted.state.nowTaskId, 'deadline');
});

test('invalid or stale review resolutions perform zero writes', () => {
  const state = initialState();
  state.reviews.pending = [{
    id: 'review:closeout:2026-08-31', kind: 'closeout', dayKey: '2026-08-31',
    createdAt: NOW, status: 'pending', progress: 0
  }];
  const repository = createRepository(state);
  let publishes = 0;
  const workflow = createResolveReviewWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    publish: () => { publishes += 1; }
  });

  assert.equal(workflow.execute({ id: 'missing', action: 'done' }).reason, 'review-not-found');
  assert.equal(workflow.execute({ id: 'review:closeout:2026-08-31', action: 'done', expectedRevision: 2 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.equal(publishes, 0);
});
