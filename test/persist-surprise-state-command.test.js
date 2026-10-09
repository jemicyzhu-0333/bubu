'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const companion = require('../src/capabilities/companion');
const { normalizeCompanionState, LIMITS } = require('../src/core/companion-state');

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
    mutateWithoutRevision: mutator => mutator(state),
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function incomingCompanion() {
  const state = normalizeCompanionState();
  state.surprise.budgetDay = '2026-09-09';
  state.surprise.lastGlobalAt = 1234;
  return state;
}

test('surprise persistence adds discoveries while preserving concurrent companion choices', () => {
  const current = normalizeCompanionState({
    relationships: { dango: { bondPoints: 7, counters: { interaction: 2 } } }
  });
  const repository = createRepository({ companion: current, pet: { satiation: 41 } });
  const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
    unitOfWork: createUnitOfWork({ repository })
  });

  const incoming = incomingCompanion();
  incoming.collection.discoveries = { 'discovery.incoming': 1234 };
  incoming.collection.activePackIds = ['stale-pack'];
  incoming.collection.completedArcIds = ['stale-arc'];
  incoming.appearance.equipped = { hat: 'stale-hat' };
  repository.mutateWithoutRevision(state => {
    state.companion.relationships.dango.bondPoints = 8;
    state.companion.relationships.usagi.bondPoints = 12;
    state.companion.bondDay = '2026-10-07';
    state.companion.bondClaims.advance = true;
    state.companion.relationships.dango.counters.interaction = 3;
    state.pet.satiation = 40;
    state.companion.collection.discoveries = { 'discovery.current': 1000 };
    state.companion.collection.activePackIds = ['builtin-core', 'current-pack'];
    state.companion.collection.completedArcIds = ['current-arc'];
    state.companion.appearance = { equipped: { hat: null, scarf: 'current-scarf' }, updatedAt: 1200 };
  });

  const before = repository.inspect().state;
  const result = command.execute({ companion: incoming });
  const persisted = repository.inspect();

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(persisted.commits, 1);
  assert.equal(persisted.state.companion.relationships.dango.bondPoints, 8);
  assert.equal(persisted.state.companion.relationships.dango.counters.interaction, 3);
  assert.equal(persisted.state.companion.surprise.lastGlobalAt, 1234);
  assert.equal(persisted.state.pet.satiation, 40);
  assert.deepEqual(persisted.state, {
    ...before,
    companion: { ...before.companion, surprise: incoming.surprise,
      collection: { ...before.companion.collection,
        discoveries: { 'discovery.current': 1000, 'discovery.incoming': 1234 } } }
  });
  assert.deepEqual(companion.persistSurpriseState.PERSIST_SURPRISE_STATE_WRITES, ['companion']);
});

test('stale and invalid surprise writes perform no canonical commit', () => {
  const repository = createRepository({ companion: normalizeCompanionState() });
  const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
    unitOfWork: createUnitOfWork({ repository })
  });

  const stale = command.execute({ companion: incomingCompanion(), expectedRevision: 4 });
  assert.equal(stale.reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);

  const invalid = structuredClone(incomingCompanion());
  invalid.surprise.extra = true;
  assert.throws(() => command.execute({ companion: invalid }), /unknown key/);
  assert.equal(repository.inspect().commits, 0);
});

for (const currentAt of [0, 1000, 3000]) {
  test(`canonical discovery timestamp ${currentAt} wins duplicate incoming timestamp`, () => {
    const current = normalizeCompanionState();
    current.collection.discoveries = { 'discovery.shared': currentAt };
    const repository = createRepository({ companion: current });
    const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
      unitOfWork: createUnitOfWork({ repository })
    });
    const incoming = incomingCompanion();
    incoming.collection.discoveries = { 'discovery.shared': 2000 };
    assert.deepEqual(command.execute({ companion: incoming }), { ok: true, changed: true });
    const saved = repository.inspect();
    assert.deepEqual(saved.state.companion.collection.discoveries, { 'discovery.shared': currentAt });
    assert.deepEqual(command.execute({ companion: incoming }), { ok: true, changed: false });
    assert.deepEqual(repository.inspect(), saved, 'replay does not rewrite or advance the revision');
  });
}

test('a stale incoming snapshot cannot erase discoveries added by a later command', () => {
  const repository = createRepository({ companion: normalizeCompanionState() });
  const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
    unitOfWork: createUnitOfWork({ repository })
  });
  const stale = incomingCompanion(), latest = incomingCompanion();
  stale.collection.discoveries = { 'discovery.old': 1000 };
  latest.collection.discoveries = { 'discovery.new': 2000 };
  command.execute({ companion: latest });
  command.execute({ companion: stale });
  assert.deepEqual(repository.inspect().state.companion.collection.discoveries, {
    'discovery.new': 2000, 'discovery.old': 1000
  });
});

test('merged discoveries accept the exact limit and reject overflow without partial writes', () => {
  const current = normalizeCompanionState();
  current.collection.discoveries = Object.fromEntries(
    Array.from({ length: LIMITS.discoveries - 1 }, (_, index) => [`existing-${index}`, index])
  );
  const repository = createRepository({ companion: current, untouched: 'same' });
  const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
    unitOfWork: createUnitOfWork({ repository })
  });
  const incoming = incomingCompanion();
  incoming.collection.discoveries = { 'discovery.last': 1000 };
  assert.deepEqual(command.execute({ companion: incoming }), { ok: true, changed: true });
  assert.equal(Object.keys(repository.inspect().state.companion.collection.discoveries).length, LIMITS.discoveries);
  const full = repository.inspect();
  assert.deepEqual(command.execute({ companion: incoming }), { ok: true, changed: false });
  incoming.collection.discoveries = { 'discovery.overflow': 2000 };
  incoming.surprise.lastGlobalAt = 5678;
  assert.throws(() => command.execute({ companion: incoming }), /discoveries exceeds capacity 512/);
  assert.deepEqual(repository.inspect(), full, 'overflow cannot persist even the incoming surprise slice');
});

test('full incoming companion validation rejects malformed fields even when they would not be copied', () => {
  const repository = createRepository({ companion: normalizeCompanionState() });
  const command = companion.persistSurpriseState.createPersistSurpriseStateCommand({
    unitOfWork: createUnitOfWork({ repository })
  });
  for (const corrupt of [
    state => { state.relationships.dango.bondPoints = -1; },
    state => { state.appearance.equipped.hat = 'invalid hat'; },
    state => { state.collection.discoveries.invalid = -1; },
    state => { state.collection.extra = true; },
    state => { delete state.appearance; }
  ]) {
    const incoming = incomingCompanion();
    corrupt(incoming);
    assert.throws(() => command.execute({ companion: incoming }), /canonical|invalid|unknown key|must be an object/);
    assert.equal(repository.inspect().commits, 0);
  }
});
