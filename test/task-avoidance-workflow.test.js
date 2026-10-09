'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createRecordTaskAvoidanceWorkflow } = require('../src/application');

const NOW = 123_456;

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

function createWorkflow(repository, events) {
  return createRecordTaskAvoidanceWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    publish: fact => {
      assert.equal(repository.inspect().state.tasks[0].lastAvoidedAt, NOW);
      events.push(fact);
    }
  });
}

function initialState() {
  return {
    tasks: [
      { id: 'active', done: false, skippedAt: null, avoidanceCount: 2, lastAvoidedAt: null, updatedAt: 10 },
      { id: 'done', done: true, skippedAt: null, avoidanceCount: 0, lastAvoidedAt: null },
      { id: 'skipped', done: false, skippedAt: NOW - 1, avoidanceCount: 0, lastAvoidedAt: null }
    ]
  };
}

test('task avoidance updates only the work-owned counters in one commit', () => {
  const repository = createRepository(initialState());
  const events = [];
  const workflow = createWorkflow(repository, events);

  const result = workflow.execute({ taskId: 'active' });
  const persisted = repository.inspect();

  assert.deepEqual(result, {
    ok: true,
    taskId: 'active',
    avoidanceCount: 3,
    changed: true
  });
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.tasks[0].updatedAt, 10, 'avoidance is not an edit to task content');
  assert.deepEqual(events.map(event => event.type), ['task-avoidance-recorded']);
});

test('missing, completed, skipped and stale avoidance requests perform zero writes', () => {
  const repository = createRepository(initialState());
  const events = [];
  const workflow = createWorkflow(repository, events);

  assert.equal(workflow.execute({ taskId: 'missing' }).reason, 'task-not-found');
  assert.equal(workflow.execute({ taskId: 'done' }).reason, 'task-completed');
  assert.equal(workflow.execute({ taskId: 'skipped' }).reason, 'occurrence-skipped');
  assert.equal(workflow.execute({ taskId: 'active', expectedRevision: 2 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});
