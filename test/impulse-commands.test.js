'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const work = require('../src/capabilities/work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const CAPTURED_AT = Date.parse('2026-09-09T08:30:00Z');

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: CAPTURED_AT });
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

function createCaptureCommand(repository, overrides = {}) {
  return work.captureImpulse.createCaptureImpulseCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => CAPTURED_AT },
    idFactory: () => 'impulse-1',
    ...overrides
  });
}

function createDiscardCommand(repository, overrides = {}) {
  return work.discardImpulse.createDiscardImpulseCommand({
    unitOfWork: createUnitOfWork({ repository }),
    ...overrides
  });
}

test('capturing an impulse commits its canonical record once before publishing', () => {
  const events = [];
  const repository = createRepository(baseState(), events);
  const command = createCaptureCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ text: '  突然想到的事  ' }), { ok: true });

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.deepEqual(persisted.state.impulses, [{
    id: 'impulse-1',
    text: '突然想到的事',
    createdAt: CAPTURED_AT, classification: null, resolution: null
  }]);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'impulse-captured',
    impulseId: 'impulse-1',
    capturedAt: CAPTURED_AT,
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(work.captureImpulse.CAPTURE_IMPULSE_WRITES, ['impulses']);
});

test('capture retries colliding identities and rejects invalid text without writing', () => {
  const repository = createRepository(baseState({
    impulses: [{ id: 'impulse-1', text: '已有闪念', createdAt: CAPTURED_AT - 1 }]
  }));
  const allocated = ['impulse-1', 'impulse-2'];
  const command = createCaptureCommand(repository, {
    idFactory: () => allocated.shift()
  });

  assert.deepEqual(command.execute({ text: '第二条' }), { ok: true });
  assert.deepEqual(repository.inspect().state.impulses.map(item => item.id), [
    'impulse-2', 'impulse-1'
  ]);

  assert.deepEqual(command.execute({ text: '   ' }), {
    ok: false,
    reason: 'impulse-text-invalid'
  });
  assert.equal(repository.inspect().commits, 1);
});

test('discard removes only the named impulse and publishes after the commit', () => {
  const events = [];
  const repository = createRepository(baseState({
    impulses: [
      { id: 'impulse-1', text: '删除我', createdAt: 1 },
      { id: 'impulse-2', text: '留下我', createdAt: 2 }
    ]
  }), events);
  const command = createDiscardCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ impulseId: 'impulse-1' }), { ok: true });
  assert.deepEqual(repository.inspect().state.impulses.map(item => item.id), ['impulse-2']);
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'impulse-discarded',
    impulseId: 'impulse-1',
    revision: 1
  });
  assert.deepEqual(work.discardImpulse.DISCARD_IMPULSE_WRITES, ['impulses']);
});

test('missing and stale impulse commands are zero-write refusals', () => {
  const events = [];
  let idCalls = 0;
  const repository = createRepository(baseState({
    impulses: [{ id: 'impulse-1', text: '保留', createdAt: 1 }]
  }), events);
  const capture = createCaptureCommand(repository, {
    idFactory: () => `impulse-${++idCalls}`,
    publish: fact => events.push(['publish', fact])
  });
  const discard = createDiscardCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(capture.execute({ text: '过期捕捉', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.deepEqual(discard.execute({ impulseId: 'missing' }), { ok: false });
  assert.deepEqual(discard.execute({ impulseId: 'impulse-1', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(idCalls, 0);
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('post-commit impulse feedback failures cannot make commands retryable', () => {
  const captureRepository = createRepository(baseState());
  const captureErrors = [];
  const capture = createCaptureCommand(captureRepository, {
    publish: () => { throw new Error('capture surface closed'); },
    reportEffectError: (error, fact) => captureErrors.push([error.message, fact.type])
  });
  assert.deepEqual(capture.execute({ text: '已经记下' }), { ok: true });
  assert.equal(captureRepository.inspect().commits, 1);
  assert.deepEqual(captureErrors, [['capture surface closed', 'impulse-captured']]);

  const discardRepository = createRepository(baseState({
    impulses: [{ id: 'impulse-1', text: '可以删', createdAt: 1 }]
  }));
  const discardErrors = [];
  const discard = createDiscardCommand(discardRepository, {
    publish: () => { throw new Error('panel closed'); },
    reportEffectError: (error, fact) => discardErrors.push([error.message, fact.type])
  });
  assert.deepEqual(discard.execute({ impulseId: 'impulse-1' }), { ok: true });
  assert.equal(discardRepository.inspect().commits, 1);
  assert.deepEqual(discardErrors, [['panel closed', 'impulse-discarded']]);
});
