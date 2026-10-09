'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAiChangeEvent } = require('../src/core/ai-change-event-contract');
function event() { return { id: 'event-1', schemaVersion: 1, occurredAt: Date.UTC(2026, 9, 4, 23, 45),
  receivedAt: Date.UTC(2026, 9, 4, 23, 46), timezone: 'Asia/Tokyo', utcOffsetMinutes: 540,
  localDayKey: '2026-10-05', dayKey: '2026-10-05', kind: 'ai.change.applied', actor: 'user',
  source: 'ai-collaboration', correlationId: 'change-1', causationId: 'command-1', commandId: 'command-1',
  entityVersion: null, visibility: 'normal', redactionState: 'none', taskId: null, sessionId: null, durationMs: null,
  payload: { receiptId: 'receipt-1', applyGroupId: 'group-1', operationIds: [], entityRefs: [], count: 1, revertsReceiptId: null } }; }
test('receipt events retain explicit timezone/offset/day rather than guessing old metadata', () => {
  assert.equal(validateAiChangeEvent(event()).dayKey, '2026-10-05');
  assert.throws(() => validateAiChangeEvent({ ...event(), timezone: 'Invalid/Zone' }), /event-invalid/);
  assert.throws(() => validateAiChangeEvent({ ...event(), localDayKey: '2026-10-04', dayKey: '2026-10-04' }), /event-invalid/);
});
test('receipt event rejects body content and is deeply immutable', () => {
  assert.throws(() => validateAiChangeEvent({ ...event(), payload: { ...event().payload, text: 'private text' } }), /payload-invalid/);
  const safe = validateAiChangeEvent(event());
  assert.throws(() => safe.payload.operationIds.push('op'), TypeError);
});

test('receipt events verify timezone DST offset and accept established slash IDs', () => {
  assert.throws(() => validateAiChangeEvent({ ...event(), utcOffsetMinutes: 480 }), /event-invalid/);
  assert.equal(validateAiChangeEvent({ ...event(), id: 'event/1' }).id, 'event/1');
  const summer = { ...event(), occurredAt: Date.UTC(2026, 6, 4, 12), timezone: 'America/New_York',
    utcOffsetMinutes: -240, localDayKey: '2026-07-04', dayKey: '2026-07-04' };
  assert.equal(validateAiChangeEvent(summer).utcOffsetMinutes, -240);
  assert.throws(() => validateAiChangeEvent({ ...summer, utcOffsetMinutes: -300 }), /event-invalid/);
});
