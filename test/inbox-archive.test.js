'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUnitOfWork, createOrganizeInboxWorkflow, createArchiveInboxRecordsWorkflow, createDeleteInboxRecordWorkflow,
  createInboxHistoryQuery, createKeepMoodNoteCommand, createDeleteMoodNoteCommand
} = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const { inboxRecords } = require('../src/capabilities/work');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');

const NOW = new Date(2026, 9, 1, 20).getTime();
let sqlAvailable = true;
try { require('node:sqlite'); } catch { sqlAvailable = false; }

function harness(impulses, { archive } = {}) {
  let state = normalizePersistedState({ impulses }, { now: NOW });
  let revision = 0, sequence = 0;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision, commit(candidate) {
    assert.deepEqual(normalizePersistedState(candidate, { now: NOW }), candidate, 'every transition must be canonical');
    state = structuredClone(candidate); revision++; return structuredClone(state);
  } };
  const unitOfWork = createUnitOfWork({ repository });
  const store = archive || openDatabase({ filePath: ':memory:', logger: () => {} }).inboxArchive;
  const clock = { now: () => NOW };
  const idFactory = prefix => `${prefix}-${++sequence}`;
  return {
    repository, unitOfWork, archive: store,
    organize: createOrganizeInboxWorkflow({ unitOfWork, clock, idFactory, profiles: ROUTINE_EFFECT_PROFILES }),
    archiving: createArchiveInboxRecordsWorkflow({ unitOfWork, readSnapshot: repository.snapshot, archive: store }),
    remove: createDeleteInboxRecordWorkflow({ unitOfWork, archive: store }),
    history: createInboxHistoryQuery({ readSnapshot: repository.snapshot, archive: store }),
    keepMood: createKeepMoodNoteCommand({ unitOfWork, clock, idFactory, inboxArchive: store }),
    deleteMood: createDeleteMoodNoteCommand({ unitOfWork, clock, inboxArchive: store })
  };
}

const captures = count => Array.from({ length: count }, (_, i) => ({
  id: `c${String(i).padStart(3, '0')}`, text: `原文 ${i}`, createdAt: NOW - 60_000 - (i % 7) * 1000
}));

test('resolved captures move to the archive and leave config.json; pending captures stay', { skip: !sqlAvailable }, () => {
  const h = harness(captures(3));
  assert.equal(h.organize.execute({ id: 'c000', action: 'keep', category: 'note' }).ok, true);
  assert.equal(h.archiving.flush().released, 1);
  const state = h.repository.snapshot();
  assert.deepEqual(state.impulses.map(item => item.id), ['c001', 'c002']);
  const page = h.history.page({});
  assert.equal(page.total, 1);
  assert.deepEqual({ ...page.items[0].resolution }, { action: 'keep', category: 'note', at: NOW, targetId: null });
  assert.equal(page.items[0].text, '原文 0');
  assert.equal(h.history.total(), 1);
  // A second flush has nothing left to copy and does not commit.
  const revision = h.repository.revision();
  assert.equal(h.archiving.flush().released, 0);
  assert.equal(h.repository.revision(), revision);
});

test('a failed or unavailable archive never releases the original text', () => {
  const failing = { available: true, put: () => ({ ok: false }), page: () => ({ ok: false, items: [] }), count: () => ({ ok: false, total: null }), existing: () => ({ ok: false, ids: [] }), remove: () => ({ ok: false, removed: 0 }) };
  for (const archive of [failing, { ...failing, available: false }]) {
    const h = harness(captures(1), { archive });
    h.organize.execute({ id: 'c000', action: 'keep' });
    h.archiving.flush();
    assert.equal(h.repository.snapshot().impulses[0].resolution.action, 'keep');
    const page = h.history.page({});
    assert.equal(page.total, null, 'unavailable archive cannot establish a complete total');
    assert.equal(page.available, false); assert.equal(page.partial, true);
    assert.equal(page.items[0].id, 'c000', 'history still shows the record from the document');
  }
});

test('history pages merge document and archive rows in one stable order without repeats', { skip: !sqlAvailable }, () => {
  const h = harness(captures(70));
  const ids = h.repository.snapshot().impulses.map(item => item.id);
  assert.equal(h.organize.keepAll({ ids: ids.slice(0, 60) }).kept, 60);
  h.archiving.flush();
  // Ten more resolved after the flush stay in the document until the next one.
  assert.equal(h.organize.keepAll({ ids: ids.slice(60) }).kept, 10);
  const seen = [];
  let cursor = null;
  do {
    const page = h.history.page({ cursor, limit: 25 });
    assert.equal(page.total, 70);
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen.map(item => item.id)).size, 70);
  const ordered = [...seen].sort(inboxRecords.compareHistory);
  assert.deepEqual(seen.map(item => item.id), ordered.map(item => item.id));
});

test('explicit deletion removes pending, document-resolved and archived captures', { skip: !sqlAvailable }, () => {
  const h = harness(captures(3));
  h.organize.execute({ id: 'c001', action: 'keep' });
  h.organize.execute({ id: 'c002', action: 'keep' });
  h.archiving.flush();
  h.organize.execute({ id: 'c000', action: 'keep' });
  assert.equal(h.remove.execute({ impulseId: 'c000' }).ok, true);
  assert.equal(h.remove.execute({ impulseId: 'c001' }).ok, true);
  assert.equal(h.remove.execute({ impulseId: 'missing' }).ok, false);
  assert.deepEqual(h.history.page({}).items.map(item => item.id), ['c002']);
  assert.equal(h.repository.snapshot().impulses.length, 0);
});

test('deleting a mood note also deletes its archived source capture', { skip: !sqlAvailable }, () => {
  const h = harness(captures(1));
  const kept = h.keepMood.execute({ impulseId: 'c000' });
  assert.equal(kept.ok, true);
  h.archiving.flush();
  assert.equal(h.history.total(), 1);
  assert.equal(h.deleteMood.execute({ id: kept.id }).ok, true);
  assert.equal(h.history.total(), 0);
});

test('a draft label commits together with its action, and nothing commits when the action fails', { skip: !sqlAvailable }, () => {
  const h = harness([{ id: 'c000', text: '有点累', createdAt: NOW - 1000 }]);
  const before = h.repository.revision();
  assert.equal(h.organize.execute({ id: 'c000', action: 'state', category: 'state' }).reason, 'energy-level-required');
  assert.equal(h.repository.revision(), before);
  assert.equal(h.repository.snapshot().impulses[0].classification, null, 'a failed action leaves no half-applied label');
  assert.equal(h.organize.execute({ id: 'c000', action: 'state', category: 'state', level: 35 }).ok, true);
  assert.equal(h.repository.revision(), before + 1);
  const record = h.repository.snapshot().impulses[0];
  assert.deepEqual({ ...record.classification }, { category: 'state', routineKind: null, level: 35 });
  assert.equal(record.resolution.action, 'state');
});

test('keep-all is bounded, closed and popover-only', () => {
  assert.equal(validateIpcPayload('impulses:keep-all', { ids: ['a', 'b'] }).ok, true);
  for (const payload of [{ ids: [] }, { ids: ['a', 'a'] }, { ids: Array.from({ length: 101 }, (_, i) => `x${i}`) }, { ids: ['a'], extra: 1 }]) {
    assert.equal(validateIpcPayload('impulses:keep-all', payload).ok, false);
  }
  assert.deepEqual(allowedSurfacesFor('impulses:keep-all'), ['popover']);
  assert.equal(validateIpcPayload('impulses:history', { cursor: 'offset:30' }).ok, false);
  assert.equal(validateIpcPayload('impulses:history', { cursor: `before:${NOW}:c001` }).ok, true);
});

test('the inbox composition owns every inbox channel and catches up the archive at startup', { skip: !sqlAvailable }, () => {
  const { createInboxOrganization } = require('../src/bootstrap/inbox-organization');
  const h = harness(captures(2));
  h.organize.execute({ id: 'c000', action: 'keep' });
  const dirty = [];
  const errors = [];
  const inbox = createInboxOrganization({
    unitOfWork: h.unitOfWork, readSnapshot: h.repository.snapshot, clock: { now: () => NOW }, idFactory: p => `${p}-x`,
    archive: h.archive, taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25, suggestNextStep: () => ({ title: '打开' }), nextWorkStart: () => NOW },
    publishChange: value => dirty.push(value), reportEffectError: error => errors.push(error)
  });
  const handlers = new Map();
  inbox.register((channel, handler) => handlers.set(channel, handler));
  assert.deepEqual([...handlers.keys()].sort(), ['impulses:delete', 'impulses:history', 'impulses:keep-all', 'impulses:keep-mood',
    'impulses:organize', 'impulses:promote', 'impulses:review', 'mood:delete']);
  assert.deepEqual(h.repository.snapshot().impulses.map(item => item.id), ['c001'], 'startup moved the resolved capture out');
  assert.equal(inbox.historyTotal(), 1);
  assert.equal(handlers.get('impulses:organize')(null, { id: 'c001', action: 'keep', category: 'note' }).ok, true);
  assert.equal(h.repository.snapshot().impulses.length, 0, 'every committed outcome is archived right away');
  assert.equal(handlers.get('impulses:history')(null, {}).total, 2);
  assert.deepEqual(errors, []);
  assert.ok(dirty.some(value => value.impulses));
});
