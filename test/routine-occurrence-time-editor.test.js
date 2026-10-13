'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutineOccurrenceTimeEditor, localDateTime, recorded } = require('../src/surfaces/popover/features/routine-occurrence-time-editor.mjs');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(send = async () => ({ ok: true })) {
  const originalAt = new Date(2026, 9, 13, 9, 12, 34, 456).getTime();
  const records = [{ routineId: 'r', occurrenceId: 'r:2026-10-13:09:00', title: '<tea>', loggedAt: originalAt, status: 'done', answered: true }];
  const fields = new Map();
  const field = selector => {
    if (!fields.has(selector)) fields.set(selector, { value: '', disabled: false, textContent: '', focus() { this.focused = true; } });
    return fields.get(selector);
  };
  const classes = new Set(['hidden']);
  const root = { textContent: '', classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, querySelector: field };
  Object.defineProperty(root, 'innerHTML', { set(value) { this.html = value; fields.clear(); const match = value.match(/value="([^"]*)"/); if (match) field('[data-time-input]').value = match[1]; }, get() { return this.html; } });
  const listeners = new Map();
  let focusCount = 0;
  const button = { focus() { focusCount++; } };
  const $ = selector => selector === '#routineTimeEditor' ? root : selector === '#btnNewRoutine' ? button : null;
  const calls = [];
  const editor = createRoutineOccurrenceTimeEditor({ $, getOccurrences: () => records,
    escapeHTML: value => String(value).replace(/"/g, '&quot;'),
    listen: (node, type, listener) => listeners.set(type, listener),
    surfaceClient: { logRoutine(payload) { calls.push(payload); return send(payload); } } });
  editor.mount();
  const open = () => editor.open(records[0].occurrenceId);
  const input = () => field('[data-time-input]');
  const status = () => field('[data-time-status]').textContent;
  return { editor, open, input, status, field, root, calls, records, listeners, originalAt, classes, focusCount: () => focusCount };
}

test('only actual terminal records have an editor; local formatter preserves seconds', () => {
  assert.equal(recorded({ answered: false, status: 'missed', loggedAt: 1 }), false);
  assert.equal(recorded({ answered: true, status: 'done', loggedAt: null }), false);
  const h = harness(); h.records[0].answered = false;
  assert.equal(h.open(), false);
  assert.equal(localDateTime(h.originalAt), '2026-10-13T09:12:34');
});

test('save sends original identity and CAS without overwriting note or magnitude', async () => {
  const h = harness(); h.open();
  h.input().value = '2026-10-12T19:22';
  await h.editor.save();
  assert.deepEqual(h.calls, [{ routineId: 'r', occurrenceId: h.records[0].occurrenceId, status: 'done',
    at: new Date(2026, 9, 12, 19, 22, 0).getTime(), expectedAt: h.originalAt, expectedStatus: 'done' }]);
  assert.equal(h.classes.has('hidden'), true);
  assert.equal(h.editor.isOpen(), false);
  assert.equal(h.focusCount(), 1);
});

test('minute display preserves original seconds and milliseconds when unchanged', async () => {
  const h = harness(); h.open();
  assert.equal(h.input().value, localDateTime(h.originalAt).slice(0, 16));
  assert.match(h.root.innerHTML, /step="60"/);
  await h.editor.save();
  assert.equal(h.calls[0].at, h.originalAt);
});

test('duplicate clicks and reopening pending same record cannot submit twice', async () => {
  const operation = deferred(); const h = harness(() => operation.promise);
  h.open(); const first = h.editor.save(); await h.editor.save();
  assert.equal(h.input().disabled, true);
  h.editor.close(); h.open(); await h.editor.save();
  assert.equal(h.calls.length, 1);
  operation.resolve({ ok: true }); await first;
  assert.equal(h.classes.has('hidden'), false);
  assert.equal(h.input().disabled, false);
  assert.equal(h.status(), '');
});

test('cancel discards draft and an old success cannot close a new draft or return focus', async () => {
  const operation = deferred(); const h = harness(() => operation.promise);
  h.open(); h.input().value = '2026-10-12T10:00'; const first = h.editor.save();
  h.editor.close(); h.open();
  assert.equal(h.input().value, localDateTime(h.originalAt).slice(0, 16));
  operation.resolve({ ok: true }); await first;
  assert.equal(h.focusCount(), 1);
  assert.equal(h.status(), '');
  assert.match(h.root.innerHTML, /datetime-local/);
});

test('rejected save retains input and supports an explicit retry', async () => {
  let attempts = 0;
  const h = harness(async () => ++attempts === 1 ? { ok: false, reason: 'occurrence-in-future' } : { ok: true });
  h.open(); h.input().value = '2026-10-13T10:00'; await h.editor.save();
  assert.equal(h.input().value, '2026-10-13T10:00');
  assert.match(h.status(), /不能晚于现在/);
  assert.equal(h.field('[data-time-save]').disabled, false);
  await h.editor.save(); assert.equal(h.calls.length, 2);
});

test('transport uncertainty is visible and retains the draft', async () => {
  const h = harness(async () => { throw new Error('private transport detail'); });
  h.open(); h.input().value = '2026-10-13T08:00'; await h.editor.save();
  assert.match(h.status(), /暂未确认/);
  assert.equal(h.input().value, '2026-10-13T08:00');
  assert.doesNotMatch(h.status(), /private/);
});

test('external edits, deletion and undo freeze a stale draft without losing input', async () => {
  for (const change of [h => h.records[0].loggedAt++, h => h.records.splice(0), h => { h.records[0].answered = false; }]) {
    const h = harness(); h.open(); h.input().value = '2026-10-13T08:00';
    change(h); h.editor.refresh(); await h.editor.save();
    assert.match(h.status(), /已变化/);
    assert.equal(h.input().value, '2026-10-13T08:00');
    assert.equal(h.field('[data-time-save]').disabled, true);
    assert.equal(h.calls.length, 0);
  }
});

test('unrelated projection updates preserve typed input and invalid input does not send', async () => {
  const h = harness(); h.open(); h.input().value = ''; h.editor.refresh();
  assert.equal(h.input().value, ''); await h.editor.save();
  assert.match(h.status(), /无效/); assert.equal(h.calls.length, 0);
});

test('Escape cancels and disposal ignores delayed receipt without restoring focus', async () => {
  const h = harness(); h.open(); let stopped = false;
  h.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(h.classes.has('hidden'), true);
  const operation = deferred(); const second = harness(() => operation.promise);
  second.open(); const running = second.editor.save(); second.editor.dispose();
  operation.resolve({ ok: true }); await running;
  assert.equal(second.root.innerHTML, ''); assert.equal(second.focusCount(), 0);
});

test('browser-normalized whole-minute input preserves stored subsecond identity', async () => {
  const h = harness(); h.records[0].loggedAt = new Date(2026, 9, 13, 9, 12, 0, 123).getTime();
  h.open(); h.input().value = '2026-10-13T09:12'; await h.editor.save();
  assert.equal(h.calls[0].at, h.records[0].loggedAt);
});

test('skipped record time correction preserves its original status', async () => {
  const h = harness(); h.records[0].status = 'skipped'; h.open(); await h.editor.save();
  assert.equal(h.calls[0].status, 'skipped'); assert.equal(h.calls[0].expectedStatus, 'skipped');
});

test('a stale server refusal freezes saving until the person reopens the record', async () => {
  const h = harness(async () => ({ ok: false, reason: 'target-changed' }));
  h.open(); await h.editor.save();
  assert.equal(h.field('[data-time-save]').disabled, true);
  assert.match(h.status(), /已变化/);
});

test('old completion cannot release another record save or replace its message', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const h = harness(() => ++calls === 1 ? first.promise : second.promise);
  h.open(); const old = h.editor.save(); h.editor.close();
  h.records.push({ ...h.records[0], occurrenceId: 'another', routineId: 'other' });
  h.editor.open('another'); const active = h.editor.save();
  first.resolve({ ok: false, reason: 'occurrence-outside-window' }); await old;
  assert.equal(h.input().disabled, true); assert.match(h.status(), /正在保存/);
  second.resolve({ ok: true }); await active;
});

test('locale changes repaint labels and failure receipts without replacing typed dates', async () => {
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  const h = harness(async () => ({ ok: false, reason: 'occurrence-in-future' }));
  h.open(); h.input().value = '2026-10-13T08:00'; await h.editor.save();
  try {
    setLocale('en'); h.editor.refresh();
    assert.equal(h.input().value, '2026-10-13T08:00');
    assert.equal(h.field('[data-time-save]').textContent, 'Confirm');
    assert.equal(h.status(), 'The recorded time cannot be in the future.');
  } finally { setLocale('zh-CN'); }
});

for (const reason of ['day-full', 'log-full']) test(`capacity refusal ${reason} keeps the draft and states no time was changed`, async () => {
  const h = harness(async () => ({ ok: false, reason }));
  h.open(); h.input().value = '2026-10-13T08:00'; await h.editor.save();
  assert.equal(h.input().value, '2026-10-13T08:00');
  assert.match(h.status(), /已满，原时间保持不变/);
  assert.equal(h.field('[data-time-save]').disabled, false);
});
