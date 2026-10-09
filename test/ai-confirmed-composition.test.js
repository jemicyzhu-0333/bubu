'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
function harness({ timelineAvailable = false, identityAvailable = true } = {}) {
  let serial = 0, revision = 0, at = Date.UTC(2026, 9, 4, 12), calls = 0;
  let state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true,
    aiModel: 'synthetic', aiBaseUrl: 'https://example.com/v1' },
    tasks: [{ id: 'task-a', title: 'Report', createdAt: at, steps: [] }] }, { now: at });
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: value => { state = structuredClone(value); revision++; return repository.snapshot(); } };
  const delivered = new Map();
  const timeline = { queryRange: () => ({ ok: true, items: [] }), supportsConfirmedChanges: timelineAvailable,
    appendConfirmedEvent(event) { if (delivered.has(event.id)) return { ok: true, verifiedDuplicate: true };
      delivered.set(event.id, event); return { ok: true, inserted: true }; }, redactReceipt() { return { ok: true }; } };
  const service = createAiCollaboration({ storage: { ownerId: 'synthetic-owner', identityAvailable, repository: null, close() {} },
    readSnapshot: repository.snapshot, factStore: { healthy: true, timeline }, getSettings: () => state.settings,
    credentialStore: { status: () => ({ configured: true }), get: () => 'fixture-only' }, now: () => at,
    idFactory: kind => `${kind}-${++serial}`, clientFactory: () => ({ async run(_name, _input, options) {
      options.beforeRequest(); calls++;
      return { type: 'changeProposal', answer: 'Review title edit', readRequest: null,
        changeProposal: { operations: [{ type: 'task.update', entityId: 'task-a', patch: { title: 'Revised report' }, scope: 'current' }] } };
    } }), changePorts: { unitOfWork: createUnitOfWork({ repository }), readRevision: repository.revision,
      normalizeState: normalizePersistedState, taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25 } } });
  const routes = new Map(); service.register((channel, handler) => routes.set(channel, handler));
  async function invoke(channel, value) {
    assert.deepEqual(allowedSurfacesFor(channel), ['popover']);
    const parsed = validateIpcPayload(channel, value); assert.equal(parsed.ok, true, JSON.stringify(parsed));
    return routes.get(channel)({}, parsed.value);
  }
  return { service, invoke, repository, delivered, calls: () => calls, advance: value => { at += value; } };
}
async function preview(h) {
  const opened = await h.invoke('ai:conversation-start', { purpose: 'stuck', mode: 'plan', taskId: 'task-a', retentionMode: 'ephemeral' });
  const conversationId = opened.conversation.id;
  const turn = await h.invoke('ai:conversation-turn', { conversationId, scopeGrantId: opened.scopeGrantId, message: 'Please suggest a title edit' });
  assert.equal(turn.ok, true, turn.reason); assert.equal(turn.proposalKind, 'change-set');
  const proposalId = turn.conversation.messages.at(-1).proposal.id;
  const result = await h.invoke('ai:change-preview', { conversationId, scopeGrantId: opened.scopeGrantId, proposalId });
  return { result, conversationId };
}
const confirmation = change => Object.fromEntries(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash'].map(key => [key, change[key]]));
test('closed production routes apply once, retain unavailable history, query receipt and undo locally', async () => {
  const h = harness(); const { result, conversationId } = await preview(h);
  assert.equal(result.ok, true, result.reason); assert.equal(h.repository.snapshot().tasks[0].title, 'Report');
  const request = confirmation(result.changeSet);
  const applied = await h.invoke('ai:change-confirm', request);
  assert.equal(applied.ok, true, applied.reason); assert.equal(applied.historyStatus, 'pending');
  assert.equal(h.repository.snapshot().tasks[0].title, 'Revised report');
  const replayed = await h.invoke('ai:change-confirm', request); assert.equal(replayed.receiptId, applied.receiptId);
  assert.equal(h.repository.snapshot().aiCollaboration.receipts.length, 1);
  const list = await h.invoke('ai:conversation-receipts', { conversationId }); assert.equal(list.items.length, 1);
  const undo = await h.invoke('ai:change-undo-preview', { conversationId, receiptId: applied.receiptId });
  assert.equal(undo.ok, true, undo.reason);
  const reverted = await h.invoke('ai:change-confirm', confirmation(undo.changeSet));
  assert.equal(reverted.ok, true, reverted.reason); assert.equal(h.repository.snapshot().tasks[0].title, 'Report');
  assert.equal(h.calls(), 1); h.service.dispose();
});
test('production receipt detail expiry is enforced and durable dedupe remains', async () => {
  const h = harness(); const { result } = await preview(h); assert.equal(result.ok, true, result.reason);
  const applied = await h.invoke('ai:change-confirm', confirmation(result.changeSet)); assert.equal(applied.ok, true, applied.reason);
  h.advance(8 * 86400000);
  const receipt = await h.invoke('ai:change-receipt', { receiptId: applied.receiptId });
  assert.equal(receipt.ok, true); assert.equal(receipt.receipt.details, null); assert.equal(receipt.undoAvailable, false);
  assert.equal(h.repository.snapshot().aiCollaboration.receipts[0].details, null);
  const replay = await h.invoke('ai:change-confirm', confirmation(result.changeSet)); assert.equal(replay.receiptId, applied.receiptId);
  h.service.dispose();
});
test('temporary profile cannot preview authoritative changes', async () => {
  const h = harness({ identityAvailable: false }); const { result } = await preview(h);
  assert.equal(result.ok, false); assert.equal(result.reason, 'change-profile-unavailable');
  assert.equal(h.repository.snapshot().aiCollaboration.receipts.length, 0); h.service.dispose();
});

test('post-commit delivery reports synced only after canonical acknowledgements', async () => {
  const h = harness({ timelineAvailable: true }); const { result } = await preview(h);
  const applied = await h.invoke('ai:change-confirm', confirmation(result.changeSet));
  assert.equal(applied.ok, true, applied.reason); assert.equal(applied.historyStatus, 'synced');
  assert.equal(h.delivered.size, 2); assert.equal(h.repository.snapshot().aiCollaboration.outbox.length, 0);
  h.service.changes.drain(); assert.equal(h.delivered.size, 2); h.service.dispose();
});
