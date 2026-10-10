'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverReviewFeature } = require('../src/surfaces/popover/features/review.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const record = id => ({ ok: true, card: { id, kind: 'startup', dayKey: '2026-10-09' }, facts: { kind: 'startup', picks: [] } });
function harness(t, client = {}) {
  const h = createCollaborationDom(), frames = [], calls = [];
  const old = global.requestAnimationFrame; global.requestAnimationFrame = fn => frames.push(fn);
  t.after(() => { global.requestAnimationFrame = old; });
  const node = () => ({ children: [], append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); }, addEventListener() {} });
  h.document.createElement = node; h.document.createTextNode = textContent => ({ textContent });
  h.$('#reviewBody').append = () => {};
  const feature = createPopoverReviewFeature({ ...h, $$: () => [{ dataset: { reviewTaskId: 'task' } }],
    getState: () => ({}), surfaceClient: { openReview: async id => record(id), resolveReview: async (...args) => { calls.push(args); return { ok: true }; }, ...client },
    activeLandingPrompt: () => null, isLandingModalOpen: () => false, renderLanding() {}, rememberLandingReturnFocus() {} });
  feature.mount(); t.after(() => feature.dispose()); return { ...h, feature, calls, frames };
}
test('review open obeys newest request, close and dispose', async t => {
  const a = deferred(), b = deferred();
  const h = harness(t, { openReview: id => (id === 'a' ? a : b).promise });
  const first = h.feature.open('a'), second = h.feature.open('b');
  b.resolve(record('b')); await second; a.resolve(record('a')); await first;
  await h.fire('#reviewDone', 'click'); assert.equal(h.calls[0][0], 'b');
  const late = deferred(); const k = harness(t, { openReview: () => late.promise });
  const opening = k.feature.open('late'); await k.feature.close(); late.resolve(record('late')); await opening;
  assert.equal(k.feature.isOpen(), false); k.frames.forEach(fn => fn()); assert.equal(k.$('#reviewClose').focused, 0);
});
for (const outcome of ['refused', 'thrown']) test(`review ${outcome} save keeps selection and allows retry`, async t => {
  let count = 0;
  const h = harness(t, { resolveReview: async () => { count++; if (count > 1) return { ok: true }; if (outcome === 'thrown') throw new Error('offline'); return { ok: false }; } });
  await h.feature.open('a'); await h.fire('#reviewDone', 'click');
  assert.equal(h.feature.isOpen(), true); assert.equal(h.$('#reviewError').classList.contains('hidden'), false);
  assert.equal(h.$('#reviewDone').disabled, false); await h.fire('#reviewDone', 'click'); assert.equal(h.feature.isOpen(), false);
});
test('review deduplicates submit, permits close and ignores old receipt after reopen', async t => {
  const pending = deferred(); let count = 0;
  const h = harness(t, { resolveReview: () => { count++; return pending.promise; } });
  await h.feature.open('a'); const save = h.fire('#reviewDone', 'click'); await h.fire('#reviewDismiss', 'click');
  assert.equal(count, 1); assert.equal(h.$('#reviewDone').disabled, true);
  await h.feature.close(); await h.feature.open('b'); pending.resolve({ ok: true }); await save;
  assert.equal(h.feature.isOpen(), true); assert.equal(h.$('#reviewDone').disabled, false);
});
test('review failed progress save is visible instead of silently losing the open review', async t => {
  const h = harness(t, { resolveReview: async () => ({ ok: false }) });
  await h.feature.open('a'); await h.feature.close(); assert.equal(h.feature.isOpen(), true);
  assert.equal(h.$('#reviewError').classList.contains('hidden'), false);
});

test('earlier save receipt cannot cancel a newer review that is still opening', async t => {
  const saving = deferred(), opening = deferred();
  const h = harness(t, { openReview: id => id === 'a' ? record('a') : opening.promise, resolveReview: () => saving.promise });
  await h.feature.open('a'); const save = h.fire('#reviewDone', 'click');
  const next = h.feature.open('b'); saving.resolve({ ok: true }); await save;
  opening.resolve(record('b')); await next; assert.equal(h.feature.isOpen(), true);
  assert.equal(h.$('#reviewDone').disabled, false);
});

test('closing native pending-review inbox invalidates an unresolved open', async t => {
  const pending = deferred(); const h = harness(t, { openReview: () => pending.promise });
  const open = h.feature.open('a'); h.fire('#reviewInbox', 'close'); pending.resolve(record('a')); await open;
  assert.equal(h.feature.isOpen(), false);
});
