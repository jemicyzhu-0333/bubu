'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { memoryCandidateFromMessage, memoryChangeFromMessage } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
function setup({ pause, memoryChange } = {}) {
  const dom = createCollaborationDom(), calls = [];
  const candidate = { id: 'message-memory', role: 'assistant', content: '这是一条待核对建议。', proposal: { id: 'proposal-memory', kind: 'memory-candidate', version: 1,
    body: JSON.stringify({ memoryCandidate: { kind: 'preference', subject: '<script>主题</script>', body: '工作时先找一个小动作', scope: 'work', expiresAt: null } }) } };
  if (memoryChange) candidate.proposal.body = JSON.stringify({ memoryChange });
  const record = { id: 'chat-memory', revision: 1, purpose: 'task', mode: 'talk', messages: [candidate], retention: { mode: 'ephemeral' }, saveState: 'ephemeral' };
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML: value => String(value).replaceAll('<', '&lt;'),
    surfaceClient: { async startConversation() { return { ok: true, conversation: structuredClone(record), scopeGrantId: 'grant-memory' }; },
      async conversationTurn() { assert.fail('preview does not call a model'); },
      async pauseConversation(args) { calls.push(['pause', args]); if (pause) return pause(args); return { ok: true }; } },
    adoptProposal() { assert.fail('memory candidate cannot be adopted as task'); }, fallbackReasonText: () => '', restoreModalFocus() {},
    isAiClarifyEnabled: () => true, showEntryStatus() {}, onMemoryCandidateReview: payload => calls.push(['review', payload]) });
  feature.mount(); return { dom, feature, calls, candidate };
}

test('chat memory candidate is escaped, inert and handed to review by stable IDs only after pausing', async () => {
  const h = setup(); h.dom.$('#taskCreateMask').classList.remove('hidden'); h.dom.$('#taskInput').value = '未保存任务'; await h.feature.open();
  assert.match(h.dom.$('#draftChatLog').innerHTML, /data-proposal-status="proposal-memory">记忆 · 提交状态暂不可用/);
  assert.doesNotMatch(h.dom.$('#draftChatLog').innerHTML, /<script>/);
  assert.equal(h.calls.length, 0); h.feature.adopt(); assert.equal(h.feature.isOpen(), true);
  await h.feature.reviewMemoryCandidate('proposal-memory');
  assert.equal(h.feature.isOpen(), false); assert.equal(h.calls[0][0], 'pause');
  assert.deepEqual(h.calls[1], ['review', { conversationId: 'chat-memory', proposalId: 'proposal-memory' }]);
  assert.equal(h.calls[0][1].selectedProposalId, 'proposal-memory');
  assert.equal(h.dom.$('#taskCreateMask').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#taskInput').value, '未保存任务');
});

test('existing memory update and forget cards remain inert and hand off only the canonical proposal identity', async () => {
  for (const operation of ['update', 'forget']) {
    const memoryChange = { operation, id: 'existing-memory', ...(operation === 'update' ? { input: {
      kind: 'context', subject: '<script>修正</script>', body: '我修改后的说法', scope: 'personal', expiresAt: null } } : {}) };
    const h = setup({ memoryChange }); await h.feature.open(); const html = h.dom.$('#draftChatLog').innerHTML;
    assert.match(html, /existing-memory/); assert.match(html, operation === 'forget' ? /永久遗忘建议.*单独确认/s : /记忆修改建议.*更新原条目/s);
    assert.doesNotMatch(html, /<script>/); assert.equal(h.calls.length, 0);
    await h.feature.reviewMemoryCandidate('proposal-memory');
    assert.deepEqual(h.calls.at(-1), ['review', { conversationId: 'chat-memory', proposalId: 'proposal-memory' }]);
    h.feature.dispose();
  }
});

test('memory change parser rejects broad deletes, unsupported operations and extra confirmation/provenance fields', () => {
  const parse = memoryChange => memoryChangeFromMessage({ proposal: { kind: 'memory-candidate', body: JSON.stringify({ memoryChange }) } });
  assert.deepEqual(parse({ operation: 'forget', id: 'm1' }), { operation: 'forget', id: 'm1' });
  for (const value of [{ operation: 'forget', id: '*' }, { operation: 'clear', id: 'm1' },
    { operation: 'forget', id: 'm1', confirmed: true }, { operation: 'update', id: 'm1', input: { body: 'partial patch' } },
    { operation: 'forget', id: 'm1', input: {} }]) assert.equal(parse(value), null);
});

test('cancel or newer navigation while old pause is pending suppresses a delayed memory-review handoff', async () => {
  let resolve; const pause = new Promise(done => { resolve = done; }); const h = setup({ pause: () => pause }); await h.feature.open();
  const review = h.feature.reviewMemoryCandidate('proposal-memory'); h.feature.close(); resolve({ ok: true }); await review;
  assert.equal(h.calls.some(([kind]) => kind === 'review'), false);
});

test('malformed or unrelated proposals do not become memory candidates', () => {
  assert.equal(memoryCandidateFromMessage({ proposal: { kind: 'task-draft', body: '{"memoryCandidate":{"subject":"x","body":"y"}}' } }), null);
  assert.equal(memoryCandidateFromMessage({ proposal: { kind: 'memory-candidate', body: 'invalid' } }), null);
  assert.equal(memoryCandidateFromMessage({ proposal: { kind: 'memory-candidate', body: '{"memoryCandidate":{"confirmed":true}}' } }), null);
});
