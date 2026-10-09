'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');

test('production shared UI uses closed production routes, renewed mode/scope grants and canonical proposal selection', async () => {
  let id = 0;
  const dom = createCollaborationDom();
  const settings = { aiBreakdownEnabled: true, aiModel: 'test', aiBaseUrl: 'https://example.com/v1' };
  const task = { id: 'task-a', title: '报告', steps: [], done: false };
  const service = createAiCollaboration({ storage: { ownerId: 'synthetic-owner', repository: null, close() {} },
    readSnapshot: () => ({ settings, tasks: [task] }), factStore: { healthy: true, timeline: { queryRange: () => ({ ok: true, items: [] }) } },
    getSettings: () => settings, credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic' },
    now: () => Date.UTC(2026, 9, 4, 12), idFactory: kind => `${kind}-${++id}`,
    clientFactory: () => ({ endpoint: 'https://example.com/v1/chat/completions', async run(_name, _input, options) {
      options.beforeRequest();
      return { type: 'changeProposal', answer: '先打开报告。', readRequest: null,
        changeProposal: { title: '整理报告', steps: [{ title: '打开报告', dependsOn: null, safeStopAfter: true }], estimateMinutes: 5, energy: 'low', notes: null } };
    } }) });
  const routes = new Map();
  service.register((channel, handler) => routes.set(channel, handler));
  const bindings = {
    startConversation: 'start', getConversation: 'open', listConversations: 'list', conversationTurn: 'turn',
    pauseConversation: 'pause', cancelConversation: 'cancel', setConversationScope: 'scope',
    setConversationMode: 'mode', setConversationRetention: 'retention'
  };
  const calls = [];
  const client = Object.fromEntries(Object.entries(bindings).map(([name, action]) => [name, async payload => {
    const channel = `ai:conversation-${action}`;
    const validated = validateIpcPayload(channel, payload);
    assert.equal(validated.ok, true, `${name}: ${JSON.stringify(validated)}`);
    calls.push([name, payload]);
    return routes.get(channel)({}, validated.value ?? validated.payload ?? payload);
  }]));
  const staged = [];
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$,
    escapeHTML: value => String(value).replaceAll('<', '&lt;'), surfaceClient: client,
    fallbackReasonText: value => value, adoptProposal: () => assert.fail('stuck never creates a new task'),
    stageStuckProposal: (proposal, taskId) => { staged.push({ proposal, taskId }); return { ok: true }; },
    restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {} });
  feature.mount(); await feature.open({ purpose: 'stuck', mode: 'small-step', taskId: task.id });
  assert.equal(dom.$('#draftChatTaskContext').textContent, '当前任务：报告');
  dom.$('#draftChatInput').value = '怎样开始'; await feature.send();
  assert.match(dom.$('#draftChatLog').innerHTML, /先打开报告/);
  const current = service.sessions.list({}).items[0];
  const proposalId = service.sessions.get({ conversationId: current.id }).conversation.messages.at(-1).proposal.id;
  feature.chooseProposal(proposalId);
  dom.$('#draftChatMode').value = 'talk'; await feature.change('mode');
  dom.$('#draftChatFocusSummary').checked = true; await feature.change('scope');
  dom.$('#draftChatInput').value = '沿着这一版继续'; await feature.send();
  assert.equal(calls.filter(([name]) => name === 'conversationTurn').at(-1)[1].selectedProposalId, proposalId);
  assert.equal(service.sessions.get({ conversationId: current.id }).conversation.messages.length, 4);
  dom.$('#draftChatInput').value = '🦉'.repeat(8001); feature.close();
  await feature.open({ purpose: 'stuck', mode: 'small-step', taskId: task.id });
  assert.equal(Array.from(dom.$('#draftChatInput').value).length, 8001);
  assert.equal(dom.$('#draftChatFocusSummary').checked, false);
  feature.adopt(); assert.equal(staged[0].taskId, task.id); assert.equal(staged[0].proposal.steps[0].title, '打开报告');
  feature.dispose(); service.dispose();
});
