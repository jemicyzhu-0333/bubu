'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createPopoverMessages } = require('../src/surfaces/popover/ui/messages.mjs');
const messages = createPopoverMessages({ pad2: value => String(value).padStart(2, '0') });

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clone = value => structuredClone(value);
const body = title => ({ title, steps: [{ title: '打开文件', dependsOn: null, safeStopAfter: true }], notes: '可编辑的备注', estimateMinutes: 5, energy: 'low' });
function proposal(version = 1, source = 'provider') {
  return { id: `assistant-${version}`, sequence: version * 2, role: 'assistant', content: `这是草稿 ${version}`,
    provenance: { source, reason: source === 'local' ? 'provider-timeout' : null, providerId: source === 'provider' ? 'p1' : null },
    proposal: { id: `proposal-${version}`, version, kind: 'task-draft', body: JSON.stringify(body(`报销 ${version}`)) } };
}
function session(id = 'c1', overrides = {}) {
  return { id, revision: 1, purpose: 'task', mode: 'talk', relatedEntity: null, status: 'active',
    retention: { mode: 'ephemeral', days: 30, pinned: false }, messages: [], inputDraft: '', selectedProposalId: null,
    saveState: 'ephemeral', ...overrides };
}
function harness({ enabled = true, initial, turn, start, stage } = {}) {
  const dom = createCollaborationDom();
  const calls = [];
  const adopted = [];
  const restored = [];
  const entryStatus = [];
  const records = new Map();
  let nextId = 0;
  const response = record => ({ ok: true, conversation: clone(record), scopeGrantId: `grant-${record.id}`,
    disclosure: { fields: ['messages', ...(record.purpose === 'stuck' ? ['task.title'] : [])], focusSummary: false },
    contextPreview: [{ items: record.relatedEntity ? [{ id: record.relatedEntity.id, title: '当前报告' }] : [], availability: 'available' }] });
  let hiddenCallback = null;
  const client = {
    onPopoverHidden(callback) { hiddenCallback = callback; return () => { hiddenCallback = null; }; },
    async startConversation(args) {
      calls.push(['start', args]);
      if (start) return start(args);
      const record = initial ? clone(initial) : session(`c${++nextId}`, { purpose: args.purpose, mode: args.mode, relatedEntity: args.taskId ? { id: args.taskId, type: 'task' } : null });
      records.set(record.id, record); return response(record);
    },
    async getConversation(args) { calls.push(['get', args]); return response(records.get(args.conversationId)); },
    async conversationTurn(args) {
      calls.push(['turn', args]);
      if (turn) return turn(args, records.get(args.conversationId));
      const record = records.get(args.conversationId);
      record.messages.push({ id: args.messageId, turnId: args.messageId, role: 'user', content: args.message });
      record.messages.push({ ...proposal(Math.ceil(record.messages.length / 2)), turnId: args.messageId });
      return { ...response(record), source: 'provider' };
    },
    async pauseConversation(args) {
      calls.push(['pause', args]);
      const record = records.get(args.conversationId);
      if (record) Object.assign(record, { ...args, status: 'paused' });
      return { ok: true, conversation: clone(record) };
    },
    async cancelConversation(args) { calls.push(['cancel', args]); return { ok: true }; },
    async setConversationScope(args) { calls.push(['scope', args]); return { ok: true, scopeGrantId: 'grant-opt-in', disclosure: { fields: ['messages', 'focusSummary'], focusSummary: args.focusSummary }, contextPreview: [{ items: [{ recordedMinutes: 25 }], coverage: 'recorded-only' }] }; },
    async setConversationMode(args) { calls.push(['mode', args]); const record = records.get(args.conversationId); record.mode = args.mode; return response(record); },
    async setConversationRetention(args) { calls.push(['retention', args]); const record = records.get(args.conversationId); Object.assign(record, { inputDraft: args.inputDraft, selectedProposalId: args.selectedProposalId, scrollTop: args.scrollTop }); record.retention = { mode: args.mode, days: args.retentionDays || 30, pinned: args.pinned || false }; record.saveState = args.mode === 'saved' ? 'saved' : 'ephemeral'; return response(record); },
    async listConversations(args) { calls.push(['list', args]); return { ok: true, items: [...records.values()].map(clone), nextCursor: null }; },
    async deleteConversation(args) { calls.push(['delete', args]); return { ok: true }; },
    addTaskWithBreakdown() { throw new Error('chat cannot write tasks'); },
    clarifyNowTask() { throw new Error('chat cannot write tasks'); }
  };
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML, surfaceClient: client,
    fallbackReasonText: messages.fallbackReasonText, adoptProposal: value => adopted.push(value),
    stageStuckProposal: stage || ((value, taskId) => { calls.push(['stage', { value, taskId }]); dom.$('#stuckMask').classList.remove('hidden'); return { ok: true }; }),
    restoreModalFocus: target => restored.push(target), isAiClarifyEnabled: () => enabled,
    showEntryStatus: source => entryStatus.push(typeof source === 'function' ? source() : source) });
  feature.mount();
  const say = async value => { dom.$('#draftChatInput').value = value; await feature.send(); };
  return { feature, dom, calls, client, records, response, adopted, restored, entryStatus, say, hide: () => hiddenCallback?.(),
    log: () => dom.$('#draftChatLog').innerHTML, status: () => dom.$('#draftChatStatus').textContent };
}

test('session starts ephemeral, suspends the origin without discarding its form, and exposes exact local preview', async () => {
  const h = harness();
  h.dom.$('#taskCreateMask').classList.remove('hidden');
  h.dom.$('#taskInput').value = '未保存标题';
  await h.feature.open();
  assert.deepEqual(h.calls[0], ['start', { purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' }]);
  assert.equal(h.dom.$('#taskCreateMask').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#taskInput').value, '未保存标题');
  assert.match(h.dom.$('#draftChatContextPreview').textContent, /availability/);
  assert.match(h.dom.html, /以下是本机预览/);
  assert.equal(h.dom.$('#draftChatFocusSummary').checked, false);
});

test('full canonical history continues beyond rounds 7 and 31 and retains every proposal version', async () => {
  const h = harness(); await h.feature.open();
  for (let i = 1; i <= 31; i += 1) await h.say(`第 ${i} 轮`);
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 31);
  assert.match(h.log(), /第 7 轮/); assert.match(h.log(), /第 31 轮/);
  assert.match(h.log(), /草稿 · 版本 1/); assert.match(h.log(), /草稿 · 版本 31/);
  assert.doesNotMatch(h.status(), /还能再聊|最后一轮|上限/);
  assert.equal(h.dom.$('#btnDraftChatSend').disabled, false);
  assert.equal(h.dom.$('#draftChatInput').value, '');
});

test('historical selection adopts only a task draft with canonical provenance and no task command', async () => {
  const h = harness(); await h.feature.open(); await h.say('第一版'); await h.say('第二版');
  h.feature.chooseProposal('proposal-1'); h.feature.adopt();
  assert.equal(h.adopted[0].title, '报销 1');
  assert.equal(h.adopted[0].provider, 'api'); assert.equal(h.adopted[0].fallback, false);
  assert.equal(h.feature.isOpen(), false);
  assert.equal(h.calls.filter(([name]) => name === 'delete').length, 0);
});

test('saved local or unknown provenance is never mislabeled as model output', async () => {
  for (const source of ['local', null]) {
    const message = proposal(1, source); if (!source) message.provenance = null;
    const h = harness({ initial: session('saved', { messages: [message] }) });
    await h.feature.open(); h.feature.adopt();
    assert.equal(h.adopted[0].fallback, true); assert.equal(h.adopted[0].provider, 'local');
  }
});

test('cancel preserves the submitted bubble and a newer draft and ignores a late answer', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise }); await h.feature.open();
  h.dom.$('#draftChatInput').value = '尚未说完'; const sending = h.feature.send();
  assert.equal(h.dom.$('#draftChatInput').value, '');
  assert.match(h.log(), /尚未说完/);
  h.dom.$('#draftChatInput').value = '下一条草稿';
  await h.feature.cancel(); const before = h.log();
  pending.resolve({ ok: true, conversation: session('c1', { messages: [proposal()] }) }); await sending;
  assert.equal(h.dom.$('#draftChatInput').value, '下一条草稿'); assert.equal(h.log(), before);
  assert.match(h.status(), /已取消生成/); assert.equal(h.dom.$('#btnDraftChatSend').disabled, false);
});

test('close pauses and reopen restores input, selected version, scroll and the same session', async () => {
  const h = harness(); h.dom.$('#taskCreateMask').classList.remove('hidden'); await h.feature.open();
  await h.say('第一版'); await h.say('第二版'); h.feature.chooseProposal('proposal-1');
  h.dom.$('#draftChatInput').value = '还想改这里'; h.dom.$('#draftChatLog').scrollTop = 143;
  h.feature.close(); await h.feature.open();
  assert.equal(h.dom.$('#draftChatInput').value, '还想改这里');
  assert.equal(h.dom.$('#draftChatLog').scrollTop, 143);
  assert.equal(h.calls.filter(([name]) => name === 'start').length, 1);
  assert.equal(h.calls.find(([name]) => name === 'pause')[1].selectedProposalId, 'proposal-1');
  h.feature.adopt(); assert.equal(h.adopted[0].title, '报销 1');
});

test('closing while a turn is running never repaints after a different session opens', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise }); await h.feature.open();
  h.dom.$('#draftChatInput').value = '旧任务'; const sending = h.feature.send(); h.feature.close();
  await h.feature.open({ purpose: 'stuck', mode: 'small-step', taskId: 'task2' });
  const before = h.log(); const beforeStatus = h.status();
  pending.resolve({ ok: true, conversation: session('c1', { messages: [proposal()] }) }); await sending;
  assert.equal(h.log(), before); assert.equal(h.status(), beforeStatus);
  assert.equal(h.dom.$('#draftChatInput').value, '');
});

test('current safe collaboration detail is shown as text and a stale detail cannot repaint reopened chat', async () => {
  const detail = 'provider-invalid-output|collaboration-step-final-stop-required';
  const h = harness({ turn: async (_args, record) => ({ ok: true, source: 'local', reason: 'provider-invalid-output',
    providerReason: detail, conversation: clone(record) }) });
  await h.feature.open(); await h.say('A normal message');
  assert.match(h.status(), /collaboration-step-final-stop-required/);
  assert.equal(h.dom.$('#draftChatStatus').innerHTML, '');
  assert.doesNotMatch(h.log(), /collaboration-step-final-stop-required/);
  h.feature.dispose();
  const pending = deferred();
  const stale = harness({ turn: () => pending.promise });
  await stale.feature.open();
  const sending = stale.say('Old message');
  stale.feature.close();
  await stale.feature.open({ purpose: 'stuck', mode: 'small-step', taskId: 'task2' });
  const status = stale.status();
  pending.resolve({ ok: true, source: 'local', reason: 'provider-invalid-output', providerReason: detail,
    conversation: session('c1') });
  await sending;
  assert.equal(stale.status(), status);
  assert.doesNotMatch(stale.log(), /collaboration-step-final-stop-required/);
  stale.feature.dispose();
});

test('8,000 Unicode characters are accepted; 8,001 stay intact and no transport call occurs', async () => {
  const h = harness(); await h.feature.open(); await h.say('🦉'.repeat(8000));
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 1);
  await h.say('🦉'.repeat(8001)); assert.equal(h.calls.filter(([name]) => name === 'turn').length, 1);
  assert.equal(Array.from(h.dom.$('#draftChatInput').value).length, 8001);
  assert.match(h.status(), /8,000/);
  assert.doesNotMatch(h.dom.html.match(/<textarea[^>]*id="draftChatInput"[^>]*>/)[0], /maxlength/);
});

test('focus summary is opt-in, refreshed disclosure uses actual preview, and turn carries new grant', async () => {
  const h = harness(); await h.feature.open();
  h.dom.$('#draftChatFocusSummary').checked = true; await h.feature.change('scope');
  assert.deepEqual(h.calls.find(([name]) => name === 'scope')[1], { conversationId: 'c1', focusSummary: true, planningPreferences: false });
  assert.match(h.dom.$('#draftChatContextPreview').textContent, /recordedMinutes/);
  await h.say('看看今天'); assert.equal(h.calls.find(([name]) => name === 'turn')[1].scopeGrantId, 'grant-opt-in');
  h.feature.close(); await h.feature.open(); assert.equal(h.dom.$('#draftChatFocusSummary').checked, false);
});

test('mode switches preserve canonical history and unsent input', async () => {
  const h = harness(); await h.feature.open(); await h.say('先聊聊');
  h.dom.$('#draftChatInput').value = '不必生成任务'; h.dom.$('#draftChatMode').value = 'plan'; await h.feature.change('mode');
  assert.match(h.log(), /先聊聊/); assert.equal(h.dom.$('#draftChatInput').value, '不必生成任务');
  assert.equal(h.dom.$('#draftChatCurrentMode').textContent, '一起安排');
});

test('local retention is explicit, defaults to 30 days and reports save failures without losing messages', async () => {
  const h = harness(); await h.feature.open(); await h.say('保存这段');
  h.dom.$('#draftChatRetention').value = 'saved'; await h.feature.change('retention');
  assert.equal(h.calls.find(([name]) => name === 'retention')[1].retentionDays, 30);
  assert.match(h.dom.$('#draftChatSaveState').textContent, /本机保存 · 30 天/);
  h.client.setConversationRetention = async () => ({ ok: false, reason: 'save-failed', conversation: session('c1', { messages: [proposal()], saveState: 'unsaved', retention: { mode: 'saved', days: 30, pinned: false } }) });
  await h.feature.change('retention'); assert.match(h.dom.$('#draftChatSaveState').textContent, /未保存 · 退出后清除/);
  assert.match(h.log(), /报销 1/); assert.match(h.status(), /未成功/);
});

test('session list resumes a saved record rather than rebuilding a truncated transcript', async () => {
  const h = harness(); await h.feature.open(); await h.say('已有内容');
  await h.feature.list(); assert.match(h.dom.$('#draftChatSessions').innerHTML, /已有内容/);
  await h.feature.startNew(); assert.equal(h.calls.filter(([name]) => name === 'start').length, 2);
  await h.feature.resume('c1'); assert.match(h.log(), /已有内容/); assert.match(h.log(), /报销 1/);
});

test('stuck adoption stages only the target next action and refuses a changed target', async () => {
  const h = harness(); h.dom.$('#stuckMask').classList.remove('hidden'); await h.feature.open({ purpose: 'stuck', mode: 'small-step', taskId: 't1' });
  await h.say('更小一点'); h.feature.adopt();
  assert.equal(h.calls.find(([name]) => name === 'stage')[1].taskId, 't1');
  assert.equal(h.adopted.length, 0); assert.equal(h.feature.isOpen(), false);
  const bad = harness({ stage: () => ({ ok: false, reason: 'target-changed' }) });
  await bad.feature.open({ purpose: 'stuck', taskId: 't1' }); await bad.say('再小一点'); bad.feature.adopt();
  assert.equal(bad.feature.isOpen(), true); assert.match(bad.status(), /任务已变化/);
});

test('all provider text and proposal content is escaped and never treated as executable markup', async () => {
  const dangerous = proposal(); dangerous.content = '<img onerror="run()">'; dangerous.proposal.body = JSON.stringify(body('<script>alert(1)</script>'));
  const h = harness({ initial: session('c1', { messages: [dangerous] }) }); await h.feature.open();
  assert.doesNotMatch(h.log(), /<script>|<img onerror/); assert.match(h.log(), /&lt;script&gt;/);
});

test('disabled AI keeps the local form available, and IME Enter does not send', async () => {
  const disabled = harness({ enabled: false }); await disabled.feature.open(); assert.equal(disabled.calls.length, 0); assert.equal(disabled.entryStatus.length, 1);
  const h = harness(); await h.feature.open(); h.dom.$('#draftChatInput').value = '中文';
  h.dom.fire('#draftChatInput', 'keydown', { key: 'Enter', isComposing: true, preventDefault() { throw new Error('IME must finish'); } });
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
});

test('dispose pauses in-flight work and removes all mounted listeners', async () => {
  const h = harness(); await h.feature.open(); h.feature.dispose(); assert.equal(h.dom.listeners.size, 0); assert.equal(h.feature.isOpen(), false);
});

test('selected historical proposal is part of the next turn and explicit save includes the exact unsent draft', async () => {
  const h = harness(); await h.feature.open(); await h.say('第一版'); await h.say('第二版');
  h.feature.chooseProposal('proposal-1'); await h.say('沿用第一版');
  assert.equal(h.calls.filter(([name]) => name === 'turn').at(-1)[1].selectedProposalId, 'proposal-1');
  h.dom.$('#draftChatInput').value = '🦉'.repeat(8001); h.dom.$('#draftChatLog').scrollTop = 91;
  h.dom.$('#draftChatRetention').value = 'saved'; await h.feature.change('retention');
  const payload = h.calls.find(([name]) => name === 'retention')[1];
  assert.equal(Array.from(payload.inputDraft).length, 8001); assert.equal(payload.scrollTop, 91);
});

test('cancel waits for a fresh authorization grant before retry can send', async () => {
  const pendingTurn = deferred(); const pendingCancel = deferred();
  const h = harness({ turn: () => pendingTurn.promise }); await h.feature.open();
  h.client.cancelConversation = () => pendingCancel.promise;
  h.dom.$('#draftChatInput').value = '保留'; const sending = h.feature.send(); const canceling = h.feature.cancel();
  await h.feature.send(); assert.equal(h.calls.filter(([name]) => name === 'turn').length, 1);
  pendingCancel.resolve({ ok: true, scopeGrantId: 'renewed' }); await canceling;
  h.client.conversationTurn = async args => { h.calls.push(['turn', args]); return h.response(h.records.get(args.conversationId)); };
  const messageId = h.calls.find(([name]) => name === 'turn')[1].messageId;
  await h.feature.send({ retryMessageId: messageId }); assert.equal(h.calls.filter(([name]) => name === 'turn').at(-1)[1].scopeGrantId, 'renewed');
  pendingTurn.resolve({ ok: false }); await sending;
});

test('failed pause is visible at the originating form and an overlong local draft remains available', async () => {
  const h = harness(); await h.feature.open();
  h.dom.$('#draftChatInput').value = '字'.repeat(64001);
  h.client.pauseConversation = async () => ({ ok: false, reason: 'conversation-draft-invalid' });
  h.feature.close(); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.entryStatus.at(-1), /尚未保存/);
  await h.feature.open(); assert.equal(h.dom.$('#draftChatInput').value.length, 64001);
});

test('failed scope change restores the last actual choice instead of displaying an ungranted scope', async () => {
  const h = harness(); await h.feature.open();
  h.client.setConversationScope = async () => ({ ok: false, reason: 'scope-grant-invalid' });
  h.dom.$('#draftChatFocusSummary').checked = true; await h.feature.change('scope');
  assert.equal(h.dom.$('#draftChatFocusSummary').checked, false);
});

test('switching a saved session to ephemeral requires explicit inline confirmation', async () => {
  const h = harness({ initial: session('saved', { retention: { mode: 'saved', days: 30, pinned: false }, saveState: 'saved' }) });
  await h.feature.open(); h.dom.$('#draftChatRetention').value = 'ephemeral'; await h.feature.change('retention');
  assert.equal(h.calls.filter(([name]) => name === 'retention').length, 0);
  assert.equal(h.dom.$('#draftChatRetentionConfirm').classList.contains('hidden'), false);
  h.dom.fire('#btnDraftChatRetentionKeep', 'click'); assert.equal(h.dom.$('#draftChatRetention').value, 'saved');
  h.dom.$('#draftChatRetention').value = 'ephemeral'; await h.feature.change('retention', { confirmed: true });
  assert.equal(h.calls.filter(([name]) => name === 'retention').length, 1);
});

test('unavailable saved-session storage is disclosed alongside the accessible in-memory list', async () => {
  const h = harness(); await h.feature.open();
  h.client.listConversations = async () => ({ ok: true, items: [], nextCursor: null, availability: 'unavailable' });
  await h.feature.list(); assert.match(h.status(), /列表暂不可用/);
});

test('editing a saved input makes its unsaved status visible until the exact draft is persisted', async () => {
  const h = harness({ initial: session('saved', { inputDraft: '', selectedProposalId: null, retention: { mode: 'saved', days: 30, pinned: false }, saveState: 'saved' }) });
  await h.feature.open(); assert.match(h.dom.$('#draftChatSaveState').textContent, /本机保存/);
  h.dom.$('#draftChatInput').value = '尚未保存的补充'; h.dom.fire('#draftChatInput', 'input');
  assert.match(h.dom.$('#draftChatSaveState').textContent, /待保存/);
  h.feature.close(); await h.feature.open(); assert.match(h.dom.$('#draftChatSaveState').textContent, /本机保存/);
  assert.equal(h.dom.$('#draftChatInput').value, '尚未保存的补充');
});

test('a newly generated draft becomes selected while earlier versions remain selectable', async () => {
  const h = harness(); await h.feature.open(); await h.say('第一版'); await h.say('第二版');
  h.feature.adopt(); assert.equal(h.adopted[0].title, '报销 2');
});

test('a soft long-conversation notice invites continuation rather than exposing a machine code', async () => {
  const h = harness({ turn: async (_args, record) => ({ ok: true, conversation: record, notice: 'summary-available' }) });
  await h.feature.open(); await h.say('继续聊'); assert.match(h.status(), /继续聊/); assert.doesNotMatch(h.status(), /summary-available/);
});

test('closing a pending open waits for its pause before issuing a fresh open', async () => {
  const pending = deferred(); const h = harness();
  const realStart = h.client.startConversation;
  let starts = 0;
  h.client.startConversation = args => { starts += 1; return starts === 1 ? pending.promise : realStart(args); };
  const firstOpen = h.feature.open(); await Promise.resolve();
  h.feature.close(); const secondOpen = h.feature.open();
  await Promise.resolve(); assert.equal(starts, 1);
  pending.resolve({ ok: true, conversation: session('abandoned'), scopeGrantId: 'old' });
  await firstOpen; await secondOpen;
  assert.equal(starts, 2);
  assert.equal(h.calls.find(([name]) => name === 'pause')[1].conversationId, 'abandoned');
  assert.equal(h.feature.isOpen(), true);
  await h.say('新对话'); assert.equal(h.calls.find(([name]) => name === 'turn')[1].scopeGrantId, 'grant-c1');
});


test('explicit deletion frees a temporary session and late replies cannot revive it', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise });
  await h.feature.open(); h.dom.$('#draftChatInput').value = 'unfinished';
  const sending = h.feature.send();
  await h.feature.requestDelete();
  assert.equal(h.calls.some(([name]) => name === 'delete'), false);
  assert.equal(h.dom.$('#draftChatDeleteConfirm').classList.contains('hidden'), false);
  await h.feature.confirmDelete();
  assert.equal(h.calls.filter(([name]) => name === 'delete').length, 1);
  assert.equal(h.feature.isOpen(), false);
  pending.resolve(h.response(session('c1', { messages: [proposal()] }))); await sending;
  assert.doesNotMatch(h.log(), /报销/);
});

test('native surface hidden pauses generation and flushes exact unsent input', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise });
  await h.feature.open(); h.dom.$('#draftChatInput').value = '保留这一段';
  const sending = h.feature.send();
  h.dom.$('#draftChatInput').value = '新的未发送草稿';
  h.hide(); await Promise.resolve();
  assert.equal(h.feature.isOpen(), false);
  assert.equal(h.calls.find(([name]) => name === 'pause')[1].inputDraft, '新的未发送草稿');
  pending.resolve(h.response(session('c1', { messages: [proposal()] }))); await sending;
  assert.doesNotMatch(h.log(), /报销/);
});

test('failed new session keeps the existing conversation available for explicit deletion', async () => {
  const h = harness(); await h.feature.open();
  h.dom.$('#draftChatInput').value = 'still here';
  h.client.startConversation = async () => ({ ok: false, reason: 'conversation-cache-full' });
  await h.feature.startNew();
  assert.equal(h.dom.$('#draftChatInput').value, 'still here');
  assert.match(h.status(), /容量/);
  await h.feature.requestDelete();
  await h.feature.confirmDelete();
  assert.equal(h.calls.find(([name]) => name === 'delete')[1].conversationId, 'c1');
});


test('late deletion completion cannot enable controls in a newer loading conversation', async () => {
  const h = harness(); await h.feature.open();
  const deleting = deferred(), loading = deferred();
  h.client.deleteConversation = () => deleting.promise;
  await h.feature.requestDelete();
  const removal = h.feature.confirmDelete();
  h.feature.close();
  h.client.startConversation = () => loading.promise;
  const reopening = h.feature.open({ purpose: 'stuck', taskId: 'new-task' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.dom.$('#btnDraftChatSend').disabled, true);
  deleting.resolve({ ok: true }); await removal;
  assert.equal(h.dom.$('#btnDraftChatSend').disabled, true);
  loading.resolve(h.response(session('new-session', { purpose: 'stuck' })));
  await reopening;
  assert.equal(h.dom.$('#btnDraftChatSend').disabled, false);
});


test('a delete confirmation cannot retarget a different resumed conversation', async () => {
  const h = harness(); await h.feature.open();
  h.records.set('c2', session('c2'));
  await h.feature.requestDelete();
  await h.feature.resume('c2');
  assert.equal(h.dom.$('#draftChatDeleteConfirm').classList.contains('hidden'), true);
  await h.feature.confirmDelete();
  assert.equal(h.calls.some(([name]) => name === 'delete'), false);
  await h.feature.requestDelete(); await h.feature.confirmDelete();
  assert.deepEqual(h.calls.find(([name]) => name === 'delete')[1], { conversationId: 'c2', expectedRevision: 1 });
});

test('sending immediately shows one identified bubble, clears input, and keeps newer text after reply', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise }); await h.feature.open();
  h.dom.$('#draftChatInput').value = '  已发送的原文 <script>  ';
  const sending = h.feature.send();
  const request = h.calls.find(([name]) => name === 'turn')[1];
  assert.match(request.messageId, /^client-message-/);
  assert.equal(h.dom.$('#draftChatInput').value, '');
  assert.equal(h.dom.$('#draftChatInput').disabled, false);
  assert.match(h.log(), /已发送的原文 &lt;script&gt;/);
  assert.match(h.log(), /等待小步回复/);
  assert.equal(h.status(), '');
  assert.equal(h.dom.$('#draftChatLog').getAttribute('aria-busy'), 'true');
  h.dom.$('#draftChatInput').value = '下一条，不应清空'; h.dom.fire('#draftChatInput', 'input');
  await h.feature.send(); assert.equal(h.calls.filter(([name]) => name === 'turn').length, 1);
  const record = h.records.get(request.conversationId);
  record.messages.push({ id: request.messageId, role: 'user', content: request.message, turnId: 'turn-new' },
    { id: 'reply-new', role: 'assistant', content: '回复', turnId: 'turn-new' });
  pending.resolve(h.response(record)); await sending;
  assert.equal(h.dom.$('#draftChatInput').value, '下一条，不应清空');
  assert.equal((h.log().match(new RegExp(`data-message-id="${request.messageId}"`, 'g')) || []).length, 1);
  assert.doesNotMatch(h.log(), /data-chat-retry/);
});

test('an unconfirmed send keeps its bubble and retries the same ID without consuming newer draft', async () => {
  const h = harness({ turn: async () => { throw new Error('synthetic lost IPC reply'); } }); await h.feature.open();
  await h.say('同一句话');
  const request = h.calls.find(([name]) => name === 'turn')[1];
  assert.match(h.log(), /发送状态待确认/); assert.match(h.log(), /data-chat-retry/);
  assert.equal(h.dom.$('#draftChatInput').value, '');
  h.dom.$('#draftChatInput').value = '新的草稿';
  await h.feature.send({ retryMessageId: request.messageId });
  const retried = h.calls.filter(([name]) => name === 'turn')[1][1];
  assert.equal(retried.messageId, request.messageId); assert.equal(retried.message, request.message);
  assert.equal(h.dom.$('#draftChatInput').value, '新的草稿');
  assert.equal((h.log().match(/同一句话/g) || []).length, 1);
});

test('same text in prior history and a new send remain distinct by message identity', async () => {
  const h = harness(); await h.feature.open(); await h.say('相同文字'); await h.say('相同文字');
  const requests = h.calls.filter(([name]) => name === 'turn').map(([, request]) => request);
  assert.notEqual(requests[0].messageId, requests[1].messageId);
  assert.equal(h.records.get('c1').messages.filter(message => message.role === 'user').length, 2);
  assert.equal((h.log().match(/class="chat-turn-content">相同文字/g) || []).length, 2);
});

test('failed and ambiguous sends never claim pending bubbles were saved locally', async () => {
  const h = harness({ initial: session('c1', { saveState: 'saved', retention: { mode: 'saved', days: 30 } }),
    turn: async (_request, record) => ({ ok: false, reason: 'clarify-disabled', conversation: clone(record) }) });
  await h.feature.open(); await h.say('保留原文');
  assert.match(h.log(), /这条消息未发送/);
  assert.match(h.dom.$('#draftChatSaveState').textContent, /尚未确认保存/);
  assert.match(h.log(), /保留原文/);
  assert.equal(h.records.get('c1').messages.length, 0);
});

test('cancel failure redraws retry state and a late turn cannot replace it', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise }); await h.feature.open();
  h.client.cancelConversation = async () => { throw new Error('synthetic cancel IPC failure'); };
  h.dom.$('#draftChatInput').value = '保留消息'; const sending = h.feature.send();
  await h.feature.cancel();
  assert.match(h.log(), /发送状态待确认/); assert.match(h.log(), /data-chat-retry/);
  const before = h.log(); pending.resolve({ ok: true, conversation: session('c1', { messages: [proposal()] }) }); await sending;
  assert.equal(h.log(), before);
});

test('typing during cancellation survives its response and close/reopen retains both bubble and next draft', async () => {
  const turn = deferred(), cancel = deferred(); const h = harness({ turn: () => turn.promise }); await h.feature.open();
  h.client.cancelConversation = () => cancel.promise;
  h.dom.$('#draftChatInput').value = '保留消息'; const sending = h.feature.send();
  const canceling = h.feature.cancel(); h.dom.$('#draftChatInput').value = '取消时继续写';
  cancel.resolve({ ok: true, scopeGrantId: 'fresh-grant' }); await canceling;
  assert.equal(h.dom.$('#draftChatInput').value, '取消时继续写'); assert.match(h.log(), /回复已取消/);
  h.feature.close(); await h.feature.open();
  assert.equal(h.dom.$('#draftChatInput').value, '取消时继续写'); assert.match(h.log(), /保留消息/);
  const before = h.log(); turn.resolve({ ok: true, conversation: session('c1', { messages: [proposal()] }) }); await sending;
  assert.equal(h.log(), before); assert.equal(h.dom.$('#draftChatInput').value, '取消时继续写');
});

test('restored unanswered canonical message offers same-ID retry without an optimistic duplicate', async () => {
  const initial = session('c1', { messages: [{ id: 'client-existing', role: 'user', content: '上次消息', turnId: 'original-turn' }],
    inputDraft: '重开后的草稿', status: 'paused' });
  const h = harness({ initial, turn: async (request, record) => {
    assert.equal(request.messageId, 'client-existing');
    record.messages.push({ id: 'restored-answer', role: 'assistant', content: '继续回复', turnId: 'original-turn' });
    return { ok: true, conversation: clone(record) };
  } });
  await h.feature.open(); assert.match(h.log(), /data-chat-retry="client-existing"/);
  await h.feature.send({ retryMessageId: 'client-existing' });
  assert.equal((h.log().match(/上次消息/g) || []).length, 1);
  assert.equal(h.dom.$('#draftChatInput').value, '重开后的草稿');
  assert.doesNotMatch(h.log(), /data-chat-retry/);
});

test('a message ID from another session cannot target this session or its draft', async () => {
  const h = harness({ turn: async () => { throw new Error('synthetic IPC failure'); } }); await h.feature.open(); await h.say('第一段');
  const oldId = h.calls.find(([name]) => name === 'turn')[1].messageId;
  await h.feature.startNew(); h.dom.$('#draftChatInput').value = '第二段草稿';
  await h.feature.send({ retryMessageId: oldId });
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 1);
  assert.equal(h.dom.$('#draftChatInput').value, '第二段草稿'); assert.doesNotMatch(h.log(), /第一段/);
});

test('Continue discussion explicitly copies task assistance into an empty editable chat draft without sending', async () => {
  const h = harness();
  h.dom.$('#taskAssistInput').value = '  每一步再小一点 <script>  ';
  h.dom.fire('#btnOpenDraftChat', 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dom.$('#draftChatInput').value, '  每一步再小一点 <script>  ');
  assert.equal(h.dom.$('#taskAssistInput').value, '  每一步再小一点 <script>  ');
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
  assert.doesNotMatch(h.log(), /每一步再小一点/);
  assert.equal(h.dom.$('#draftChatInput').disabled, false);
});

test('normal open and empty assistance do not silently import task editor text', async () => {
  const h = harness(); h.dom.$('#taskAssistInput').value = '只给任务模型的补充';
  await h.feature.open(); assert.equal(h.dom.$('#draftChatInput').value, '');
  h.feature.close(); h.dom.$('#taskAssistInput').value = '   ';
  h.dom.fire('#btnOpenDraftChat', 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dom.$('#draftChatInput').value, '');
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
});

test('assistance prefill preserves a resumed conversation draft and reports the conflict', async () => {
  const h = harness({ initial: session('c1', { inputDraft: '原对话草稿' }) });
  h.dom.$('#taskAssistInput').value = '任务补充';
  h.dom.fire('#btnOpenDraftChat', 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dom.$('#draftChatInput').value, '原对话草稿');
  assert.equal(h.dom.$('#taskAssistInput').value, '任务补充');
  assert.match(h.status(), /已有对话草稿/);
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
});

test('input typed during opening wins over assistance and saved drafts, even when cleared again', async () => {
  for (const newer of ['加载期间的新草稿', '']) {
    const pending = deferred(); const h = harness({ start: () => pending.promise });
    h.dom.$('#taskAssistInput').value = '任务补充';
    h.dom.fire('#btnOpenDraftChat', 'click'); await Promise.resolve();
    h.dom.$('#draftChatInput').value = newer; h.dom.fire('#draftChatInput', 'input');
    pending.resolve(h.response(session('c1', { inputDraft: '保存过的旧草稿' })));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.dom.$('#draftChatInput').value, newer);
    assert.match(h.status(), /已有对话草稿/);
    assert.equal(h.dom.$('#taskAssistInput').value, '任务补充');
    assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
  }
});

test('closing an assistance-prefill open cannot inject it into a later conversation', async () => {
  const pending = deferred(); let starts = 0;
  const h = harness({ start: () => ++starts === 1 ? pending.promise : h.response(session('c2')) });
  h.dom.$('#taskAssistInput').value = '旧任务补充';
  h.dom.fire('#btnOpenDraftChat', 'click'); await Promise.resolve();
  h.feature.close(); const reopened = h.feature.open({ purpose: 'stuck', taskId: 'other-task' });
  pending.resolve(h.response(session('c1'))); await reopened;
  assert.equal(h.dom.$('#draftChatInput').value, '');
  assert.equal(h.dom.$('#taskAssistInput').value, '旧任务补充');
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
});

test('a failed assistance-prefill open retains source text and never submits or changes chat draft', async () => {
  const h = harness({ start: async () => ({ ok: false, reason: 'conversation-cache-full' }) });
  h.dom.$('#taskAssistInput').value = '保留任务补充';
  h.dom.fire('#btnOpenDraftChat', 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dom.$('#taskAssistInput').value, '保留任务补充');
  assert.equal(h.dom.$('#draftChatInput').value, '');
  assert.match(h.status(), /容量/);
  assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
});

test('a draft typed while B loads never overwrites A, including a failed open and later retry', async () => {
  for (const failFirst of [false, true]) {
    const h = harness(); await h.feature.open();
    h.dom.$('#draftChatInput').value = 'A的草稿'; h.dom.fire('#draftChatInput', 'input');
    const pending = deferred(); h.client.startConversation = () => pending.promise;
    const opening = h.feature.startNew(); await new Promise(resolve => setImmediate(resolve));
    h.dom.$('#draftChatInput').value = 'B的新草稿'; h.dom.fire('#draftChatInput', 'input');
    if (failFirst) {
      pending.resolve({ ok: false, reason: 'conversation-cache-full' }); await opening;
      assert.equal(h.dom.$('#draftChatInput').value, 'A的草稿');
      assert.match(h.status(), /新输入仍暂存/);
      h.client.startConversation = async () => { const next = session('B'); h.records.set('B', next); return h.response(next); };
      await h.feature.startNew();
    } else {
      const next = session('B'); h.records.set('B', next); pending.resolve(h.response(next)); await opening;
    }
    assert.equal(h.dom.$('#draftChatInput').value, 'B的新草稿');
    await h.feature.resume('c1'); assert.equal(h.dom.$('#draftChatInput').value, 'A的草稿');
    await h.feature.resume('B'); assert.equal(h.dom.$('#draftChatInput').value, 'B的新草稿');
  }
});

test('close during B loading pauses A with its own draft and saves the new draft only to B', async () => {
  const h = harness(); await h.feature.open();
  h.dom.$('#draftChatInput').value = 'A的草稿'; h.dom.fire('#draftChatInput', 'input');
  const pending = deferred(); h.client.startConversation = () => pending.promise;
  const opening = h.feature.startNew(); await new Promise(resolve => setImmediate(resolve));
  h.dom.$('#draftChatInput').value = 'B的新草稿'; h.dom.fire('#draftChatInput', 'input');
  h.feature.close();
  const next = session('B'); h.records.set('B', next); pending.resolve(h.response(next)); await opening;
  await h.feature.open();
  assert.equal(h.dom.$('#draftChatInput').value, 'A的草稿');
  const pauses = h.calls.filter(([name]) => name === 'pause').map(([, request]) => request);
  assert.ok(pauses.filter(request => request.conversationId === 'c1').every(request => request.inputDraft === 'A的草稿'));
  assert.equal(pauses.find(request => request.conversationId === 'B').inputDraft, 'B的新草稿');
  await h.feature.resume('B'); assert.equal(h.dom.$('#draftChatInput').value, 'B的新草稿');
});

test('same-purpose close and reopen freeze each pending load draft instead of sharing a mutable key', async () => {
  const first = deferred(); let starts = 0;
  const h = harness({ start: () => {
    if (++starts === 1) return first.promise;
    const next = session('second-open'); h.records.set(next.id, next); return h.response(next);
  } });
  const opening = h.feature.open(); await new Promise(resolve => setImmediate(resolve));
  h.dom.$('#draftChatInput').value = '第一个加载草稿'; h.dom.fire('#draftChatInput', 'input');
  h.feature.close(); const reopened = h.feature.open();
  h.dom.$('#draftChatInput').value = '第二个加载草稿'; h.dom.fire('#draftChatInput', 'input');
  const old = session('first-open'); h.records.set(old.id, old); first.resolve(h.response(old));
  await opening; await reopened;
  const oldPause = h.calls.filter(([name]) => name === 'pause').map(([, request]) => request).find(request => request.conversationId === old.id);
  assert.equal(oldPause.inputDraft, '第一个加载草稿');
  assert.equal(h.dom.$('#draftChatInput').value, '第二个加载草稿');
  await h.feature.resume(old.id); assert.equal(h.dom.$('#draftChatInput').value, '第一个加载草稿');
  await h.feature.resume('second-open'); assert.equal(h.dom.$('#draftChatInput').value, '第二个加载草稿');
});

test('closing a pending load retains its captured draft even when the load later fails or rejects', async () => {
  for (const rejects of [false, true]) {
    const pending = deferred(); let starts = 0;
    const h = harness({ start: () => {
      if (++starts === 1) return pending.promise;
      const next = session('recovered-open'); h.records.set(next.id, next); return h.response(next);
    } });
    const opening = h.feature.open(); await new Promise(resolve => setImmediate(resolve));
    h.dom.$('#draftChatInput').value = '失败加载仍保留的新稿'; h.dom.fire('#draftChatInput', 'input');
    h.feature.close();
    pending.resolve(rejects ? Promise.reject(new Error('synthetic load failure')) : { ok: false, reason: 'conversation-cache-full' });
    await opening; await h.feature.open();
    assert.equal(h.dom.$('#draftChatInput').value, '失败加载仍保留的新稿');
    assert.equal(h.calls.filter(([name]) => name === 'turn').length, 0);
  }
});

test('opening and setting changes cannot be canceled as if they were model generation', async () => {
  const pending = deferred(); const h = harness({ start: () => pending.promise });
  const opening = h.feature.open(); await Promise.resolve();
  assert.equal(h.dom.$('#btnDraftChatCancel').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#btnDraftChatSend').textContent, '处理中…');
  await h.feature.cancel();
  pending.resolve(h.response(session('opening'))); await opening;
  assert.equal(h.calls.some(([name]) => name === 'cancel'), false);
  const mode = deferred(); h.client.setConversationMode = () => mode.promise;
  h.dom.$('#draftChatMode').focus();
  const changing = h.feature.change('mode');
  assert.equal(h.dom.$('#draftChatPlanningPreferences').disabled, true);
  await h.feature.cancel();
  assert.equal(h.calls.some(([name]) => name === 'cancel'), false);
  mode.resolve(h.response(session('opening', { mode: 'plan' }))); await changing;
  h.feature.dispose();
});

test('cancellation is single-flight and cannot be invoked twice while awaiting its receipt', async () => {
  const turn = deferred(), cancellation = deferred(); const h = harness({ turn: () => turn.promise });
  await h.feature.open(); h.client.cancelConversation = args => { h.calls.push(['cancel', args]); return cancellation.promise; };
  h.dom.$('#draftChatInput').value = 'Message'; const sending = h.feature.send();
  assert.equal(h.dom.$('#btnDraftChatCancel').classList.contains('hidden'), false);
  const canceling = h.feature.cancel(); await h.feature.cancel();
  assert.equal(h.calls.filter(([name]) => name === 'cancel').length, 1);
  assert.equal(h.dom.$('#btnDraftChatCancel').classList.contains('hidden'), true);
  cancellation.resolve({ ok: true }); await canceling;
  turn.resolve({ ok: true }); await sending; h.feature.dispose();
});

test('settings save and confirmation dismissal return focus to visible settings controls', async () => {
  const h = harness({ initial: session('saved', { retention: { mode: 'saved' }, saveState: 'saved' }) });
  await h.feature.open(); h.dom.fire('#btnDraftChatSettings', 'click');
  h.dom.$('#draftChatMode').focus(); await h.feature.change('mode');
  assert.equal(h.dom.document.activeElement, h.dom.$('#draftChatMode'));
  await h.feature.requestDelete(); h.dom.fire('#btnDraftChatDeleteKeep', 'click');
  assert.equal(h.dom.document.activeElement, h.dom.$('#btnDraftChatDelete'));
  h.dom.$('#draftChatRetention').value = 'ephemeral'; await h.feature.change('retention');
  h.dom.fire('#btnDraftChatRetentionKeep', 'click');
  assert.equal(h.dom.document.activeElement, h.dom.$('#draftChatRetention'));
  h.feature.dispose();
});

test('local fallback details remain on the reply without a duplicate completion banner', async () => {
  const h = harness({ turn: async (args, record) => {
    record.messages.push({ id: args.messageId, role: 'user', content: args.message }, proposal(1, 'local'));
    return { ok: true, conversation: structuredClone(record), source: 'local', providerReason: 'provider-timeout' };
  } });
  await h.feature.open(); await h.say('A request');
  assert.match(h.log(), /data-chat-source="local">本地模板/);
  assert.equal(h.status(), ''); h.feature.dispose();
});

test('missing cancellation receipts never claim success and preserve the newer composer input', async () => {
  for (const receipt of [undefined, null, {}]) {
    const turn = deferred(); const h = harness({ turn: () => turn.promise }); await h.feature.open();
    h.client.cancelConversation = async () => receipt;
    h.dom.$('#draftChatInput').value = 'Submitted'; const sending = h.feature.send();
    h.dom.$('#draftChatInput').value = 'Still drafting'; await h.feature.cancel();
    assert.match(h.status(), /取消请求未确认/);
    assert.doesNotMatch(h.log(), /回复已取消/);
    assert.equal(h.dom.$('#draftChatInput').value, 'Still drafting');
    turn.resolve({ ok: true }); await sending;
    assert.match(h.status(), /取消请求未确认/); h.feature.dispose();
  }
});

test('confirmed retention changes return focus to the select rather than the hidden confirmation', async () => {
  const h = harness({ initial: session('saved', { retention: { mode: 'saved' }, saveState: 'saved' }) });
  await h.feature.open(); h.dom.fire('#btnDraftChatSettings', 'click');
  h.dom.$('#draftChatRetention').value = 'ephemeral'; await h.feature.change('retention');
  assert.equal(h.dom.document.activeElement, h.dom.$('#btnDraftChatRetentionConfirm'));
  await h.feature.change('retention', { confirmed: true });
  assert.equal(h.dom.$('#draftChatRetentionConfirm').classList.contains('hidden'), true);
  assert.equal(h.dom.document.activeElement, h.dom.$('#draftChatRetention'));
  h.feature.dispose();
});
