'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createDeleteMoodNoteCommand } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { UNAVAILABLE_INBOX_ARCHIVE } = require('../src/platform/persistence/sqlite/inbox-archive-repository');
const NOW = new Date(2026, 9, 7, 12).getTime();
function fixture(archive, durability, initial = {}) {
  let state = normalizePersistedState({ ...normalizePersistedState({}, { now: NOW }), moodNotes: [{ id: 'm', at: NOW - 1000, text: 'Synthetic private note' }], ...initial }, { now: NOW });
  let revision = 0; const effects = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: candidate => { state = structuredClone(candidate); revision++; return structuredClone(state); } };
  const command = createDeleteMoodNoteCommand({ unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW }, inboxArchive: archive, durability, publish: fact => effects.push(fact) });
  return { command, repository, effects };
}
test('unavailable, missing or throwing archive query refuses before any canonical deletion', () => {
  for (const archive of [UNAVAILABLE_INBOX_ARCHIVE, { available: true },
    { available: false, idsByTarget: () => { throw new Error('query unavailable'); } },
    { available: true, idsByTarget: () => ({ ok: true }) }]) {
    const h = fixture(archive), before = h.repository.snapshot();
    assert.deepEqual(h.command.execute({ id: 'm' }), { ok: false, reason: 'mood-source-query-unavailable' });
    assert.deepEqual(h.repository.snapshot(), before);
    assert.equal(h.repository.revision(), 0); assert.deepEqual(h.effects, []);
  }
});
test('archive removal failure reports partial deletion and exact target retry cleans remaining SQL source', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' }); t.after(() => store.close());
  assert.equal(store.healthy, true);
  const row = { id: 'capture', text: 'Synthetic private note', createdAt: NOW - 1000,
    classification: { category: 'feeling', routineKind: null, level: null },
    resolution: { action: 'feeling', category: 'feeling', at: NOW, targetId: 'm' } };
  assert.equal(store.inboxArchive.put([row]).ok, true);
  let fail = true, attempts = 0;
  const archive = { ...store.inboxArchive, available: false, removeByTarget: (...args) => {
    attempts++; if (fail) throw new Error('synthetic removal failure');
    return store.inboxArchive.removeByTarget(...args);
  } };
  const h = fixture(archive);
  const first = h.command.execute({ id: 'm' });
  assert.equal(first.ok, false); assert.equal(first.reason, 'mood-delete-partial');
  assert.equal(first.localDeleted, true); assert.equal(first.sourceCleanupPending, true);
  assert.equal(h.repository.snapshot().moodNotes.length, 0); assert.equal(attempts, 1);
  assert.deepEqual(store.inboxArchive.idsByTarget('feeling', 'm').ids, ['capture']);
  fail = false;
  const retry = h.command.execute({ id: 'm' });
  assert.equal(retry.ok, true); assert.equal(retry.localDeleted, false); assert.equal(attempts, 2);
  assert.deepEqual(store.inboxArchive.idsByTarget('feeling', 'm').ids, []);
});
test('unconfirmed canonical deletion cannot trigger archive cleanup or claim complete success', () => {
  let removed = 0;
  const h = fixture({ available: true, idsByTarget: () => ({ ok: true, ids: ['capture'] }),
    removeByTarget: () => { removed++; return { ok: true }; } }, { verify: () => ({ ok: false }) });
  const result = h.command.execute({ id: 'm' });
  assert.equal(result.ok, false); assert.equal(result.durability, 'unconfirmed');
  assert.equal(result.sourceCleanupPending, true); assert.equal(removed, 0);
});
test('a lost successful response can be reconciled as current verified absence, not a new deletion', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' }); t.after(() => store.close());
  let proofs = 0;
  const h = fixture(store.inboxArchive, { verify: () => { proofs++; return { ok: true }; } });
  assert.equal(h.command.execute({ id: 'm' }).ok, true);
  const revision = h.repository.revision();
  const retry = h.command.execute({ id: 'm' });
  assert.equal(retry.ok, true); assert.equal(retry.alreadyAbsent, true); assert.equal(retry.localDeleted, false);
  assert.equal(retry.changed, false); assert.equal(h.repository.revision(), revision); assert.equal(proofs, 2);
});
test('canonical source without a remaining mood is cleaned, never misreported already absent', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' }); t.after(() => store.close());
  const h = fixture(store.inboxArchive, { verify: () => ({ ok: true }) }, { moodNotes: [], impulses: [{
    id: 'capture', text: 'Synthetic retained source', createdAt: NOW - 1000,
    resolution: { action: 'feeling', category: 'feeling', at: NOW, targetId: 'm' }
  }] });
  const result = h.command.execute({ id: 'm' });
  assert.equal(result.ok, true); assert.notEqual(result.alreadyAbsent, true);
  assert.equal(h.repository.snapshot().impulses.length, 0); assert.equal(h.repository.revision(), 1);
});
test('absence cannot be confirmed without config proof or authoritative archive query', () => {
  const archive = { idsByTarget: () => ({ ok: true, ids: [] }), removeByTarget: () => { throw new Error('must not delete'); } };
  for (const durability of [undefined, { verify: () => ({ ok: false }) }]) {
    const h = fixture(archive, durability, { moodNotes: [] });
    const result = h.command.execute({ id: 'm' });
    assert.equal(result.ok, false); assert.equal(result.durability, 'unconfirmed');
    assert.equal(h.repository.revision(), 0);
  }
  const h = fixture(UNAVAILABLE_INBOX_ARCHIVE, { verify: () => ({ ok: true }) }, { moodNotes: [] });
  assert.equal(h.command.execute({ id: 'm' }).reason, 'mood-source-query-unavailable');
});
test('invalid target identities fail before archive access and the canonical limit is enforced', () => {
  let queries = 0;
  const h = fixture({ idsByTarget: () => { queries++; return { ok: true, ids: [] }; } });
  for (const id of [null, '', '   ', 'x'.repeat(65)]) {
    assert.equal(h.command.execute({ id }).reason, 'mood-note-invalid');
  }
  assert.equal(queries, 0); assert.equal(h.repository.revision(), 0);
});
