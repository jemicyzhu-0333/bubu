'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openMemoryAuthority } = require('../src/bootstrap/memory-authority');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createPopoverMemoryList } = require('../src/surfaces/popover/features/memory-list.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const NOW = Date.UTC(2026, 9, 4, 12), tick = () => new Promise(resolve => setImmediate(resolve));

function setup(operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-change-chat-ui-'));
  const factStore = openDatabase({ filePath: path.join(directory, 'facts.sqlite'), driver: 'node:sqlite', now: () => NOW });
  const storage = { ownerId: 'memory-change-fixture-owner', identityAvailable: true, repository: null, close() {} };
  let serial = 0; const idFactory = kind => `${kind}-${++serial}`;
  const authority = openMemoryAuthority({ factStore, storage, userDataPath: directory, now: () => NOW, idFactory });
  const seed = subject => {
    const prepared = authority.service.preview({ operation: 'add', input: { kind: 'preference', subject, body: '原来的记忆正文', scope: 'work',
      expiresAt: null, sourceRefs: [{ kind: 'message', id: 'synthetic-lineage-source', revision: null }] } });
    assert.equal(prepared.ok, true, prepared.reason); const p = prepared.preview;
    const result = authority.service.confirm({ previewId: p.previewId, previewHash: p.previewHash, expectedVersion: p.expectedVersion });
    assert.equal(result.ok, true, result.reason); return p.after;
  };
  const original = seed('待修正记忆'), linked = operation === 'forget' ? seed('同源派生记忆') : null;
  const state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiMemoryEnabled: true,
    aiModel: 'fixture-only', aiBaseUrl: 'https://fixture.invalid/v1' } }, { now: NOW });
  const calls = [], providerInputs = [], routes = new Map();
  const collaboration = createAiCollaboration({ storage, factStore, memoryAuthority: authority, readSnapshot: () => structuredClone(state), getSettings: () => state.settings,
    credentialStore: { status: () => ({ configured: true }), get: () => 'fixture-only' }, now: () => NOW, idFactory,
    clientFactory: () => ({ endpoint: 'https://fixture.invalid/v1/chat/completions', async run(_task, input, options) {
      providerInputs.push(structuredClone(input)); options.beforeRequest();
      return { type: 'changeProposal', answer: '请先核对这条现有记忆。', readRequest: null,
        changeProposal: { memoryChange: { operation, id: original.id, ...(operation === 'update' ? { input: {
          kind: 'context', subject: '更正后的主题', body: '模型提出的新说法', scope: 'personal', expiresAt: null } } : {}) } } };
    } }) });
  collaboration.register((channel, handler) => routes.set(channel, handler));
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload-popover.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(_key, value) { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, async invoke(channel, payload) {
        const serialized = payload === undefined ? undefined : structuredClone(payload), decoded = validateIpcPayload(channel, serialized);
        assert.equal(decoded.ok, true, `${channel}: ${JSON.stringify(decoded)}`); assert.equal(typeof routes.get(channel), 'function', channel);
        const result = await routes.get(channel)({}, decoded.value); calls.push({ channel, payload: serialized, result }); return result;
      } } };
  } });
  const client = createPopoverSurfaceClient(bridge), dom = createCollaborationDom();
  const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const memory = createPopoverMemoryList({ $: dom.$, escapeHTML, surfaceClient: client, now: () => NOW }); memory.mount();
  const chat = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML, surfaceClient: client,
    fallbackReasonText: value => value, adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {},
    onMemoryCandidateReview: async request => { dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupAi').open = true; await memory.reviewMemoryCandidate(request); } });
  chat.mount();
  return { authority, client, dom, memory, chat, calls, original, linked, providerInputs,
    async propose() {
      await chat.open(); dom.$('#draftChatContextKind').value = 'memory'; await chat.contextSelection.load();
      assert.equal(chat.contextSelection.toggle(original.id, true), true); await chat.change('scope');
      dom.$('#draftChatInput').value = operation === 'forget' ? '这条过时了，请提出遗忘范围' : '这条不对，请提出更正'; await chat.send();
      const conversation = collaboration.sessions.get({ conversationId: collaboration.sessions.list({}).items[0].id }).conversation;
      const proposal = conversation.messages.at(-1).proposal; assert.equal(proposal?.kind, 'memory-candidate');
      assert.equal(JSON.parse(proposal.body).memoryChange.operation, operation);
      await chat.reviewMemoryCandidate(proposal.id); return { conversation, proposal };
    },
    close() { chat.dispose(); memory.dispose(); collaboration.dispose(); authority.close(); factStore.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test('production preload and SQLite preserve target identity while editing an AI correction before explicit confirmation', async () => {
  const h = setup('update');
  try {
    const { conversation, proposal } = await h.propose();
    const prepared = h.calls.filter(call => call.channel === 'memory:proposal-preview').at(-1);
    assert.equal(prepared.result.ok, true, prepared.result.reason); assert.equal(prepared.result.preview.operation, 'update');
    assert.equal(prepared.result.preview.before.id, h.original.id); assert.equal(prepared.result.preview.expectedVersion, 1);
    assert.match(h.dom.$('#memoryDraftTarget').textContent, /当前版本 1/);
    assert.equal(h.authority.service.list().items[0].body, '原来的记忆正文');
    h.dom.$('#memoryDraftBody').value = '我确认后的准确说法'; h.dom.fire('#memoryDraft', 'input'); await h.memory.confirm();
    assert.equal(h.calls.filter(call => call.channel === 'memory:change-confirm').length, 0);
    await h.memory.remember(); const edited = h.calls.filter(call => call.channel === 'memory:proposal-preview').at(-1);
    assert.equal(edited.result.preview.before.id, h.original.id); assert.equal(edited.payload.input.sourceRefs, undefined);
    assert.equal(edited.payload.input.validFrom, undefined); await h.memory.confirm(); await tick();
    const rows = h.authority.service.list().items; assert.equal(rows.length, 1); assert.equal(rows[0].id, h.original.id);
    assert.equal(rows[0].version, 2); assert.equal(rows[0].body, '我确认后的准确说法');
    assert.ok(rows[0].sourceRefs.some(ref => ref.kind === 'message' && ref.id === conversation.messages.at(-1).id));
    const status = await h.client.getConversationProposalStatus({ conversationId: conversation.id, proposalIds: [proposal.id] });
    assert.equal(status.items[0].status, 'applied'); assert.equal(status.items[0].targetId, h.original.id);
    assert.equal((await h.client.previewMemoryProposal({ conversationId: conversation.id, proposalId: proposal.id })).reason, 'memory-candidate-already-reviewed');
    assert.equal(h.providerInputs.length, 1);
  } finally { h.close(); }
});

test('production preload and SQLite require acknowledged expanded forget scope and return its real canonical receipt', async () => {
  const h = setup('forget');
  try {
    const { conversation, proposal } = await h.propose(), prepared = h.calls.filter(call => call.channel === 'memory:proposal-preview').at(-1);
    assert.equal(prepared.result.ok, true, prepared.result.reason); const p = prepared.result.preview;
    assert.equal(p.operation, 'permanent-remove'); assert.equal(p.permanent, true);
    assert.ok(p.affectedIds.includes(h.original.id)); assert.ok(p.affectedIds.includes(h.linked.id));
    assert.ok(h.dom.$('#memoryReviewContent').innerHTML.includes(h.linked.id)); assert.match(h.dom.$('#memoryReviewContent').innerHTML, /synthetic-lineage-source/);
    assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), true);
    await h.memory.confirm(); assert.equal(h.calls.filter(call => call.channel === 'memory:change-confirm').length, 0);
    const ticket = { previewId: p.previewId, previewHash: p.previewHash, expectedVersion: p.expectedVersion };
    assert.equal((await h.client.confirmMemoryChange(ticket)).reason, 'memory-permanent-acknowledgement-required');
    assert.equal(h.authority.service.list().items.length, 2);
    h.dom.$('#memoryPermanentAcknowledge').checked = true; await h.memory.confirm(); await tick();
    const applied = h.calls.filter(call => call.channel === 'memory:change-confirm').at(-1);
    assert.equal(applied.payload.permanentAcknowledged, true); assert.equal(applied.result.ok, true, applied.result.reason);
    assert.equal(h.authority.service.list().items.length, 0); assert.doesNotMatch(h.dom.$('#memoryReviewContent').innerHTML, /原来的记忆正文/);
    const replay = await h.client.confirmMemoryChange(ticket); assert.equal(replay.ok, true); assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.receiptId, applied.result.receipt.receiptId);
    const status = await h.client.getConversationProposalStatus({ conversationId: conversation.id, proposalIds: [proposal.id] });
    assert.equal(status.items[0].status, 'removed'); assert.equal(status.items[0].receiptId, applied.result.receipt.receiptId);
    assert.equal(h.providerInputs.length, 1);
  } finally { h.close(); }
});
