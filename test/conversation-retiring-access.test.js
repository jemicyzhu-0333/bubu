'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createConversationAccess } = require('../src/application/ai/conversation-access');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createMemoryRecallFixture } = require('../test-support/memory-recall-fixture');

function fixture(options = {}) {
  let sequence = 0, failAt = 0, enabled = true;
  const calls = { issue: 0, revoke: 0, provider: 0, snapshot: 0, read: 0 };
  const now = () => { if (failAt && --failAt === 0) throw new Error('synthetic-preparation-clock'); return 1000; };
  const sessions = createCollaborationSessions({ ownerId: 'access-owner', now,
    idFactory: (_index, kind) => `${kind}-${++sequence}`, schedule: () => 0, cancelSchedule() {} });
  const actualGrants = createContextGrants({ ownerId: 'access-owner', now, idFactory: () => `grant-${++sequence}` });
  const grants = { ...actualGrants,
    issue(request) { calls.issue++; return actualGrants.issue(request); },
    revoke(id) { calls.revoke++; return actualGrants.revoke(id); } };
  const { memoryRecall } = createMemoryRecallFixture({ records: () => options.memoryRecords || [], now,
    onSnapshot: options.memorySnapshot });
  const readSnapshot = () => { calls.snapshot++; return { tasks: [], impulses: [], routines: [],
    settings: { aiMemoryEnabled: Boolean(options.memoryRecords) } }; };
  const actualReads = createContextReads({ grants, readSnapshot, memoryRecall, now });
  const reads = { ...actualReads, execute(request, invokeOwnedSource) { calls.read++; return actualReads.execute(request, invokeOwnedSource); } };
  const access = createConversationAccess({ sessions, grants, now,
    reads, memoryRecall,
    getProvider() { calls.provider++; return { purposeAllowed: enabled, enabled, configured: true, fingerprint: 'provider', model: 'synthetic', endpoint: 'synthetic' }; },
    readSnapshot });
  const opened = access.start({ purpose: 'stuck', mode: 'talk' });
  assert.equal(opened.ok, true);
  const conversationId = opened.conversation.id;
  const get = () => sessions.get({ conversationId }).conversation;
  const begin = () => sessions.beginTurn({ conversationId, message: 'Synthetic user', providerId: 'provider', authorizationGeneration: get().authGeneration });
  return { sessions, actualGrants, access, opened, conversationId, calls, get, begin,
    reset() { for (const key of Object.keys(calls)) calls[key] = 0; },
    failPreparation() { failAt = 3; }, disable() { enabled = false; } };
}

test('actual access preserves detached known apply without fresh scope or source calls', () => {
  for (const kind of ['setScope', 'setMode', 'cancel']) {
    const f = fixture(), begun = f.begin();
    begun.signal.addEventListener('abort', () => {
      assert.equal(f.sessions.delete({ conversationId: f.conversationId, expectedRevision: f.get().revision }).ok, true);
    });
    f.reset();
    const result = f.access[kind]({ conversationId: f.conversationId,
      ...(kind === 'setScope' ? { focusSummary: false } : kind === 'setMode' ? { mode: 'plan' } : {}) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'scope-not-issued');
    assert.equal(result.transition.applied, true);
    assert.equal(result.transition.persistence, 'superseded');
    assert.equal(result.conversation, null);
    assert.equal(result.scopeGrantId, null);
    assert.deepEqual(f.calls, { issue: 0, revoke: 0, provider: 0, snapshot: 0, read: 0 });
  }
});

test('reentrant fresh access scope is not erased by old post-abort scope replacement', () => {
  const f = fixture(), begun = f.begin();
  let newer;
  begun.signal.addEventListener('abort', () => { newer = f.access.open({ conversationId: f.conversationId }); });
  f.reset();
  const result = f.access.setScope({ conversationId: f.conversationId, focusSummary: false });
  assert.equal(result.reason, 'scope-not-issued');
  assert.equal(result.transition.applied, true);
  assert.equal(newer.ok, true);
  assert.equal(f.calls.issue, 1);
  assert.equal(f.calls.revoke, 0);
  assert.equal(f.actualGrants.resolve({ scopeGrantId: newer.scopeGrantId, conversationId: f.conversationId,
    providerId: 'provider', authorizationGeneration: newer.conversation.authGeneration }).ok, true);
});

test('same-entry newer turn prevents old access from preparing a scope on its behalf', () => {
  const f = fixture(), begun = f.begin();
  let newer;
  begun.signal.addEventListener('abort', () => { newer = f.begin(); });
  f.reset();
  const result = f.access.cancel({ conversationId: f.conversationId });
  assert.equal(result.reason, 'scope-not-issued');
  assert.equal(result.transition.applied, true);
  assert.equal(result.transition.persistence, 'superseded');
  assert.equal(result.conversation.status, 'generating');
  assert.equal(newer.signal.aborted, false);
  assert.equal(f.calls.issue, 0);
  assert.equal(f.calls.provider, 0);
});

test('fresh-scope refusal after known retirement retains separate applied acknowledgement', () => {
  const f = fixture(), begun = f.begin();
  begun.signal.addEventListener('abort', () => { f.disable(); });
  f.reset();
  const result = f.access.setMode({ conversationId: f.conversationId, mode: 'plan' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scope-not-issued');
  assert.equal(result.transition.applied, true);
  assert.equal(result.conversation.mode, 'plan');
  assert.equal(f.calls.issue, 0);
});

test('pending privacy opens local readable history without provider, grant or source preparation', () => {
  const f = fixture(), begun = f.begin();
  f.sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'Readable local text',
    sourceRefs: [{ kind: 'task', id: 'task-1', revision: 'v1' }] });
  f.failPreparation();
  assert.equal(f.sessions.revoke({ conversationId: f.conversationId }).reason, 'conversation-context-pending');
  f.reset();
  const opened = f.access.open({ conversationId: f.conversationId });
  assert.equal(opened.ok, true);
  assert.equal(opened.localOnly, true);
  assert.equal(opened.scopeGrantId, null);
  assert.equal(opened.conversation.messages.at(-1).content, 'Readable local text');
  assert.equal(opened.conversation.messages.at(-1).contextAllowed, false);
  assert.deepEqual(f.calls, { issue: 0, revoke: 0, provider: 0, snapshot: 0, read: 0 });
  for (const kind of ['setMode', 'cancel']) {
    const result = f.access[kind]({ conversationId: f.conversationId, mode: 'plan' });
    assert.equal(result.reason, 'scope-not-issued');
    assert.equal(result.transition.applied, true);
    assert.equal(result.conversation.contextEligibilityPending, true);
    assert.equal(f.calls.issue, 0);
    assert.equal(f.calls.provider, 0);
  }
  const applied = f.access.setScope({ conversationId: f.conversationId, focusSummary: false });
  assert.equal(applied.ok, true);
  assert.equal(applied.conversation.contextEligibilityPending, false);
  assert.equal(typeof applied.scopeGrantId, 'string');
});

test('ordinary requiresAuthorization does not block the existing fresh-grant path', () => {
  const f = fixture();
  assert.equal(f.opened.conversation.requiresAuthorization, true);
  assert.equal(typeof f.opened.scopeGrantId, 'string');
  assert.equal(f.begin().ok, true);
  assert.equal(f.sessions.revoke({ conversationId: f.conversationId }).ok, true);
  const reopened = f.access.open({ conversationId: f.conversationId });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.conversation.requiresAuthorization, true);
  assert.equal(reopened.localOnly, undefined);
  assert.equal(typeof reopened.scopeGrantId, 'string');
});

test('memory becoming ineligible between scope qualification and preview cannot publish a fresh grant', () => {
  for (const change of [item => { item.status = 'paused'; }, item => { item.contextAllowed = false; },
    item => { item.expiresAt = 1000; }]) {
    const records = [{ id: 'selected-memory', version: 1, validFrom: 0, expiresAt: null, contextAllowed: true,
      status: 'active', source: 'user-confirmed', kind: 'preference', subject: 'Synthetic subject',
      scope: 'personal', body: 'SYNTHETIC_PRIVATE_MEMORY' }];
    let snapshots = 0;
    const f = fixture({ memoryRecords: records, memorySnapshot() { if (++snapshots === 2) change(records[0]); } });
    const result = f.access.setScope({ conversationId: f.conversationId, memoryIds: ['selected-memory'] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'scope-not-issued');
    assert.equal(result.scopeGrantId, null);
    assert.equal(result.transition.applied, true);
    assert.equal(snapshots, 2);
    assert.equal(f.access.captureScopes().length, 0);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_MEMORY/);
    assert.equal(f.actualGrants.resolve({ scopeGrantId: f.opened.scopeGrantId, conversationId: f.conversationId,
      providerId: 'provider', authorizationGeneration: f.opened.conversation.authGeneration }).ok, false);
  }
});
