'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationChanges } = require('../src/application/ai/conversation-changes');
const { createChangeSetService } = require('../src/application/ai/change-set-service');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { guidance, progress, routines } = require('../src/capabilities');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { localDayKey } = require('../src/core/calendar');
const NOW = Date.parse('2026-10-04T10:00:00Z');
const OWNER = 'owner-1234567890123456';
const edit = (title = 'Changed', entityId = 'task-1') => ({ type: 'task.update', entityId, patch: { title } });
const create = title => ({ type: 'task.create', input: { title } });
const confirmation = change => Object.fromEntries(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
  'operationsHash', 'previewHash', 'disclosureHash'].map(key => [key, change[key]]));
function harness(options = {}) {
  let sequence = 0, at = NOW, revision = 0, commits = 0, enabled = true, configured = true, fingerprint = 'provider-one';
  let state = normalizePersistedState({ ...normalizePersistedState({}, { now: NOW }),
    tasks: ['task-1', 'task-2'].map(id => ({ id, title: id, createdAt: 1 })),
    impulses: [{ id: 'inbox-1', text: 'Captured text', createdAt: 1 }] }, { now: NOW });
  routines.routineEditing.addRoutine(state, { title: 'Meeting', kind: 'meeting', schedule: null,
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'routine-1', now: NOW });
  const idFactory = kind => `${kind}-${++sequence}`, now = () => at;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate, context) { state = normalizePersistedState(candidate, context); revision++; commits++; return structuredClone(state); } };
  const sessions = createCollaborationSessions({ ownerId: OWNER, now, idFactory: (_n, kind) => idFactory(kind), maxCached: 20 });
  const grants = createContextGrants({ ownerId: OWNER, now, idFactory });
  const reads = createContextReads({ grants, readSnapshot: repository.snapshot, now });
  const getProvider = () => ({ enabled, configured, purposeAllowed: true, fingerprint });
  const conversationId = sessions.start({ purpose: 'task' }).conversation.id;
  let scopeGrantId;
  function issue(selection = {}) {
    const conversation = sessions.get({ conversationId }).conversation;
    const result = grants.issue({ conversationId, purpose: conversation.purpose, providerId: fingerprint,
      authorizationGeneration: conversation.authGeneration, selection: { tools: ['task.read', 'task.search', 'inbox.search', 'routine.search'],
        taskIds: ['task-1'], inboxIds: ['inbox-1'], routineIds: ['routine-1'], memoryIds: [],
        fromDay: localDayKey(at), toDay: localDayKey(at), ...selection } });
    assert.equal(result.ok, true, result.reason); scopeGrantId = result.grant.id; return result.grant;
  }
  issue();
  function proposal(operations, { sourceRefs = [], kind = 'change-set', body, contextAllowed } = {}) {
    const conversation = sessions.get({ conversationId }).conversation;
    const started = sessions.beginTurn({ conversationId, message: 'Please help', providerId: fingerprint,
      authorizationGeneration: conversation.authGeneration, sourceRefs });
    assert.equal(started.ok, true, started.reason);
    const proposalId = idFactory('proposal');
    const result = sessions.completeTurn({ token: started.token, providerId: fingerprint, content: '',
      proposal: { id: proposalId, version: 1, kind, body: body || JSON.stringify({ operations }) }, sourceRefs,
      provenance: { source: 'provider', providerId: fingerprint, reason: null } });
    assert.equal(result.ok, true, result.reason); return proposalId;
  }
  let changeService;
  const ports = { sessions, grants, reads, getProvider, readSnapshot: repository.snapshot,
    ownerId: OWNER, identityAvailable: true, now, idFactory,
    createService: validateAuthorization => (changeService = createChangeSetService({ ownerId: OWNER, identityAvailable: true,
      unitOfWork: createUnitOfWork({ repository }), readSnapshot: repository.snapshot, readRevision: repository.revision,
      normalizeState: normalizePersistedState, now, idFactory, ledger: guidance.aiChangeLedger,
      taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25 }, getTimezone: () => 'UTC',
      validateAuthorization, buildEvents: progress.aiChangeEvents.buildEvents, ...(options.servicePorts || {}) })), ...options.ports };
  const adapter = createConversationChanges(ports);
  return { adapter, ports, sessions, grants, reads, issue, proposal, conversationId, get scopeGrantId() { return scopeGrantId; },
    preview: (proposalId, extra = {}) => adapter.preview({ conversationId, scopeGrantId, proposalId, ...extra }),
    get changeService() { return changeService; }, inspect: repository.snapshot, commits: () => commits,
    mutate: fn => { fn(state); revision++; }, clock: value => { at = value; }, disable: () => { enabled = false; },
    provider: value => { fingerprint = value; }, unconfigure: () => { configured = false; } };
}

test('canonical owned proposal produces a confirmed receipt; queries are owner-bound and do not require AI', () => {
  const h = harness(); const p = h.preview(h.proposal([edit()])); assert.equal(p.ok, true, p.reason); assert.equal(h.commits(), 0);
  const applied = h.adapter.confirm(confirmation(p.changeSet)); assert.equal(applied.ok, true, applied.reason);
  assert.equal(applied.historyStatus, 'pending'); assert.equal(applied.undoAvailable, true); assert.equal(h.commits(), 1);
  h.disable(); const loaded = h.adapter.getReceipt({ receiptId: applied.receiptId }); assert.equal(loaded.ok, true);
  assert.equal(h.adapter.confirm(confirmation(p.changeSet)).replayed, true); assert.equal(h.commits(), 1);
  assert.equal(h.adapter.listReceipts({ conversationId: h.conversationId }).items.length, 1);
  const other = createConversationChanges({ ...h.ports, ownerId: 'other-owner-123456', service: h.changeService });
  assert.equal(other.getReceipt({ receiptId: applied.receiptId }).reason, 'change-receipt-missing');
  assert.deepEqual(other.listReceipts({ conversationId: h.conversationId }).items, []);
});
test('only canonical change-set proposals may be previewed; renderer cannot substitute a source', () => {
  const h = harness();
  assert.equal(h.preview('unknown-proposal').ok, false);
  assert.equal(h.preview(h.proposal([edit()], { kind: 'task-draft' })).ok, false);
  assert.equal(h.preview(h.proposal([edit()], { body: JSON.stringify({ operations: [edit()], confirmed: true }) })).ok, false);
  assert.equal(h.adapter.preview({ conversationId: h.conversationId, scopeGrantId: h.scopeGrantId,
    proposalId: h.proposal([edit()]), body: JSON.stringify({ operations: [create('Forged')] }) }).ok, false);
  assert.equal(h.commits(), 0);
});
test('write types enforce exact selected IDs and tool grants; routine kinds stay ordinary', () => {
  const h = harness(); assert.equal(h.preview(h.proposal([edit('Wrong target', 'task-2')])).reason, 'change-target-not-authorized');
  const inbox = { type: 'inbox.keep', entityId: 'inbox-1', classification: { category: 'note' } };
  const inboxProposal = h.proposal([inbox]); h.issue({ inboxIds: [] }); assert.equal(h.preview(inboxProposal).reason, 'change-target-not-authorized');
  h.issue({ tools: [] }); assert.equal(h.preview(h.proposal([edit()])).reason, 'change-target-not-authorized');
  h.issue(); h.mutate(state => { state.routines[0].kind = 'medication'; });
  const routine = { type: 'routine.schedule', entityId: 'routine-1', schedule: { frequency: 'daily', timesOfDay: ['15:00'], weekdays: [], windowMinutes: 60 } };
  assert.equal(h.preview(h.proposal([routine])).reason, 'change-target-not-authorized');
});
test('grant/provider/generation changes revoke pending execution even without UI disabled states', () => {
  for (const mode of ['scope', 'generation', 'provider', 'disabled', 'unconfigured']) {
    const h = harness(); const p = h.preview(h.proposal([edit()])); assert.equal(p.ok, true, p.reason);
    if (mode === 'scope') h.issue({ taskIds: [] });
    if (mode === 'generation') h.sessions.revoke({ conversationId: h.conversationId });
    if (mode === 'provider') h.provider('provider-two');
    if (mode === 'disabled') h.disable();
    if (mode === 'unconfigured') h.unconfigure();
    assert.equal(h.adapter.confirm(confirmation(p.changeSet)).ok, false, mode); assert.equal(h.commits(), 0);
  }
});
test('edits are bound to their original canonical proposal and old confirmations expire', () => {
  const h = harness(); const firstId = h.proposal([edit('First')]); const secondId = h.proposal([edit('Second')]);
  const first = h.preview(firstId); assert.equal(first.ok, true, first.reason);
  assert.equal(h.preview(secondId, { changeSetId: first.changeSet.changeSetId, expectedProposalVersion: 1,
    operations: [{ ...edit('Changed'), opId: first.changeSet.operations[0].opId }] }).reason, 'change-proposal-identity-conflict');
  const edited = h.preview(firstId, { changeSetId: first.changeSet.changeSetId, expectedProposalVersion: 1,
    operations: [{ ...edit('Changed'), opId: first.changeSet.operations[0].opId }] });
  assert.equal(edited.ok, true, edited.reason); assert.equal(h.adapter.confirm(confirmation(first.changeSet)).ok, false);
  assert.equal(h.adapter.confirm(confirmation(edited.changeSet)).ok, true);
});
test('cross-preview operation IDs and unselected edited targets are rejected', () => {
  const h = harness(); const p = h.preview(h.proposal([edit()])); const otherId = h.proposal([create('Other')]);
  assert.equal(h.preview(otherId, { operations: [{ ...create('Other'), opId: p.changeSet.operations[0].opId }] }).reason, 'change-operation-identity-invalid');
  assert.equal(h.preview(p.proposalId, { changeSetId: p.changeSet.changeSetId, expectedProposalVersion: 1,
    operations: [edit('Unselected', 'task-2')] }).reason, 'change-target-not-authorized');
});
test('restored/withdrawn source evidence requires an exact fresh authorized read', () => {
  const h = harness(); const ref = { kind: 'task', id: 'task-1', revision: entityFingerprint(h.inspect().tasks[0]) };
  const proposalId = h.proposal([create('Derived from source')], { sourceRefs: [ref] });
  h.sessions.revoke({ conversationId: h.conversationId }); h.issue();
  const fresh = h.preview(proposalId); assert.equal(fresh.ok, true, fresh.reason);
  h.adapter.cancel({ conversationId: h.conversationId, changeSetId: fresh.changeSet.changeSetId });
  h.issue({ taskIds: [] }); assert.equal(h.preview(proposalId).reason, 'change-source-not-authorized');
  h.issue(); h.mutate(state => { state.tasks[0].title = 'Changed evidence'; });
  assert.equal(h.preview(proposalId).reason, 'change-source-not-authorized');
});
test('source evidence is revalidated at confirmation, including create with no target', () => {
  const h = harness(); const ref = { kind: 'task', id: 'task-1', revision: entityFingerprint(h.inspect().tasks[0]) };
  const p = h.preview(h.proposal([create('Derived')], { sourceRefs: [ref] })); assert.equal(p.ok, true, p.reason);
  h.mutate(state => { state.tasks[0].description = 'New source'; });
  assert.equal(h.adapter.confirm(confirmation(p.changeSet)).ok, false); assert.equal(h.commits(), 0);
});
test('AI-disabled undo uses private one-time receipt authority and cannot authorize arbitrary operations', () => {
  const h = harness(); const p = h.preview(h.proposal([edit()])); const applied = h.adapter.confirm(confirmation(p.changeSet));
  h.disable(); h.grants.clear(); const undo = h.adapter.previewUndo({ receiptId: applied.receiptId });
  assert.equal(undo.ok, true, undo.reason);
  assert.equal(h.changeService.prepare({ conversationId: h.conversationId, purpose: 'review',
    authorization: undo.changeSet.authorization, operations: [create('Unauthorized local write')] }).ok, false);
  const reverted = h.adapter.confirm(confirmation(undo.changeSet)); assert.equal(reverted.ok, true, reverted.reason);
  assert.equal(h.inspect().tasks[0].title, 'task-1'); assert.equal(h.adapter.previewUndo({ receiptId: applied.receiptId }).ok, false);
  assert.equal(h.adapter.confirm(confirmation(undo.changeSet)).replayed, true); assert.equal(h.commits(), 2);
});
test('local undo expires and rechecks post-versions; invalidation cancels remote and local previews', () => {
  for (const mode of ['changed', 'expired', 'invalidated']) {
    const h = harness(); const p = h.preview(h.proposal([edit()])); const applied = h.adapter.confirm(confirmation(p.changeSet));
    const undo = h.adapter.previewUndo({ receiptId: applied.receiptId }); assert.equal(undo.ok, true, undo.reason);
    if (mode === 'changed') h.mutate(state => { state.tasks[0].description = 'Human edit'; });
    if (mode === 'expired') h.clock(NOW + 15 * 60 * 1000);
    if (mode === 'invalidated') assert.equal(h.adapter.invalidate(h.conversationId).invalidated, 1);
    assert.equal(h.adapter.confirm(confirmation(undo.changeSet)).ok, false); assert.equal(h.commits(), 1);
  }
  const h = harness(); const p = h.preview(h.proposal([edit()])); h.adapter.invalidate();
  assert.equal(h.adapter.confirm(confirmation(p.changeSet)).ok, false); assert.equal(h.commits(), 0);
});
test('receipt listing is conversation-bounded with the shared offset cursor and detached results', () => {
  const h = harness();
  for (let index = 0; index < 3; index++) { const p = h.preview(h.proposal([create(`Task ${index}`)])); assert.equal(h.adapter.confirm(confirmation(p.changeSet)).ok, true); }
  const first = h.adapter.listReceipts({ conversationId: h.conversationId, limit: 2 });
  assert.equal(first.items.length, 2); assert.equal(first.nextCursor, 'offset:2');
  assert.equal(h.adapter.listReceipts({ conversationId: h.conversationId, cursor: first.nextCursor, limit: 2 }).items.length, 1);
  first.items[0].receipt.status = 'forged'; assert.equal(h.inspect().aiCollaboration.receipts.at(-1).status, 'applied');
  assert.equal(h.adapter.listReceipts({ conversationId: h.conversationId, cursor: 'bad' }).ok, false);
  assert.equal(h.adapter.listReceipts({ conversationId: h.conversationId, limit: 51 }).ok, false);
  assert.deepEqual(h.adapter.listReceipts({ conversationId: 'unrelated-conversation' }).items, []);
});
test('max50 preserves every pending preview, successful receipts release slots, and temporary identity cannot act', () => {
  const h = harness(); const proposalId = h.proposal([create('Pending')]); let first;
  for (let index = 0; index < 50; index++) { const p = h.preview(index === 0 ? proposalId : h.proposal([create(`Pending ${index}`)])); assert.equal(p.ok, true, p.reason); first ||= p; }
  assert.equal(h.preview(h.proposal([create('Overflow')])).reason, 'change-preview-capacity');
  assert.equal(h.adapter.confirm(confirmation(first.changeSet)).ok, true); assert.equal(h.preview(proposalId).alreadyApplied, true);
  assert.equal(h.preview(h.proposal([create('New proposal')])).ok, true);
  assert.equal(h.adapter.invalidate().invalidated, 50);
  const temporary = harness({ ports: { identityAvailable: false } });
  assert.equal(temporary.preview(temporary.proposal([edit()])).reason, 'change-profile-unavailable');
  assert.equal(temporary.adapter.getReceipt({ receiptId: 'missing' }).reason, 'change-profile-unavailable');
});

test('local undo accepts the scoped UI route, verifies its conversation and never treats scopeGrantId as authority', () => {
  const h = harness(); const p = h.preview(h.proposal([edit()])); const applied = h.adapter.confirm(confirmation(p.changeSet));
  h.disable();
  assert.equal(h.adapter.previewUndo({ conversationId: 'wrong-conversation', receiptId: applied.receiptId }).reason, 'change-conversation-owner-mismatch');
  assert.equal(h.adapter.previewUndo({ conversationId: h.conversationId, receiptId: applied.receiptId, scopeGrantId: 42 }).reason, 'change-undo-invalid');
  const undo = h.adapter.previewUndo({ conversationId: h.conversationId, receiptId: applied.receiptId, scopeGrantId: 'expired-remote-grant' });
  assert.equal(undo.ok, true, undo.reason); assert.equal(h.adapter.confirm(confirmation(undo.changeSet)).ok, true);
});

test('expired receipt details are hidden from query/list/duplicate confirmation even before durable cleanup', () => {
  const h = harness(); const p = h.preview(h.proposal([edit('Private title')]));
  const applied = h.adapter.confirm(confirmation(p.changeSet)); h.clock(applied.receipt.details.expiresAt);
  assert.notEqual(h.inspect().aiCollaboration.receipts[0].details, null, 'test leaves canonical cleanup pending');
  const responses = [h.adapter.getReceipt({ receiptId: applied.receiptId }),
    h.adapter.listReceipts({ conversationId: h.conversationId }).items[0], h.adapter.confirm(confirmation(p.changeSet))];
  for (const result of responses) { assert.equal(result.ok, true); assert.equal(result.receipt.details, null);
    assert.equal(result.receipt.detailsRedacted, true); assert.equal(result.undoAvailable, false); }
});
