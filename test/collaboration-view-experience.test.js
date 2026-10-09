'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createCollaborationView } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
const { createPopoverMessages } = require('../src/surfaces/popover/ui/messages.mjs');
const { fallbackReasonText } = createPopoverMessages({ pad2: value => String(value).padStart(2, '0') });
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function harness() {
  const dom = createCollaborationDom();
  return { ...dom, view: createCollaborationView({ $: dom.$, escapeHTML, fallbackReasonText }) };
}
const record = (id = 'c1', messages = []) => ({ id, mode: 'talk', purpose: 'draft', messages, retention: { mode: 'ephemeral' } });

test('short conversations omit pagination noise while full history remains reachable', () => {
  const { $, view } = harness();
  view.conversation(record('c1', [{ id: 'u', role: 'user', content: '你好' }, { id: 'a', role: 'assistant', content: '你好' }]));
  assert.equal($('#draftChatHistoryNav').classList.contains('hidden'), true);
  assert.equal($('#draftChatHistoryRange').textContent, '');
  const long = record('c2', Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: String(i) })));
  view.conversation(long);
  assert.equal($('#draftChatHistoryNav').classList.contains('hidden'), false);
  assert.equal($('#draftChatHistoryRange').textContent, '第 2–201 条，共 201 条');
  view.pageHistory('earlier');
  assert.match($('#draftChatLog').innerHTML, /data-message-id="m0"/);
  view.pageHistory('latest');
  assert.match($('#draftChatLog').innerHTML, /data-message-id="m200"/);
});

test('local response provenance survives status changes, projection refresh and reopening', () => {
  const { $, view } = harness();
  const local = record('c1', [{ id: 'a', role: 'assistant', content: '<script>unsafe</script>', provenance: { source: 'local', reason: 'provider-response-html' } }]);
  view.conversation(local);
  const expected = $('#draftChatLog').innerHTML;
  assert.match(expected, /data-chat-source="local">本地模板/);
  assert.ok(expected.includes(escapeHTML(fallbackReasonText('provider-response-html'))));
  assert.ok(expected.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!expected.includes('<script>'));
  view.status('新的状态');
  view.proposalStatuses('c1', []);
  assert.equal($('#draftChatLog').innerHTML, expected);
  view.conversation(record('other'));
  view.conversation(structuredClone(local));
  assert.equal($('#draftChatLog').innerHTML, expected);
});

test('API and user messages never acquire local labels; unknown local reasons stay plainly local', () => {
  const { $, view } = harness();
  view.conversation(record('c1', [
    { id: 'u', role: 'user', content: 'hi', provenance: { source: 'local' } },
    { id: 'a', role: 'assistant', content: 'hello', provenance: { source: 'api' } },
    { id: 'l', role: 'assistant', content: 'local', provenance: { source: 'local', reason: 'unknown' } }
  ]));
  assert.equal(($('#draftChatLog').innerHTML.match(/data-chat-source="local"/g) || []).length, 1);
});

test('switching conversations collapses auxiliary controls, labels current session and preserves safe title text', () => {
  const { $, view } = harness();
  const current = { ...record('current'), title: '<img src=x onerror=alert(1)>' };
  view.conversation(current);
  for (const id of ['#draftChatSettings', '#draftChatLibrary', '#draftChatManage']) $(id).open = true;
  view.conversation(current);
  assert.equal($('#draftChatSettings').open, true);
  view.conversation(record('other'));
  for (const id of ['#draftChatSettings', '#draftChatLibrary', '#draftChatManage']) assert.equal($(id).open, false);
  view.conversation(current);
  assert.equal($('#draftChatSessionTitle').textContent, current.title);
  view.sessions([current, record('other')], null);
  const list = $('#draftChatSessions').innerHTML;
  assert.match(list, /data-chat-resume="current" aria-current="true"/);
  assert.match(list, /data-chat-resume="other" aria-current="false"/);
  assert.match(list, /当前对话/);
  assert.ok(!list.includes('<img'));
  assert.equal($('#btnDraftChatMore').classList.contains('hidden'), true);
});

test('draft, busy state and scroll position continue to work with the simplified layout', () => {
  const { $, view } = harness();
  const session = record('c1', [{ id: 'a', role: 'assistant', content: 'Reply' }]);
  view.conversation(session);
  $('#draftChatLog').scrollTop = 45;
  view.conversation(session);
  assert.equal($('#draftChatLog').scrollTop, 45);
  view.draft('未发送的输入', null);
  assert.equal($('#draftChatInput').value, '未发送的输入');
  view.busy(true);
  assert.equal($('#draftChatInput').disabled, true);
  assert.equal($('#draftChatLog').getAttribute('aria-busy'), 'true');
  view.busy(false);
  assert.equal($('#draftChatInput').disabled, false);
});


test('cached session list updates its current marker immediately on new or resumed conversation', () => {
  const { $, view } = harness();
  const first = record('first'), second = record('second');
  view.conversation(first);
  view.sessions([first, second], null);
  assert.match($('#draftChatSessions').innerHTML, /data-chat-resume="first" aria-current="true"/);
  view.conversation(second);
  assert.match($('#draftChatSessions').innerHTML, /data-chat-resume="first" aria-current="false"/);
  assert.match($('#draftChatSessions').innerHTML, /data-chat-resume="second" aria-current="true"/);
  view.conversation(record('new'));
  assert.ok(!$('#draftChatSessions').innerHTML.includes('aria-current="true"'));
  view.conversation(first);
  assert.match($('#draftChatSessions').innerHTML, /data-chat-resume="first" aria-current="true"/);
});

test('authoritative list refresh replaces cached metadata and deleted sessions stay absent', () => {
  const { $, view } = harness();
  const first = { ...record('first'), title: 'old title' }, second = record('second');
  view.conversation(first);
  view.sessions([first, second], 'next-page');
  view.sessions([{ ...first, title: 'updated title' }, second], null);
  view.conversation(second);
  assert.ok($('#draftChatSessions').innerHTML.includes('updated title'));
  assert.ok(!$('#draftChatSessions').innerHTML.includes('old title'));
  // Production deletion clears the view, then supplies its filtered canonical list.
  view.conversation(null);
  view.sessions([first], null);
  view.conversation(record('new'));
  assert.ok(!$('#draftChatSessions').innerHTML.includes('data-chat-resume="second"'));
  view.sessions([], null);
  view.conversation(first);
  assert.ok(!$('#draftChatSessions').innerHTML.includes('data-chat-resume='));
});
