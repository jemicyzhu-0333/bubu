'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureEventTime } = require('../src/core/capture-event-time');
const { validateCaptureTriageResult, CAPTURE_TRIAGE_TASK } = require('../src/core/llm/capture-triage-task');
const { createCaptureTriageStatus } = require('../src/application/ai/capture-triage-status');
const at = new Date(2026, 9, 13, 19, 54, 32).getTime();
const impulse = { id: 'i', text: '晚上6点做了1小时健身', createdAt: at };
const eventTime = { dayOffset: 0, time: '18:00', evidence: '晚上6点' };
const triage = { category: 'log', confidence: 95, title: '健身', routineKind: 'movement', level: null, reason: '已完成的活动', eventTime };

test('explicit model time uses the original local capture day and never substitutes a duration or future time', () => {
  assert.equal(captureEventTime(impulse, eventTime, at), new Date(2026, 9, 13, 18).getTime());
  assert.equal(captureEventTime(impulse, { ...eventTime, dayOffset: -1 }, at), new Date(2026, 9, 12, 18).getTime());
  for (const suggestion of [null, { ...eventTime, time: '25:00' }, { ...eventTime, time: '20:00' },
    { ...eventTime, evidence: '1小时' }, { ...eventTime, dayOffset: -2 }, { ...eventTime, evidence: '编造的时刻' }]) {
    assert.equal(captureEventTime(impulse, suggestion, at), null);
  }
});

test('model output validates a bounded time proposal without changing sent fields or requiring legacy output', () => {
  assert.deepEqual(validateCaptureTriageResult(triage).eventTime, eventTime);
  assert.equal(validateCaptureTriageResult({ ...triage, eventTime: null }).eventTime, undefined);
  const { eventTime: ignored, ...legacy } = triage;
  assert.equal(validateCaptureTriageResult(legacy).eventTime, undefined);
  assert.deepEqual(CAPTURE_TRIAGE_TASK.buildInput({ impulseText: impulse.text, routineLog: 'never transmitted' }), { impulseText: impulse.text });
  assert.throws(() => validateCaptureTriageResult({ ...triage, eventTime: { ...eventTime, extra: true } }));
  assert.throws(() => validateCaptureTriageResult({ ...triage, eventTime: { ...eventTime, dayOffset: 1 } }));
});

test('ephemeral suggested time binds the exact capture, kind, successful generation and committed triage', () => {
  const state = { impulses: [structuredClone(impulse)] };
  const status = createCaptureTriageStatus({ readSnapshot: () => state });
  const fact = { impulseId: 'i', capturedAt: at }, old = status.begin(fact), current = status.begin(fact);
  state.impulses[0].triage = { ...triage, at: at + 1 }; delete state.impulses[0].triage.eventTime;
  const result = { changed: true, occurredAt: at - 3600000, triageAt: at + 1, routineKind: 'movement' };
  status.finish(old, result);
  assert.equal(status.read(state.impulses[0]), null);
  status.finish(current, result);
  assert.equal(status.read(state.impulses[0]).occurredAt, result.occurredAt);
  assert.equal(JSON.stringify(state).includes('occurredAt'), false);
  for (const mutate of [item => { item.text += '!'; }, item => { item.createdAt++; },
    item => { item.triage.routineKind = 'rest'; }, item => { item.triage.at++; },
    item => { item.classification = { category: 'log' }; }, item => { item.resolution = { action: 'log' }; }]) {
    const candidate = structuredClone(state.impulses[0]); mutate(candidate); assert.equal(status.read(candidate), null);
  }
  assert.equal(createCaptureTriageStatus({ readSnapshot: () => state }).read(state.impulses[0]), null);
  status.dispose(); assert.equal(status.read(state.impulses[0]), null);
});

test('rendered time drafts win over late AI and unchanged fallback preserves the exact capture instant', async () => {
  const { eventTimeValue, eventTimeAt, parseEventTime, localDateTime } = await import('../src/surfaces/popover/features/inbox-event-time.mjs');
  assert.equal(eventTimeAt(impulse, {}, eventTimeValue(impulse)), at);
  const suggested = { ...impulse, triageStatus: { occurredAt: at - 3600000 } };
  const draft = { eventTime: '2026-10-13T17:30' };
  assert.equal(eventTimeValue(suggested, draft), draft.eventTime);
  assert.equal(eventTimeAt(suggested, draft, draft.eventTime), new Date(2026, 9, 13, 17, 30).getTime());
  assert.equal(eventTimeValue(suggested, { eventTime: '' }), '');
  assert.equal(parseEventTime('2026-02-30T18:00'), null);
  assert.equal(parseEventTime(''), null);
  assert.equal(eventTimeValue(impulse), localDateTime(at));
});
