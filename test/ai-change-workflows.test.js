'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChangeSetService } = require('../src/application/ai/change-set-service');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const contract = require('../src/capabilities/guidance/contract/ai-change-receipt');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { focusSession } = require('../src/capabilities/execution');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const { routines } = require('../src/capabilities');

const NOW = new Date(2026, 9, 4, 10, 0, 0).getTime();
const auth = { scopeGrantId: 'grant-1', generation: 1, providerFingerprint: 'provider-1' };
const testLedger = require('../src/capabilities/guidance/domain/ai-change-ledger');
function harness(options = {}) {
  let at = NOW, serial = 0, revision = 0, commits = 0, writesFail = false, authorized = true, timezone = 'UTC';
  let state = normalizePersistedState({ ...normalizePersistedState({}, { now: at }), tasks: [{ id: 'task-1', title: 'Write report', createdAt: 1,
    steps: [{ id: 'step-1', title: 'Open document', done: false }] }],
    impulses: [{ id: 'inbox-1', text: 'Remember the report', createdAt: 1 }], ...options.state }, { now: at });
  state.aiCollaboration ||= testLedger.createLedger();
  const normalizeState = (candidate, context) => ({ ...normalizePersistedState(candidate, context),
    aiCollaboration: structuredClone(candidate.aiCollaboration) });
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate, context) { if (writesFail) throw new Error('disk'); state = normalizeState(candidate, context); commits++; revision++; if (options.throwAfterCommit) throw new Error('lost response'); return structuredClone(state); } };
  const ports = { ownerId: 'owner-profile-123456', identityAvailable: true, unitOfWork: createUnitOfWork({ repository }),
    readSnapshot: repository.snapshot, readRevision: repository.revision, normalizeState, now: () => at,
    idFactory: prefix => `${prefix}-${++serial}`, taskPolicies: { inferEnergy: title => title.includes('Hard') ? 'high' : 'medium',
      suggestDuration: (_title, energy) => energy === 'high' ? 45 : 25 },
    getTimezone: () => timezone, validateAuthorization: () => authorized, ledger: testLedger,
    buildEvents: ({ receipt, occurredAt, timezone, utcOffsetMinutes, localDayKey }) => [{
      id: `event-${receipt.commandId}`, schemaVersion: 1, occurredAt, receivedAt: occurredAt, timezone, utcOffsetMinutes,
      localDayKey, dayKey: localDayKey, kind: receipt.revertsReceiptId ? 'ai.change.reverted' : 'ai.change.applied',
      actor: 'user', source: 'ai-collaboration', correlationId: receipt.changeSetId, causationId: receipt.commandId,
      commandId: receipt.commandId, entityVersion: null, visibility: 'normal', redactionState: 'none',
      taskId: null, sessionId: null, durationMs: null,
      payload: { receiptId: receipt.receiptId, applyGroupId: receipt.applyGroupId, operationIds: [], entityRefs: [],
        count: receipt.results.length, revertsReceiptId: receipt.revertsReceiptId } }],
    ...options.ports };
  let service = createChangeSetService(ports);
  const candidate = operations => ({ conversationId: 'conversation-1', purpose: 'task', authorization: auth, operations });
  const request = change => Object.fromEntries(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
    'operationsHash', 'previewHash', 'disclosureHash'].map(field => [field, change[field]]));
  return { ports, candidate, request, get service() { return service; }, prepare: operations => service.prepare(candidate(operations)),
    confirm: change => service.confirm(request(change)), inspect: () => structuredClone(state), commits: () => commits,
    mutate: fn => { fn(state); revision++; }, clock: value => { at = value; }, failWrites: () => { writesFail = true; },
    authorize: value => { authorized = value; }, zone: value => { timezone = value; },
    restart: () => { revision = 0; service = createChangeSetService(ports); } };
}
const edit = title => ({ type: 'task.update', entityId: 'task-1', patch: { title } });
const create = title => ({ type: 'task.create', input: { title, steps: [{ title: 'Begin' }] } });

test('prepare is pure; atomic task creation/edit returns exact receipt without Now or rewards', () => {
  const h = harness(); const before = h.inspect();
  const prepared = h.prepare([create('New task'), edit('Hard report')]);
  assert.equal(prepared.ok, true, prepared.reason); assert.equal(h.commits(), 0); assert.deepEqual(h.inspect(), before);
  assert.ok(prepared.changeSet.diff.some(row => row.derivedChanges.some(field => field.field === 'energy')));
  h.clock(NOW + 1000);
  const result = h.confirm(prepared.changeSet);
  assert.equal(result.ok, true, result.reason); assert.equal(h.commits(), 1); assert.equal(result.historyStatus, 'pending');
  const after = h.inspect(); assert.equal(after.tasks.length, 2);
  for (const field of ['nowTaskId', 'stats', 'xp', 'rewardLedger', 'focusSession', 'routineLog']) assert.deepEqual(after[field], before[field]);
  assert.equal(after.aiCollaboration.receipts.length, 1); assert.equal(after.aiCollaboration.nextCommitSequence, 2);
});
test('same confirmation and restart retry return one receipt with zero repeated writes', () => {
  const h = harness(); const p = h.prepare([create('Once')]); const first = h.confirm(p.changeSet);
  assert.equal(first.ok, true, first.reason); assert.equal(h.confirm(p.changeSet).receiptId, first.receiptId);
  h.restart(); assert.equal(h.confirm(p.changeSet).receiptId, first.receiptId); assert.equal(h.commits(), 1);
});
test('failure in later operation causes zero business/ledger writes', () => {
  const h = harness(); const before = h.inspect();
  assert.equal(h.prepare([create('Never'), { type: 'task.steps', entityId: 'task-1', steps: [{ op: 'rename', stepId: 'missing', title: 'No' }] }]).ok, false);
  assert.equal(h.commits(), 0); assert.deepEqual(h.inspect(), before);
});
test('same-millisecond target edit conflicts; unrelated canonical changes do not', () => {
  const h = harness(); const p = h.prepare([edit('New')]);
  h.mutate(state => { state.tasks[0].description = 'Human changed it'; });
  assert.equal(h.confirm(p.changeSet).reason, 'change-target-conflict'); assert.equal(h.commits(), 0);
  const fresh = h.prepare([edit('New')]); h.mutate(state => { state.settings.dnd = !state.settings.dnd; });
  const result = h.confirm(fresh.changeSet); assert.equal(result.ok, true, result.reason);
});
test('edited selection invalidates old version and hashes, consumed op cannot reapply under new version', () => {
  const h = harness(); const p = h.prepare([create('First')]); const old = p.changeSet;
  const edited = h.service.prepare({ ...h.candidate([{ ...create('Edited'), opId: old.operations[0].opId }]),
    changeSetId: old.changeSetId, expectedProposalVersion: old.proposalVersion });
  assert.equal(edited.ok, true, edited.reason); assert.equal(h.confirm(old).ok, false);
  assert.equal(h.confirm(edited.changeSet).ok, true);
  const again = h.service.prepare({ ...h.candidate([{ ...create('Again'), opId: old.operations[0].opId }]),
    changeSetId: old.changeSetId, expectedProposalVersion: edited.changeSet.proposalVersion });
  assert.equal(again.reason, 'change-operation-consumed');
});
test('expiry, revocation, hash forgery, cancellation, and absent durable owner fail closed', () => {
  for (const mode of ['expiry', 'authorization', 'hash', 'cancel']) {
    const h = harness(); const p = h.prepare([edit('New')]);
    if (mode === 'expiry') h.clock(p.changeSet.expiresAt);
    if (mode === 'authorization') h.authorize(false);
    if (mode === 'cancel') h.service.cancel(p.changeSet);
    const request = h.request(p.changeSet); if (mode === 'hash') request.previewHash = 'a'.repeat(64);
    assert.equal(h.service.confirm(request).ok, false, mode); assert.equal(h.commits(), 0);
  }
  assert.equal(harness({ ports: { identityAvailable: false } }).prepare([create('No')]).reason, 'change-profile-unavailable');
});
test('normalization drift and canonical write failure retain preview without receipt', () => {
  const h = harness(); const p = h.prepare([edit('New')]); h.failWrites();
  assert.equal(h.confirm(p.changeSet).reason, 'change-commit-failed'); assert.equal(h.commits(), 0);
  assert.equal(h.service.get(p.changeSet).ok, true);
  const drift = harness({ ports: { normalizeState: candidate => ({ ...candidate, nowTaskId: 'task-1' }) } });
  assert.equal(drift.prepare([create('No')]).reason, 'change-normalization-drift'); assert.equal(drift.commits(), 0);
});
test('post-commit publication failure is still a durable success', () => {
  const h = harness({ ports: { publish() { throw new Error('projection'); } } });
  const result = h.confirm(h.prepare([edit('Saved')]).changeSet);
  assert.equal(result.ok, true, result.reason); assert.equal(h.commits(), 1);
});
test('inbox conversion atomically preserves original source and never selects Now; repeat consumed source refuses', () => {
  const h = harness(); const p = h.prepare([{ type: 'inbox.convert-task', entityId: 'inbox-1', input: { title: 'Converted' } }]);
  assert.equal(p.ok, true, p.reason); h.clock(NOW + 2000);
  const result = h.confirm(p.changeSet); assert.equal(result.ok, true, result.reason);
  const state = h.inspect(); assert.equal(state.impulses[0].text, 'Remember the report');
  assert.equal(state.impulses[0].resolution.at, NOW + 2000); assert.equal(state.nowTaskId, null);
  assert.equal(result.receipt.details.undo, null); assert.equal(h.prepare([{ type: 'inbox.keep', entityId: 'inbox-1', classification: { category: 'note' } }]).ok, false);
});
test('inbox classification freshness and inference withdrawal are part of exact preview', () => {
  const h = harness(); const p = h.prepare([{ type: 'inbox.keep', entityId: 'inbox-1', classification: { category: 'note' } }]);
  h.mutate(state => { state.impulses[0].classification = { category: 'task', routineKind: null, level: null }; });
  assert.equal(h.confirm(p.changeSet).reason, 'change-target-conflict'); assert.equal(h.commits(), 0);
});
test('safe task undo is a second receipt and does not erase later edits', () => {
  const h = harness(); const original = h.inspect().tasks[0]; const result = h.confirm(h.prepare([edit('Hard changed')]).changeSet);
  assert.equal(result.ok, true, result.reason);
  const undo = h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth });
  assert.equal(undo.ok, true, undo.reason); h.clock(NOW + 3000);
  const reverted = h.confirm(undo.changeSet); assert.equal(reverted.ok, true, reverted.reason);
  const restored = h.inspect().tasks[0]; for (const field of ['title', 'energy', 'energyAuto', 'suggestedMin']) assert.deepEqual(restored[field], original[field]);
  assert.equal(h.inspect().aiCollaboration.receipts[0].status, 'reverted'); assert.equal(h.commits(), 2);
  assert.equal(h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth }).ok, false);
  const second = h.confirm(h.prepare([edit('Another')]).changeSet); h.mutate(state => { state.tasks[0].description = 'Later'; });
  assert.equal(h.service.prepareUndo({ receiptId: second.receiptId, conversationId: 'conversation-1', authorization: auth }).reason, 'change-target-conflict');
});
test('unfinished steps preserve IDs, undo removes only new steps; completed steps remain immutable', () => {
  const h = harness(); const p = h.prepare([{ type: 'task.steps', entityId: 'task-1', steps: [{ op: 'rename', stepId: 'step-1', title: 'Open notes' }, { op: 'add', title: 'Write one line' }] }]);
  const result = h.confirm(p.changeSet); assert.equal(result.ok, true, result.reason); assert.equal(h.inspect().tasks[0].steps[0].id, 'step-1');
  const undo = h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth });
  assert.equal(undo.ok, true, undo.reason); assert.equal(h.confirm(undo.changeSet).ok, true);
  assert.equal(h.inspect().tasks[0].steps.length, 1); assert.equal(h.inspect().tasks[0].steps[0].title, 'Open document');
  h.mutate(state => { state.tasks[0].steps[0].done = true; });
  assert.equal(h.prepare([{ type: 'task.steps', entityId: 'task-1', steps: [{ op: 'rename', stepId: 'step-1', title: 'No' }] }]).reason, 'step-completed');
});
test('focus lock is rechecked after preview and permits only current pending-step additions/renames', () => {
  const h = harness(); const p = h.prepare([edit('No')]);
  h.mutate(state => { state.focusSession = focusSession.normalizeFocusSession({ status: 'focus', taskId: 'task-1', sessionId: 'session-1', startedAt: NOW, plannedDurationMs: 1500000, elapsedBeforeStartMs: 0 }, { now: NOW }); });
  assert.equal(h.confirm(p.changeSet).reason, 'task-in-focus');
  const allowed = h.prepare([{ type: 'task.steps', entityId: 'task-1', scope: 'current', steps: [{ op: 'add', title: 'Small action' }] }]);
  assert.equal(allowed.ok, true, allowed.reason); assert.equal(h.confirm(allowed.changeSet).ok, true);
});
function addRoutine(h, kind = 'meeting', time = '15:00') {
  h.mutate(state => routines.routineEditing.addRoutine(state, { title: 'Routine', kind,
    schedule: { frequency: 'daily', timesOfDay: [time], weekdays: [], windowMinutes: 60 },
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'routine-1', now: NOW }));
}
const reschedule = time => ({ type: 'routine.schedule', entityId: 'routine-1', schedule: { frequency: 'daily', timesOfDay: [time], weekdays: [], windowMinutes: 60 } });
test('ordinary future schedule and undo preserve log; timezone drift and elapsed-slot rewrite refuse', () => {
  const h = harness(); addRoutine(h); const before = h.inspect().routineLog;
  const p = h.prepare([reschedule('16:00')]); assert.equal(p.ok, true, p.reason); const result = h.confirm(p.changeSet);
  assert.equal(result.ok, true, result.reason); assert.deepEqual(h.inspect().routineLog, before);
  const undo = h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth });
  assert.equal(undo.ok, true, undo.reason); assert.equal(h.confirm(undo.changeSet).ok, true);
  const next = h.prepare([reschedule('17:00')]); h.zone('America/New_York');
  assert.equal(h.confirm(next.changeSet).reason, 'routine-timezone-changed');
  const elapsed = harness(); addRoutine(elapsed, 'meeting', '09:00');
  assert.equal(elapsed.prepare([reschedule('16:00')]).reason, 'routine-elapsed-slots-changed');
});
test('sensitive/custom routine kinds and malformed schedule are not normalized into permitted writes', () => {
  for (const kind of ['medication', 'stimulant', 'custom']) { const h = harness(); addRoutine(h, kind); assert.equal(h.prepare([reschedule('16:00')]).reason, 'routine-kind-not-authorized'); }
  const h = harness(); addRoutine(h); const op = reschedule('25:00'); assert.equal(h.prepare([op]).reason, 'change-operations-invalid');
});

test('post-preview policy drift and failure after the first simulated operation still commit nothing', () => {
  let drift = false;
  const h = harness({ ports: { taskPolicies: { inferEnergy: () => drift ? 'high' : 'medium', suggestDuration: () => 25 } } });
  const p = h.prepare([create('First'), edit('Second')]); assert.equal(p.ok, true, p.reason);
  drift = true; assert.equal(h.confirm(p.changeSet).reason, 'change-preview-drift');
  assert.equal(h.inspect().tasks.length, 1); assert.equal(h.inspect().aiCollaboration.receipts.length, 0); assert.equal(h.commits(), 0);
});
test('ledger reservation failure leaves all business writes absent and permits a safe retry', () => {
  let full = true;
  const h = harness({ ports: { ledger: { ...testLedger, appendReceipt(...args) {
    return full ? { ok: false, reason: 'outbox-capacity' } : testLedger.appendReceipt(...args);
  } } } });
  const p = h.prepare([create('Reserved')]); const before = h.inspect();
  assert.equal(h.confirm(p.changeSet).reason, 'outbox-capacity'); assert.deepEqual(h.inspect(), before);
  full = false; assert.equal(h.confirm(p.changeSet).ok, true); assert.equal(h.commits(), 1);
});
test('missing or malformed audit events fail before canonical business commit', () => {
  for (const buildEvents of [() => [], () => [{ id: 'forged' }], () => { throw new Error('history builder'); }]) {
    const h = harness({ ports: { buildEvents } }); const p = h.prepare([create('Not saved')]);
    assert.equal(h.confirm(p.changeSet).ok, false); assert.equal(h.commits(), 0); assert.equal(h.inspect().tasks.length, 1);
  }
});
test('outbox delivery acknowledgment changes receipt status without replaying business work', () => {
  const h = harness(); const p = h.prepare([edit('Saved')]); const result = h.confirm(p.changeSet);
  h.mutate(state => { const eventId = result.receipt.eventIds[0]; state.aiCollaboration = testLedger.acknowledgeEvent(state.aiCollaboration,
    { eventId, ownerId: result.receipt.ownerId, commandId: result.receipt.commandId }).ledger; });
  assert.equal(h.confirm(p.changeSet).historyStatus, 'synced'); assert.equal(h.commits(), 1);
});
test('undo rechecks a changed post-version after its preview, expiry and receipt redaction', () => {
  for (const mode of ['edited', 'expired', 'redacted']) {
    const h = harness(); const result = h.confirm(h.prepare([edit('Changed')]).changeSet);
    const undo = h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth });
    assert.equal(undo.ok, true, undo.reason);
    if (mode === 'edited') h.mutate(state => { state.tasks[0].tags = ['human']; });
    if (mode === 'expired') h.clock(result.receipt.details.undo.expiresAt);
    if (mode === 'redacted') h.mutate(state => { state.aiCollaboration = testLedger.redactDetails(state.aiCollaboration,
      { ownerId: result.receipt.ownerId, receiptIds: [result.receiptId] }).ledger; });
    assert.equal(h.confirm(undo.changeSet).ok, false, mode); assert.equal(h.commits(), 1);
  }
});
test('confirmed non-state inbox classification removes only its speculative signals and displays their identities', () => {
  const h = harness({ state: { energySignals: [
    { id: 'signal-1', source: 'impulse-ai', referenceId: 'inbox-1', at: NOW, delta: -5, confidence: 70, reason: 'fixture' },
    { id: 'signal-2', source: 'impulse-ai', referenceId: 'other-inbox', at: NOW, delta: 5, confidence: 70, reason: 'fixture' }
  ] } });
  const p = h.prepare([{ type: 'inbox.keep', entityId: 'inbox-1', classification: { category: 'note' } }]);
  assert.equal(p.ok, true, p.reason);
  assert.ok(p.changeSet.diff.some(row => [...row.fields, ...row.derivedChanges].some(field =>
    field.field === 'energySignalIds' && field.before[0] === 'signal-1' && field.after.length === 0)));
  assert.equal(h.confirm(p.changeSet).ok, true); assert.deepEqual(h.inspect().energySignals.map(signal => signal.id), ['signal-2']);
});
test('recurrence requires explicit scope, previews future template and preserves unrelated series fields on undo', () => {
  const h = harness({ state: { tasks: [{ id: 'task-1', title: 'Recurring', createdAt: 1, seriesId: 'series-1',
    occurrenceDate: '2026-10-04', steps: [{ id: 'step-1', title: 'Start', done: false }] }],
    recurrenceSeries: [{ id: 'series-1', createdAt: 1, state: 'active', rule: { frequency: 'daily', interval: 1,
      weekdays: null, strategy: 'fixed', anchorDate: '2026-10-04' }, template: { title: 'Recurring', stepTitles: ['Start'], tags: [],
      energy: 'medium', energyAuto: true, estimateMinutes: null }, openTaskId: 'task-1', lastOccurrenceDate: '2026-10-04' }] } });
  assert.equal(h.prepare([edit('Only now')]).reason, 'recurrence-scope-required');
  const p = h.prepare([{ ...edit('Future title'), scope: 'current-and-future' }]); assert.equal(p.ok, true, p.reason);
  assert.ok(p.changeSet.diff.some(row => row.entityRef.kind === 'recurrenceSeries'));
  const beforeRule = h.inspect().recurrenceSeries[0].rule;
  const result = h.confirm(p.changeSet); assert.equal(result.ok, true, result.reason);
  assert.equal(h.inspect().recurrenceSeries[0].template.title, 'Future title');
  const undo = h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth });
  assert.equal(undo.ok, true, undo.reason); assert.equal(h.confirm(undo.changeSet).ok, true);
  assert.equal(h.inspect().recurrenceSeries[0].template.title, 'Recurring'); assert.deepEqual(h.inspect().recurrenceSeries[0].rule, beforeRule);
});
test('existing completed tasks and steps cannot be changed, and creation never claims undo support', () => {
  const done = harness({ state: { tasks: [{ id: 'task-1', title: 'Finished', createdAt: 1, done: true, completedAt: NOW }] } });
  assert.equal(done.prepare([edit('No')]).reason, 'task-completed');
  const h = harness(); const result = h.confirm(h.prepare([create('New')]).changeSet);
  assert.equal(h.service.prepareUndo({ receiptId: result.receiptId, conversationId: 'conversation-1', authorization: auth }).reason, 'change-undo-unavailable');
});
test('ordinary schedule becomes unsafe while awaiting confirmation when its original slot becomes due', () => {
  const h = harness(); addRoutine(h, 'meeting', '10:05'); const p = h.prepare([reschedule('11:00')]);
  assert.equal(p.ok, true, p.reason); h.clock(NOW + 6 * 60 * 1000);
  assert.equal(h.confirm(p.changeSet).reason, 'routine-elapsed-slots-changed'); assert.equal(h.commits(), 0);
});

test('a lost response after canonical persistence is recovered from the durable receipt', () => {
  let published = 0;
  const h = harness({ throwAfterCommit: true, ports: { publish: () => { published++; } } }); const p = h.prepare([create('Saved despite reply failure')]);
  const result = h.confirm(p.changeSet); assert.equal(result.ok, true, result.reason); assert.equal(h.commits(), 1);
  assert.equal(h.confirm(p.changeSet).receiptId, result.receiptId); assert.equal(h.inspect().tasks.length, 2); assert.equal(published, 1);
});
test('post-commit snapshot-read failure cannot turn committed work into a retryable failure', () => {
  let broken = false;
  const h = harness(); const service = createChangeSetService({ ...h.ports,
    readSnapshot: () => { if (broken) throw new Error('read unavailable'); return h.ports.readSnapshot(); },
    publish: () => { broken = true; } });
  const p = service.prepare(h.candidate([create('Durable')]));
  const result = service.confirm(h.request(p.changeSet)); assert.equal(result.ok, true, result.reason);
  assert.equal(result.historyStatus, 'pending'); assert.equal(h.commits(), 1);
});
test('duplicate issued identities fail closed without replacing a pending preview', () => {
  const h = harness({ ports: { idFactory: () => 'same-id' } });
  assert.equal(h.prepare([create('No duplicate identity')]).ok, false); assert.equal(h.commits(), 0);
});

test('event envelope uses the actual IANA timezone day and DST offset, not process-local time', () => {
  const { eventCalendar } = require('../src/application/workflows/apply-ai-change-set');
  assert.deepEqual(eventCalendar(Date.parse('2026-07-01T01:00:00Z'), 'America/Los_Angeles'),
    { timezone: 'America/Los_Angeles', utcOffsetMinutes: -420, localDayKey: '2026-06-30' });
  assert.deepEqual(eventCalendar(Date.parse('2026-01-01T01:00:00Z'), 'America/Los_Angeles'),
    { timezone: 'America/Los_Angeles', utcOffsetMinutes: -480, localDayKey: '2025-12-31' });
  assert.deepEqual(eventCalendar(Date.parse('2026-07-01T20:00:00Z'), 'Asia/Kathmandu'),
    { timezone: 'Asia/Kathmandu', utcOffsetMinutes: 345, localDayKey: '2026-07-02' });
});
