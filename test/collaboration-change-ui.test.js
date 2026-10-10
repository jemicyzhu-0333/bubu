'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationView } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
const { editableOperation, editOperation } = require('../src/surfaces/popover/ui/collaboration-change-edit.mjs');
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const operation = () => ({ opId: 'op-1', type: 'task.update', entityId: 't1', scope: 'current', patch: { title: '新标题', plannedFor: '2026-10-04' }, expectedVersion: 'v1', allocatedIds: [] });
const proposal = () => ({ id: 'm1', role: 'assistant', content: '模型说已经应用，但这仍是建议', proposal: { id: 'p1', kind: 'change-set', version: 1, body: JSON.stringify({ operations: [{ type: 'task.update', entityId: 't1', patch: { title: '新标题' } }] }) } });
function preview(overrides = {}) {
  return { changeSetId: 'cs1', conversationId: 'c1', proposalVersion: 1, applyGroupId: 'g1', operationsHash: 'a'.repeat(64), previewHash: 'b'.repeat(64), disclosureHash: 'c'.repeat(64),
    operations: [operation()], applyGroups: [{ applyGroupId: 'g1', store: 'config', opIds: ['op-1'] }],
    diff: [{ opId: 'op-1', type: 'task.update', entityRef: { kind: 'task', id: 't1' }, fields: [{ field: 'title', before: '旧标题', after: '新标题' }],
      derivedChanges: [{ field: 'nextAction', before: null, after: '随之变化的下一步' }], reversibility: { status: 'available', reason: null } }],
    warnings: ['仅本次'], rationale: '用户选择修改标题', evidenceRefs: [{ kind: 'message', id: 'm0', revision: null }], reversibility: 'available', ...overrides };
}
function applied(change = preview(), overrides = {}) {
  return { ...Object.fromEntries(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash'].map(key => [key, change[key]])),
    receiptId: 'r1', status: 'applied', appliedRevision: 7, committedAt: 1, revertsReceiptId: null,
    results: [{ opId: 'op-1', type: 'task.update' }], details: { diff: change.diff, undo: { expiresAt: 9999999999999 } }, ...overrides };
}
function harness() {
  const dom = createCollaborationDom(), calls = [];
  let record = { id: 'c1', revision: 1, purpose: 'stuck', mode: 'talk', relatedEntity: { type: 'task', id: 't1' }, messages: [proposal()],
    retention: { mode: 'ephemeral' }, saveState: 'ephemeral', inputDraft: '' };
  const response = () => ({ ok: true, conversation: structuredClone(record), scopeGrantId: 'grant1',
    disclosure: { fields: ['title'], provider: { model: 'Fixture', endpoint: 'https://fixture.invalid' } }, contextPreview: [{ items: [{ id: 't1', title: '当前任务' }] }] });
  const client = {
    async startConversation() { return response(); }, async getConversation() { return response(); }, async pauseConversation() { return { ok: true }; },
    async conversationTurn(args) { calls.push(['turn', args]); return response(); },
    async setConversationScope(args) { calls.push(['scope', args]); return { ...response(), scopeGrantId: 'grant2', contextPreview: [{ items: [{ id: 'in1', text: '已选择的收件原文' }] }] }; },
    async getConversationContextChoices(args) { calls.push(['choices', args]); return { ok: true, items: args.kind === 'inbox' ? [{ id: 'in1', text: '本机收件原文' }] : args.kind === 'routine' ? [{ id: 'med1', kind: 'medication', title: '不可选' }, { id: 'rou1', kind: 'meeting', title: '会议' }] : [{ id: 't1', title: '当前任务' }, { id: 't2', title: '另一任务' }], nextCursor: null, availability: 'available' }; },
    async previewConversationChanges(args) { calls.push(['preview', args]); return { ok: true, changeSet: preview(args.expectedProposalVersion ? { proposalVersion: args.expectedProposalVersion + 1, previewHash: 'd'.repeat(64), operations: args.operations } : {}) }; },
    async confirmConversationChanges(args) { calls.push(['confirm', args]); return { ok: true, receipt: applied({ ...preview(), ...args }), historyStatus: 'pending', undoAvailable: true }; },
    async getChangeReceipt(args) { calls.push(['receipt', args]); return { ok: true, receipt: applied(), historyStatus: 'synced', undoAvailable: true }; },
    async getConversationReceipts(args) { calls.push(['receipts', args]); return { ok: true, items: [], nextCursor: null }; },
    async previewChangeUndo(args) { calls.push(['undo', args]); return { ok: true, changeSet: preview({ changeSetId: 'undo-cs', revertsReceiptId: 'r1', operations: [{ opId: 'undo-op', type: 'task.restore', entityId: 't1' }] }) }; },
    async cancelConversationChanges(args) { calls.push(['cancel', args]); return { ok: true }; }
  };
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML, surfaceClient: client,
    fallbackReasonText: () => '', adoptProposal: () => {}, stageStuckProposal: () => ({ ok: true }), restoreModalFocus: () => {},
    isAiClarifyEnabled: () => true, showEntryStatus: () => {} });
  feature.mount();
  return { dom, calls, client, feature, setRecord(value) { record = value; }, response, status: () => dom.$('#draftChatChangeStatus').textContent,
    cards: () => dom.$('#draftChatChangeCards').innerHTML, log: () => dom.$('#draftChatLog').innerHTML };
}

test('context starts with only entry task; local search and selections do not send or apply', async () => {
  const h = harness(); await h.feature.open({ purpose: 'stuck', taskId: 't1' });
  assert.deepEqual(h.feature.contextSelection.selection(), { taskIds: ['t1'], inboxIds: [], routineIds: [], memoryIds: [] });
  h.dom.$('#draftChatContextKind').value = 'inbox'; await h.feature.contextSelection.load();
  assert.match(h.dom.$('#draftChatContextChoices').innerHTML, /本机收件原文/);
  h.feature.contextSelection.toggle('in1', true);
  h.dom.$('#draftChatInput').value = '一起整理'; await h.feature.send();
  assert.equal(h.calls.filter(([kind]) => ['turn', 'scope', 'confirm'].includes(kind)).length, 0);
  await h.feature.change('scope');
  assert.deepEqual(h.calls.find(([kind]) => kind === 'scope')[1], { conversationId: 'c1', focusSummary: false, planningPreferences: false, taskIds: ['t1'], inboxIds: ['in1'], routineIds: [], memoryIds: [] });
  assert.match(h.dom.$('#draftChatContextPreview').textContent, /已选择的收件原文/);
  assert.match(h.dom.$('#draftChatProvider').textContent, /Fixture.*fixture.invalid/);
  await h.feature.send(); assert.equal(h.calls.find(([kind]) => kind === 'turn')[1].scopeGrantId, 'grant2');
});

test('canonical context selection uses relatedEntity.kind and preserves actual returned IDs', async () => {
  const h = harness();
  const original = h.client.startConversation;
  h.client.startConversation = async () => {
    const result = await original(); result.conversation.relatedEntity = { kind: 'task', id: 't1' };
    result.selection = { taskIds: ['t1'], inboxIds: [], routineIds: [], focusSummary: false };
    return result;
  };
  await h.feature.open(); assert.deepEqual(h.feature.contextSelection.selection().taskIds, ['t1']);
});

test('context summary shows selected categories and preserves the preview-required state without a success banner', async () => {
  const h = harness(); await h.feature.open();
  assert.equal(h.dom.$('#draftChatScopeSelection').textContent, '已选：任务 1');
  await h.feature.contextSelection.load();
  assert.equal(h.dom.$('#draftChatStatus').textContent, '');
  h.feature.contextSelection.toggle('t1', false);
  assert.equal(h.dom.$('#draftChatScopeSelection').textContent, '未选择额外内容');
  assert.match(h.dom.$('#draftChatScopePending').textContent, /更新预览后才可发送/);
  assert.equal(h.feature.contextSelection.isDirty(), true);
  assert.equal(h.calls.some(([kind]) => ['scope', 'turn', 'confirm'].includes(kind)), false);
});

test('late local search never repaints a reopened session, and truncated candidates are disclosed', async () => {
  const h = harness(), pending = deferred(); await h.feature.open();
  h.client.getConversationContextChoices = () => pending.promise;
  const loading = h.feature.contextSelection.load(); h.feature.close(); await h.feature.open();
  pending.resolve({ ok: true, items: [{ id: 'old', title: '旧候选' }], availability: 'available' }); await loading;
  assert.doesNotMatch(h.dom.$('#draftChatContextChoices').innerHTML, /旧候选/);
  h.client.getConversationContextChoices = async () => ({ ok: true, items: [{ id: 'in1', text: '长文', textTruncated: true }], availability: 'available' });
  h.dom.$('#draftChatContextKind').value = 'inbox'; await h.feature.contextSelection.load();
  assert.match(h.dom.$('#draftChatContextChoices').innerHTML, /仅显示前 500 字/);
});

test('sensitive routines remain unselectable and unavailable choices never mean zero activity', async () => {
  const h = harness(); await h.feature.open(); h.dom.$('#draftChatContextKind').value = 'routine'; await h.feature.contextSelection.load();
  assert.equal(h.feature.contextSelection.toggle('med1', true), false);
  assert.equal(h.feature.contextSelection.toggle('rou1', true), true);
  h.client.getConversationContextChoices = async () => ({ ok: true, availability: 'unavailable', items: [] });
  await h.feature.contextSelection.load(); assert.match(h.dom.$('#draftChatStatus').textContent, /不能据此判断没有记录/);
});

test('each selected context category is capped at fifty and failed scope reverts pending choice', async () => {
  const h = harness(); await h.feature.open(); h.dom.$('#draftChatContextKind').value = 'inbox';
  h.client.getConversationContextChoices = async () => ({ ok: true, items: Array.from({ length: 51 }, (_, i) => ({ id: `in${i}`, text: `条目${i}` })), availability: 'available' });
  await h.feature.contextSelection.load();
  for (let i = 0; i < 50; i++) assert.equal(h.feature.contextSelection.toggle(`in${i}`, true), true);
  assert.equal(h.feature.contextSelection.toggle('in50', true), false);
  h.client.setConversationScope = async () => ({ ok: false, reason: 'scope-grant-invalid' });
  await h.feature.change('scope'); assert.deepEqual(h.feature.contextSelection.selection().inboxIds, []);
});

test('model applied claims remain inert; only local preview creates reviewable actual diffs', async () => {
  const h = harness(); await h.feature.open();
  assert.match(h.log(), /data-proposal-status="p1">任务与日常 · 提交状态暂不可用/);
  assert.equal(h.dom.$('#draftChatChanges').classList.contains('hidden'), true);
  await h.feature.changes.preview('p1');
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  assert.match(h.cards(), /旧标题/); assert.match(h.cards(), /新标题/); assert.match(h.cards(), /随之变化/);
  assert.match(h.cards(), /用户选择修改标题/); assert.match(h.cards(), /message:m0/);
  assert.doesNotMatch(h.cards(), /独立回执|独立提交组/);
});

test('review rejects multi-group previews instead of presenting unsupported partial commits', async () => {
  const h = harness(); await h.feature.open();
  h.client.previewConversationChanges = async () => ({ ok: true, changeSet: preview({
    applyGroups: [{ applyGroupId: 'g1' }, { applyGroupId: 'g2' }]
  }) });
  await h.feature.changes.preview('p1');
  assert.equal(h.cards(), ''); assert.match(h.status(), /本机差异暂不可用/);
  await h.feature.changes.confirm();
  assert.equal(h.calls.some(([kind]) => kind === 'confirm'), false);
});

test('editing invalidates confirmation and sends only closed candidate fields with server operation ID', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.feature.changes.edit('op-1', 'title', '手动修改'); await h.feature.changes.confirm();
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  await h.feature.changes.preview(); const request = h.calls.filter(([kind]) => kind === 'preview').at(-1)[1];
  assert.equal(request.expectedProposalVersion, 1); assert.equal(request.changeSetId, 'cs1');
  assert.equal(request.operations[0].patch.title, '手动修改');
  assert.equal('expectedVersion' in request.operations[0], false); assert.equal('allocatedIds' in request.operations[0], false);
  await h.feature.changes.confirm(); const confirmed = h.calls.find(([kind]) => kind === 'confirm')[1];
  assert.equal(confirmed.proposalVersion, 2); assert.equal(confirmed.previewHash, 'd'.repeat(64));
});

test('deselected operations require re-preview, and an empty selection cannot be confirmed', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.feature.changes.select('op-1', false); await h.feature.changes.confirm(); await h.feature.changes.preview();
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  assert.equal(h.calls.filter(([kind]) => kind === 'preview').length, 1); assert.match(h.status(), /至少保留一项/);
});

test('confirmation is single-flight and pending timeline is successful business commit, not failed application', async () => {
  const h = harness(), pending = deferred(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.client.confirmConversationChanges = args => { h.calls.push(['confirm', args]); return pending.promise; };
  const first = h.feature.changes.confirm(); await h.feature.changes.confirm();
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  pending.resolve({ ok: true, receipt: applied(), historyStatus: 'pending' }); await first;
  assert.match(h.cards(), /修改已提交，时间线记录待同步/); assert.match(h.cards(), /回执 r1/);
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  await h.feature.changes.showReceipt('r1'); assert.match(h.cards(), /时间线记录已同步/);
});

test('already-applied preview displays the canonical receipt and never offers a fresh apply', async () => {
  const h = harness(); await h.feature.open();
  h.client.previewConversationChanges = async () => ({ ok: true, alreadyApplied: true, receipt: applied(), receiptId: 'r1', historyStatus: 'pending', durability: 'confirmed', undoAvailable: true });
  await h.feature.changes.preview('p1'); assert.match(h.cards(), /回执 r1/);
  assert.equal(h.dom.$('#btnDraftChatChangeConfirm').classList.contains('hidden'), true);
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
});

test('durability uncertainty preserves exact confirmation and never reports the committed change as unapplied', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.client.confirmConversationChanges = async args => { h.calls.push(['confirm', args]); return { ok: false, reason: 'change-durability-uncertain', committed: true, receiptId: 'r1', retrySameIdentity: true }; };
  await h.feature.changes.confirm(); assert.match(h.status(), /已落入本机状态.*持久保存尚未确认/); assert.doesNotMatch(h.status(), /未应用/);
  const bound = h.calls.find(([kind]) => kind === 'confirm')[1];
  h.client.confirmConversationChanges = async args => { assert.deepEqual(args, bound); return { ok: true, receipt: applied(), durability: 'confirmed', historyStatus: 'pending', undoAvailable: true }; };
  await h.feature.changes.confirm({ retry: true }); assert.match(h.cards(), /回执 r1/);
});

test('receipt-only unconfirmed durability is visible and supports exact-identity persistence verification', async () => {
  const h = harness(); h.client.getChangeReceipt = async () => ({ ok: true, receipt: applied(), durability: 'unconfirmed', historyStatus: 'pending', undoAvailable: false });
  await h.feature.openReceipt({ receiptId: 'r1' }); assert.match(h.cards(), /持久保存尚未确认/);
  assert.equal(h.dom.$('#btnDraftChatUndo').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#btnDraftChatChangeRetry').classList.contains('hidden'), false);
  await h.feature.changes.confirm({ retry: true }); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
});

test('lost response retry binds the same identity and mismatched receipts cannot claim success', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.client.confirmConversationChanges = async args => { h.calls.push(['confirm', args]); throw new Error('response lost'); };
  await h.feature.changes.confirm(); assert.match(h.status(), /尚未确认/);
  h.feature.changes.edit('op-1', 'title', '不能改');
  h.client.confirmConversationChanges = async args => { h.calls.push(['confirm', args]); return { ok: true, receipt: applied(preview({ previewHash: 'f'.repeat(64) })) }; };
  await h.feature.changes.confirm({ retry: true }); assert.match(h.status(), /尚未确认/);
  h.client.confirmConversationChanges = async args => { h.calls.push(['confirm', args]); return { ok: true, receipt: applied(), historyStatus: 'synced' }; };
  await h.feature.changes.confirm({ retry: true });
  const requests = h.calls.filter(([kind]) => kind === 'confirm').map(([, args]) => args);
  assert.deepEqual(requests[0], requests[1]); assert.deepEqual(requests[0], requests[2]); assert.match(h.cards(), /回执 r1/);
});

test('conflict blocks stale confirmation, and context edits invalidate a visible preview', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  h.client.confirmConversationChanges = async args => { h.calls.push(['confirm', args]); return { ok: false, reason: 'change-target-conflict' }; };
  await h.feature.changes.confirm(); assert.match(h.status(), /内容已在别处修改/);
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  await h.feature.changes.preview();
  h.dom.$('#draftChatContextKind').value = 'inbox'; await h.feature.contextSelection.load(); h.feature.contextSelection.toggle('in1', true);
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
});

test('undo is a fresh read-only diff and needs a separate explicit confirm', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1'); await h.feature.changes.confirm();
  await h.feature.changes.undo();
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  assert.match(h.dom.$('#draftChatChangeTitle').textContent, /撤销前核对/);
  assert.equal(h.dom.$('#btnDraftChatChangeConfirm').textContent, '确认这次撤销');
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').at(-1)[1].changeSetId, 'undo-cs');
});

test('creation and inbox receipts without undo never offer generic undo', async () => {
  const h = harness(); await h.feature.open(); h.client.getChangeReceipt = async () => ({ ok: true, receipt: applied(preview(), { details: { diff: [], undo: null } }) });
  await h.feature.changes.showReceipt('r1'); assert.equal(h.dom.$('#btnDraftChatUndo').classList.contains('hidden'), true);
  await h.feature.changes.undo(); assert.equal(h.calls.filter(([kind]) => kind === 'undo').length, 0);
});

test('late preview and commit callbacks cannot repaint after close or alter a newer conversation', async () => {
  const h = harness(), pending = deferred(); await h.feature.open();
  h.client.previewConversationChanges = () => pending.promise;
  const reading = h.feature.changes.preview('p1'); h.feature.close(); await h.feature.open();
  pending.resolve({ ok: true, changeSet: preview() }); await reading;
  assert.equal(h.dom.$('#draftChatChanges').classList.contains('hidden'), true);
  h.client.previewConversationChanges = async () => ({ ok: true, changeSet: preview() }); await h.feature.changes.preview('p1');
  const writing = deferred(); h.client.confirmConversationChanges = () => writing.promise;
  const committing = h.feature.changes.confirm(); h.feature.close();
  h.setRecord({ ...h.response().conversation, id: 'c2' }); await h.feature.resume('c2');
  writing.resolve({ ok: true, receipt: applied() }); await committing;
  assert.equal(h.dom.$('#draftChatChanges').classList.contains('hidden'), true);
});

test('durable receipt history is independently restored and model text is never used as receipt evidence', async () => {
  const h = harness(); h.client.getConversationReceipts = async () => ({ ok: true, items: [{ ok: true, receipt: applied(), historyStatus: 'pending', undoAvailable: true }, { ...applied(), receiptId: 'wrong-owner-conversation', conversationId: 'other' }], nextCursor: null });
  await h.feature.open(); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.dom.$('#draftChatReceipts').innerHTML, /data-chat-receipt="r1"/);
  assert.doesNotMatch(h.dom.$('#draftChatReceipts').innerHTML, /wrong-owner/);
  assert.match(h.log(), /data-proposal-status="p1">任务与日常 · 提交状态暂不可用/);
});

test('normal proposal unknown outcome restores the exact confirmation when the same conversation reopens', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1');
  const confirmations = [];
  h.client.confirmConversationChanges = async args => { confirmations.push(structuredClone(args));
    return confirmations.length === 1 ? { ok: false, reason: 'change-commit-outcome-unknown', retrySameIdentity: true }
      : { ok: true, receipt: applied({ ...preview(), ...args }), historyStatus: 'pending', undoAvailable: true }; };
  await h.feature.changes.confirm(); h.feature.close(); await h.feature.resume('c1');
  assert.equal(h.dom.$('#draftChatChanges').classList.contains('hidden'), false);
  await h.feature.changes.confirm({ retry: true });
  assert.equal(confirmations.length, 2); assert.deepEqual(confirmations[1], confirmations[0]);
});

test('authoritative undoAvailable false hides undo even when retained compensation details remain', async () => {
  const h = harness(); await h.feature.open();
  h.client.getChangeReceipt = async () => ({ ok: true, receipt: applied(), undoAvailable: false });
  await h.feature.changes.showReceipt('r1'); await h.feature.changes.undo();
  assert.equal(h.calls.filter(([kind]) => kind === 'undo').length, 0);
  assert.equal(h.dom.$('#btnDraftChatUndo').classList.contains('hidden'), true);
});

test('timeline continue opens a closed collaboration surface before restoring its canonical conversation', async () => {
  const h = harness(); await h.feature.resume('c1'); assert.equal(h.feature.isOpen(), true);
  assert.match(h.log(), /data-chat-change="p1"/);
});

test('receipt-only entry neither opens nor creates a conversation and suppresses chat mutations', async () => {
  const h = harness();
  h.client.startConversation = () => assert.fail('receipt mode must not create a conversation');
  h.client.getConversation = () => assert.fail('receipt mode must not need a conversation');
  await h.feature.openReceipt({ receiptId: 'r1' });
  assert.match(h.cards(), /回执 r1/); assert.equal(h.dom.$('#draftChatTitle').textContent, '本机变更回执');
  assert.equal(h.dom.$('#draftChatConversationControls').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#draftChatConversationComposer').classList.contains('hidden'), true);
  await h.feature.startNew(); await h.feature.send(); await h.feature.change('scope');
  assert.equal(h.calls.filter(([kind]) => ['turn', 'scope', 'start'].includes(kind)).length, 0);
  await h.feature.changes.undo(); assert.equal(h.calls.find(([kind]) => kind === 'undo')[1].conversationId, 'c1');
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
});

test('late receipt and undo results cannot repaint a newer receipt-only view', async () => {
  const h = harness(), a = deferred();
  h.client.getChangeReceipt = ({ receiptId }) => receiptId === 'r1' ? a.promise : Promise.resolve({ ok: true, receipt: applied(preview({ conversationId: 'c2' }), { receiptId: 'r2' }), undoAvailable: true });
  const opening = h.feature.openReceipt({ receiptId: 'r1' }); await new Promise(resolve => setImmediate(resolve));
  await h.feature.openReceipt({ receiptId: 'r2' });
  a.resolve({ ok: true, receipt: applied(), undoAvailable: true }); await opening;
  assert.match(h.cards(), /回执 r2/); assert.doesNotMatch(h.cards(), /回执 r1/);
  const undo = deferred(); h.client.previewChangeUndo = () => undo.promise;
  const reading = h.feature.changes.undo(); h.feature.close();
  h.client.getChangeReceipt = async () => ({ ok: true, receipt: applied(), undoAvailable: true });
  await h.feature.openReceipt({ receiptId: 'r1' });
  undo.resolve({ ok: true, changeSet: preview({ conversationId: 'c2', revertsReceiptId: 'r2' }) }); await reading;
  assert.match(h.cards(), /回执 r1/); assert.equal(h.dom.$('#btnDraftChatChangeConfirm').classList.contains('hidden'), true);
  assert.ok(h.calls.some(([kind, args]) => kind === 'cancel' && args.conversationId === 'c2'));
});

test('closing during receipt undo confirmation preserves the same identity for recovery after a lost response', async () => {
  const h = harness(), response = deferred(); await h.feature.openReceipt({ receiptId: 'r1' }); await h.feature.changes.undo();
  h.client.confirmConversationChanges = args => { h.calls.push(['confirm', args]); return response.promise; };
  const committing = h.feature.changes.confirm(); const expected = h.calls.find(([kind]) => kind === 'confirm')[1];
  h.feature.close(); response.reject(new Error('response lost')); await committing;
  await h.feature.openReceipt({ receiptId: 'r1' }); assert.match(h.status(), /先前的撤销提交结果尚未确认/);
  h.client.confirmConversationChanges = async args => { assert.deepEqual(args, expected); return { ok: true, receipt: applied({ ...preview(), ...args }, { receiptId: 'undo-r', revertsReceiptId: 'r1' }), undoAvailable: false }; };
  await h.feature.changes.confirm({ retry: true }); assert.match(h.cards(), /回执 undo-r/);
});

test('unavailable receipt history is visible and does not claim there were no commits', async () => {
  const h = harness(); h.client.getConversationReceipts = async () => ({ ok: false, reason: 'unavailable' });
  await h.feature.open(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dom.$('#draftChatReceiptHistory').classList.contains('hidden'), false);
  assert.match(h.dom.$('#draftChatReceiptsStatus').textContent, /不能据此判断没有提交记录/);
});

test('cancel discards only the preview and leaves canonical proposal history readable', async () => {
  const h = harness(); await h.feature.open(); await h.feature.changes.preview('p1'); await h.feature.changes.cancel();
  assert.deepEqual(h.calls.find(([kind]) => kind === 'cancel')[1], { conversationId: 'c1', changeSetId: 'cs1', proposalVersion: 1,
    applyGroupId: 'g1', operationsHash: 'a'.repeat(64), previewHash: 'b'.repeat(64), disclosureHash: 'c'.repeat(64) });
  await h.feature.changes.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  assert.match(h.log(), /data-chat-change="p1"/); assert.match(h.status(), /原建议仍在/);
});

test('all diff, rationale, source and context text is escaped rather than executed', async () => {
  const h = harness(); await h.feature.open();
  const change = preview(); change.rationale = '<script>run()</script>'; change.warnings = ['<img onerror="run()">'];
  change.diff[0].fields[0].after = '<svg onload="run()">';
  h.client.previewConversationChanges = async () => ({ ok: true, changeSet: change }); await h.feature.changes.preview('p1');
  const decorativeIcon = '<svg class="disclosure-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4" vector-effect="non-scaling-stroke"/></svg>';
  assert.equal(h.cards().split(decorativeIcon).length - 1, 1);
  assert.doesNotMatch(h.cards().replace(decorativeIcon, ''), /<script>|<img|<svg/);
  for (const escaped of ['&lt;script&gt;', '&lt;img onerror=&quot;run()&quot;&gt;', '&lt;svg onload=&quot;run()&quot;&gt;']) assert.ok(h.cards().includes(escaped));
});

test('routine changes separately disclose actual timezone, scheduling scope and no occurrence changes', async () => {
  const h = harness(); await h.feature.open();
  const op = { opId: 'rou-op', type: 'routine.schedule', entityId: 'rou1', timezone: 'Asia/Shanghai', schedule: { frequency: 'daily', timesOfDay: ['09:00'], weekdays: [], windowMinutes: 30 } };
  h.client.previewConversationChanges = async () => ({ ok: true, changeSet: preview({ operations: [op], diff: [] }) });
  await h.feature.changes.preview('p1');
  assert.match(h.cards(), /chat-change-routine/); assert.match(h.cards(), /Asia\/Shanghai/); assert.match(h.cards(), /不改变已发生记录/);
  const candidate = editableOperation(op); assert.equal('timezone' in candidate, false);
  assert.equal(editOperation(candidate, 'timesOfDay', '10:00, 12:00').schedule.timesOfDay.length, 2);
});

test('history rendering is bounded, every older message is accessible, and append does not yank scroll-back', () => {
  const dom = createCollaborationDom(), view = createCollaborationView({ $: dom.$, escapeHTML });
  const record = { id: 'long', mode: 'talk', retention: { mode: 'ephemeral' }, messages: Array.from({ length: 451 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `正文 ${i}` })) };
  view.conversation(record, null);
  assert.equal((dom.$('#draftChatLog').innerHTML.match(/<article/g) || []).length, 200);
  assert.match(dom.$('#draftChatHistoryRange').textContent, /第 252–451 条/);
  view.pageHistory('earlier'); assert.match(dom.$('#draftChatLog').innerHTML, /data-message-id="m51"/);
  view.pageHistory('earlier'); assert.match(dom.$('#draftChatLog').innerHTML, /data-message-id="m0"/);
  dom.$('#draftChatLog').scrollTop = 77;
  record.messages.push({ id: 'm451', role: 'assistant', content: '新回复' });
  view.conversation(record, null, { toBottom: true });
  assert.equal(dom.$('#draftChatLog').scrollTop, 77); assert.doesNotMatch(dom.$('#draftChatLog').innerHTML, /新回复/);
  view.pageHistory('latest'); assert.match(dom.$('#draftChatLog').innerHTML, /新回复/);
  assert.equal((dom.$('#draftChatLog').innerHTML.match(/<article/g) || []).length, 200);
  view.pageHistory('earlier'); const earlier = dom.$('#draftChatHistoryRange').textContent;
  view.conversation({ id: 'another', messages: [], retention: {} }, null);
  view.conversation(record, null); assert.equal(dom.$('#draftChatHistoryRange').textContent, earlier);
});
