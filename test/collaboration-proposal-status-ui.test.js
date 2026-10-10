'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createCollaborationView } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
const { createCollaborationProposalStatus } = require('../src/surfaces/popover/features/collaboration-proposal-status.mjs');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { routeFor, allowedSurfacesFor, validateIpcPayload } = require('../src/application/ipc/route-catalog');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function message(id, kind = 'change-set') {
  const body = kind === 'memory-candidate' ? { memoryCandidate: { kind: 'preference', subject: '偏好', body: '待核对', scope: 'work', expiresAt: null } }
    : kind === 'planning-preference-candidate' ? { planningPreference: { startMinute: 60, endMinute: 120, demand: 'low', scope: 'today' } } : { operations: [] };
  return { id: `m-${id}`, role: 'assistant', content: '模型声称已经保存', proposal: { id, version: 1, kind, body: JSON.stringify(body) } };
}
const row = (proposalId, store = 'config', status = 'applied') => ({ proposalId, store, status, receiptId: `receipt-${proposalId}`,
  version: 2, targetId: `target-${proposalId}`, historyStatus: 'pending' });
function harness(messages = [message('p1')]) {
  const dom = createCollaborationDom(), view = createCollaborationView({ $: dom.$, escapeHTML: esc });
  const state = { record: { id: 'c1', messages, purpose: 'task', mode: 'talk', retention: { mode: 'ephemeral' } }, open: true };
  const calls = [], client = { async getConversationProposalStatus(args) { calls.push(args); return { ok: true, items: args.proposalIds.map(id => row(id)) }; } };
  const controller = createCollaborationProposalStatus({ surfaceClient: client, getState: () => state, view });
  view.conversation(state.record, null);
  return { dom, view, state, client, calls, controller, log: () => dom.$('#draftChatLog').innerHTML };
}

test('closed read-only proposal status route and scoped bridge accept only 50 owned IDs per call', async () => {
  const channel = 'ai:conversation-proposal-status';
  assert.equal(routeFor(channel).kind, 'query'); assert.deepEqual(allowedSurfacesFor(channel), ['popover']);
  const payload = { conversationId: 'c1', proposalIds: ['p1', 'p2'] };
  assert.deepEqual(validateIpcPayload(channel, payload), { ok: true, value: payload });
  for (const bad of [{ ...payload, proposalIds: ['p1', 'p1'] }, { ...payload, proposalIds: Array.from({ length: 51 }, (_, i) => `p${i}`) },
    { ...payload, proposalIds: [true] }, { ...payload, receiptId: 'forged' }, { ...payload, status: 'applied' }]) assert.equal(validateIpcPayload(channel, bad).ok, false);
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload-popover.js'), 'utf8'), { require() { return {
    contextBridge: { exposeInMainWorld(_key, value) { bridge = value; } }, ipcRenderer: { on() {}, removeListener() {}, invoke: async (name, args) => ({ name, args }) } }; } });
  assert.deepEqual(await createPopoverSurfaceClient(bridge).getConversationProposalStatus(payload), { name: channel, args: payload });
});

test('visible history is fetched in batches of 50 and older paging remains accessible without changing messages or scroll', async () => {
  const h = harness(Array.from({ length: 251 }, (_, i) => message(`p${i}`))), original = structuredClone(h.state.record);
  h.dom.$('#draftChatLog').scrollTop = 456; h.dom.$('#draftChatSaveState').textContent = '当前输入待保存';
  h.dom.$('#draftChatRetention').value = 'saved';
  await h.controller.refresh();
  assert.deepEqual(h.calls.map(call => call.proposalIds.length), [50, 50, 50, 50]);
  assert.equal(h.calls[0].proposalIds[0], 'p51'); assert.doesNotMatch(h.log(), /data-proposal-status="p0"/);
  assert.equal(h.dom.$('#draftChatLog').scrollTop, 456); assert.equal(h.dom.$('#draftChatSaveState').textContent, '当前输入待保存');
  assert.equal(h.dom.$('#draftChatRetention').value, 'saved'); assert.deepEqual(h.state.record, original);
  h.view.pageHistory('earlier'); await h.controller.refresh();
  assert.deepEqual(h.calls.slice(4).map(call => call.proposalIds.length), [50, 1]); assert.match(h.log(), /data-proposal-status="p0"/);
});

test('only canonical status rows label each independent store and failed reads never imply an unapplied proposal', async () => {
  const h = harness([message('task'), message('memory', 'memory-candidate'), message('planning', 'planning-preference-candidate')]);
  assert.match(h.log(), /提交状态待核对/); assert.doesNotMatch(h.log(), /尚未应用|尚未成为有效记忆/);
  h.client.getConversationProposalStatus = async () => ({ ok: true, items: [row('task'), row('memory', 'memory', 'removed'), row('planning', 'planning', 'reverted')] });
  await h.controller.refresh();
  for (const label of ['任务与日常 · 已提交', '记忆 · 已移除', '安排偏好 · 已撤销', 'receipt-memory', '时间线待同步', '核对记录']) assert.ok(h.log().includes(label), label);
  h.client.getConversationProposalStatus = async () => { throw new Error('unavailable'); }; await h.controller.refresh();
  assert.match(h.log(), /提交状态暂不可用/); assert.doesNotMatch(h.log(), /receipt-memory|记忆 · 已移除|尚未应用/);
});

test('foreign or duplicate status rows are unavailable and receipt identifiers are escaped', async () => {
  const h = harness(); h.client.getConversationProposalStatus = async () => ({ ok: true, items: [row('p1', 'memory'), row('foreign')] });
  await h.controller.refresh(); assert.match(h.log(), /状态暂不可用/); assert.doesNotMatch(h.log(), /receipt-foreign/);
  h.client.getConversationProposalStatus = async () => ({ ok: true, items: [row('p1'), row('p1')] }); await h.controller.refresh(); assert.match(h.log(), /状态暂不可用/);
  h.client.getConversationProposalStatus = async () => ({ ok: true, items: [{ ...row('p1'), receiptId: '<receipt>' }] });
  await h.controller.refresh(); assert.match(h.log(), /&lt;receipt>/); assert.doesNotMatch(h.log(), /<receipt>/);
});

test('proposal state and pending sync stay visible while record identifiers use a native disclosure', async () => {
  const h = harness(); await h.controller.refresh();
  const state = h.log().match(/<p[^>]*data-proposal-status="p1"[^>]*>(.*?)<\/p>/s)?.[1];
  assert.equal(state, '任务与日常 · 已提交 · 时间线待同步');
  const disclosure = h.log().match(/<details\b([^>]*)>(.*?)<\/details>/s);
  assert.ok(disclosure); assert.doesNotMatch(disclosure[1], /\bopen\b|\bhidden\b|tabindex="-1"/);
  assert.match(disclosure[1], /class="chat-proposal-note disclosure"/);
  assert.match(disclosure[2], /^<summary><svg class="disclosure-icon"[^>]*stroke-width="1\.5"[^>]*><path[^>]*\/><\/svg><span data-chat-copy="\d+">记录详情<\/span><\/summary>/);
  for (const detail of ['receipt-p1', '当前版本 2', 'target-p1']) assert.ok(disclosure[2].includes(detail), detail);
});

test('late status after close, new source or page switch cannot repaint the current conversation', async () => {
  const h = harness(), old = defer(); h.client.getConversationProposalStatus = () => old.promise;
  const reading = h.controller.refresh(); h.controller.invalidate(); h.state.open = false;
  h.state.record = { ...h.state.record, id: 'c2', messages: [message('new')] }; h.state.open = true; h.view.conversation(h.state.record, null);
  h.client.getConversationProposalStatus = async () => ({ ok: true, items: [row('new')] }); await h.controller.refresh();
  old.resolve({ ok: true, items: [row('p1')] }); await reading;
  assert.match(h.log(), /receipt-new/); assert.doesNotMatch(h.log(), /receipt-p1/);
  const stale = defer(); h.client.getConversationProposalStatus = () => stale.promise;
  const pending = h.controller.refresh(); h.controller.invalidate(); stale.resolve({ ok: true, items: [row('new')] }); await pending;
  assert.doesNotMatch(h.log(), /receipt-new/); assert.match(h.log(), /提交状态待核对/);
});

test('real draft feature re-queries canonical statuses after close/resume and pagination without write ports', async () => {
  const dom = createCollaborationDom(), calls = [];
  const record = { id: 'c1', revision: 1, purpose: 'task', mode: 'talk', messages: Array.from({ length: 201 }, (_, i) => message(`p${i}`)), retention: { mode: 'ephemeral' } };
  let receipt = false;
  const client = { startConversation: async () => ({ ok: true, conversation: structuredClone(record) }),
    getConversation: async () => ({ ok: true, conversation: structuredClone(record) }), pauseConversation: async () => ({ ok: true }),
    conversationTurn: async () => assert.fail('no model request'),
    getConversationProposalStatus: async args => { calls.push(args); return { ok: true, items: args.proposalIds.map(id => receipt ? row(id) : { ...row(id), status: 'proposal', receiptId: null }) }; } };
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML: esc, surfaceClient: client,
    fallbackReasonText: () => '', adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {} });
  feature.mount(); await feature.open(); await tick(); assert.match(dom.$('#draftChatLog').innerHTML, /尚无对应提交回执/);
  feature.close(); receipt = true; await feature.resume('c1'); await tick(); assert.match(dom.$('#draftChatLog').innerHTML, /receipt-p200/);
  dom.fire('#btnDraftChatEarlier', 'click'); await tick(); assert.match(dom.$('#draftChatLog').innerHTML, /receipt-p0/);
  assert.ok(calls.every(call => call.proposalIds.length <= 50 && call.conversationId === 'c1')); feature.dispose();
});

// A narrow DOM double verifies the production locale repaint boundary; browser input/layout is separate.
test('record-details locale repaint updates the label without replacing the native summary subtree', async () => {
  const { setLocale, t } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN');
  try {
    const h = harness(); await h.controller.refresh();
    const spans = [...h.log().matchAll(/<span data-chat-copy="(\d+)">(.*?)<\/span>/gs)]
      .map(([, id, textContent]) => ({ dataset: { chatCopy: id }, textContent }));
    const label = spans.find(node => node.textContent === '记录详情');
    assert.ok(label);
    const summary = { set textContent(_) { assert.fail('locale repaint must not replace summary children'); } };
    h.dom.$('#draftChatLog').querySelectorAll = selector => selector === '[data-chat-copy]' ? spans
      : selector === '[data-chat-copy-aria]' ? [] : [summary];
    setLocale('en'); h.view.repaintCopy();
    assert.equal(label.textContent, t('记录详情'));
    assert.notEqual(label.textContent, '记录详情');
    setLocale('zh-CN'); h.view.repaintCopy();
    assert.equal(label.textContent, '记录详情');
  } finally { setLocale('zh-CN'); }
});
