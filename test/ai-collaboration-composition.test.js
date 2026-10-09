'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRecallFixture } = require('../test-support/memory-recall-fixture');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
function harness({ available = true, memoryAuthority } = {}) {
  let id = 0, calls = 0;
  const settings = { aiBreakdownEnabled: true, aiClarifyEnabled: true, aiModel: 'test-model', aiBaseUrl: 'https://example.com/v1' };
  const snapshot = { settings, tasks: [{ id: 'task-a', title: 'Report', steps: [], done: false }] };
  const service = createAiCollaboration({ storage: { ownerId: 'profile-abc', repository: null, close() {} },
    memoryAuthority, readSnapshot: () => snapshot, factStore: { healthy: available, timeline: { queryRange: () => ({ ok: true, items: [] }) } },
    getSettings: () => settings, credentialStore: { status: () => ({ configured: true }), get: () => 'test-only', set() {}, clear() { return true; } },
    now: () => Date.UTC(2026, 9, 4, 12), idFactory: kind => `${kind}-${++id}`,
    clientFactory: () => ({ endpoint: 'https://example.com/v1/chat/completions', async run(_name, _input, options) {
      options.beforeRequest(); calls += 1;
      return { type: 'answer', answer: 'We can start with one line.', readRequest: null, changeProposal: null };
    } }) });
  return { service, snapshot, settings, calls: () => calls };
}
test('all collaboration routes are closed and restricted to the popover', () => {
  assert.deepEqual(allowedSurfacesFor('ai:conversation-turn'), ['popover']);
  const value = { conversationId: 'c', scopeGrantId: 'g', message: 'hello' };
  assert.equal(validateIpcPayload('ai:conversation-turn', value).ok, true);
  assert.equal(validateIpcPayload('ai:conversation-turn', { ...value, consent: true }).ok, false);
  assert.equal(validateIpcPayload('ai:conversation-turn', { ...value, message: '🙂'.repeat(8000) }).ok, true);
  assert.equal(validateIpcPayload('ai:conversation-turn', { ...value, message: '🙂'.repeat(8001) }).ok, false);
  assert.equal(validateIpcPayload('ai:conversation-scope', { conversationId: 'c', focusSummary: true, allData: true }).ok, false);
});
test('start previews only selected current task and does not call a provider', async () => {
  const h = harness();
  const opened = h.service.start({ purpose: 'stuck', mode: 'talk', taskId: 'task-a', retentionMode: 'ephemeral' });
  assert.equal(opened.ok, true);
  assert.equal(h.calls(), 0);
  assert.equal(opened.contextPreview.length, 1);
  assert.equal(opened.disclosure.focusSummary, false);
  assert.equal(opened.contextPreview[0].items[0].id, 'task-a');
  const result = await h.service.turns.run({ conversationId: opened.conversation.id,
    scopeGrantId: opened.scopeGrantId, message: 'I am stuck' });
  assert.equal(result.ok, true);
  assert.equal(h.calls(), 1);
  assert.equal(result.conversation.messages.length, 2);
});
test('scope changes revoke old grants and unavailable history stays explicitly unavailable', () => {
  const h = harness({ available: false });
  const opened = h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  const updated = h.service.setScope({ conversationId: opened.conversation.id, focusSummary: true });
  assert.equal(updated.ok, true);
  assert.equal(updated.contextPreview[0].availability, 'unavailable');
  assert.notEqual(updated.scopeGrantId, opened.scopeGrantId);
  assert.equal(h.service.grants.resolve({ conversationId: opened.conversation.id,
    scopeGrantId: opened.scopeGrantId, providerId: h.service.getProvider().fingerprint, authorizationGeneration: 0 }).ok, false);
});
test('saved preference cannot claim recoverability when authoritative storage is unavailable', () => {
  const h = harness();
  const opened = h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'saved' });
  assert.equal(opened.ok, false);
  assert.equal(opened.conversation.recoverable, false);
});

test('successful credential replacement invalidates active authorization without exporting the secret', async () => {
  const h = harness();
  const opened = h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  const before = h.service.getProvider().fingerprint;
  const handlers = new Map();
  h.service.register((channel, handler) => handlers.set(channel, handler));
  const result = handlers.get('ai:credential-import')({}, { secret: 'test-only-replacement' });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('test-only-replacement'), false);
  assert.notEqual(h.service.getProvider().fingerprint, before);
  assert.equal(h.service.grants.resolve({ conversationId: opened.conversation.id,
    scopeGrantId: opened.scopeGrantId, providerId: before, authorizationGeneration: 0 }).ok, false);
});


test('task clarification permission is enforced on direct start, legacy IPC and resumed turns', async () => {
  const h = harness();
  const saved = h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  h.settings.aiClarifyEnabled = false;
  assert.equal(h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' }).reason, 'clarify-disabled');
  const resumed = h.service.open({ conversationId: saved.conversation.id });
  const refused = await h.service.turns.run({ conversationId: saved.conversation.id,
    scopeGrantId: resumed.scopeGrantId, message: 'Do not send this' });
  assert.equal(refused.reason, 'clarify-disabled');
  const handlers = new Map(); h.service.register((channel, handler) => handlers.set(channel, handler));
  assert.equal((await handlers.get('ai:draft-turn')({}, { message: 'Do not send this either' })).reason, 'clarify-disabled');
  assert.equal(h.calls(), 0);
  const stuck = h.service.start({ purpose: 'stuck', mode: 'talk', taskId: 'task-a', retentionMode: 'ephemeral' });
  assert.equal(stuck.ok, true);
  assert.equal((await h.service.turns.run({ conversationId: stuck.conversation.id,
    scopeGrantId: stuck.scopeGrantId, message: 'Help with current task' })).ok, true);
  assert.equal(h.calls(), 1);
});

test('legacy draft IPC shares continuous conversation history beyond six rounds', async t => {
  const h = harness();
  t.after(() => h.service.dispose());
  const handlers = new Map();
  h.service.register((channel, handler) => handlers.set(channel, handler));
  assert.deepEqual(allowedSurfacesFor('ai:draft-turn'), ['popover']);
  let conversationId;
  for (let turn = 0; turn < 8; turn += 1) {
    const payload = { message: `Round ${turn + 1}`, ...(conversationId ? { conversationId } : {}) };
    assert.equal(validateIpcPayload('ai:draft-turn', payload).ok, true);
    const result = await handlers.get('ai:draft-turn')({}, payload);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'need-more');
    assert.equal(result.provider, 'provider');
    conversationId ||= result.conversationId;
    assert.equal(result.conversationId, conversationId);
  }
  const reopened = handlers.get('ai:conversation-open')({}, { conversationId });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.conversation.messages.length, 16);
  assert.equal(reopened.conversation.messages[0].content, 'Round 1');
  assert.equal(reopened.conversation.messages.at(-2).content, 'Round 8');
  assert.equal(reopened.conversation.retention.mode, 'ephemeral');
  assert.equal(h.calls(), 8);
});

test('legacy discard pauses the shared conversation even after clarification is disabled', async t => {
  const h = harness();
  t.after(() => h.service.dispose());
  const handlers = new Map();
  h.service.register((channel, handler) => handlers.set(channel, handler));
  const first = await handlers.get('ai:draft-turn')({}, { message: 'Keep this thought' });
  h.settings.aiClarifyEnabled = false;
  const paused = handlers.get('ai:draft-discard')({}, { conversationId: first.conversationId });
  assert.equal(paused.ok, true);
  assert.equal(paused.conversation.status, 'paused');
  assert.equal(paused.conversation.messages.length, 2);
  h.settings.aiClarifyEnabled = true;
  const resumed = await handlers.get('ai:draft-turn')({}, {
    conversationId: first.conversationId, message: 'Continue it'
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.conversationId, first.conversationId);
  assert.equal(resumed.conversation.messages.length, 4);
});

test('production delete is revision-bound and frees the temporary-session capacity', () => {
  const h = harness(); const handlers = new Map();
  h.service.register((channel, handler) => handlers.set(channel, handler));
  const opened = Array.from({ length: 20 }, () => h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' }));
  assert.ok(opened.every(item => item.ok));
  assert.equal(h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' }).reason, 'conversation-cache-full');
  const first = opened[0].conversation;
  assert.equal(validateIpcPayload('ai:conversation-delete', { conversationId: first.id }).ok, false);
  assert.equal(handlers.get('ai:conversation-delete')({}, { conversationId: first.id,
    expectedRevision: first.revision + 1 }).reason, 'conversation-delete-conflict');
  assert.equal(handlers.get('ai:conversation-delete')({}, { conversationId: first.id,
    expectedRevision: first.revision }).ok, true);
  assert.equal(h.service.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' }).ok, true);
  h.service.dispose();
});

test('production composition retains trusted attempt usage while recall avoids management reads', async t => {
  const at = Date.UTC(2026, 9, 4, 12), calls = [], observedReferences = [];
  const records = [{ id: 'memory-a', version: 1, status: 'active', contextAllowed: true, kind: 'preference',
    subject: 'Synthetic opening', body: 'Start with one fact.', source: 'user-confirmed', scope: 'work',
    validFrom: 0, expiresAt: null, updatedAt: 0, useCount: 0 }];
  const { contextReader } = createMemoryRecallFixture({ records: () => records, now: () => at });
  const memory = { available: true, contextReader,
    list() { throw new Error('Recall must not call management list'); },
    forgettingState() { throw new Error('History must not call management forgettingState'); },
    getVersion({ id }) { calls.push('trusted-version'); return { ok: true, id, version: 1, contextAllowed: true }; },
    usage({ references }) { calls.push('trusted-usage'); observedReferences.push(structuredClone(references));
      records[0].useCount++; return { ok: true }; }
  };
  const h = harness({ memoryAuthority: { service: memory, onInvalidate: () => () => {}, close() {},
    drain: () => ({ ok: true, delivered: 0 }) } });
  t.after(() => h.service.dispose()); h.settings.aiMemoryEnabled = true;
  const opened = h.service.start({ purpose: 'stuck', mode: 'talk', retentionMode: 'ephemeral' });
  const scoped = h.service.setScope({ conversationId: opened.conversation.id, memoryIds: ['memory-a'] });
  assert.equal(scoped.ok, true, scoped.reason); assert.deepEqual(calls, []);
  const result = await h.service.turns.run({ conversationId: opened.conversation.id,
    scopeGrantId: scoped.scopeGrantId, message: 'Help me begin.' });
  assert.equal(result.ok, true, result.reason); assert.equal(h.calls(), 1);
  assert.deepEqual(calls, ['trusted-version', 'trusted-usage']);
  assert.deepEqual(observedReferences, [[{ id: 'memory-a', version: 1 }]]);
  assert.equal(records[0].useCount, 1); assert.equal(records[0].version, 1);
  assert.equal(result.disclosure.usage.reads, 1);
});
