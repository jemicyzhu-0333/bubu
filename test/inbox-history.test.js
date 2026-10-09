'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInboxHistory } = require('../src/surfaces/popover/features/inbox-history.mjs');
const row = (id, createdAt = 1, targetId = null) => ({ id, text: `Synthetic ${id}`, createdAt,
  resolution: { action: targetId ? 'feeling' : 'keep', category: targetId ? 'feeling' : 'note', targetId } });
const page = (items, extra = {}) => ({ available: true, partial: false, items, total: items.length,
  globalTotal: items.length, nextCursor: null, ...extra });
const unavailable = items => ({ available: false, partial: items.length > 0, items, total: null, globalTotal: null, nextCursor: null });
function fixture() {
  const calls = [], changes = [];
  const history = createInboxHistory({ readPage: input => new Promise((resolve, reject) => calls.push({ input, resolve, reject })),
    onChange: () => changes.push(history.view()) });
  history.setScope('history', '');
  return { history, calls, changes };
}
async function settle(h, result, append = false) {
  const pending = h.history.load(append); h.calls.at(-1).resolve(result); await pending;
}
test('unavailable first page is unknown, never authoritative empty or zero, and retry starts page one', async () => {
  const h = fixture(); h.history.acceptCount(9, 1);
  await settle(h, unavailable([]));
  assert.equal(h.history.view().available, false); assert.equal(h.history.view().total, null);
  assert.equal(h.history.view().globalTotal, null); assert.equal(h.history.view().nextCursor, null);
  assert.equal(h.history.view().canRetry, true);
  await settle(h, page([], { globalTotal: 0 }));
  assert.equal(h.calls.at(-1).input.cursor, null);
  assert.equal(h.history.view().available, true); assert.equal(h.history.view().globalTotal, 0);
});
test('failed refresh retains same-category rows but stale rows cannot authorize source cleanup', async () => {
  const h = fixture(); await settle(h, page([row('a', 1, 'm')]));
  assert.equal(h.history.findSource('a').id, 'a');
  const pending = h.history.load(); assert.equal(h.history.findSource('a'), null);
  h.calls.at(-1).reject(new Error('offline')); await pending;
  assert.deepEqual(h.history.view().items.map(x => x.id), ['a']);
  assert.equal(h.history.findSource('a'), null); assert.equal(h.history.view().globalTotal, null);
});
test('partial authoritative local rows merge by ID and replace stale cached values', async () => {
  const h = fixture(); await settle(h, page([row('a', 1, 'm'), row('b', 2, 'm')]));
  const fresh = { ...row('a', 3, 'm'), text: 'Synthetic revised' };
  await settle(h, unavailable([fresh, row('c', 4)]));
  assert.deepEqual(h.history.view().items.map(x => x.id), ['c', 'a', 'b']);
  assert.equal(h.history.findSource('a').text, fresh.text);
  assert.equal(h.history.findSource('b'), null);
  assert.equal(h.history.view().nextCursor, null);
});
test('failed append disables continuation and next retry rereads page one', async () => {
  const h = fixture(); await settle(h, page([row('a')], { total: 2, globalTotal: 2, nextCursor: 'next' }));
  await settle(h, unavailable([]), true);
  assert.equal(h.calls.at(-1).input.cursor, 'next');
  assert.equal(h.history.view().nextCursor, null);
  const pending = h.history.load(true); assert.equal(h.calls.at(-1).input.cursor, null);
  h.calls.at(-1).resolve(page([row('a'), row('b')])); await pending;
});
test('category and scope changes invalidate late responses and never mix cached rows', async () => {
  const h = fixture(); await settle(h, page([row('old')]));
  const old = h.history.load(); const delayed = h.calls.at(-1);
  h.history.setScope('history', 'feeling');
  assert.deepEqual(h.history.view().items, []);
  await settle(h, page([row('new', 2, 'm')])); delayed.resolve(page([row('late')])); await old;
  assert.deepEqual(h.history.view().items.map(x => x.id), ['new']);
  const pending = h.history.load(); h.history.setScope('pending', 'feeling');
  h.calls.at(-1).resolve(page([row('hidden')])); await pending;
  assert.equal(h.history.findSource('new'), null);
  h.history.setScope('history', 'feeling');
  assert.deepEqual(h.history.view().items.map(x => x.id), ['new']);
});
test('explicit deletion invalidates caches and in-flight responses before a failed reload', async () => {
  const h = fixture(); await settle(h, page([row('delete'), row('keep')]));
  const pending = h.history.load(); const delayed = h.calls.at(-1);
  h.history.invalidateId('delete');
  await settle(h, unavailable([])); delayed.resolve(page([row('delete')])); await pending;
  assert.deepEqual(h.history.view().items.map(x => x.id), ['keep']);
  assert.equal(h.history.view().globalTotal, null);
});
test('mood invalidation removes exact feeling target only and invalidates old page even without cached match', async () => {
  const h = fixture(); await settle(h, page([row('a', 1, 'm'), row('b', 2, 'other'), row('c')]));
  h.history.invalidateMoodSource('m');
  assert.deepEqual(h.history.view().items.map(x => x.id), ['b', 'c']);
  const pending = h.history.load(); h.history.invalidateMoodSource('missing');
  h.calls.at(-1).resolve(page([row('late', 3, 'missing')])); await pending;
  assert.deepEqual(h.history.view().items.map(x => x.id), ['b', 'c']);
});
test('only fresh count projection can replace a query result, not unrelated state redraws', async () => {
  const h = fixture(); h.history.acceptCount(7, 1);
  await settle(h, unavailable([])); h.history.acceptCount(7, 1);
  assert.equal(h.history.view().globalTotal, null);
  await settle(h, page([row('x')], { globalTotal: 3 })); h.history.acceptCount(7, 1);
  assert.equal(h.history.view().globalTotal, 3);
  h.history.acceptCount(8, 2); assert.equal(h.history.view().globalTotal, 8);
  const pending = h.history.load(); h.history.acceptCount(9, 3);
  h.calls.at(-1).resolve(page([], { globalTotal: 4 })); await pending;
  assert.equal(h.history.view().globalTotal, 9);
});
test('dispose prevents late publication, clears text cache and disallows requests', async () => {
  const h = fixture(); await settle(h, page([row('a')]));
  const pending = h.history.load(), length = h.changes.length;
  h.history.dispose(); h.calls.at(-1).resolve(page([row('late')])); await pending;
  assert.equal(h.changes.length, length); assert.deepEqual(h.history.view().items, []);
  assert.equal(h.history.findSource('a'), null);
  await h.history.load(); assert.equal(h.calls.length, 2);
});

test('older count generations cannot overwrite a newer observed count', () => {
  const h = fixture(); h.history.acceptCount(4, 2); h.history.acceptCount(8, 1);
  assert.equal(h.history.view().globalTotal, 4);
});

test('cache merge uses the same code-point ID tie order as archive pagination', async () => {
  const h = fixture(); await settle(h, page(['A', 'B', 'a', 'b'].map(id => row(id))));
  await settle(h, unavailable([]));
  assert.deepEqual(h.history.view().items.map(x => x.id), ['A', 'B', 'a', 'b']);
  await settle(h, page([row('A'), row('B')], { total: 4, globalTotal: 4, nextCursor: 'next' }));
  await settle(h, page([row('a'), row('b')], { total: 4, globalTotal: 4 }), true);
  assert.deepEqual(h.history.view().items.map(x => x.id), ['A', 'B', 'a', 'b']);
});
