'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanningPreferencesFeature } = require('../src/surfaces/popover/features/planning-preferences.mjs');
const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { planningProposalFixture, INPUT } = require('../test-support/planning-proposal-fixture');
const BINDINGS = Object.freeze({ getPlanningGuidance: 'planning:get', cancelPlanningPreview: 'planning:preview-cancel',
  previewPlanningProposal: 'planning:proposal-preview', previewPlanningPreference: 'planning:preference-preview',
  confirmPlanningPreference: 'planning:preference-confirm', undoPlanningPreference: 'planning:preference-undo',
  previewEnergyHistoryConsent: 'planning:history-preview', confirmEnergyHistoryConsent: 'planning:history-confirm',
  previewEnergyCurveTrial: 'planning:trial-preview', confirmEnergyCurveTrial: 'planning:trial-confirm', undoEnergyCurveTrial: 'planning:trial-undo',
  startConversation: 'ai:conversation-start', getConversation: 'ai:conversation-open', listConversations: 'ai:conversation-list',
  conversationTurn: 'ai:conversation-turn', pauseConversation: 'ai:conversation-pause', cancelConversation: 'ai:conversation-cancel',
  setConversationScope: 'ai:conversation-scope', setConversationMode: 'ai:conversation-mode', setConversationRetention: 'ai:conversation-retention' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function ui(f) {
  const dom = createCollaborationDom(), calls = [], overrides = {};
  const bridge = Object.fromEntries(Object.entries(BINDINGS).map(([name, channel]) => [name, async payload => {
    const decoded = validateIpcPayload(channel, payload); assert.equal(decoded.ok, true, JSON.stringify(decoded));
    const result = await (overrides[name] ? overrides[name](payload) : f.routes.get(channel)({}, decoded.value));
    calls.push({ name, payload, result }); return result;
  }]));
  const client = createPopoverSurfaceClient(new Proxy(bridge, { get(target, name) {
    if (name === 'onPopoverHidden') return () => () => {};
    return target[name] || (() => { throw new Error(`Unexpected fixture method: ${String(name)}`); });
  } }));
  const feature = createPlanningPreferencesFeature({ document: dom.document, $: dom.$, client, now: f.clock.now });
  feature.init(); dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupPlanning').open = true;
  return { dom, calls, overrides, feature, client, last: name => calls.filter(call => call.name === name).at(-1) };
}

test('proposal UI preserves canonical provenance after editing, supports midnight end, and confirms only the fresh ticket', async t => {
  const f = planningProposalFixture(); const h = ui(f); t.after(() => { h.feature.dispose(); f.dispose(); });
  const request = f.candidate({ ...INPUT, endMinute: 1440 });
  await h.feature.reviewProposal(request);
  assert.equal(h.dom.$('#planningEnd').value, '24:00');
  assert.equal(h.dom.$('#planningPreferenceTarget').disabled, true);
  const first = h.last('previewPlanningProposal').result;
  assert.equal(f.commits(), 0);
  h.dom.$('#planningDemand').value = 'medium'; await h.dom.fire('#planningDemand', 'change');
  await h.feature.confirm(); assert.equal(f.commits(), 0);
  assert.equal(f.invoke('planning:preference-confirm', { previewId: first.previewId }).ok, false);
  await h.feature.preview('preference');
  const second = h.last('previewPlanningProposal').result;
  assert.deepEqual(second.provenance, first.provenance);
  assert.equal(h.calls.some(call => call.name === 'previewPlanningPreference'), false);
  await h.feature.confirm();
  assert.equal(f.commits(), 1); assert.equal(f.snapshot().planningPreferences.items[0].demand, 'medium');
  f.reopen(); await h.feature.reviewProposal(request);
  assert.match(h.dom.$('#planningStatus').textContent, /已经保存/);
  assert.equal(h.dom.$('#planningConfirm').disabled, true); assert.equal(f.commits(), 1);
});

test('proposal UI refuses forgotten sources at confirmation and closes without leaving an active ticket', async t => {
  const f = planningProposalFixture(); const h = ui(f); t.after(() => { h.feature.dispose(); f.dispose(); });
  const request = f.candidate(); await h.feature.reviewProposal(request);
  f.setAllowed(false); await h.feature.confirm();
  assert.equal(f.commits(), 0); assert.match(h.dom.$('#planningStatus').textContent, /来源/);
  assert.equal(h.dom.$('#planningConfirm').disabled, true);
  f.setAllowed(true); await h.feature.reviewProposal(request);
  const ticket = h.last('previewPlanningProposal').result.previewId;
  await h.dom.fire('#btnSettingsClose', 'click');
  assert.equal(f.invoke('planning:preference-confirm', { previewId: ticket }).ok, false);
  assert.equal(f.commits(), 0);
});

test('late proposal A cannot replace or cancel newer B and repeated abandoned candidates release capacity', async t => {
  const f = planningProposalFixture(); const h = ui(f); t.after(() => { h.feature.dispose(); f.dispose(); });
  const a = f.candidate(), b = f.candidate({ ...INPUT, demand: 'high' });
  let release, abandoned;
  h.overrides.previewPlanningProposal = request => {
    const result = f.invoke('planning:proposal-preview', request);
    if (request.proposalId === a.proposalId) { abandoned = result; return new Promise(resolve => { release = () => resolve(result); }); }
    return result;
  };
  const late = h.feature.reviewProposal(a); await tick();
  await h.feature.reviewProposal(b);
  const current = h.last('previewPlanningProposal').result;
  release(); await late;
  assert.equal(h.dom.$('#planningDemand').value, 'high');
  assert.equal(f.invoke('planning:preference-confirm', { previewId: abandoned.previewId }).ok, false);
  assert.equal(h.last('cancelPlanningPreview').payload.previewId, abandoned.previewId);
  delete h.overrides.previewPlanningProposal;
  for (let i = 0; i < 40; i++) { await h.feature.reviewProposal(b); await h.dom.fire('#planningCancel', 'click'); }
  assert.equal(f.invoke('planning:preference-confirm', { previewId: current.previewId }).ok, false);
  await h.feature.reviewProposal(b); await h.feature.confirm();
  assert.equal(f.commits(), 1); assert.equal(f.snapshot().planningPreferences.items[0].demand, 'high');
});

test('production chat proposal hands off to the local panel after pause, with no model write or extra model call', async t => {
  const f = planningProposalFixture(); let modelCalls = 0, serial = 0;
  f.mutate(state => { Object.assign(state.settings, { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiModel: 'synthetic', aiBaseUrl: 'https://example.com/v1' }); });
  const collaboration = createAiCollaboration({ storage: { ownerId: 'synthetic-owner', repository: null, close() {} },
    readSnapshot: f.snapshot, factStore: { healthy: true, timeline: { queryRange: () => ({ ok: true, items: [] }) } },
    getSettings: () => f.snapshot().settings, credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic' },
    now: f.clock.now, idFactory: kind => `${kind}-${++serial}`, clientFactory: () => ({ endpoint: 'https://example.com/v1/chat/completions',
      async run(_name, _input, options) { options.beforeRequest(); modelCalls++; return { type: 'changeProposal', answer: '下午可以留给轻一些的事情。',
        readRequest: null, changeProposal: { planningPreference: INPUT } }; } }) });
  collaboration.register((channel, handler) => f.routes.set(channel, handler));
  createPlanningPreferences({ ...f, readSnapshot: f.snapshot, getConversation: collaboration.sessions.get,
    validateContextVersions: collaboration.reads.validateContextVersions, isContextMessageAllowed: () => true })
    .register((channel, handler) => f.routes.set(channel, handler));
  const h = ui(f); let handed = null;
  h.dom.$('#settingsMask').classList.add('hidden'); h.dom.$('#settingGroupPlanning').open = false;
  const chat = createPopoverDraftConversation({ document: h.dom.document, $: h.dom.$, surfaceClient: h.client,
    escapeHTML: value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`), fallbackReasonText: () => '本机',
    adoptProposal: () => assert.fail('planning cannot become a task draft'), restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {},
    onPlanningCandidateReview: async request => {
      handed = request; assert.equal(chat.isOpen(), false);
      assert.equal(collaboration.sessions.get({ conversationId: request.conversationId }).conversation.status, 'paused');
      h.dom.$('#settingsMask').classList.remove('hidden'); h.dom.$('#settingGroupPlanning').open = true;
      await h.feature.reviewProposal(request);
    } });
  t.after(() => { chat.dispose(); h.feature.dispose(); collaboration.dispose(); f.dispose(); });
  chat.mount(); await chat.open({ purpose: 'planning', mode: 'plan' });
  h.dom.$('#draftChatInput').value = '下午想安排轻一点'; await chat.send();
  assert.equal(modelCalls, 1); assert.equal(f.commits(), 0);
  assert.match(h.dom.$('#draftChatLog').innerHTML, /data-chat-planning/);
  assert.match(h.dom.$('#draftChatLog').innerHTML, /安排偏好 · 提交状态暂不可用/);
  assert.match(h.dom.$('#draftChatLog').innerHTML, /可编辑并单独确认，不改变自评或能量曲线/);
  const record = collaboration.sessions.get({ conversationId: collaboration.sessions.list({}).items[0].id }).conversation;
  const originalBody = record.messages.at(-1).proposal.body;
  await chat.reviewPlanningCandidate(record.messages.at(-1).proposal.id);
  assert.equal(handed.conversationId, record.id); assert.equal(f.commits(), 0);
  h.dom.$('#planningScope').value = 'saved'; await h.dom.fire('#planningScope', 'change');
  await h.feature.preview('preference'); await h.feature.confirm();
  assert.equal(f.commits(), 1); assert.equal(modelCalls, 1);
  assert.equal(f.snapshot().planningPreferences.items[0].scope, 'saved');
  assert.equal(collaboration.sessions.get({ conversationId: record.id }).conversation.messages.at(-1).proposal.body, originalBody);
  assert.equal(f.snapshot().energyProfile, null); assert.equal(f.snapshot().energyCheckIn, null);
});
