'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

test('unit of work commits one isolated candidate and reports the actual write set', () => {
  const repository = createRepository({ tasks: [{ id: 'a', done: false }], nowTaskId: null, settings: {} });
  const unitOfWork = createUnitOfWork({ repository });

  const result = unitOfWork.run({
    writes: ['tasks', 'nowTaskId'],
    context: { now: 42 },
    transition: draft => {
      draft.tasks[0].done = true;
      draft.nowTaskId = 'a';
      return { ok: true, value: 'selected' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 'selected');
  assert.equal(result.committed, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.changedPaths, ['nowTaskId', 'tasks']);
  assert.deepEqual(repository.inspect(), {
    state: { tasks: [{ id: 'a', done: true }], nowTaskId: 'a', settings: {} },
    revision: 1,
    commits: 1
  });
});

test('rejections and no-op transitions perform zero canonical writes', () => {
  const original = { tasks: [{ id: 'a', done: false }], nowTaskId: null };
  const repository = createRepository(original);
  const unitOfWork = createUnitOfWork({ repository });

  const rejected = unitOfWork.run({
    writes: ['tasks'],
    transition: draft => {
      draft.tasks[0].done = true;
      return { ok: false, reason: 'not-allowed' };
    }
  });
  const unchanged = unitOfWork.run({
    writes: ['nowTaskId'],
    transition: () => ({ ok: true })
  });

  assert.deepEqual(rejected, {
    ok: false,
    reason: 'not-allowed',
    committed: false,
    revision: 0
  });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.committed, false);
  assert.deepEqual(unchanged.changedPaths, []);
  assert.deepEqual(repository.inspect(), { state: original, revision: 0, commits: 0 });
});

test('undeclared writes and asynchronous transitions fail before commit', () => {
  const repository = createRepository({ tasks: [], settings: { dnd: false } });
  const unitOfWork = createUnitOfWork({ repository });

  assert.throws(() => unitOfWork.run({
    writes: ['tasks'],
    transition: draft => { draft.settings.dnd = true; }
  }), /undeclared state path: settings/);
  assert.throws(() => unitOfWork.run({
    writes: ['tasks'],
    transition: draft => { draft.shadow = undefined; }
  }), /undeclared state path: shadow/);
  assert.throws(() => unitOfWork.run({
    writes: ['tasks'],
    transition: async draft => { draft.tasks.push({ id: 'late' }); }
  }), /must be synchronous/);
  assert.equal(repository.inspect().commits, 0);
});

test('an expected revision conflict does not run the transition or commit', () => {
  const repository = createRepository({ tasks: [] });
  const unitOfWork = createUnitOfWork({ repository });
  let transitioned = false;

  const result = unitOfWork.run({
    writes: ['tasks'],
    expectedRevision: 3,
    transition: () => { transitioned = true; }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'state-revision-conflict',
    expectedRevision: 3,
    actualRevision: 0,
    committed: false,
    revision: 0
  });
  assert.equal(transitioned, false);
  assert.equal(repository.inspect().commits, 0);
});
