'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { routines } = require('../src/capabilities');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');

const NOW = new Date(2026, 9, 4, 10).getTime();
const BINDINGS = Object.freeze({ startConversation: 'ai:conversation-start', getConversation: 'ai:conversation-open',
  listConversations: 'ai:conversation-list', conversationTurn: 'ai:conversation-turn', pauseConversation: 'ai:conversation-pause',
  cancelConversation: 'ai:conversation-cancel', setConversationScope: 'ai:conversation-scope', setConversationMode: 'ai:conversation-mode',
  setConversationRetention: 'ai:conversation-retention', getConversationContextChoices: 'ai:conversation-context-choices',
  previewConversationChanges: 'ai:change-preview', confirmConversationChanges: 'ai:change-confirm', cancelConversationChanges: 'ai:change-cancel',
  getChangeReceipt: 'ai:change-receipt', getConversationReceipts: 'ai:conversation-receipts', previewChangeUndo: 'ai:change-undo-preview' });
function setup(candidate) {
  let serial = 0, revision = 0, commits = 0;
  const calls = [], providerInputs = [];
  let state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiModel: 'fixture', aiBaseUrl: 'https://fixture.invalid/v1' },
    tasks: [{ id: 'task-1', title: '报告', createdAt: 1, steps: [{ id: 'step-1', title: '打开报告', done: false }] }],
    impulses: [{ id: 'inbox-1', text: '选择后才参考的原文', createdAt: 1 }, { id: 'inbox-2', text: '不应发送的未选原文', createdAt: 2 }] }, { now: NOW });
  routines.routineEditing.addRoutine(state, { title: '会议', kind: 'meeting', schedule: { frequency: 'daily', timesOfDay: ['15:00'], weekdays: [], windowMinutes: 30 },
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'routine-1', now: NOW });
  routines.routineEditing.addRoutine(state, { title: '敏感日常', kind: 'medication', schedule: null,
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'routine-sensitive', now: NOW });
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(next, context) { state = normalizePersistedState(next, context); commits++; revision++; return structuredClone(state); } };
  const service = createAiCollaboration({ storage: { ownerId: 'synthetic-owner-1234', identityAvailable: true, repository: null, close() {} },
    readSnapshot: repository.snapshot, getSettings: () => state.settings, now: () => NOW, idFactory: kind => `${kind}-${++serial}`,
    credentialStore: { status: () => ({ configured: true }), get: () => 'fixture-only' },
    factStore: { healthy: true, timeline: { queryRange: () => ({ ok: true, items: [] }) } },
    changePorts: { unitOfWork: createUnitOfWork({ repository }), readRevision: repository.revision,
      normalizeState: normalizePersistedState, getTimezone: () => 'UTC',
      taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25 } },
    clientFactory: () => ({ endpoint: 'https://fixture.invalid/v1/chat/completions', async run(_name, input, options) {
      providerInputs.push(structuredClone(input)); options.beforeRequest();
      return { type: 'changeProposal', answer: '以下是待核对的合成建议。', readRequest: null, changeProposal: { operations: structuredClone(candidate) } };
    } }) });
  const routes = new Map(); service.register((channel, handler) => routes.set(channel, handler));
  const bridge = new Proxy({}, { get(_target, name) {
    if (name === 'onPopoverHidden') return () => () => {};
    if (!BINDINGS[name]) return () => { throw new Error(`Unexpected fixture port: ${String(name)}`); };
    return async payload => {
      const channel = BINDINGS[name], decoded = validateIpcPayload(channel, payload);
      assert.equal(decoded.ok, true, `${name} IPC: ${JSON.stringify(decoded)}`);
      const result = await routes.get(channel)({}, decoded.value ?? decoded.payload ?? payload);
      calls.push({ name, payload: structuredClone(payload), result: structuredClone(result) });
      return result;
    };
  } });
  const dom = createCollaborationDom(), feature = createPopoverDraftConversation({ document: dom.document, $: dom.$,
    escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    surfaceClient: createPopoverSurfaceClient(bridge), fallbackReasonText: value => value, adoptProposal() {},
    stageStuckProposal: () => ({ ok: true }), restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {} });
  feature.mount();
  const last = name => calls.filter(call => call.name === name).at(-1);
  const proposalId = () => service.sessions.list({}).items[0] && service.sessions.get({ conversationId: service.sessions.list({}).items[0].id }).conversation.messages.at(-1).proposal.id;
  return { service, feature, dom, calls, last, providerInputs, inspect: repository.snapshot, commits: () => commits,
    changeState(fn) { fn(state); revision++; }, proposalId,
    async send(text = '请提出改动') { dom.$('#draftChatInput').value = text; await feature.send(); },
    close() { feature.dispose(); service.dispose(); } };
}

test('actual scoped UI, closed routes, real preview/commit ledger and wrapped receipt history work end to end', async () => {
  const h = setup([{ type: 'task.update', entityId: 'task-1', scope: 'current', patch: { title: '更小的报告' } }]);
  try {
    await h.feature.open({ purpose: 'stuck', taskId: 'task-1' });
    assert.deepEqual(h.feature.contextSelection.selection().taskIds, ['task-1']);
    await h.send(); await h.feature.changes.preview(h.proposalId());
    assert.equal(h.last('previewConversationChanges').result.ok, true, h.last('previewConversationChanges').result.reason);
    assert.match(h.dom.$('#draftChatChangeCards').innerHTML, /更小的报告/); assert.equal(h.commits(), 0);
    const original = h.last('previewConversationChanges').result.changeSet;
    h.feature.changes.edit(original.operations[0].opId, 'title', '本人修改的报告'); await h.feature.changes.preview();
    assert.equal(h.last('previewConversationChanges').result.ok, true, h.last('previewConversationChanges').result.reason);
    await h.feature.changes.confirm();
    const confirmed = h.last('confirmConversationChanges'); assert.equal(confirmed.result.ok, true, confirmed.result.reason);
    assert.equal(h.inspect().tasks[0].title, '本人修改的报告'); assert.equal(h.inspect().aiCollaboration.receipts.length, 1);
    assert.match(h.dom.$('#draftChatChangeCards').innerHTML, /时间线记录待同步/);
    const commits = h.commits(); await h.feature.changes.confirm(); assert.equal(h.commits(), commits);
    await h.feature.changes.listReceipts(); assert.match(h.dom.$('#draftChatReceipts').innerHTML, new RegExp(confirmed.result.receiptId));
    h.feature.close(); await h.feature.resume(confirmed.result.receipt.conversationId);
    await h.feature.changes.listReceipts(); assert.match(h.dom.$('#draftChatReceipts').innerHTML, /已确认修改/);
    await h.feature.changes.showReceipt(confirmed.result.receiptId);
    h.changeState(state => { state.settings.aiBreakdownEnabled = false; }); h.service.invalidateAll();
    await h.feature.changes.undo();
    assert.equal(h.last('previewChangeUndo').result.ok, true, h.last('previewChangeUndo').result.reason);
    assert.equal(h.inspect().tasks[0].title, '本人修改的报告');
    await h.feature.changes.confirm(); assert.equal(h.last('confirmConversationChanges').result.ok, true, h.last('confirmConversationChanges').result.reason);
    assert.equal(h.inspect().tasks[0].title, '报告'); assert.equal(h.inspect().aiCollaboration.receipts.length, 2);
    assert.equal(h.inspect().aiCollaboration.receipts[0].status, 'reverted');
  } finally { h.close(); }
});

test('actual context choices and scope disclose only selected inbox/routine data, then commit preserves original and log', async () => {
  const h = setup([{ type: 'inbox.convert-task', entityId: 'inbox-1', input: { title: '从收件建立' } },
    { type: 'routine.schedule', entityId: 'routine-1', schedule: { frequency: 'daily', timesOfDay: ['16:00'], weekdays: [], windowMinutes: 30 } }]);
  try {
    await h.feature.open({ purpose: 'stuck', taskId: 'task-1' });
    for (const [kind, id] of [['inbox', 'inbox-1'], ['routine', 'routine-1']]) {
      h.dom.$('#draftChatContextKind').value = kind; await h.feature.contextSelection.load();
      if (kind === 'routine') assert.doesNotMatch(h.dom.$('#draftChatContextChoices').innerHTML, /敏感日常/);
      h.feature.contextSelection.toggle(id, true);
    }
    await h.feature.change('scope'); assert.equal(h.last('setConversationScope').result.ok, true, h.last('setConversationScope').result.reason);
    assert.match(h.dom.$('#draftChatContextPreview').textContent, /选择后才参考的原文/);
    assert.doesNotMatch(h.dom.$('#draftChatContextPreview').textContent, /不应发送的未选原文|敏感日常/);
    await h.send(); assert.doesNotMatch(JSON.stringify(h.providerInputs), /不应发送的未选原文|敏感日常/);
    await h.feature.changes.preview(h.proposalId()); assert.equal(h.last('previewConversationChanges').result.ok, true, h.last('previewConversationChanges').result.reason);
    const logs = h.inspect().routineLog; await h.feature.changes.confirm();
    assert.equal(h.last('confirmConversationChanges').result.ok, true, h.last('confirmConversationChanges').result.reason);
    const after = h.inspect(); assert.equal(after.tasks.length, 2); assert.equal(after.impulses[0].text, '选择后才参考的原文');
    assert.equal(after.routines.find(item => item.id === 'routine-1').schedule.timesOfDay[0], '16:00');
    assert.deepEqual(after.routineLog, logs); assert.equal(h.last('confirmConversationChanges').result.undoAvailable, false);
    assert.equal(h.dom.$('#btnDraftChatUndo').classList.contains('hidden'), true);
  } finally { h.close(); }
});

test('scope renewal discards old preview identity and preserves user edits in a fresh server preview', async () => {
  const h = setup([{ type: 'task.update', entityId: 'task-1', scope: 'current', patch: { title: '候选标题' } }]);
  try {
    await h.feature.open({ purpose: 'stuck', taskId: 'task-1' }); await h.send(); await h.feature.changes.preview(h.proposalId());
    const first = h.last('previewConversationChanges').result.changeSet;
    h.feature.changes.edit(first.operations[0].opId, 'title', '保留本人编辑');
    h.dom.$('#draftChatFocusSummary').checked = true; await h.feature.change('scope');
    await h.feature.changes.preview(); const next = h.last('previewConversationChanges');
    assert.equal(next.result.ok, true, next.result.reason);
    assert.notEqual(next.result.changeSet.authorization.scopeGrantId, first.authorization.scopeGrantId);
    assert.equal('changeSetId' in next.payload, false);
    assert.equal(next.payload.operations[0].patch.title, '保留本人编辑'); assert.equal('opId' in next.payload.operations[0], false);
    await h.feature.changes.confirm(); assert.equal(h.inspect().tasks[0].title, '保留本人编辑');
  } finally { h.close(); }
});

test('local receipt UI remains independently available after AI is disabled and conversation is deleted', async () => {
  const h = setup([{ type: 'task.update', entityId: 'task-1', patch: { title: '保留回执' } }]);
  try {
    await h.feature.open({ purpose: 'stuck', taskId: 'task-1' }); await h.send(); await h.feature.changes.preview(h.proposalId()); await h.feature.changes.confirm();
    const result = h.last('confirmConversationChanges').result, cid = result.receipt.conversationId;
    h.feature.close(); await new Promise(resolve => setImmediate(resolve));
    const conversation = h.service.sessions.get({ conversationId: cid }).conversation;
    h.service.sessions.delete({ conversationId: cid, expectedRevision: conversation.revision });
    h.changeState(state => { state.settings.aiBreakdownEnabled = false; state.settings.aiClarifyEnabled = false; }); h.service.invalidateAll();
    const before = h.providerInputs.length, turns = h.calls.filter(call => ['startConversation', 'getConversation'].includes(call.name)).length;
    await h.feature.openReceipt({ receiptId: result.receiptId });
    assert.match(h.dom.$('#draftChatChangeCards').innerHTML, new RegExp(result.receiptId));
    assert.equal(h.calls.filter(call => ['startConversation', 'getConversation'].includes(call.name)).length, turns);
    assert.equal(h.providerInputs.length, before);
    await h.feature.changes.undo(); assert.equal(h.last('previewChangeUndo').result.ok, true, h.last('previewChangeUndo').result.reason);
    await h.feature.changes.confirm(); assert.equal(h.inspect().tasks[0].title, '报告');
    assert.equal(h.service.sessions.get({ conversationId: cid }).ok, false); assert.equal(h.providerInputs.length, before);
  } finally { h.close(); }
});

test('dismissing receipt-only undo previews releases authority instead of exhausting the preview capacity', async () => {
  const h = setup([{ type: 'task.update', entityId: 'task-1', patch: { title: '回执预览关闭' } }]);
  try {
    await h.feature.open({ purpose: 'stuck', taskId: 'task-1' }); await h.send(); await h.feature.changes.preview(h.proposalId()); await h.feature.changes.confirm();
    const receiptId = h.last('confirmConversationChanges').result.receiptId;
    for (let index = 0; index < 55; index++) {
      await h.feature.openReceipt({ receiptId }); await h.feature.changes.undo();
      assert.equal(h.last('previewChangeUndo').result.ok, true, `${index}: ${h.last('previewChangeUndo').result.reason}`);
      h.feature.close(); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(h.inspect().aiCollaboration.receipts.length, 1);
  } finally { h.close(); }
});
