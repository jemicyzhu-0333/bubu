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

test('production preload, codecs, registered routes and SQLite review an inert chat candidate before confirming and forgetting its source lineage', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-chat-ui-'));
  const factStore = openDatabase({ filePath: path.join(directory, 'facts.sqlite'), driver: 'node:sqlite', now: () => NOW });
  const storage = { ownerId: 'memory-chat-fixture-owner', identityAvailable: true, repository: null, close() {} };
  let serial = 0; const idFactory = kind => `${kind}-${++serial}`;
  const authority = openMemoryAuthority({ factStore, storage, userDataPath: directory, now: () => NOW, idFactory });
  assert.equal(authority.service.available, true, authority.reason);
  const state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiMemoryEnabled: false,
    aiModel: 'fixture-only', aiBaseUrl: 'https://fixture.invalid/v1' } }, { now: NOW });
  const calls = [], providerInputs = [], routes = new Map();
  const collaboration = createAiCollaboration({ storage, factStore, memoryAuthority: authority, readSnapshot: () => structuredClone(state), getSettings: () => state.settings,
    credentialStore: { status: () => ({ configured: true }), get: () => 'fixture-only' }, now: () => NOW, idFactory,
    clientFactory: () => ({ endpoint: 'https://fixture.invalid/v1/chat/completions', async run(_task, input, options) {
      providerInputs.push(structuredClone(input)); options.beforeRequest();
      return { type: 'changeProposal', answer: '可以先核对是否记住这一点。', readRequest: null,
        changeProposal: { memoryCandidate: { kind: 'preference', subject: '工作时开头', body: '先写一句事实', scope: 'work', expiresAt: null } } };
    } }) });
  collaboration.register((channel, handler) => routes.set(channel, handler));
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload-popover.js'), 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(_key, value) { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, async invoke(channel, payload) {
        const serialized = payload === undefined ? undefined : structuredClone(payload);
        const decoded = validateIpcPayload(channel, serialized); assert.equal(decoded.ok, true, `${channel}: ${JSON.stringify(decoded)}`);
        const handler = routes.get(channel); assert.equal(typeof handler, 'function', channel);
        const result = await handler({}, decoded.value); calls.push({ channel, payload: serialized, result }); return result;
      } } }; }
  });
  const client = createPopoverSurfaceClient(bridge), dom = createCollaborationDom();
  const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const memory = createPopoverMemoryList({ $: dom.$, escapeHTML, surfaceClient: client, now: () => NOW }); memory.mount();
  const chat = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML, surfaceClient: client,
    fallbackReasonText: value => value, adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {},
    onMemoryCandidateReview: async request => { dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupAi').open = true; await memory.reviewMemoryCandidate(request); } });
  chat.mount();
  try {
    await chat.open(); dom.$('#draftChatInput').value = '工作时先写一句事实比较容易'; await chat.send();
    const conversation = collaboration.sessions.get({ conversationId: collaboration.sessions.list({}).items[0].id }).conversation;
    const proposal = conversation.messages.at(-1).proposal;
    assert.equal(proposal.kind, 'memory-candidate'); assert.equal(authority.service.list().items.length, 0);
    await chat.reviewMemoryCandidate(proposal.id);
    const prepared = calls.find(call => call.channel === 'memory:proposal-preview');
    assert.equal(prepared.result.ok, true, prepared.result.reason);
    assert.deepEqual(prepared.payload, { conversationId: conversation.id, proposalId: proposal.id });
    assert.equal(authority.service.list().items.length, 0); assert.match(dom.$('#memoryReviewContent').innerHTML, /尚未提交/);
    assert.equal(dom.$('#memoryDraftBody').value, '先写一句事实');
    const sourceRefs = prepared.result.preview.after.sourceRefs;
    dom.$('#memoryDraftSubject').value = '我核对后的工作开头'; dom.$('#memoryDraftBody').value = '先列两条事实，再开始';
    dom.$('#memoryDraftScope').value = 'personal'; dom.$('#memoryDraftExpiry').value = '2026-12-01T12:00';
    dom.fire('#memoryDraft', 'input'); await memory.confirm();
    assert.equal(authority.service.list().items.length, 0);
    assert.equal(calls.filter(call => call.channel === 'memory:change-confirm').length, 0);
    await memory.remember();
    const edited = calls.filter(call => call.channel === 'memory:proposal-preview').at(-1);
    assert.equal(edited.result.ok, true, edited.result.reason);
    assert.equal(edited.payload.proposalId, proposal.id); assert.equal(edited.payload.input.body, '先列两条事实，再开始');
    assert.equal(edited.payload.input.sourceRefs, undefined); assert.equal(edited.payload.input.sourceType, undefined);
    assert.deepEqual(edited.result.preview.after.sourceRefs, sourceRefs);
    assert.notEqual(edited.result.preview.previewHash, prepared.result.preview.previewHash);
    assert.equal(authority.service.list().items.length, 0);
    const unrelated = await client.previewMemoryChange({ operation: 'add', expectedVersion: null,
      input: { kind: 'preference', subject: '其他本机草稿', body: '尚未确认', scope: 'work', expiresAt: null } });
    const wrongReplacement = await client.previewMemoryProposal({ conversationId: conversation.id, proposalId: proposal.id,
      input: edited.payload.input, replacePreviewId: unrelated.preview.previewId });
    assert.equal(wrongReplacement.reason, 'memory-preview-conflict');
    assert.equal((await client.cancelMemoryChange({ previewId: unrelated.preview.previewId })).ok, true);
    // Replacing an existing candidate preview cancels exactly that ticket; a
    // delayed cancel of the old ticket must leave the new preview confirmable.
    await memory.remember();
    const replaced = calls.filter(call => call.channel === 'memory:proposal-preview').at(-1);
    assert.equal(replaced.payload.replacePreviewId, edited.result.preview.previewId);
    assert.equal(replaced.result.ok, true, replaced.result.reason);
    const stale = edited.result.preview;
    assert.equal((await client.confirmMemoryChange({ previewId: stale.previewId, previewHash: stale.previewHash, expectedVersion: null })).ok, false);
    await client.cancelMemoryChange({ previewId: stale.previewId });
    assert.equal(authority.service.list().items.length, 0);
    await memory.confirm(); await tick();
    let record = authority.service.list().items[0]; assert.equal(record.status, 'active'); assert.equal(record.sourceType, 'user-edit');
    assert.equal(record.body, '先列两条事实，再开始'); assert.equal(record.scope, 'personal');
    assert.equal(record.expiresAt, Date.parse('2026-12-01T12:00'));
    assert.deepEqual(record.sourceRefs, sourceRefs);
    assert.ok(record.sourceRefs.some(ref => ref.kind === 'message' && ref.id === conversation.messages.at(-1).id));
    const committedId = record.id;
    const groupStatus = await client.getConversationProposalStatus({ conversationId: conversation.id, proposalIds: [proposal.id] });
    assert.equal(groupStatus.ok, true); assert.equal(groupStatus.items[0].store, 'memory');
    assert.equal(groupStatus.items[0].status, 'applied'); assert.equal(groupStatus.items[0].targetId, committedId);
    assert.ok(groupStatus.items[0].receiptId);
    await chat.resume(conversation.id); await tick();
    assert.match(dom.$('#draftChatLog').innerHTML, /记忆 · 已提交/);
    assert.ok(dom.$('#draftChatLog').innerHTML.includes(groupStatus.items[0].receiptId));
    assert.match(dom.$('#draftChatLog').innerHTML, /核对记录/); chat.close(); await tick();
    dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupAi').open = true; await memory.load();
    const duplicate = await client.previewMemoryProposal({ conversationId: conversation.id, proposalId: proposal.id });
    assert.equal(duplicate.reason, 'memory-candidate-already-reviewed'); assert.equal(duplicate.memoryId, committedId);
    memory.edit(record.id); dom.$('#memoryDraftSubject').value = '日后修改主题'; dom.$('#memoryDraftBody').value = '日后确认的说法';
    await memory.remember(); await memory.confirm(); await tick();
    record = authority.service.list().items[0]; assert.equal(record.id, committedId); assert.equal(record.version, 2);
    const afterManualEdit = await client.previewMemoryProposal({ conversationId: conversation.id, proposalId: proposal.id });
    assert.equal(afterManualEdit.reason, 'memory-candidate-already-reviewed'); assert.equal(afterManualEdit.memoryId, committedId);
    assert.equal(state.settings.aiMemoryEnabled, false); assert.equal(providerInputs.length, 1);
    assert.equal((await client.forgetMemory(record.id)).reason, 'memory-reviewed-change-required');
    await memory.requestAction('remove', record.id, record.version); await memory.confirm(); await tick(); await memory.selectStatus('removed');
    record = authority.service.list().items[0]; assert.equal(record.recycleUntil - record.removedAt, 30 * 86400000);
    assert.match(dom.$('#memoryList').innerHTML, /30 天/);
    await memory.requestAction('permanent-remove', record.id, record.version);
    dom.$('#memoryPermanentAcknowledge').checked = true; await memory.confirm(); await tick();
    assert.equal(authority.service.list().items.length, 0);
    const repeated = await client.previewMemoryProposal({ conversationId: conversation.id, proposalId: proposal.id });
    assert.equal(repeated.ok, false); assert.equal(repeated.reason, 'memory-candidate-already-reviewed');
    assert.equal(repeated.status, 'removed');
    assert.equal(providerInputs.length, 1); assert.equal(state.settings.aiMemoryEnabled, false);
  } finally { chat.dispose(); memory.dispose(); collaboration.dispose(); authority.close(); factStore.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
