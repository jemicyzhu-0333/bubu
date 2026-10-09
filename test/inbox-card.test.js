'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveClassification, describeTriage } = require('../src/surfaces/popover/features/inbox-triage.mjs');
const { inboxCard, missingField } = require('../src/surfaces/popover/features/inbox-card.mjs');

const escapeHTML = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const state = { routines: { items: [{ id: 'r1', kind: 'meal', title: '午餐', active: true }, { id: 'r2', kind: 'meal', title: '晚餐', active: true }] } };

test('a draft label overlays the stored one without writing it', () => {
  const impulse = { id: 'i1', text: '吃完了', createdAt: 1, triage: { category: 'log', routineKind: 'meal' }, classification: null };
  assert.deepEqual(effectiveClassification(impulse, {}), { category: 'log', routineKind: 'meal', level: null });
  assert.deepEqual(effectiveClassification(impulse, { category: 'state', level: 35 }), { category: 'state', routineKind: null, level: 35 });
  assert.deepEqual(effectiveClassification(impulse, { routineKind: 'snack' }), { category: 'log', routineKind: 'snack', level: null });
  assert.equal(describeTriage(impulse, state, { category: 'feeling' }).action.kind, 'feeling');
});

test('an unclassified capture offers one-tap picks and keeps it as the low-effort default', () => {
  const html = inboxCard({ id: 'i1', text: '睡觉睡觉', createdAt: 1, classification: null }, state, escapeHTML, undefined);
  assert.match(html, /data-inbox-pick="task"/);
  assert.match(html, /data-inbox-action="keep">先留存</);
  assert.doesNotMatch(html, /留在历史/);
  assert.match(html, /待分类/);
  const picked = inboxCard({ id: 'i1', text: '睡觉睡觉', createdAt: 1, classification: null }, state, escapeHTML, { category: 'note' });
  assert.doesNotMatch(picked, /data-inbox-pick=/);
  assert.match(picked, /未保存/);
});

test('details fold away while complete and open on the one missing field', () => {
  assert.equal(missingField({ category: 'log', routineKind: 'meal' }, { matching: state.routines.items, destination: '', title: '' }), 'routine');
  assert.equal(missingField({ category: 'log', routineKind: 'meal' }, { matching: state.routines.items, destination: 'r1', title: '' }), null);
  assert.equal(missingField({ category: 'routine', routineKind: null }, { matching: [], destination: '', title: 'x' }), 'kind');
  assert.equal(missingField({ category: 'state', level: null }, {}), 'level');
  const complete = inboxCard({ id: 'i1', text: '吃完了', createdAt: 1, classification: { category: 'log', routineKind: 'meal', level: null } },
    { routines: { items: [state.routines.items[0]] } }, escapeHTML, undefined);
  assert.match(complete, /<details class="inbox-details" data-missing="">/);
  const ambiguous = inboxCard({ id: 'i1', text: '吃完了', createdAt: 1, classification: { category: 'log', routineKind: 'meal', level: null } }, state, escapeHTML, undefined);
  assert.match(ambiguous, /data-missing="routine" open/);
});

test('retained feeling sources offer explicit associated-source deletion only for a valid missing target', () => {
  const impulse = { id: 'i', text: 'Synthetic source', createdAt: 1,
    resolution: { action: 'feeling', category: 'feeling', targetId: 'm' } };
  const html = inboxCard(impulse, { ...state, moodNotes: [] }, escapeHTML);
  assert.match(html, /来源记录仍保留/);
  assert.match(html, /data-inbox-action="delete-mood-source"/);
  assert.match(html, /删除关联来源/);
  for (const targetId of [null, '', '   ', 'x'.repeat(65)]) {
    assert.doesNotMatch(inboxCard({ ...impulse, resolution: { ...impulse.resolution, targetId } }, state, escapeHTML), /delete-mood-source/);
  }
  assert.doesNotMatch(inboxCard(impulse, { ...state, moodNotes: [{ id: 'm' }] }, escapeHTML), /delete-mood-source|来源记录仍保留/);
  assert.doesNotMatch(inboxCard({ ...impulse, resolution: { ...impulse.resolution, action: 'keep' } }, state, escapeHTML), /delete-mood-source/);
});
