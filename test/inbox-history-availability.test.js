'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createInboxHistoryQuery, createPopoverStateQuery } = require('../src/application');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { createSqlInboxArchiveRepository, UNAVAILABLE_INBOX_ARCHIVE } = require('../src/platform/persistence/sqlite/inbox-archive-repository');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const { buildStateDelta, applyStateDelta } = require('../src/core/state-channel.mjs');
const { SKINS } = require('../src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');

const NOW = new Date(2026, 9, 7, 12).getTime();
const record = (id, category = 'note', createdAt = NOW) => ({ id, text: `Synthetic ${id}`, createdAt,
  classification: { category, routineKind: null, level: null },
  resolution: { action: category === 'feeling' ? 'feeling' : 'keep', category, at: NOW, targetId: category === 'feeling' ? 'mood' : null } });
const healthyPort = () => ({ available: true, page: () => ({ ok: true, items: [] }),
  count: () => ({ ok: true, total: 0 }), existing: () => ({ ok: true, ids: [] }) });
const query = (archive, rows = []) => createInboxHistoryQuery({ archive, readSnapshot: () => ({ impulses: rows }) });
const unavailable = items => ({ available: false, partial: items.length > 0, items,
  total: null, globalTotal: null, nextCursor: null });

test('archive reads distinguish a healthy empty store from closed SQLite and a missing table', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' });
  assert.equal(store.healthy, true);
  assert.deepEqual(store.inboxArchive.page(), { ok: true, items: [] });
  assert.deepEqual(store.inboxArchive.count(), { ok: true, total: 0 });
  assert.deepEqual(store.inboxArchive.existing(['a']), { ok: true, ids: [] });
  assert.deepEqual(query(store.inboxArchive).page(), { available: true, partial: false,
    items: [], total: 0, globalTotal: 0, nextCursor: null });
  store.close();
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const missingTable = createSqlInboxArchiveRepository({ handle: {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params)
  } });
  for (const archive of [store.inboxArchive, missingTable, UNAVAILABLE_INBOX_ARCHIVE]) {
    assert.equal(archive.page().ok, false);
    assert.equal(archive.count().ok, false);
    assert.equal(archive.existing(['a']).ok, false);
    assert.deepEqual(query(archive).page(), unavailable([]));
    assert.equal(query(archive).total(), null);
  }
});

test('unavailable history returns only bounded, filtered authoritative local records without a cursor', () => {
  const rows = [record('c', 'note', NOW - 1), record('b'), record('a'), record('m', 'feeling'),
    { id: 'pending', text: 'Pending', createdAt: NOW }];
  assert.deepEqual(query(UNAVAILABLE_INBOX_ARCHIVE, rows).page({ category: 'note', limit: 2 }),
    unavailable([rows[2], rows[1]]));
  assert.deepEqual(query(UNAVAILABLE_INBOX_ARCHIVE, rows).page({ category: 'note', cursor: `before:${NOW}:b` }),
    unavailable([rows[0]]));
});

test('missing, throwing and malformed read results never become authoritative empty history', () => {
  const local = record('local');
  const badValues = {
    page: [null, [], { ok: false, items: [record('untrusted')] }, { ok: true },
      { ok: true, items: null }, { ok: true, items: [null] }, { ok: true, items: [{}] },
      { ok: true, items: [{ ...record('x'), createdAt: NaN }] },
      { ok: true, items: [{ ...record('x'), resolution: { action: 'keep' } }] }],
    count: [null, 0, { ok: false, total: 0 }, { ok: true }, { ok: true, total: null },
      { ok: true, total: -1 }, { ok: true, total: NaN }, { ok: true, total: 1.5 }, { ok: true, total: '0' }],
    existing: [null, [], { ok: false, ids: [] }, { ok: true }, { ok: true, ids: null },
      { ok: true, ids: [null] }, { ok: true, ids: ['not-requested'] }, { ok: true, ids: ['local', 'local'] }]
  };
  for (const [method, values] of Object.entries(badValues)) {
    for (const value of values) {
      const archive = { ...healthyPort(), [method]: () => value };
      assert.deepEqual(query(archive, [local]).page(), unavailable([local]), `${method}: ${JSON.stringify(value)}`);
      if (method !== 'page') assert.equal(query(archive, [local]).total(), null);
    }
    for (const replacement of [undefined, () => { throw new Error('Synthetic read failure'); }]) {
      const archive = { ...healthyPort(), [method]: replacement };
      assert.deepEqual(query(archive, [local]).page(), unavailable([local]));
      if (method !== 'page') assert.equal(query(archive, [local]).total(), null);
    }
  }
  for (const archive of [null, undefined, {}]) {
    assert.deepEqual(query(archive, [local]).page(), unavailable([local]));
    assert.equal(query(archive, [local]).total(), null);
  }
});

test('a later read failure discards archive rows and preserves even local rows already copied there', () => {
  const local = record('local');
  const archive = { ...healthyPort(), existing: () => ({ ok: true, ids: ['local'] }),
    page: () => ({ ok: true, items: [record('archive')] }), count: () => ({ ok: false, total: null }) };
  assert.deepEqual(query(archive, [local]).page(), unavailable([local]));
});

test('filtered totals stay distinct from global totals and either count failure marks the page unavailable', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' }); t.after(() => store.close());
  const archived = [record('a'), record('b', 'feeling')];
  assert.equal(store.inboxArchive.put(archived).ok, true);
  const rows = [archived[0], record('c'), record('d', 'feeling')];
  const history = query(store.inboxArchive, rows);
  const result = history.page({ category: 'note' });
  assert.equal(result.available, true); assert.equal(result.partial, false);
  assert.equal(result.total, 2); assert.equal(result.globalTotal, 4); assert.equal(history.total(), 4);
  assert.deepEqual(result.items.map(item => item.id), ['a', 'c']);
  const count = store.inboxArchive.count;
  for (const failedCategory of [null, 'note']) {
    const archive = { ...store.inboxArchive, count: (options = {}) => (options.category || null) === failedCategory
      ? { ok: false } : count(options) };
    assert.deepEqual(query(archive, rows).page({ category: 'note' }), unavailable([rows[0], rows[1]]));
  }
});

test('existing checks every overlap in bounded batches and never returns a partial successful lookup', t => {
  const store = openDatabase({ filePath: ':memory:', driver: 'node:sqlite' }); t.after(() => store.close());
  const rows = Array.from({ length: 501 }, (_, index) => record(`row-${String(index).padStart(3, '0')}`, 'note', NOW - index % 7));
  assert.equal(store.inboxArchive.put(rows).ok, true);
  const ids = rows.map(item => item.id);
  assert.deepEqual(new Set(store.inboxArchive.existing(ids).ids), new Set(ids));
  assert.equal(query(store.inboxArchive, rows).total(), 501);
  const history = query(store.inboxArchive, rows);
  let cursor = null; const seen = [];
  do {
    const page = history.page({ cursor, limit: 100 });
    assert.equal(page.available, true); assert.equal(page.total, 501); assert.equal(page.globalTotal, 501);
    seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 501); assert.equal(new Set(seen).size, 501);
  const batches = [];
  const archive = createSqlInboxArchiveRepository({ handle: { all: (_sql, params) => {
    batches.push(params.length); if (batches.length === 2) throw new Error('Synthetic second-batch failure');
    return params.map(id => ({ id }));
  } } });
  assert.equal(archive.existing(ids).ok, false);
  assert.deepEqual(batches, [500, 1]);
  assert.deepEqual(store.inboxArchive.idsByTarget('keep', 'unused'), { ok: true, ids: [] });
  const moodRows = rows.map(item => ({ ...item, resolution: { ...item.resolution, action: 'feeling', targetId: 'mood' } }));
  assert.equal(store.inboxArchive.put(moodRows).ok, true);
  assert.deepEqual(store.inboxArchive.idsByTarget('feeling', 'mood'), { ok: false, ids: [], reason: 'source-scope-too-large' });
});

test('popover projects unknown counts and scoped count freshness even with unchanged canonical revision', () => {
  const state = normalizePersistedState({}, { now: NOW });
  let count = 7;
  const options = { readSnapshot: () => state, readRevision: () => 3,
    readSession: () => state.focusSession, clock: { now: () => NOW, dayKey: localDayKey },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 17,
    countInboxHistory: () => { if (count instanceof Error) throw count; return count; }
  };
  const projection = createPopoverStateQuery(options);
  const first = projection.execute();
  assert.equal(first.inboxHistoryTotal, 7);
  assert.equal(Number.isSafeInteger(first.inboxHistoryCountVersion), true);
  for (const value of [null, -1, '0', NaN, new Error('Synthetic unavailable count')]) {
    count = value; const next = projection.execute();
    assert.equal(next.inboxHistoryTotal, null);
    assert.ok(next.inboxHistoryCountVersion > first.inboxHistoryCountVersion);
    const unrelated = buildStateDelta(next, { tasks: true });
    assert.equal(Object.hasOwn(unrelated, 'inboxHistoryTotal'), false);
    assert.equal(Object.hasOwn(unrelated, 'inboxHistoryCountVersion'), false);
    const applied = applyStateDelta(first, { revision: 4, dirty: { tasks: true }, delta: unrelated });
    assert.equal(applied.state.inboxHistoryCountVersion, first.inboxHistoryCountVersion);
    const changed = buildStateDelta(next, { impulses: true });
    assert.equal(changed.inboxHistoryTotal, null);
    assert.equal(changed.inboxHistoryCountVersion, next.inboxHistoryCountVersion);
  }
  count = 0; const recovered = projection.execute();
  assert.equal(recovered.inboxHistoryTotal, 0);
  assert.ok(recovered.inboxHistoryCountVersion > first.inboxHistoryCountVersion);
  assert.equal(createPopoverStateQuery({ ...options, countInboxHistory: null }).execute().inboxHistoryTotal, null);
});

test('malformed page ordering, category, bounds and contradictory first-page totals are unavailable', () => {
  const local = record('local');
  const a = record('a'), b = record('b');
  const cases = [
    { items: [a, a], total: 2 },
    { items: [b, a], total: 2 },
    { items: [record('m', 'feeling')], total: 1, options: { category: 'note' } },
    { items: [a, b], total: 2, options: { limit: 1 } },
    { items: [a], total: 1, options: { cursor: `before:${NOW}:a` } },
    { items: [], total: 1 },
    { items: [a], total: 2 },
    { items: [{ ...a, classification: { category: 'unknown', routineKind: null, level: null } }], total: 1 }
  ];
  for (const { items, total, options = {} } of cases) {
    const archive = { ...healthyPort(), page: () => ({ ok: true, items }), count: () => ({ ok: true, total }) };
    assert.deepEqual(query(archive, [local]).page(options), unavailable([local]));
  }
});

test('malformed SQL count rows are never converted into a healthy empty count', () => {
  for (const row of [null, {}, { total: null }, { total: '' }, { total: -1 }, { total: 0.5 }, { total: NaN }]) {
    const archive = createSqlInboxArchiveRepository({ handle: { get: () => row } });
    assert.equal(archive.count().ok, false);
  }
});
