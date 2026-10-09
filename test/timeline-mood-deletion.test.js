'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimelineMoodDeletion } = require('../src/surfaces/popover/features/timeline-mood-deletion.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], renders = [], refreshed = [], notes = new Set(['a', 'b']);
  const feature = createTimelineMoodDeletion({ hasMood: id => notes.has(id),
    sendDelete: id => new Promise((resolve, reject) => calls.push({ id, resolve, reject })),
    render: view => renders.push(view), refresh: day => refreshed.push(day) });
  function begin(id = 'a') { assert.equal(feature.activate(id, '2026-10-07'), 'armed'); assert.equal(feature.activate(id, '2026-10-07'), 'sending'); }
  return { feature, calls, renders, refreshed, notes, begin };
}
test('confirmation is identity-owned and dispatch is single-flight', async () => {
  const h = fixture();
  assert.equal(h.feature.activate('missing', '2026-10-07'), 'blocked');
  assert.equal(h.feature.activate('a', '2026-10-07'), 'armed');
  h.feature.resetArming(); assert.equal(h.feature.activate('a', '2026-10-07'), 'armed');
  assert.equal(h.calls.length, 0);
  assert.equal(h.feature.activate('a', '2026-10-07'), 'sending');
  assert.equal(h.feature.activate('b', '2026-10-08'), 'blocked');
  assert.equal(h.feature.retry(), false); assert.equal(h.feature.dismiss(), false);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].id, 'a');
  h.calls[0].resolve({ ok: true, changed: true, localDeleted: true }); await tick();
  assert.equal(h.feature.view().phase, 'complete'); assert.deepEqual(h.refreshed, ['2026-10-07']);
});
test('partial cleanup retains original identity after its canonical row disappears', async () => {
  const h = fixture(); h.begin(); h.notes.delete('a');
  h.calls[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true }); await tick();
  assert.equal(h.feature.view().phase, 'partial'); assert.equal(h.feature.dismiss(), false);
  h.feature.resetArming(); assert.equal(h.feature.retry(), true); assert.equal(h.calls[1].id, 'a');
  h.calls[1].resolve({ ok: false, reason: 'mood-source-query-unavailable' }); await tick();
  assert.equal(h.feature.view().phase, 'partial');
  h.feature.retry(); h.calls[2].resolve({ ok: true, changed: false, localDeleted: false }); await tick();
  assert.equal(h.feature.view().phase, 'complete'); assert.equal(h.feature.dismiss(), true);
});
test('unknown result is not downgraded by a refused retry; verified absence resolves current state', async () => {
  const h = fixture(); h.begin(); h.calls[0].reject(new Error('reply lost')); await tick();
  assert.equal(h.feature.view().phase, 'unknown');
  h.feature.retry(); h.calls[1].resolve({ ok: false, reason: 'mood-source-query-unavailable' }); await tick();
  assert.equal(h.feature.view().phase, 'unknown');
  h.feature.retry(); h.calls[2].resolve({ ok: true, alreadyAbsent: true, changed: false, localDeleted: false }); await tick();
  assert.equal(h.feature.view().phase, 'complete'); assert.equal(h.feature.view().alreadyAbsent, true);
});
test('first refusal may be dismissed, but malformed and unconfirmed results stay unknown', async () => {
  const h = fixture(); h.begin(); h.calls[0].resolve({ ok: false, reason: 'mood-source-query-unavailable' }); await tick();
  assert.equal(h.feature.view().phase, 'refused'); assert.equal(h.feature.dismiss(), true);
  for (const result of [{ ok: true },
    { ok: true, changed: true, localDeleted: true, durability: 'unconfirmed' },
    { ok: true, changed: true, localDeleted: true, outcome: 'unknown' },
    { ok: true, changed: false, localDeleted: false, alreadyAbsent: 'true' },
    { ok: true, changed: false, localDeleted: false, sourceCleanupPending: 'false' },
    { ok: true, changed: false, localDeleted: false, retrySameIdentity: 'false' },
    { ok: true, changed: true, localDeleted: true, retrySameIdentity: true },
    { ok: true, changed: true, localDeleted: true, sourceCleanupPending: true }, { ok: true, alreadyAbsent: true, changed: true, localDeleted: true },
    { ok: false, reason: 'mood-note-not-found' }, { ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, durability: 'unconfirmed' }]) {
    const x = fixture(); x.begin(); x.calls[0].resolve(result); await tick();
    assert.equal(x.feature.view().phase, 'unknown'); assert.equal(x.feature.dismiss(), false);
  }
});
test('disposed operations cannot render, refresh, retry or start a different deletion', async () => {
  const h = fixture(); h.begin(); const count = h.renders.length; h.feature.dispose();
  h.calls[0].resolve({ ok: true, changed: true, localDeleted: true }); await tick();
  assert.equal(h.renders.length, count); assert.deepEqual(h.refreshed, []);
  assert.equal(h.feature.retry(), false); assert.equal(h.feature.activate('b', '2026-10-08'), 'blocked');
});
test('the operation view retains identity and state, never source text or a canonical record copy', async () => {
  const h = fixture(); h.begin();
  h.calls[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true, text: 'must not retain' }); await tick();
  assert.deepEqual(Object.keys(h.feature.view()).sort(), ['alreadyAbsent','armedMoodId','armedSourceId','busy','canDismiss','canRetry','dayKey','moodId','phase']);
  assert.equal(JSON.stringify(h.renders).includes('must not retain'), false);
});

test('a residual source needs fresh identity-bound confirmation and shares the timeline operation slot', async () => {
  const calls = [], notes = new Set(['live']);
  let source = { id: 'source', text: 'never retained', createdAt: 42,
    resolution: { action: 'feeling', targetId: 'gone', at: 43 } };
  const feature = createTimelineMoodDeletion({ hasMood: id => notes.has(id), findSource: id => id === source?.id ? source : null,
    sendDelete: id => new Promise(resolve => calls.push({ id, resolve })), render() {}, refresh() {} });
  assert.equal(calls.length, 0);
  assert.equal(feature.activateSource('source', 'wrong', '2026-10-07'), 'blocked');
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'armed');
  source = { ...source, resolution: { ...source.resolution, at: 44 } };
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'armed', 'replaced source must be confirmed again');
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'sending');
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'gone');
  assert.equal(feature.activate('live', '2026-10-07'), 'blocked');
  source = null;
  calls[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: false });
  await tick();
  assert.equal(feature.retry(), true); assert.equal(calls[1].id, 'gone');
  calls[1].resolve({ ok: true, changed: false, localDeleted: false }); await tick();
  assert.equal(feature.view().phase, 'complete');
  assert.equal(JSON.stringify(feature.view()).includes('never retained'), false);
});
test('source confirmation cannot survive loss of authoritative row or a reappearing target', () => {
  let authoritative = true, present = false, calls = 0;
  const row = { id: 'source', createdAt: 42, resolution: { action: 'feeling', targetId: 'gone', at: 43 } };
  const feature = createTimelineMoodDeletion({ hasMood: () => present, findSource: () => authoritative ? row : null,
    sendDelete() { calls++; }, render() {}, refresh() {} });
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'armed');
  authoritative = false;
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'blocked');
  authoritative = true;
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'armed');
  present = true;
  assert.equal(feature.activateSource('source', 'gone', '2026-10-07'), 'blocked');
  assert.equal(calls, 0);
});
test('shared subscriptions report arming reset without retaining source content and stop on disposal', async () => {
  const h = fixture(), first = [], second = [];
  const remove = h.feature.subscribe(view => first.push(view));
  h.feature.subscribe(view => second.push(view));
  h.feature.activate('a', '2026-10-07');
  assert.equal(first.at(-1).armedMoodId, 'a');
  h.feature.resetArming(); assert.equal(second.at(-1).armedMoodId, null);
  remove(); const count = first.length;
  h.begin(); assert.equal(first.length, count);
  const before = second.length; h.feature.dispose();
  h.calls[0].resolve({ ok: true, changed: true, localDeleted: true }); await tick();
  assert.equal(second.length, before);
});

test('source cleanup never normalizes a loaded target into a different mood identity', () => {
  let calls = 0;
  for (const targetId of [' mood', 'mood ', 'mood\n', 'x'.repeat(65)]) {
    const source = { id: 'source', createdAt: 1, resolution: { action: 'feeling', targetId, at: 2 } };
    const feature = createTimelineMoodDeletion({ hasMood: () => false, findSource: () => source,
      sendDelete() { calls++; }, render() {}, refresh() {} });
    assert.equal(feature.activateSource('source', targetId, '2026-10-07'), 'blocked');
    feature.dispose();
  }
  assert.equal(calls, 0);
});
