'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { progress, guidance } = require('../src/capabilities');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createChangeOutboxPublisher } = require('../src/application/ai/change-outbox-publisher');
const { createAcknowledgeAiChangeDeliveryWorkflow } = require('../src/application/workflows/acknowledge-ai-change-delivery');
const { NOW, receiptFixture, AFTER_HASH } = require('../test-support/ai-change-ledger-fixture');
const { aiChangeLedger: ledger } = guidance;
const { buildEvents } = progress.aiChangeEvents;
const temporary = [];
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-timeline-')); temporary.push(dir); return dir; }
test.after(() => temporary.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture(number = 1, patch = {}) {
  const receipt = receiptFixture(number, patch);
  const events = buildEvents({ receipt, occurredAt: receipt.committedAt, timezone: 'Etc/UTC', utcOffsetMinutes: 0,
    localDayKey: new Date(receipt.committedAt).toISOString().slice(0, 10) });
  receipt.eventIds = events.map(event => event.id);
  return { receipt, events };
}
function setup({ timeline, state, failCommit = () => false } = {}) {
  let canonical = structuredClone(state), revision = 0, writes = 0;
  const repository = { snapshot: () => structuredClone(canonical), revision: () => revision,
    commit(candidate) {
      if (failCommit()) throw new Error('injected canonical failure');
      canonical = structuredClone(candidate); revision += 1; writes += 1; return structuredClone(canonical);
    } };
  const unitOfWork = createUnitOfWork({ repository });
  const delivery = createAcknowledgeAiChangeDeliveryWorkflow({ unitOfWork, ledger, ownerId: 'owner-1' });
  const publisher = createChangeOutboxPublisher({ readSnapshot: repository.snapshot, ledger, timeline, delivery,
    ownerId: 'owner-1', now: () => NOW + 100 });
  return { publisher, snapshot: repository.snapshot, writes: () => writes, delivery };
}
function committed(number = 1) {
  const { receipt, events } = fixture(number);
  const result = ledger.appendReceipt(ledger.createLedger(), { receipt, events, now: NOW });
  return { tasks: [{ id: 'task-1', title: 'Business committed exactly once' }], aiCollaboration: result.ledger };
}

test('builder produces deterministic metadata-only entity events and one receipt summary', () => {
  const { receipt, events } = fixture();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.kind), ['task.changed', 'ai.change.applied']);
  assert.deepEqual(buildEvents({ receipt, occurredAt: NOW, timezone: 'Etc/UTC', utcOffsetMinutes: 0, localDayKey: '2026-10-04' }), events);
  assert.equal(events[0].payload.entityRefs[0].version, AFTER_HASH);
  assert.deepEqual(events[1].payload.operationIds, []);
  assert.deepEqual(events[1].payload.entityRefs, []);
  assert.doesNotMatch(JSON.stringify(events), /Old title|New title|Business|transcript|description/);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.ok(events.every(event => event.commandId === receipt.commandId && Object.isFrozen(event)));
});

test('inbox conversion emits actual resolution and target changes without original capture body/date', () => {
  const receipt = receiptFixture();
  receipt.results[0] = { ...receipt.results[0], type: 'inbox.convert-task',
    entityRefs: [{ kind: 'inbox', id: 'inbox-1' }, { kind: 'task', id: 'task-1' }],
    afterVersions: [{ kind: 'inbox', id: 'inbox-1', fingerprint: AFTER_HASH }, ...receipt.results[0].afterVersions] };
  const events = buildEvents({ receipt, occurredAt: NOW, timezone: 'Etc/UTC', utcOffsetMinutes: 0, localDayKey: '2026-10-04' });
  assert.deepEqual(events.map(event => event.kind), ['inbox.resolved', 'task.changed', 'ai.change.applied']);
  assert.ok(events.every(event => event.occurredAt === NOW));
  assert.throws(() => buildEvents({ receipt, occurredAt: NOW - 86400000, timezone: 'Etc/UTC', utcOffsetMinutes: 0, localDayKey: '2026-10-03' }), /receipt-invalid/);
});

test('SQL exact duplicates verify every field and same identity collisions never acknowledge', () => {
  const store = openDatabase({ filePath: ':memory:' });
  const event = fixture().events[0];
  assert.deepEqual(store.timeline.appendConfirmedEvent(event), { ok: true, inserted: true });
  assert.deepEqual(store.timeline.appendConfirmedEvent(structuredClone(event)), { ok: true, inserted: false, verifiedDuplicate: true });
  for (const changed of [{ ...event, receivedAt: NOW + 1 }, { ...event, taskId: null },
    { ...event, payload: { ...event.payload, applyGroupId: 'other-group' } }]) {
    assert.equal(store.timeline.appendConfirmedEvent(changed).reason, 'event-id-conflict');
  }
  assert.deepEqual(store.timeline.readDay('2026-10-04')[0], event);
  store.close();
});

test('crash after canonical commit before publish drains only stored events after restart', () => {
  const original = committed();
  const filePath = path.join(temp(), 'facts.sqlite');
  const store = openDatabase({ filePath });
  const app = setup({ timeline: store.timeline, state: original });
  const result = app.publisher.drain();
  assert.deepEqual(result, { ok: true, attempted: 2, delivered: 2, pending: 0, more: false });
  assert.deepEqual(app.snapshot().tasks, original.tasks);
  assert.equal(app.snapshot().aiCollaboration.receipts.length, 1);
  assert.equal(store.timeline.readDay('2026-10-04').length, 2);
  store.close();
  const reopened = openDatabase({ filePath });
  const restarted = setup({ timeline: reopened.timeline, state: app.snapshot() });
  assert.equal(restarted.publisher.drain().attempted, 0);
  assert.equal(reopened.timeline.readDay('2026-10-04').length, 2);
  reopened.close();
});

test('append success and acknowledgement failure replay the same event without business re-execution', () => {
  const store = openDatabase({ filePath: ':memory:' });
  let blocked = true;
  const original = committed();
  const app = setup({ timeline: store.timeline, state: original, failCommit: () => blocked });
  assert.equal(app.publisher.drain().reason, 'timeline-ack-failed');
  assert.equal(store.timeline.readDay('2026-10-04').length, 1);
  assert.equal(app.snapshot().aiCollaboration.outbox.length, 2);
  blocked = false;
  const restarted = setup({ timeline: store.timeline, state: app.snapshot() });
  assert.equal(restarted.publisher.drain().pending, 0);
  assert.equal(store.timeline.readDay('2026-10-04').length, 2);
  assert.deepEqual(restarted.snapshot().tasks, original.tasks);
  store.close();
});

test('SQL failure, unverified ignore, unsupported tiers and invalid limit retain durable queue', () => {
  for (const timeline of [null, { supportsConfirmedChanges: false },
    { supportsConfirmedChanges: true, appendConfirmedEvent() { throw new Error('SQL failed'); } },
    { supportsConfirmedChanges: true, appendConfirmedEvent: () => ({ ok: true, inserted: false }) }]) {
    const app = setup({ timeline, state: committed() });
    assert.equal(app.publisher.drain().ok, false);
    assert.equal(app.snapshot().aiCollaboration.outbox.length, 2);
    assert.equal(app.publisher.drain({ limit: 101 }).reason, 'drain-limit-invalid');
  }
  const store = openDatabase({ filePath: path.join(temp(), 'fallback.sqlite'), driver: 'jsonl' });
  const app = setup({ timeline: store.timeline, state: committed() });
  assert.equal(app.publisher.drain().reason, 'timeline-unavailable');
  assert.equal(store.timeline.appendConfirmedEvent(fixture().events[0]).ok, false);
  assert.equal(app.snapshot().aiCollaboration.outbox.length, 2);
  store.close();
});

test('bounded drains continue remaining work and foreign owner ack never mutates state', () => {
  const store = openDatabase({ filePath: ':memory:' });
  const app = setup({ timeline: store.timeline, state: committed() });
  assert.equal(app.publisher.drain({ limit: 1 }).more, true);
  const before = app.snapshot();
  const entry = before.aiCollaboration.outbox[0];
  assert.equal(app.delivery.acknowledge({ eventId: entry.eventId, commandId: entry.commandId, ownerId: 'other' }).ok, false);
  assert.deepEqual(app.snapshot(), before);
  assert.equal(app.publisher.drain().pending, 0);
  store.close();
});

test('redacted replay monotonically hides a prior successful append after ack failure', () => {
  const store = openDatabase({ filePath: ':memory:' });
  const state = committed();
  store.timeline.appendConfirmedEvent(state.aiCollaboration.outbox[0].event);
  state.aiCollaboration = ledger.redactDetails(state.aiCollaboration, { ownerId: 'owner-1', receiptIds: ['receipt-1'] }).ledger;
  const app = setup({ timeline: store.timeline, state });
  assert.equal(app.publisher.drain().pending, 0);
  assert.ok(store.timeline.readDay('2026-10-04').every(event => event.redactionState === 'redacted'));
  const day = progress.timelineDay.buildTimelineDay(store.timeline.readDay('2026-10-04'), { dayKey: '2026-10-04' });
  assert.equal(day.markers.length, 1);
  assert.equal(day.markers[0].visibility, 'private');
  store.close();
});

test('causal grouping preserves independent same-time commands, provenance and duration units', () => {
  const first = fixture(), second = fixture(2);
  const day = progress.timelineDay.buildTimelineDay([...first.events, ...second.events], { dayKey: '2026-10-04' });
  assert.equal(day.markers.length, 2);
  assert.ok(day.markers.every(marker => marker.changes.length === 1 && marker.groupedEventIds.length === 2));
  assert.equal(day.totals.focusMs, 0);
  assert.equal(day.markers[0].timezone, 'Etc/UTC');
  const legacy = progress.timelineDay.buildTimelineDay([{ id: 'old', kind: 'task.completed', occurredAt: NOW }], { dayKey: '2026-10-04' });
  assert.equal(legacy.markers[0].receivedAt, null);
  assert.equal(legacy.markers[0].source, null);
});

test('stored DST offsets and travel local-day keys survive SQL and projection unchanged', () => {
  const store = openDatabase({ filePath: ':memory:' });
  const times = [Date.parse('2026-11-01T05:30:00Z'), Date.parse('2026-11-01T06:30:00Z')];
  for (let i = 0; i < times.length; i += 1) {
    const receipt = receiptFixture(i + 1, { committedAt: times[i] });
    const events = buildEvents({ receipt, occurredAt: times[i], timezone: 'America/New_York',
      utcOffsetMinutes: i ? -300 : -240, localDayKey: '2026-11-01' });
    events.forEach(event => assert.equal(store.timeline.appendConfirmedEvent(event).ok, true));
  }
  const day = progress.timelineDay.buildTimelineDay(store.timeline.readDay('2026-11-01'), { dayKey: '2026-11-01' });
  assert.deepEqual(day.markers.map(marker => marker.utcOffsetMinutes), [-240, -300]);
  assert.equal(day.markers[1].occurredAt - day.markers[0].occurredAt, 3600000);
  const receipt = receiptFixture(3, { committedAt: Date.parse('2026-10-03T23:30:00Z') });
  const events = buildEvents({ receipt, occurredAt: receipt.committedAt, timezone: 'Asia/Tokyo', utcOffsetMinutes: 540, localDayKey: '2026-10-04' });
  events.forEach(event => store.timeline.appendConfirmedEvent(event));
  const travel = progress.timelineDay.buildTimelineDay(store.timeline.readDay('2026-10-04'), { dayKey: '2026-10-04' });
  assert.equal(travel.markers.length, 1);
  assert.ok(travel.rangeEnd > travel.rangeStart);
  assert.equal(travel.markers[0].localDayKey, '2026-10-04');
  store.close();
});

test('manual inbox facts omit bodies and use resolution time rather than capture time', () => {
  const captured = progress.timelineFacts.inboxCapturedFacts({ inboxId: 'inbox-1', capturedAt: NOW - 86400000, text: 'secret' });
  const resolved = progress.timelineFacts.inboxResolvedFacts({ inboxId: 'inbox-1', resolvedAt: NOW, action: 'keep', createdAt: NOW - 86400000, text: 'secret' });
  assert.equal(captured[0].dayKey, '2026-10-03');
  assert.equal(resolved[0].dayKey, '2026-10-04');
  assert.doesNotMatch(JSON.stringify([...captured, ...resolved]), /secret|createdAt/);
  assert.deepEqual(progress.timelineFacts.inboxResolvedFacts({ inboxId: 'a', resolvedAt: NOW, action: 'delete' }), []);
});
