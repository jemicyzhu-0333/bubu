'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryService } = require('../src/application/ai/memory-service');

function snapshot() {
  return { ok: true, items: [{ id: 'memory.one', version: 1, status: 'active', kind: 'preference', subject: 'Synthetic subject',
    body: 'Synthetic body', source: 'user-confirmed', scope: 'personal', validFrom: 0, expiresAt: null,
    contextAllowed: true, updatedAt: 0 }], sampledAt: 1000, authority: { ownerId: 'owner', ledgerId: 'ledger', sequence: 0 } };
}
function forgetting() {
  return { ok: true, ownerId: 'owner', ledgerId: 'ledger', sequence: 0, memoryIds: [],
    sourceRefs: [{ kind: 'task', id: 'task.one', revision: null }] };
}
function fixture() {
  const calls = [], forbidden = [];
  let result = snapshot(), state = forgetting();
  const reader = {
    readContextSnapshot(request) { assert.equal(this, reader); calls.push(request); return result; },
    readContextForgettingState() { assert.equal(this, reader); calls.push('state'); return state; }
  };
  const repository = { available: true, contextReader: Object.freeze(reader) };
  for (const name of ['list', 'search', 'getVersion', 'forgettingState', 'receipt', 'preview', 'commit', 'undo',
    'usage', 'outbox', 'acknowledgeOutbox', 'recover', 'proof', 'delete']) {
    repository[name] = () => { forbidden.push(name); throw new Error(`Forbidden ${name}`); };
  }
  const service = createMemoryService({ repository,
    now() { forbidden.push('clock'); throw new Error('No service clock'); },
    idFactory() { forbidden.push('id'); throw new Error('No ID allocation'); },
    onInvalidate() { forbidden.push('invalidate'); throw new Error('No observer'); } });
  return { service, repository, calls, forbidden, result(value) { result = value; }, state(value) { state = value; } };
}
function unavailable(value) {
  assert.deepEqual(value, { ok: false, availability: 'unavailable', reason: 'memory-authority-unavailable' });
}

test('service exposes exactly two frozen read methods with preserved receiver and detached values', () => {
  const f = fixture(), original = snapshot(); f.result(original);
  assert.equal(Object.isFrozen(f.service.contextReader), true);
  assert.deepEqual(Object.keys(f.service.contextReader), ['readContextSnapshot', 'readContextForgettingState']);
  const request = { ids: ['memory.one'] };
  const result = f.service.contextReader.readContextSnapshot(request);
  assert.deepEqual(result, original);
  assert.notEqual(f.calls[0], request);
  assert.notEqual(f.calls[0].ids, request.ids);
  result.items[0].body = 'Caller modification'; result.authority.ownerId = 'caller';
  assert.equal(original.items[0].body, 'Synthetic body');
  assert.equal(original.authority.ownerId, 'owner');
  const state = forgetting(); f.state(state);
  const read = f.service.contextReader.readContextForgettingState();
  read.sourceRefs[0].id = 'caller'; read.memoryIds.push('caller');
  assert.equal(state.sourceRefs[0].id, 'task.one');
  assert.deepEqual(state.memoryIds, []);
  assert.deepEqual(f.forbidden, []);
});

test('invalid and implicit selections fail before repository access', () => {
  const f = fixture(); let getters = 0;
  Object.defineProperty(f.repository, 'contextReader', { get() { getters++; throw new Error('No port'); } });
  const accessor = Object.defineProperty({}, 'ids', { get() { getters++; return null; } });
  for (const request of [undefined, {}, { ids: undefined }, { ids: null, extra: 1 }, accessor,
    { ids: new Array(1) }, { ids: ['memory.one', 'memory.one'] }, { ids: Array.from({ length: 9 }, (_, i) => `m.${i}`) }]) {
    assert.equal(f.service.contextReader.readContextSnapshot(request).reason, 'memory-context-invalid-selection');
  }
  assert.equal(getters, 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.forbidden, []);
});

test('selected success must exactly cover selection; discovery and empty selection stay distinct', () => {
  const f = fixture();
  unavailable(f.service.contextReader.readContextSnapshot({ ids: [] }));
  unavailable(f.service.contextReader.readContextSnapshot({ ids: ['missing'] }));
  unavailable(f.service.contextReader.readContextSnapshot({ ids: ['memory.one', 'missing'] }));
  assert.equal(f.service.contextReader.readContextSnapshot({ ids: null }).ok, true);
  const empty = snapshot(); empty.items = []; f.result(empty);
  assert.equal(f.service.contextReader.readContextSnapshot({ ids: [] }).ok, true);
  unavailable(f.service.contextReader.readContextSnapshot({ ids: ['memory.one'] }));
  assert.deepEqual(f.forbidden, []);
});

test('a read callback cannot change the captured selected IDs by mutating its request', () => {
  const f = fixture();
  f.repository.contextReader = { readContextSnapshot(request) {
    request.ids.splice(0, request.ids.length, 'other');
    const result = snapshot(); result.items[0].id = 'other'; return result;
  } };
  const request = { ids: ['memory.one'] };
  unavailable(f.service.contextReader.readContextSnapshot(request));
  assert.deepEqual(request.ids, ['memory.one']);
  assert.deepEqual(f.forbidden, []);
});

test('malformed, extra, oversized, duplicate and ineligible result fields fail closed', () => {
  const changes = [
    value => { value.extra = 'Private metadata'; }, value => { value.authority.sequence = -1; },
    value => { value.authority.ownerId = 'bad identity'; }, value => { value.items[0].sourceRefs = []; },
    value => { value.items[0].version = '1'; }, value => { value.items[0].contextAllowed = false; },
    value => { value.items[0].status = 'paused'; }, value => { value.items[0].source = 'candidate'; },
    value => { value.items[0].source = 'aggregated'; }, value => { value.items[0].validFrom = 1001; },
    value => { value.items[0].expiresAt = 1000; }, value => { value.items[0].body = 'x'.repeat(501); },
    value => { value.items[0].subject = 'x'.repeat(201); }, value => { value.items.push({ ...value.items[0] }); },
    value => { value.sampledAt = NaN; }, value => { value.items = Array.from({ length: 501 }, (_, i) => ({ ...value.items[0], id: `m.${i}` })); },
    value => { Object.defineProperty(value, 'private', { value: 'Hidden metadata' }); },
    value => { value[Symbol('private')] = 'Hidden metadata'; }
  ];
  for (const change of changes) {
    const f = fixture(), value = snapshot(); change(value); f.result(value);
    unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
    assert.deepEqual(f.forbidden, []);
  }
});

test('failure union preserves bounded unknown state and strips arbitrary errors and metadata', () => {
  const f = fixture();
  const unknown = { ok: false, availability: 'unavailable', reason: 'memory-commit-outcome-unknown', outcome: 'unknown', retrySameIdentity: true };
  f.result(unknown);
  assert.deepEqual(f.service.contextReader.readContextSnapshot({ ids: null }), unknown);
  for (const value of [{ ...unknown, private: 'Body' }, { ...unknown, retrySameIdentity: false },
    { ok: false, availability: 'unavailable', reason: 'arbitrary-private-text' }, new Error('Private message'), null]) {
    f.result(value); f.state(value);
    unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
    unavailable(f.service.contextReader.readContextForgettingState());
  }
  assert.deepEqual(f.forbidden, []);
});

test('missing, throwing or unavailable narrow ports never fall back to maintenance APIs', () => {
  for (const reader of [undefined, {}, { readContextSnapshot() { throw new Error('Private body'); },
    readContextForgettingState() { throw { secret: 'Private metadata' }; } }]) {
    const f = fixture(); f.repository.contextReader = reader;
    unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
    unavailable(f.service.contextReader.readContextForgettingState());
    assert.deepEqual(f.forbidden, []);
  }
  const f = fixture(); f.repository.available = false;
  unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
  assert.deepEqual(f.calls, []);
});

test('result accessors and throwing port getters are caught without reading exception metadata', () => {
  const f = fixture(); let getters = 0;
  const value = snapshot();
  Object.defineProperty(value.items[0], 'body', { get() { getters++; throw new Error('Private body'); } });
  f.result(value);
  unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
  assert.equal(getters, 0);
  Object.defineProperty(f.repository, 'contextReader', { get() {
    throw Object.defineProperty({}, 'message', { get() { getters++; throw new Error('Private exception'); } });
  } });
  unavailable(f.service.contextReader.readContextSnapshot({ ids: null }));
  unavailable(f.service.contextReader.readContextForgettingState());
  assert.equal(getters, 0);
  assert.deepEqual(f.forbidden, []);
});

test('forgetting state rejects malformed identities and references without imposing a cumulative history cap', () => {
  const f = fixture(), large = forgetting();
  large.memoryIds = Array.from({ length: 2001 }, (_, index) => `forgotten.${index}`);
  large.sourceRefs = Array.from({ length: 2001 }, (_, index) => ({ kind: 'task', id: `task.${index}`, revision: null }));
  f.state(large);
  assert.equal(f.service.contextReader.readContextForgettingState().memoryIds.length, 2001);
  for (const change of [value => { value.memoryIds = ['same', 'same']; }, value => { value.sourceRefs.push({ ...value.sourceRefs[0] }); },
    value => { value.body = 'Private body'; }, value => { value.sourceRefs[0].kind = 'unknown'; },
    value => { value.ownerId = 'bad identity'; }, value => { value.sequence = 0.5; }]) {
    const value = forgetting(); change(value); f.state(value);
    unavailable(f.service.contextReader.readContextForgettingState());
  }
  assert.deepEqual(f.forbidden, []);
});
