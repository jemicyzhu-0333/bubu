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
      record.messages.push({ id: `user-${record.messages.length}`, role: 'user', content: args.message });
      record.messages.push(proposal(Math.ceil(record.messages.length / 2)));
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

test('cancel preserves submitted input and ignores a late answer including its finally callback', async () => {
  const pending = deferred(); const h = harness({ turn: () => pending.promise }); await h.feature.open();
  h.dom.$('#draftChatInput').value = '尚未说完'; const sending = h.feature.send();
  await h.feature.cancel(); const before = h.log();
  pending.resolve({ ok: true, conversation: session('c1', { messages: [proposal()] }) }); await sending;
  assert.equal(h.dom.$('#draftChatInput').value, '尚未说完'); assert.equal(h.log(), before);
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
  assert.match(h.dom.$('#draftChatSaveState').textContent, /已保存到本机 · 30 天/);
  h.client.setConversationRetention = async () => ({ ok: false, reason: 'save-failed', conversation: session('c1', { messages: [proposal()], saveState: 'unsaved', retention: { mode: 'saved', days: 30, pinned: false } }) });
  await h.feature.change('retention'); assert.match(h.dom.$('#draftChatSaveState').textContent, /尚未保存到本机/);
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
  assert.doesNotMatch(h.log(), /<script>|<img/); assert.match(h.log(), /&lt;script&gt;/);
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
  await h.feature.send(); assert.equal(h.calls.filter(([name]) => name === 'turn').at(-1)[1].scopeGrantId, 'renewed');
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
  await h.feature.open(); assert.match(h.dom.$('#draftChatSaveState').textContent, /已保存到本机/);
  h.dom.$('#draftChatInput').value = '尚未保存的补充'; h.dom.fire('#draftChatInput', 'input');
  assert.match(h.dom.$('#draftChatSaveState').textContent, /待保存/);
  h.feature.close(); await h.feature.open(); assert.match(h.dom.$('#draftChatSaveState').textContent, /已保存到本机/);
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
  const sending = h.feature.send(); h.hide(); await Promise.resolve();
  assert.equal(h.feature.isOpen(), false);
  assert.equal(h.calls.find(([name]) => name === 'pause')[1].inputDraft, '保留这一段');
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
