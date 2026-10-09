'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, openCollaborationDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openMemoryAuthority } = require('../src/bootstrap/memory-authority');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { validateCollaborationResult, COLLABORATION_TASK } = require('../src/core/llm');
const { memoryContextVersion } = require('../src/application/ai/context-choices');
const { memoryProposalSchemas } = require('../src/core/ai-memory-protocol');
const { proposalValid } = require('../src/application/ai/conversation-record');
const AT = Date.UTC(2026, 9, 4, 12), OWNER = 'memory-changes-fixture-owner';
const input = (body = 'Start with one fact') => ({ kind: 'preference', subject: 'Synthetic opening', body, scope: 'global', expiresAt: null });
const envelope = changeProposal => ({ type: 'changeProposal', answer: 'Review this proposed change locally.', readRequest: null, changeProposal });
const ticket = preview => ({ previewId: preview.previewId, previewHash: preview.previewHash, expectedVersion: preview.expectedVersion });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-changes-'));
  let serial = 0, collaboration, authority, factStore, storage, providerReply = () => envelope({ memoryCandidate: input() });
  const idFactory = kind => `${kind}-${++serial}`, sent = [], routes = new Map();
  const state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiMemoryEnabled: true,
    aiModel: 'fixture-only', aiBaseUrl: 'https://fixture.invalid/v1' } }, { now: AT });
  function open() {
    factStore = openDatabase({ filePath: path.join(directory, 'facts.sqlite'), driver: 'node:sqlite', now: () => AT });
    const db = openCollaborationDatabase({ filePath: path.join(directory, 'conversation.sqlite'), ownerId: OWNER });
    assert.equal(db.status, 'available', db.reason);
    storage = { ownerId: OWNER, identityAvailable: true, repository: db.repository, close: db.close };
    authority = openMemoryAuthority({ factStore, storage, userDataPath: directory, now: () => AT, idFactory });
    assert.equal(authority.service.available, true, authority.reason);
    collaboration = createAiCollaboration({ storage, factStore, memoryAuthority: authority,
      readSnapshot: () => structuredClone(state), getSettings: () => state.settings,
      credentialStore: { status: () => ({ configured: true }), get: () => 'fixture-only' }, now: () => AT, idFactory,
      clientFactory: () => ({ endpoint: 'https://fixture.invalid/v1/chat/completions', async run(_task, payload, controls) {
        controls.beforeRequest(); sent.push(structuredClone(payload)); return providerReply(payload);
      } }) });
    routes.clear(); collaboration.register((channel, handler) => routes.set(channel, handler));
  }
  function close() { collaboration?.dispose(); authority?.close(); factStore?.close(); }
  open(); t.after(() => { close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function invoke(channel, payload) {
    const decoded = validateIpcPayload(channel, structuredClone(payload));
    assert.equal(decoded.ok, true, `${channel}: ${JSON.stringify(decoded)}`);
    return routes.get(channel)({}, decoded.value);
  }
  function manual(request) {
    const result = invoke('memory:change-preview', request); assert.equal(result.ok, true, result.reason);
    const committed = invoke('memory:change-confirm', { ...ticket(result.preview), ...(result.preview.permanent ? { permanentAcknowledged: true } : {}) });
    assert.equal(committed.ok, true, committed.reason); return committed;
  }
  async function propose(change, selected = []) {
    providerReply = typeof change === 'function' ? change : () => envelope(change);
    const started = invoke('ai:conversation-start', { purpose: 'planning', mode: 'talk', retentionMode: 'saved' });
    assert.equal(started.ok, true, started.reason);
    const scoped = invoke('ai:conversation-scope', { conversationId: started.conversation.id, memoryIds: selected, focusSummary: false });
    assert.equal(scoped.ok, true, scoped.reason);
    const result = await invoke('ai:conversation-turn', { conversationId: started.conversation.id,
      scopeGrantId: scoped.scopeGrantId, message: 'Please suggest a memory correction for me to review.' });
    return { result, request: { conversationId: started.conversation.id, proposalId: result.conversation.messages.at(-1)?.proposal?.id } };
  }
  return { invoke, manual, propose, sent, state, directory, restart() { close(); open(); },
    get service() { return authority.service; }, get collaboration() { return collaboration; } };
}

test('memory update and forget model variants are closed and cannot claim authority or provenance', () => {
  const update = { memoryChange: { operation: 'update', id: 'memory-1', input: input() } };
  const forget = { memoryChange: { operation: 'forget', id: 'memory-1' } };
  for (const proposal of [update, forget, { memoryCandidate: input() }]) assert.deepEqual(validateCollaborationResult(envelope(proposal)), envelope(proposal));
  const schemas = COLLABORATION_TASK.buildSchema().properties.changeProposal.anyOf[1].anyOf;
  assert.ok(memoryProposalSchemas.every(schema => schemas.includes(schema)));
  for (const proposal of [
    { ...update, memoryCandidate: input() }, { memoryChange: { ...forget.memoryChange, input: input() } },
    ...['sourceRefs', 'version', 'expectedVersion', 'confirmedAt', 'receiptId', 'permanentAcknowledged'].map(key =>
      ({ memoryChange: { ...update.memoryChange, [key]: true } })),
    { memoryChange: { ...update.memoryChange, input: { ...input(), sourceType: 'user-edit' } } },
    { memoryChange: { operation: 'remove', id: 'memory-1' } }, { memoryChange: { operation: 'forget', id: '' } }
  ]) {
    assert.throws(() => validateCollaborationResult(envelope(proposal)));
    assert.equal(proposalValid({ id: 'canonical-proposal', version: 1, kind: 'memory-candidate', body: JSON.stringify(proposal) }), false);
  }
});

test('production composition rejects unselected or unknown update and forget targets before canonical proposal', async t => {
  const f = fixture(t), saved = f.manual({ operation: 'add', input: input() });
  for (const operation of ['update', 'forget']) for (const id of [saved.receipt.memoryId, 'unknown-memory']) {
    const { result } = await f.propose({ memoryChange: { operation, id, ...(operation === 'update' ? { input: input('Changed') } : {}) } });
    assert.equal(result.source, 'local'); assert.equal(result.reason, 'provider-invalid-output'); assert.equal(result.proposal, null);
  }
  assert.equal(f.service.list().items[0].version, 1);
});

test('real selected memory read creates inert update with exact version provenance; edited preview, undo and restart preserve consumption', async t => {
  const f = fixture(t), saved = f.manual({ operation: 'add', input: input() }), id = saved.receipt.memoryId;
  const { result, request } = await f.propose({ memoryChange: { operation: 'update', id, input: input('Proposed opening') } }, [id]);
  assert.equal(result.source, 'provider'); assert.equal(result.proposalKind, 'memory-candidate');
  assert.equal(f.service.list().items[0].version, 1);
  const message = result.conversation.messages.at(-1), ref = { kind: 'memory', id, revision: memoryContextVersion({ id, version: 1 }) };
  assert.ok(message.sourceRefs.some(value => JSON.stringify(value) === JSON.stringify(ref)));
  assert.ok(result.disclosure.reads.some(read => read.tool === 'memory.search' && read.sourceRefs.some(value => value.id === id)));
  const first = f.invoke('memory:proposal-preview', request); assert.equal(first.ok, true, first.reason);
  assert.equal(first.preview.operation, 'update'); assert.equal(first.preview.expectedVersion, 1); assert.equal(first.preview.before.body, input().body);
  const edited = f.invoke('memory:proposal-preview', { ...request, input: input('User edited opening'), replacePreviewId: first.preview.previewId });
  assert.equal(edited.ok, true, edited.reason); assert.deepEqual(edited.preview.candidateOrigin, first.preview.candidateOrigin);
  assert.deepEqual(edited.preview.after.sourceRefs, first.preview.after.sourceRefs);
  assert.equal(f.invoke('memory:change-confirm', ticket(first.preview)).ok, false);
  const applied = f.invoke('memory:change-confirm', ticket(edited.preview)); assert.equal(applied.ok, true, applied.reason);
  assert.equal(applied.receipt.candidateOrigin.proposalId, request.proposalId);
  assert.equal(f.service.list().items[0].body, 'User edited opening'); assert.equal(f.service.list().items[0].id, id);
  assert.equal(f.invoke('memory:change-confirm', ticket(edited.preview)).replayed, true, 'receipt lookup precedes revoked source freshness');
  const undo = f.invoke('memory:undo-preview', { receiptId: applied.receipt.receiptId }); assert.equal(undo.ok, true);
  assert.equal(f.invoke('memory:change-confirm', ticket(undo.preview)).ok, true);
  assert.equal(f.service.list().items[0].body, input().body);
  const reverted = f.invoke('ai:conversation-proposal-status', { conversationId: request.conversationId, proposalIds: [request.proposalId] });
  assert.equal(reverted.items[0].status, 'reverted'); assert.equal(reverted.items[0].receiptId, applied.receipt.receiptId);
  f.manual({ operation: 'update', targetId: id, expectedVersion: 3, input: input('Later manual edit') });
  f.restart();
  const consumed = f.invoke('memory:proposal-preview', request);
  assert.equal(consumed.reason, 'memory-candidate-already-reviewed'); assert.equal(consumed.status, 'reverted');
  assert.equal(f.invoke('ai:conversation-proposal-status', { conversationId: request.conversationId, proposalIds: [request.proposalId] }).items[0].status, 'reverted');
  assert.equal(f.invoke('memory:change-confirm', ticket(edited.preview)).replayed, true);
  assert.equal(f.service.list().items[0].version, 4);
});

test('selected targets changed in flight, before preview, or after preview never commit a stale AI edit', async t => {
  for (const stage of ['in-flight', 'before-preview', 'after-preview']) {
    const f = fixture(t), saved = f.manual({ operation: 'add', input: input() }), id = saved.receipt.memoryId;
    const edit = () => f.manual({ operation: 'update', targetId: id, expectedVersion: 1, input: input('New current statement') });
    const proposal = { memoryChange: { operation: 'update', id, input: input('Stale proposal') } };
    const { result, request } = await f.propose(stage === 'in-flight' ? () => { edit(); return envelope(proposal); } : proposal, [id]);
    if (stage === 'in-flight') assert.equal(result.ok, false);
    else {
      if (stage === 'before-preview') edit();
      const prepared = f.invoke('memory:proposal-preview', request);
      if (stage === 'before-preview') assert.equal(prepared.ok, false);
      else { assert.equal(prepared.ok, true); edit(); assert.equal(f.invoke('memory:change-confirm', ticket(prepared.preview)).ok, false); }
    }
    assert.equal(f.service.list().items[0].version, 2); assert.equal(f.service.list().items[0].body, 'New current statement');
  }
});

test('AI forget uses permanent review, forbids edits, requires backend acknowledgement and remains consumed after restart', async t => {
  const f = fixture(t), saved = f.manual({ operation: 'add', input: input() }), id = saved.receipt.memoryId;
  const { result, request } = await f.propose({ memoryChange: { operation: 'forget', id } }, [id]);
  assert.equal(result.source, 'provider'); assert.equal(f.service.list().items.length, 1);
  assert.equal(f.invoke('memory:proposal-preview', { ...request, input: input() }).reason, 'memory-input-invalid');
  const prepared = f.invoke('memory:proposal-preview', request); assert.equal(prepared.ok, true, prepared.reason);
  assert.equal(prepared.preview.operation, 'permanent-remove'); assert.equal(prepared.preview.after, null);
  assert.equal(f.invoke('memory:change-confirm', ticket(prepared.preview)).reason, 'memory-permanent-acknowledgement-required');
  assert.equal(f.invoke('memory:change-confirm', { ...ticket(prepared.preview), permanentAcknowledged: false }).ok, false);
  assert.equal(f.service.list().items.length, 1);
  const applied = f.invoke('memory:change-confirm', { ...ticket(prepared.preview), permanentAcknowledged: true });
  assert.equal(applied.ok, true, applied.reason); assert.equal(applied.receipt.candidateOrigin.proposalId, request.proposalId);
  assert.equal(f.service.list().items.length, 0);
  f.restart();
  assert.equal(f.invoke('memory:change-confirm', ticket(prepared.preview)).replayed, true);
  const repeated = f.invoke('memory:proposal-preview', request); assert.equal(repeated.reason, 'memory-candidate-already-reviewed');
  assert.equal(repeated.status, 'removed');
});

test('manual permanent removal has the same backend acknowledgment boundary; ordinary confirmation cannot smuggle operation flags', t => {
  const f = fixture(t), saved = f.manual({ operation: 'add', input: input() });
  const prepared = f.invoke('memory:change-preview', { operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 });
  assert.equal(f.invoke('memory:change-confirm', ticket(prepared.preview)).reason, 'memory-permanent-acknowledgement-required');
  for (const extra of [{ operation: 'add' }, { permanent: false }, { permanentAcknowledged: 'yes' }]) {
    assert.equal(validateIpcPayload('memory:change-confirm', { ...ticket(prepared.preview), ...extra }).ok, false);
  }
  assert.equal(f.service.list().items.length, 1);
});
