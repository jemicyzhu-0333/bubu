'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aiChangeLedger: ledger } = require('../src/capabilities/guidance');
const { NOW, HASH, receiptFixture, summaryFixture, appendFixture, identityOf } = require('../test-support/ai-change-ledger-fixture');

function immutable(value) {
  Object.freeze(value);
  Object.values(value).filter(item => item && typeof item === 'object').forEach(immutable);
  return value;
}
function assertRejected(mutator, pattern = /validation|ai-change-event/) {
  const candidate = structuredClone(appendFixture().ledger);
  mutator(candidate);
  const before = structuredClone(candidate);
  assert.throws(() => ledger.normalizeLedger(candidate), pattern);
  assert.deepEqual(candidate, before, 'validation never repairs or drops the bad record');
}

test('guidance facade exposes an immutable, clock-free fixed-point receipt/outbox ledger', () => {
  const initial = immutable(ledger.createLedger());
  const result = appendFixture(initial);
  assert.equal(result.ok, true);
  assert.deepEqual(initial, ledger.createLedger());
  assert.equal(result.ledger.nextCommitSequence, 2);
  assert.equal(result.ledger.receipts.length, 1);
  assert.equal(result.ledger.outbox.length, 1);
  const normalized = ledger.normalizeLedger(immutable(result.ledger));
  assert.deepEqual(normalized, result.ledger);
  normalized.receipts[0].results[0].entityRefs[0].id = 'mutated-copy';
  assert.equal(result.ledger.receipts[0].results[0].entityRefs[0].id, 'task-1');
});

test('exact identity replay returns the recorded outcome even after its confirmation expires', () => {
  const original = appendFixture();
  const receipt = receiptFixture();
  const retried = ledger.appendReceipt(original.ledger, { receipt, events: [summaryFixture(receipt)], now: NOW + 100000000 });
  assert.equal(retried.replayed, true);
  assert.deepEqual(retried.ledger, original.ledger);
  assert.deepEqual(retried.receipt, original.receipt);
  assert.deepEqual(ledger.findReceipt(original.ledger, identityOf(receipt)), receipt);
});

test('owner and any disclosure, preview or operation hash mismatch fail closed', () => {
  const { ledger: state, receipt } = appendFixture();
  for (const key of ['ownerId', 'operationsHash', 'previewHash', 'disclosureHash']) {
    const identity = { ...identityOf(receipt), [key]: key === 'ownerId' ? 'owner-2' : 'c'.repeat(64) };
    assert.throws(() => ledger.findReceipt(state, identity), /mismatch/);
  }
  assert.throws(() => ledger.findReceipt(state, { ...identityOf(receipt), consent: true }), /identity-invalid/);
});

test('new expired confirmations and mismatched commit sequences produce no candidate write', () => {
  const initial = ledger.createLedger();
  const receipt = receiptFixture();
  const events = [summaryFixture(receipt)];
  assert.equal(ledger.appendReceipt(initial, { receipt, events, now: receipt.confirmationExpiresAt }).reason, 'confirmation-expired');
  receipt.commitSequence = 2;
  assert.equal(ledger.appendReceipt(initial, { receipt, events, now: NOW }).reason, 'commit-sequence-conflict');
  assert.deepEqual(initial, ledger.createLedger());
});

test('applied operation IDs remain consumed under a new proposal version or another group', () => {
  const first = appendFixture();
  for (const patch of [{ proposalVersion: 2 }, { applyGroupId: 'group-2' }]) {
    const second = receiptFixture(2, { changeSetId: first.receipt.changeSetId, ...patch });
    second.results[0].opId = first.receipt.results[0].opId;
    second.details.diff[0].opId = second.results[0].opId;
    assert.throws(() => ledger.appendReceipt(first.ledger, { receipt: second, events: [summaryFixture(second)], now: NOW }), /operation-already-applied/);
  }
});

test('normalization rejects lost fields, unknown data, future versions, duplicate identities and sequence corruption', () => {
  for (const mutate of [
    state => { delete state.receipts; }, state => { state.version = 2; }, state => { state.outbox = null; },
    state => { state.transcript = 'private body'; }, state => { state.receipts[0].messages = ['private']; },
    state => { state.receipts[0].results[0].body = 'inbox content'; }, state => { delete state.receipts[0].previewHash; },
    state => { state.receipts.push(structuredClone(state.receipts[0])); },
    state => { state.nextCommitSequence = 1; }, state => { state.nextCommitSequence = Number.MAX_SAFE_INTEGER + 1; },
    state => { state.receipts[0].commitSequence = 1.5; }, state => { state.receipts[0].detailsRedacted = true; },
    state => { state.receipts[0].details.expiresAt = NOW + ledger.DETAILS_TTL_MS + 1; }
  ]) assertRejected(mutate);
});

test('orphans, duplicated outbox, wrong owner/command and hidden payload fields are rejected without dropping events', () => {
  for (const mutate of [
    state => { state.receipts = []; }, state => { state.outbox.push(structuredClone(state.outbox[0])); },
    state => { state.outbox[0].ownerId = 'owner-2'; }, state => { state.outbox[0].commandId = 'command-other'; },
    state => { state.outbox[0].event.payload.body = 'private body'; },
    state => { state.outbox[0].event.payload.receiptId = 'receipt-other'; },
    state => { state.outbox[0].event.payload.applyGroupId = 'group-other'; },
    state => { state.outbox[0].event.payload.count = 2; },
    state => { state.outbox[0].event.occurredAt += 1; },
    state => { state.outbox[0].event.entityVersion = HASH; },
    state => { state.outbox[0].lastErrorCode = 'private raw error'; },
    state => { state.outbox[0].attempts = -1; }
  ]) assertRejected(mutate);
});

test('events require a one-to-one receipt ID list and exactly one neutral summary', () => {
  const receipt = receiptFixture();
  for (const events of [[], [summaryFixture(receipt), summaryFixture(receipt)]]) {
    assert.throws(() => ledger.appendReceipt(ledger.createLedger(), { receipt, events, now: NOW }), /events-invalid/);
  }
  const wrong = summaryFixture(receipt); wrong.id = 'other-event';
  assert.throws(() => ledger.appendReceipt(ledger.createLedger(), { receipt, events: [wrong], now: NOW }), /events-invalid/);
});

test('only typed compensation and bounded allowlisted field differences survive canonical validation', () => {
  for (const mutate of [
    state => { state.receipts[0].details.undo.operations[0].fields[0].field = 'xp'; },
    state => { state.receipts[0].details.undo.operations[0].snapshot = { tasks: [] }; },
    state => { state.receipts[0].details.undo.operations[0].type = 'restore-anything'; },
    state => { state.receipts[0].details.diff[0].fields[0].field = 'transcript'; },
    state => { state.receipts[0].details.diff[0].fields[0].after = { secret: 'body' }; },
    state => { state.receipts[0].details.diff[0].fields[0].after = 'x'.repeat(501); },
    state => { state.receipts[0].details.evidenceRefs = [{ kind: 'message', id: 'message-1', revision: null, text: 'private' }]; },
    state => { state.receipts[0].details.undo.expectedPostVersions[0].fingerprint = 'c'.repeat(64); },
    state => { state.receipts[0].details.undo.operations[0].seriesFields = [{ field: 'title', value: 'Forbidden current-only template' }]; }
  ]) assertRejected(mutate);
});

test('delivery failures retain pending events and log only mapped metadata; acknowledgement is idempotent and identity bound', () => {
  const first = appendFixture();
  const identity = { eventId: 'event-1', ownerId: 'owner-1', commandId: 'command-1' };
  const failed = ledger.recordDeliveryFailure(first.ledger, { ...identity, now: NOW + 50, errorCode: 'timeline-write-failed' });
  assert.equal(failed.ledger.outbox[0].attempts, 1);
  assert.equal(failed.ledger.outbox[0].lastAttemptAt, NOW + 50);
  assert.equal(first.ledger.outbox[0].attempts, 0);
  assert.throws(() => ledger.recordDeliveryFailure(first.ledger, { ...identity, now: NOW, errorCode: 'Raw error containing a title' }), /failure-invalid/);
  assert.throws(() => ledger.acknowledgeEvent(first.ledger, { ...identity, ownerId: 'owner-2' }), /identity-mismatch/);
  const ack = ledger.acknowledgeEvent(failed.ledger, identity);
  assert.equal(ack.changed, true);
  assert.equal(ack.ledger.outbox.length, 0);
  assert.deepEqual(ack.ledger.receipts, first.ledger.receipts);
  assert.equal(ledger.acknowledgeEvent(ack.ledger, identity).changed, false);
});

test('detail expiry and privacy redaction preserve all body-free dedupe identities and undelivered events', () => {
  const first = appendFixture();
  assert.equal(ledger.pruneDetails(first.ledger, { now: NOW + ledger.DETAILS_TTL_MS - 1 }).changed, false);
  const pruned = ledger.pruneDetails(first.ledger, { now: NOW + ledger.DEDUPE_TTL_MS * 2 });
  assert.equal(pruned.ledger.receipts.length, 1);
  assert.equal(pruned.ledger.receipts[0].details, null);
  assert.equal(pruned.ledger.receipts[0].detailsRedacted, true);
  assert.equal(pruned.ledger.outbox.length, 1);
  assert.equal(pruned.ledger.outbox[0].event.visibility, 'private');
  assert.equal(pruned.ledger.outbox[0].event.redactionState, 'redacted');
  assert.deepEqual(identityOf(pruned.ledger.receipts[0]), identityOf(first.receipt));
  assert.deepEqual(pruned.ledger.receipts[0].results, first.receipt.results);
  assert.equal(JSON.stringify(pruned).includes('Old title'), false);
  assert.throws(() => ledger.redactDetails(first.ledger, { ownerId: 'wrong', receiptIds: ['receipt-1'] }), /owner-mismatch/);
  assert.equal(ledger.redactDetails(first.ledger, { ownerId: 'owner-1', receiptIds: ['receipt-1'] }).changed, true);
});

test('compensation appends a new receipt and links both outcomes atomically, and cannot be repeated', () => {
  const first = appendFixture();
  const undo = receiptFixture(2, { revertsReceiptId: 'receipt-1' });
  undo.results[0].type = 'task.restore';
  undo.details.diff[0].type = 'task.restore';
  undo.details.diff[0].reversibility = { status: 'unavailable', reason: 'compensation-not-reversible' };
  undo.details.undo = null;
  const result = ledger.appendReceipt(first.ledger, { receipt: undo, events: [summaryFixture(undo)], now: NOW });
  assert.equal(result.ok, true);
  assert.equal(first.ledger.receipts[0].status, 'applied');
  assert.equal(result.ledger.receipts[0].status, 'reverted');
  assert.equal(result.ledger.receipts[0].revertedByReceiptId, undo.receiptId);
  assert.equal(result.ledger.receipts[0].details.undo, null);
  assert.equal(ledger.markReverted(result.ledger, { receiptId: 'receipt-1', revertedByReceiptId: 'receipt-2' }).ok, true);
  assertRejected(state => { state.receipts[0].status = 'reverted'; state.receipts[0].revertedByReceiptId = 'missing'; });
});

test('capacity and sequence exhaustion fail closed rather than evicting live receipt or outbox data', () => {
  const state = ledger.createLedger();
  state.nextCommitSequence = Number.MAX_SAFE_INTEGER;
  assert.equal(ledger.capacityFor(state, { receipts: 1, eventCount: 1, now: NOW }).reason, 'commit-sequence-exhausted');
  const full = ledger.createLedger();
  for (let number = 1; number <= ledger.MAX_RECEIPTS; number += 1) {
    full.receipts.push(receiptFixture(number, { details: null, detailsRedacted: true }));
  }
  full.nextCommitSequence = ledger.MAX_RECEIPTS + 1;
  assert.equal(ledger.normalizeLedger(full).receipts.length, ledger.MAX_RECEIPTS);
  assert.equal(ledger.capacityFor(full, { receipts: 1, now: NOW }).reason, 'receipt-capacity');
  assert.equal(ledger.capacityFor(appendFixture().ledger, { receipts: 0, eventCount: ledger.MAX_OUTBOX }).reason, 'outbox-capacity');
  full.receipts.push(receiptFixture(ledger.MAX_RECEIPTS + 1));
  assert.throws(() => ledger.normalizeLedger(full), /ledger-invalid/);
});

test('JSON-incompatible fields, sparse arrays, symbols and accessors cannot be silently stripped', () => {
  const candidate = appendFixture().ledger;
  candidate.outbox[0].event[Symbol('hidden-body')] = 'private';
  assert.throws(() => ledger.normalizeLedger(candidate), /ledger-invalid/);
  delete candidate.outbox[0].event[Reflect.ownKeys(candidate.outbox[0].event).find(key => typeof key === 'symbol')];
  Object.defineProperty(candidate.outbox[0].event, 'timezone', { enumerable: true, get() { throw new Error('getter ran'); } });
  assert.throws(() => ledger.normalizeLedger(candidate), /ledger-invalid/);
  const sparse = ledger.createLedger(); sparse.receipts = Array(1); sparse.receipts.secret = 'private';
  assert.throws(() => ledger.normalizeLedger(sparse), /ledger-invalid/);
});

test('per-operation events bind their kind, entity fingerprint and task ID to the receipt result', () => {
  const receipt = receiptFixture(); receipt.eventIds.push('task-event-1');
  const summary = summaryFixture(receipt);
  const event = { ...summary, id: 'task-event-1', kind: 'task.changed', taskId: 'task-1',
    entityVersion: receipt.results[0].afterVersions[0].fingerprint,
    payload: { ...summary.payload, operationIds: ['op-1'], entityRefs: [{ kind: 'task', id: 'task-1',
      version: receipt.results[0].afterVersions[0].fingerprint }], count: 1 } };
  const result = ledger.appendReceipt(ledger.createLedger(), { receipt, events: [summary, event], now: NOW });
  assert.equal(result.ledger.outbox.length, 2);
  for (const patch of [
    value => { value.kind = 'inbox.resolved'; }, value => { value.taskId = 'task-other'; },
    value => { value.payload.operationIds = ['op-other']; },
    value => { value.payload.entityRefs[0].version = 'c'.repeat(64); },
    value => { value.payload.entityRefs[0].id = 'task-other'; },
    value => { value.entityVersion = 'c'.repeat(64); }
  ]) {
    const bad = structuredClone(result.ledger); patch(bad.outbox[1].event);
    assert.throws(() => ledger.normalizeLedger(bad), /outbox-result-invalid/);
  }
});

test('routine compensation and inbox metadata are validated by their exact closed value grammars', () => {
  const receipt = receiptFixture();
  receipt.results[0].type = 'routine.schedule';
  receipt.results[0].entityRefs[0] = { kind: 'routine', id: 'routine-1' };
  for (const ref of [...receipt.results[0].beforeVersions, ...receipt.results[0].afterVersions]) {
    ref.kind = 'routine'; ref.id = 'routine-1';
  }
  const schedule = { frequency: 'weekly', timesOfDay: ['09:00', '18:00'], weekdays: [1, 3], windowMinutes: 60 };
  receipt.details.diff[0] = { ...receipt.details.diff[0], type: 'routine.schedule', entityRef: { kind: 'routine', id: 'routine-1' },
    fields: [{ field: 'schedule', before: null, after: schedule }] };
  receipt.details.undo.operations = [{ type: 'routine.restore-schedule', entityId: 'routine-1', timezone: 'Etc/UTC', schedule: null }];
  receipt.details.undo.expectedPostVersions = structuredClone(receipt.results[0].afterVersions);
  const valid = ledger.appendReceipt(ledger.createLedger(), { receipt, events: [summaryFixture(receipt)], now: NOW });
  assert.equal(valid.ok, true);
  const bad = structuredClone(valid.ledger);
  bad.receipts[0].details.diff[0].fields[0].after.weekdays = [3, 1];
  assert.throws(() => ledger.normalizeLedger(bad), /receipt-invalid/);
  bad.receipts[0].details.diff[0].fields[0].after = schedule;
  bad.receipts[0].details.undo.operations[0].timezone = 'Invalid/Zone';
  assert.throws(() => ledger.normalizeLedger(bad), /receipt-invalid/);
});

function largeReceipt(number, rows = 2) {
  const receipt = receiptFixture(number);
  const steps = Array.from({ length: 100 }, (_, index) => ({ id: `step-${index}`, title: 'é'.repeat(200),
    done: false, completedAt: null, completionCycle: 0 }));
  receipt.results[0].entityRefs = Array.from({ length: rows }, (_, index) => ({ kind: 'task', id: `task-${index + 1}` }));
  receipt.details.diff = receipt.results[0].entityRefs.map(ref => ({ ...receipt.details.diff[0], entityRef: ref,
    fields: [{ field: 'steps', before: steps, after: steps }] }));
  return receipt;
}

test('byte capacities reject rather than truncating receipt details or the durable ledger', () => {
  const tooLarge = largeReceipt(1, 3);
  assert.throws(() => ledger.appendReceipt(ledger.createLedger(), { receipt: tooLarge,
    events: [summaryFixture(tooLarge)], now: NOW }), /receipt-capacity/);
  const state = ledger.createLedger();
  const sample = largeReceipt(1);
  assert.ok(Buffer.byteLength(JSON.stringify(sample)) < ledger.MAX_RECEIPT_BYTES);
  let number = 1;
  while (Buffer.byteLength(JSON.stringify(state)) + Buffer.byteLength(JSON.stringify(sample)) < ledger.MAX_LEDGER_BYTES - 4096) {
    state.receipts.push(largeReceipt(number));
    number += 1;
  }
  state.nextCommitSequence = number;
  const next = largeReceipt(number);
  assert.equal(ledger.capacityFor(state, { receipt: next, events: [summaryFixture(next)], now: NOW }).reason, 'ledger-capacity');
  state.receipts.push(next); state.nextCommitSequence += 1;
  assert.throws(() => ledger.normalizeLedger(state), /ledger-capacity/);
});

test('two otherwise valid pending summaries cannot coexist for the same receipt', () => {
  const state = appendFixture().ledger;
  state.receipts[0].eventIds.push('duplicate-summary');
  const duplicate = structuredClone(state.outbox[0]);
  duplicate.eventId = 'duplicate-summary'; duplicate.event.id = duplicate.eventId;
  state.outbox.push(duplicate);
  assert.throws(() => ledger.normalizeLedger(state), /summary-duplicate/);
});
