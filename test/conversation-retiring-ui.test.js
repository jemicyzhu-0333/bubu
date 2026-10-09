'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createConversationAccess } = require('../src/application/ai/conversation-access');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createRetiringDom } = require('./fixtures/conversation-retiring-dom');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let sequence = 0, currentId = null, failAt = 0, turnPending = null, turnStarted = null, detachTurn = false;
  const calls = [];
  const now = () => { if (failAt && --failAt === 0) throw new Error('synthetic-preparation-clock'); return 1000; };
  const sessions = createCollaborationSessions({ ownerId: 'ui-owner', now,
    idFactory: (_index, kind) => `${kind}-${++sequence}`, schedule: () => 0, cancelSchedule() {} });
  const grants = createContextGrants({ ownerId: 'ui-owner', now, idFactory: () => `grant-${++sequence}` });
  const access = createConversationAccess({ sessions, grants, now,
    reads: { execute: () => ({ ok: true, items: [], sourceRefs: [], disclosure: { fields: [] }, availability: 'available' }) },
    getProvider: () => ({ purposeAllowed: true, enabled: true, configured: true, fingerprint: 'provider', model: 'synthetic', endpoint: 'synthetic' }),
    readSnapshot: () => ({ tasks: [], impulses: [], routines: [], settings: { aiMemoryEnabled: false } }) });
  const get = () => sessions.get({ conversationId: currentId }).conversation;
  function begin(detach = false) {
    const begun = sessions.beginTurn({ conversationId: currentId, message: 'Synthetic active user', providerId: 'provider',
      authorizationGeneration: get().authGeneration });
    if (detach) begun.signal.addEventListener('abort', () => {
      const record = get();
      assert.equal(sessions.delete({ conversationId: currentId, expectedRevision: record.revision }).ok, true);
    });
    return begun;
  }
  const client = {
    async startConversation(args) { calls.push('start'); const result = access.start(args); currentId = result.conversation.id; return result; },
    async getConversation(args) { calls.push('get'); currentId = args.conversationId; return access.open(args); },
    async conversationTurn() {
      calls.push('turn'); const begun = begin(detachTurn); turnStarted?.resolve(begun);
      return turnPending ? turnPending.promise : { ok: false, reason: 'synthetic-provider-not-used' };
    },
    async cancelConversation(args) { calls.push('cancel'); return access.cancel(args); },
    async setConversationMode(args) { calls.push('mode'); return access.setMode(args); },
    async setConversationScope(args) { calls.push('scope'); return access.setScope(args); },
    async pauseConversation(args) { calls.push('pause'); return access.pause(args); },
    async listConversations() { return { ok: true, items: [], nextCursor: null }; },
    async getConversationContextChoices() { return { ok: true, items: [], nextCursor: null }; },
    async listConversationReceipts() { return { ok: true, items: [], nextCursor: null }; }
  };
  const dom = createRetiringDom();
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, surfaceClient: client,
    escapeHTML: value => String(value).replaceAll('<', '&lt;'), fallbackReasonText: () => '',
    adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {} });
  feature.mount();
  return { sessions, grants, access, client, feature, dom, calls, get, begin,
    pendingTurn() { turnPending = deferred(); turnStarted = deferred(); detachTurn = true; return { pending: turnPending, entered: turnStarted }; },
    pendingConversation() {
      const opened = access.start({ purpose: 'task', mode: 'talk' }); currentId = opened.conversation.id;
      const begun = begin();
      sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'Readable local history',
        sourceRefs: [{ kind: 'task', id: 'task-1', revision: 'v1' }] });
      failAt = 3;
      assert.equal(sessions.revoke({ conversationId: currentId }).reason, 'conversation-context-pending');
      return currentId;
    }, status: () => dom.$('#draftChatStatus').textContent };
}

test('actual feature acknowledges confirmed cancel with no fresh scope and cannot resend', async () => {
  const f = fixture(); await f.feature.open();
  const pending = f.pendingTurn();
  f.dom.$('#draftChatInput').value = 'User input';
  const sending = f.feature.send(); await pending.entered.promise;
  f.dom.$('#draftChatInput').value = 'KEEP_UNSENT_DRAFT';
  await f.feature.cancel();
  assert.match(f.status(), /先前生成已取消/);
  assert.doesNotMatch(f.status(), /取消请求未确认|可以重试/);
  assert.equal(f.dom.$('#draftChatInput').value, 'KEEP_UNSENT_DRAFT');
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, true);
  assert.equal(f.dom.$('#draftChatContextPreview').textContent, '没有附加上下文');
  await f.feature.send();
  assert.equal(f.calls.filter(value => value === 'turn').length, 1);
  assert.equal(f.calls.filter(value => value === 'cancel').length, 1);
  assert.equal(f.calls.filter(value => value === 'scope').length, 0);
  pending.pending.resolve({ ok: false, reason: 'turn-canceled' }); await sending;
});

test('actual scope and mode retirement failures clear preview without claiming mutation failure', async () => {
  for (const kind of ['scope', 'mode']) {
    const f = fixture(); await f.feature.open(); f.begin(true);
    f.dom.$('#draftChatInput').value = 'KEEP_LOCAL_DRAFT';
    f.dom.$('#draftChatMode').value = 'plan';
    await f.feature.change(kind);
    assert.match(f.status(), kind === 'scope' ? /旧参考范围已撤回/ : /模式已更改/);
    assert.match(f.status(), /重新打开/);
    assert.doesNotMatch(f.status(), /本机预览已更新|可以重试/);
    assert.equal(f.dom.$('#draftChatInput').value, 'KEEP_LOCAL_DRAFT');
    assert.equal(f.dom.$('#btnDraftChatSend').disabled, true);
    assert.equal(f.dom.$('#draftChatContextPreview').textContent, '没有附加上下文');
    await f.feature.send();
    assert.equal(f.calls.includes('turn'), false);
    assert.equal(f.calls.filter(value => value === kind).length, 1);
  }
});

test('newer input typed while a known-applied response waits is never replaced by captured draft', async () => {
  const f = fixture(); await f.feature.open(); f.begin(true);
  const ready = deferred(), release = deferred();
  const original = f.client.setConversationMode;
  f.client.setConversationMode = async request => { const result = await original(request); ready.resolve(result); await release.promise; return result; };
  f.dom.$('#draftChatInput').value = 'OLDER_DRAFT'; f.dom.$('#draftChatMode').value = 'plan';
  const changing = f.feature.change('mode');
  assert.equal((await ready.promise).transition.applied, true);
  f.dom.$('#draftChatInput').value = 'NEWER_DRAFT';
  release.resolve(); await changing;
  assert.equal(f.dom.$('#draftChatInput').value, 'NEWER_DRAFT');
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, true);
});

test('late applied-scope failure cannot clear a reopened UI owner grant or draft', async () => {
  const f = fixture(); await f.feature.open(); f.begin(true);
  const ready = deferred(), release = deferred();
  const original = f.client.setConversationMode;
  f.client.setConversationMode = async request => { const result = await original(request); ready.resolve(); await release.promise; return result; };
  f.dom.$('#draftChatMode').value = 'plan';
  const changing = f.feature.change('mode'); await ready.promise;
  f.feature.close();
  await f.feature.open({ purpose: 'stuck' });
  f.dom.$('#draftChatInput').value = 'NEW_UI_OWNER';
  release.resolve(); await changing;
  assert.equal(f.dom.$('#draftChatInput').value, 'NEW_UI_OWNER');
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, false);
  await f.feature.send();
  assert.equal(f.calls.filter(value => value === 'turn').length, 1);
});

test('pending local-only open is readable, visibly cannot send and waits for explicit Apply', async () => {
  const f = fixture(), conversationId = f.pendingConversation();
  await f.feature.open({ conversationId });
  assert.match(f.dom.$('#draftChatLog').innerHTML, /Readable local history/);
  assert.match(f.status(), /参考范围尚未更新/);
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, true);
  assert.equal(f.dom.$('#btnDraftChatScopeApply').disabled, false);
  f.dom.$('#draftChatInput').value = 'LOCAL_PENDING_DRAFT';
  await f.feature.send();
  assert.equal(f.calls.includes('turn'), false);
  assert.equal(f.calls.includes('scope'), false);
  await f.feature.change('scope');
  assert.equal(f.calls.filter(value => value === 'scope').length, 1);
  assert.equal(f.get().contextEligibilityPending, false);
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, false);
  assert.equal(f.dom.$('#draftChatInput').value, 'LOCAL_PENDING_DRAFT');
});

test('explicit null grant without conversation clears a retained grant through the actual accept path', async () => {
  const f = fixture(); await f.feature.open();
  f.client.setConversationMode = async () => ({ ok: true, conversation: null, scopeGrantId: null });
  f.dom.$('#draftChatMode').value = 'plan';
  await f.feature.change('mode');
  assert.equal(f.dom.$('#btnDraftChatSend').disabled, true);
  f.dom.$('#draftChatInput').value = 'Must stay local';
  await f.feature.send();
  assert.equal(f.calls.includes('turn'), false);
});
