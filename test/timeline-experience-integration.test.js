'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimelineDay } = require('../src/capabilities/progress/domain/timeline-day');
const facts = require('../src/capabilities/progress/domain/timeline-facts');
const { buildTimelineStory } = require('../src/surfaces/popover/features/timeline-story.mjs');
const { setLocale, getLocale, t } = require('../src/surfaces/shared/interface/i18n.mjs');
const dayKey = '2026-10-12';
const at = (hour, minute = 0) => new Date(2026, 9, 12, hour, minute).getTime();
const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { serverNow: at(20), tasks: [], archivedTasks: [], routines: { items: [{ id: 'stretch', title: 'Stretch' }] }, moodNotes: [] };
function render(events, extraState = {}, filter = 'all') {
  const day = buildTimelineDay(events, { dayKey });
  return { day, story: buildTimelineStory({ day, state: { ...state, ...extraState }, filter, escapeHTML,
    formatMs: ms => `${Math.round(ms / 60000)} min` }) };
}
function routineEvents() {
  return [...facts.routineRemindedFacts({ routineId: 'stretch', occurrenceId: 'stretch:slot1', kind: 'custom', level: 2, remindedAt: at(9) }),
    ...facts.routineLoggedFacts({ routineId: 'stretch', occurrenceId: 'stretch:slot1', kind: 'custom', status: 'done',
      revision: 1, scheduled: true, loggedAt: at(9, 10) })];
}

test('the real day projection exposes only bounded association metadata', () => {
  const events = [...routineEvents(), ...facts.inboxResolvedFacts({ inboxId: 'i1', action: 'feeling', targetId: 'm1', resolvedAt: at(10) })];
  events.push({ id: 'invalid', kind: 'inbox.resolved', occurredAt: at(11),
    payload: { inboxId: 'x'.repeat(513), action: 'unknown', targetId: {}, text: 'PRIVATE UNPROJECTED BODY', unexpected: 'secret' } });
  const { day } = render(events);
  assert.equal(day.markers[0].occurrenceId, 'stretch:slot1');
  assert.equal(day.markers[2].inboxId, 'i1');
  assert.equal(day.markers[2].resolutionAction, 'feeling');
  assert.equal(day.markers[2].targetId, 'm1');
  assert.equal(day.markers[3].inboxId, null);
  assert.equal(day.markers[3].resolutionAction, null);
  assert.equal(day.markers[3].targetId, null);
  assert.doesNotMatch(JSON.stringify(day), /PRIVATE UNPROJECTED BODY|unexpected|secret/);
  assert.ok(Object.isFrozen(day.markers[0]));
});

test('real routine facts produce one outcome row with both original timestamps in details', () => {
  const events = routineEvents(), before = structuredClone(events);
  const { day, story } = render(events);
  assert.equal(story.entryCount, 1);
  assert.equal(story.processRecordCount, 2);
  assert.match(story.markup, /09:00 · 提醒 · Stretch/);
  assert.match(story.markup, /09:10 · 做了 · Stretch/);
  assert.match(story.markup, /2 条过程记录/);
  assert.equal(day.totals.markerCount, 2);
  assert.equal(day.totals.focusMs, 0);
  assert.deepEqual(events, before);
});

test('the real mood process retains deletion identity, supports inbox filtering and escapes private text', () => {
  const events = [...facts.inboxCapturedFacts({ inboxId: 'i1', capturedAt: at(8) }),
    ...facts.inboxResolvedFacts({ inboxId: 'i1', action: 'feeling', targetId: 'm1', resolvedAt: at(12) })];
  const note = { id: 'm1', at: at(8), text: '<script>fixture only</script>' };
  const { story } = render(events, { moodNotes: [note] }, 'inbox');
  assert.equal(story.entryCount, 1);
  assert.match(story.markup, /data-row-id="m1"/);
  assert.match(story.markup, /data-mood-id="m1"/);
  assert.match(story.markup, /3 条过程记录/);
  assert.match(story.markup, /12:00 · 已处理/);
  assert.doesNotMatch(story.markup, /<script>/);
  const deleted = render(events, { moodNotes: [] });
  assert.doesNotMatch(deleted.story.markup, /fixture only|data-mood-id|data-row-id="m1"/);
});

test('the 500 marker cap is explicit and prevents a misleading partial process summary', () => {
  const events = routineEvents();
  for (let i = 0; i < 499; i++) events.push({ id: `change-${i}`, kind: 'task.changed', occurredAt: at(10) + i, payload: {} });
  const { day, story } = render(events);
  assert.equal(day.markers.length, 500);
  assert.equal(day.markersTruncated, true);
  assert.equal(story.entryCount, 500);
  assert.match(story.markup, /仅显示前 500 条记录/);
  assert.doesNotMatch(story.markup, /class="tl-process-count"/);
  assert.equal(render(events.slice(0, 500)).day.markersTruncated, false);
});

test('English process labels preserve user titles and the original facts', context => {
  const locale = getLocale(); context.after(() => setLocale(locale)); setLocale('en');
  const { story } = render(routineEvents());
  assert.match(story.markup, /2 process records/);
  assert.match(story.markup, /Process records/);
  assert.match(story.markup, /Stretch/);
  assert.doesNotMatch(story.markup, /过程记录/);
  assert.equal(t('跳过本次'), 'Skip this time');
  for (const source of ['已转任务', '已预约', '已留作以后', '已建日常', '已记日常', '已记状态', '已留存']) assert.notEqual(t(source), source);
});

function aiReceiptEvents(inboxIds, { committedAt = at(11), redacted = false } = {}) {
  const { buildEvents } = require('../src/capabilities/progress/domain/ai-change-events');
  const { receiptFixture } = require('../test-support/ai-change-ledger-fixture');
  const base = receiptFixture(1, { committedAt, detailsRedacted: redacted });
  const fingerprint = base.results[0].afterVersions[0].fingerprint;
  const receipt = { ...base, results: inboxIds.map((id, index) => ({ opId: `op-${index}`, type: 'inbox.keep', changed: true,
    entityRefs: [{ kind: 'inbox', id }], beforeVersions: [{ kind: 'inbox', id, fingerprint }],
    afterVersions: [{ kind: 'inbox', id, fingerprint }] })) };
  return buildEvents({ receipt, occurredAt: committedAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -new Date(committedAt).getTimezoneOffset(), localDayKey: dayKey });
}

test('AI-organized inbox items read their identity from entity refs and merge into the receipt row', () => {
  const events = [...facts.inboxCapturedFacts({ inboxId: 'i1', capturedAt: at(8) }),
    ...facts.inboxCapturedFacts({ inboxId: 'i2', capturedAt: at(9) }), ...aiReceiptEvents(['i1', 'i2'])];
  const { day, story } = render(events);
  const receipt = day.markers.find(marker => marker.change);
  assert.deepEqual(receipt.changes.map(change => change.inboxId), ['i1', 'i2']);
  assert.equal(story.entryCount, 1);
  assert.match(story.markup, /data-receipt-id="receipt-1"/);
  assert.match(story.markup, /3 条过程记录/);
  assert.match(story.markup, /过程记录\n08:00 · [^\n]+\n09:00 · [^\n]+\n11:00 · /);
});

test('redacted AI receipts and doubly resolved inbox items are never merged', () => {
  const redacted = render([...facts.inboxCapturedFacts({ inboxId: 'i1', capturedAt: at(8) }), ...aiReceiptEvents(['i1'], { redacted: true })]);
  assert.equal(redacted.story.entryCount, 2);
  const twice = render([...facts.inboxCapturedFacts({ inboxId: 'i1', capturedAt: at(8) }),
    ...facts.inboxResolvedFacts({ inboxId: 'i1', action: 'keep', resolvedAt: at(10) }), ...aiReceiptEvents(['i1'])]);
  assert.equal(twice.story.entryCount, 3);
});
