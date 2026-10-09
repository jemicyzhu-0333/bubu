'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationView } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
function harness() {
  const dom = createCollaborationDom(), calls = [];
  const records = new Map(['first', 'second'].map(id => [id, { id, revision: 1, purpose: 'task', mode: 'talk', messages: [{ id: id+'-m', role: 'assistant', content: 'Synthetic response', provenance: { source: 'local', reason: 'provider-not-configured' } }], retention: { mode: 'ephemeral' }, inputDraft: '', saveState: 'ephemeral' }]));
  let seq = 0;
  const response = record => ({ ok: true, conversation: structuredClone(record), scopeGrantId: 'grant', disclosure: { fields: [] } });
  const client = {
    async startConversation() { const id = seq++ ? 'second' : 'first'; return response(records.get(id)); },
    async getConversation({ conversationId }) { return response(records.get(conversationId)); },
    async listConversations() { calls.push('list'); return { ok: true, items: [...records.values()], nextCursor: null }; },
    async pauseConversation(args) { calls.push(['pause', args]); return { ok: true }; },
    async conversationTurn() { calls.push('turn'); return response(records.get('first')); }
  };
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML, surfaceClient: client,
    fallbackReasonText: () => '尚未配置模型', adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {} });
  feature.mount();
  return { ...dom, feature, calls, client, records };
}
const hidden = (dom, id) => dom.$(id).classList.contains('hidden');

test('detail, list and settings are mutually exclusive and only detail has a composer', () => {
  const dom = createCollaborationDom();
  const view = createCollaborationView({ $: dom.$, escapeHTML });
  for (const [page, visible] of [['detail','#draftChatDetail'], ['list','#draftChatLibrary'], ['settings','#draftChatSettings']]) {
    view.page(page);
    for (const id of ['#draftChatDetail','#draftChatLibrary','#draftChatSettings']) assert.equal(hidden(dom,id),id!==visible);
    assert.equal(hidden(dom,'#draftChatComposeShell'),page!=='detail');
    assert.equal(hidden(dom,'#btnDraftChatBack'),page==='detail');
  }
});

test('back from list and settings keeps draft and transcript scroll; Escape returns within the same modal', async () => {
  const h=harness(); await h.feature.open();
  h.$('#draftChatInput').value='Unsent draft'; h.$('#draftChatLog').scrollTop=123;
  h.fire('#draftChatInput','input');
  await h.feature.list();
  assert.equal(hidden(h,'#draftChatLibrary'),false); assert.equal(hidden(h,'#draftChatDetail'),true);
  h.fire('#btnDraftChatBack','click');
  assert.equal(h.$('#draftChatInput').value,'Unsent draft'); assert.equal(h.$('#draftChatLog').scrollTop,123);
  h.fire('#btnDraftChatSettings','click');
  assert.equal(hidden(h,'#draftChatSettings'),false);
  let prevented=false,stopped=false;
  h.fire('#draftChatMask','keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented&&stopped,true); assert.equal(h.feature.isOpen(),true);
  assert.equal(hidden(h,'#draftChatDetail'),false); assert.equal(h.$('#draftChatInput').value,'Unsent draft');
  assert.equal(h.document.activeElement,h.$('#draftChatInput'));
  h.feature.dispose();
});

test('switching through list restores each session draft and scroll, with current marker refreshed', async () => {
  const h=harness(); await h.feature.open();
  h.$('#draftChatInput').value='First draft';h.$('#draftChatLog').scrollTop=71;h.fire('#draftChatInput','input');
  await h.feature.list(); await h.feature.resume('second');
  assert.equal(hidden(h,'#draftChatDetail'),false);assert.equal(hidden(h,'#draftChatLibrary'),true);
  h.$('#draftChatInput').value='Second draft';h.$('#draftChatLog').scrollTop=19;h.fire('#draftChatInput','input');
  await h.feature.list(); await h.feature.resume('first');
  assert.equal(h.$('#draftChatInput').value,'First draft');assert.equal(h.$('#draftChatLog').scrollTop,71);
  assert.match(h.$('#draftChatSessions').innerHTML,/data-chat-resume="first" aria-current="true"/);
  assert.ok(h.$('#draftChatLog').innerHTML.includes('本地模板'));
  h.feature.dispose();
});

test('late list response never takes the user back out of the conversation', async () => {
  const h=harness(); await h.feature.open();let resolve;
  h.client.listConversations=()=>new Promise(r=>{resolve=r;});
  const pending=h.feature.list();h.fire('#btnDraftChatBack','click');
  resolve({ok:true,items:[],nextCursor:null});await pending;
  assert.equal(hidden(h,'#draftChatDetail'),false);assert.equal(hidden(h,'#draftChatLibrary'),true);
  h.feature.dispose();
});

test('leaving settings cancels deletion confirmation without deleting or clearing draft', async () => {
  const h=harness();await h.feature.open();h.$('#draftChatInput').value='Keep this';
  h.fire('#btnDraftChatSettings','click');await h.feature.requestDelete();
  assert.equal(hidden(h,'#draftChatDeleteConfirm'),false);
  h.fire('#btnDraftChatBack','click');
  assert.equal(hidden(h,'#draftChatDeleteConfirm'),true);assert.equal(h.$('#draftChatInput').value,'Keep this');
  assert.equal(h.feature.isOpen(),true);h.feature.dispose();
});


test('external conversationId entry restores canonical draft directly to detail without sending', async () => {
  const h=harness();
  h.records.get('second').inputDraft='Persisted unsent draft from another entry';
  h.records.get('second').scrollTop=37;
  await h.feature.open({conversationId:'second'});
  assert.equal(hidden(h,'#draftChatDetail'),false);
  assert.equal(hidden(h,'#draftChatLibrary'),true);
  assert.equal(h.$('#draftChatInput').value,'Persisted unsent draft from another entry');
  assert.equal(h.$('#draftChatLog').scrollTop,37);
  await h.feature.list();h.fire('#btnDraftChatBack','click');
  assert.equal(h.$('#draftChatInput').value,'Persisted unsent draft from another entry');
  assert.equal(h.calls.filter(item=>item==='turn').length,0);
  h.feature.dispose();
});
