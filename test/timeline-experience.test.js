'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupTimelineExperiences, previousRecordedEnd } = require('../src/surfaces/popover/features/timeline-experience.mjs');

const start = Date.UTC(2026, 9, 12);
const day = { dayKey: '2026-10-12', dayStart: start, dayEnd: start + 86400000 };
const at = minutes => start + minutes * 60000;
function marker(kind, minutes, fields = {}) {
  return { type: 'marker', at: at(minutes), eventId: `${kind}:${minutes}`, marker: { kind, occurredAt: at(minutes), ...fields } };
}
const routine = (kind, minutes, occurrenceId = 'r:slot-1', extra = {}) => marker(`routine.${kind}`, minutes,
  { routineId: 'r', occurrenceId, ...(kind === 'logged' ? { status: 'done' } : {}), ...extra });
const inbox = (kind, minutes, inboxId = 'i1', extra = {}) => marker(`inbox.${kind}`, minutes, { inboxId, ...extra });
const mood = (minutes = 10, id = 'm1') => ({ type: 'mood', at: at(minutes), id, text: 'A private fixture note' });
const group = entries => groupTimelineExperiences(entries, day);

test('one scheduled occurrence presents its answer and retains ordered process members', () => {
  const entries = [routine('reminded', 10), routine('logged', 20)];
  const [result] = group(entries);
  assert.equal(result.at, at(20));
  assert.equal(result.marker.status, 'done');
  assert.deepEqual(result.experienceMembers, entries);
  assert.equal(result.experienceId, 'routine:["r","r:slot-1"]');
});

test('a skipped answer remains skipped and an unanswered window never becomes a completion', () => {
  const skipped = group([routine('reminded', 10), routine('logged', 20, 'r:slot-1', { status: 'skipped' })])[0];
  assert.equal(skipped.marker.status, 'skipped');
  const unanswered = group([routine('reminded', 10), routine('missed', 40)])[0];
  assert.equal(unanswered.marker.kind, 'routine.missed');
  assert.equal(unanswered.marker.status, undefined);
});

test('different slots and free-form taps stay independent despite matching names and times', () => {
  const result = group([routine('reminded', 10), routine('logged', 10),
    routine('reminded', 10, 'r:slot-2'), routine('logged', 10, 'r:free:1')]);
  assert.equal(result.length, 3);
  assert.equal(result.filter(entry => entry.experienceMembers).length, 1);
});

test('the occurrence and routine identities must both match', () => {
  assert.equal(group([routine('reminded', 10), routine('logged', 11, 'r:slot-1', { routineId: 'other' })]).length, 2);
});

test('missing, invalid and overlong identities never collapse legacy records', () => {
  for (const occurrenceId of [null, undefined, '', ' ', 0, {}, [], 'x'.repeat(513)]) {
    assert.equal(group([routine('reminded', 10, 'unused', { occurrenceId }),
      routine('logged', 10, 'unused', { occurrenceId })]).length, 2);
  }
});

test('conflicting answers are not resolved by a timestamp heuristic', () => {
  const entries = [routine('reminded', 10), routine('logged', 20), routine('logged', 30, 'r:slot-1', { status: 'skipped' })];
  assert.deepEqual(group(entries), entries);
});

test('undo and subsequent redraw do not retain an obsolete completion', () => {
  const reminder = routine('reminded', 10), completed = routine('logged', 20);
  assert.equal(group([reminder, completed]).length, 1);
  const afterUndo = group([reminder]);
  assert.deepEqual(afterUndo, [reminder]);
  assert.equal(afterUndo[0].experienceMembers, undefined);
});

test('one inbox capture and resolution form a process without changing either timestamp', () => {
  const entries = [inbox('captured', 10), inbox('resolved', 50, 'i1', { resolutionAction: 'keep' })];
  const [result] = group(entries);
  assert.equal(result.at, at(50));
  assert.deepEqual(result.experienceMembers.map(entry => entry.at), [at(10), at(50)]);
});

test('an exact mood target folds receipt rows while retaining mood time and deletion identity', () => {
  const note = mood();
  const [result] = group([inbox('captured', 10), note,
    inbox('resolved', 60, 'i1', { resolutionAction: 'feeling', targetId: 'm1' })]);
  assert.equal(result.type, 'mood');
  assert.equal(result.id, 'm1');
  assert.equal(result.at, at(10));
  assert.equal(result.experienceMembers.length, 3);
});

test('missing or unrelated mood targets cannot hide a separate personal record', () => {
  for (const targetId of [null, undefined, 'other']) {
    const entries = [inbox('captured', 10), mood(), inbox('resolved', 10, 'i1', { resolutionAction: 'feeling', targetId })];
    const result = group(entries);
    assert.equal(result.length, 2);
    assert.equal(result.find(entry => entry.type === 'mood').experienceMembers, undefined);
  }
});

test('two sources claiming one mood are ambiguous, rather than first-match wins', () => {
  const result = group([mood(), inbox('captured', 10),
    inbox('resolved', 20, 'i1', { resolutionAction: 'feeling', targetId: 'm1' }),
    inbox('captured', 11, 'i2'), inbox('resolved', 21, 'i2', { resolutionAction: 'feeling', targetId: 'm1' })]);
  assert.equal(result.length, 3);
  assert.equal(result.find(entry => entry.type === 'mood').experienceMembers, undefined);
});

test('removing a mood invalidates the displayed content and all process-detail copies', () => {
  const receipts = [inbox('captured', 10), inbox('resolved', 60, 'i1', { resolutionAction: 'feeling', targetId: 'm1' })];
  assert.match(JSON.stringify(group([...receipts, mood()])), /A private fixture note/);
  assert.doesNotMatch(JSON.stringify(group(receipts)), /A private fixture note/);
});

test('inbox-to-routine links without occurrence identity do not absorb routine records', () => {
  const result = group([inbox('captured', 10), inbox('resolved', 20, 'i1', { resolutionAction: 'log', targetId: 'r' }),
    routine('logged', 10)]);
  assert.equal(result.length, 2);
  assert.equal(result.find(entry => entry.marker.kind === 'routine.logged').experienceMembers, undefined);
});

test('private, redacted and AI-receipt records retain their own presentation boundary', () => {
  for (const extra of [{ visibility: 'private' }, { redactionState: 'redacted' }, { change: { receiptId: 'receipt' } }]) {
    assert.equal(group([routine('reminded', 10), routine('logged', 20, 'r:slot-1', extra)]).length, 2);
  }
});

test('cross-day, inconsistent stored day and truncated histories do not invent a complete process', () => {
  const entries = [routine('reminded', -5), routine('logged', 10)];
  assert.equal(group(entries).length, 2);
  const inconsistent = [routine('reminded', 5, 'r:slot-1', { localDayKey: '2026-10-11' }), routine('logged', 10)];
  assert.equal(group(inconsistent).length, 2);
  const truncated = [routine('reminded', 5), routine('logged', 10)];
  assert.deepEqual(groupTimelineExperiences(truncated, { ...day, markersTruncated: true }), truncated);
});

test('grouping never changes the input facts, focus durations or independent sessions', () => {
  const focus = { type: 'focus', at: at(30), end: at(45), durationMs: 900000, sessionId: 's1' };
  const entries = [routine('reminded', 10), routine('logged', 20), focus];
  const before = structuredClone(entries);
  for (const entry of entries) { if (entry.marker) Object.freeze(entry.marker); Object.freeze(entry); }
  Object.freeze(entries);
  const result = group(entries);
  assert.deepEqual(entries, before);
  assert.equal(result.find(entry => entry.type === 'focus'), focus);
});

test('gap labels account for process evidence and overlapping focus hidden by a filter', () => {
  const entries = [inbox('captured', 70), inbox('resolved', 180),
    { type: 'focus', at: at(80), end: at(140), durationMs: 3600000 }];
  assert.equal(previousRecordedEnd(entries, at(180), at(10)), at(140));
});
