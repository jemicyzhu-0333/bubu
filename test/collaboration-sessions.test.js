'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { validateConversationSnapshot } = require('../src/application/ai/conversation-record');
const { buildBoundedContext } = require('../src/application/ai/run-budget');
const { openCollaborationDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');

const OWNER = 'synthetic-profile-owner';
const PROVIDER = 'synthetic-provider-fingerprint';
const PROPOSAL = { id: 'draft-1', version: 1, kind: 'task-draft', body: '{"title":"Synthetic task","steps":[]}' };
const SOURCE = { kind: 'task', id: 'synthetic-task', revision: 'v1' };
let factoryIndex = 0;
function fixture(options = {}) {
  const factory = ++factoryIndex;
  let at = 1000;
  const sessions = createCollaborationSessions({ ownerId: OWNER, now: () => at,
    idFactory: (n, kind) => `${factory}-${kind}-${n}`, ...options });
  const conversationId = sessions.start().conversation.id;
  function turn(message = 'Synthetic input', proposal = null, sourceRefs = []) {
    const authorizationGeneration = sessions.get({ conversationId }).conversation.authGeneration;
    const begun = sessions.beginTurn({ conversationId, message, providerId: PROVIDER, authorizationGeneration, sourceRefs });
    assert.equal(begun.ok, true, begun.reason);
    const completed = sessions.completeTurn({ token: begun.token, providerId: PROVIDER, content: 'Synthetic answer?', proposal });
    assert.equal(completed.ok, true, completed.reason);
    return completed;
  }
  return { sessions, conversationId, turn, setTime: value => { at = value; } };
}
function database() {
  const store = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  assert.equal(store.status, 'available');
  return store;
}

test('seventh and thirty-first turns continue; notice is offered once with an actionable draft', () => {
  const f = fixture();
  for (let i = 0; i < 30; i += 1) assert.equal(f.turn().notice, null);
  const thirtyFirst = f.turn('Continue comparing', PROPOSAL);
  assert.equal(thirtyFirst.notice, 'summary-available');
  assert.equal(thirtyFirst.conversation.messages.length, 62);
  assert.equal(f.turn().notice, null);
  assert.deepEqual(thirtyFirst.conversation.messages.at(-1).proposal, PROPOSAL);
});

test('101st turn segments and derives attributed excerpts without losing or saving canonical history', () => {
  let writes = 0;
  const f = fixture({ repository: { load: () => ({ ok: false }), saveSnapshot: () => { writes += 1; } } });
  for (let i = 0; i < 101; i += 1) f.turn(`Synthetic turn ${i}`, i === 0 ? PROPOSAL : null);
  const value = f.sessions.get({ conversationId: f.conversationId }).conversation;
  assert.equal(value.messages.length, 202);
  assert.equal(value.segment.index, 1);
  assert.equal(value.segment.turns, 1);
  assert.equal(value.summaries.length, 1);
  assert.deepEqual(value.summaries[0].coveredMessageIds, value.messages.slice(0, 200).map(message => message.id));
  assert.equal(value.summaries[0].throughMessageId, value.messages[199].id);
  assert.equal(value.saveState, 'ephemeral');
  assert.equal(writes, 0);
});

test('Unicode input is counted as code points with no silent truncation and byte segmentation is bounded', () => {
  const f = fixture();
  const tooLong = f.sessions.beginTurn({ conversationId: f.conversationId, message: '😀'.repeat(8001), providerId: PROVIDER, authorizationGeneration: 0 });
  assert.equal(tooLong.reason, 'message-too-long');
  for (let i = 0; i < 20; i += 1) f.turn('😀'.repeat(8000));
  const value = f.sessions.get({ conversationId: f.conversationId }).conversation;
  assert.equal([...value.messages[0].content].length, 8000);
  assert.equal(value.segment.index > 0, true);
  assert.equal(value.segment.bytes <= 512 * 1024, true);
  assert.equal(value.messages.length, 40);
});

test('explicit save writes the whole current transcript and resume restores exact identity, proposals and draft', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.turn('Original user text', PROPOSAL);
  assert.equal(db.repository.listPage({ ownerId: OWNER }).items.length, 0);
  const saved = f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved', inputDraft: 'unfinished input', selectedProposalId: PROPOSAL.id });
  assert.equal(saved.ok, true);
  assert.equal(saved.conversation.recoverable, true);
  const expected = saved.conversation;
  const restarted = fixture({ repository: db.repository }).sessions;
  const restored = restarted.get({ conversationId: f.conversationId }).conversation;
  assert.deepEqual(restored.messages, expected.messages);
  assert.equal(restored.revision, expected.revision);
  assert.equal(restored.inputDraft, 'unfinished input');
  assert.equal(restored.selectedProposalId, PROPOSAL.id);
  assert.equal(restored.requiresAuthorization, true);
  assert.equal(restarted.beginTurn({ conversationId: f.conversationId, message: 'next', providerId: PROVIDER, authorizationGeneration: 0 }).reason, 'conversation-authorization-required');
  assert.equal(restarted.beginTurn({ conversationId: f.conversationId, message: 'next', providerId: PROVIDER, authorizationGeneration: restored.authGeneration }).ok, true);
  db.close();
});

test('save failure leaves full history in memory visibly unsaved and retry persists it', () => {
  const db = database();
  let fail = true;
  const f = fixture({ repository: { ...db.repository, saveSnapshot: request => fail ? { ok: false, reason: 'synthetic-disk-full' } : db.repository.saveSnapshot(request) } });
  f.turn('Retain me', PROPOSAL);
  const failed = f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  assert.equal(failed.ok, false);
  assert.equal(failed.conversation.saveState, 'unsaved');
  assert.equal(failed.conversation.recoverable, false);
  assert.equal(failed.conversation.messages.length, 2);
  assert.equal(db.repository.listPage({ ownerId: OWNER }).items.length, 0);
  fail = false;
  const saved = f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  assert.equal(saved.ok, true);
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation.messages.length, 2);
  db.close();
});

test('saved segmentation waits for failed pending snapshot, preserving current segment and history', () => {
  const db = database();
  let fail = false;
  const f = fixture({ repository: { ...db.repository, saveSnapshot: request => fail ? { ok: false, reason: 'synthetic-disk-full' } : db.repository.saveSnapshot(request) } });
  assert.equal(f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' }).ok, true);
  for (let i = 0; i < 99; i += 1) f.turn();
  fail = true;
  f.turn();
  const stopped = f.sessions.beginTurn({ conversationId: f.conversationId, message: '101st input', providerId: PROVIDER, authorizationGeneration: 0 });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.conversation.messages.length, 200);
  assert.equal(stopped.conversation.segment.index, 0);
  fail = false;
  assert.equal(f.turn().conversation.segment.index, 1);
  db.close();
});

test('cancel, superseding input, pause and changed provider reject late replies', () => {
  const f = fixture();
  function begin(message) {
    return f.sessions.beginTurn({ conversationId: f.conversationId, message, providerId: PROVIDER,
      authorizationGeneration: f.sessions.get({ conversationId: f.conversationId }).conversation.authGeneration });
  }
  const old = begin('first');
  const latest = begin('second');
  assert.equal(old.signal.aborted, true);
  assert.equal(f.sessions.completeTurn({ token: old.token, providerId: PROVIDER, content: 'late' }).reason, 'conversation-turn-stale');
  f.sessions.cancel({ conversationId: f.conversationId });
  assert.equal(latest.signal.aborted, true);
  assert.equal(f.sessions.completeTurn({ token: latest.token, providerId: PROVIDER, content: 'late' }).ok, false);
  const paused = begin('third');
  f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'keep my draft' });
  assert.equal(paused.signal.aborted, true);
  assert.equal(f.sessions.get({ conversationId: f.conversationId }).conversation.inputDraft, 'keep my draft');
  const changed = begin('fourth');
  assert.equal(f.sessions.completeTurn({ token: changed.token, providerId: 'another-provider', content: 'wrong endpoint' }).reason, 'provider-changed');
  assert.equal(changed.signal.aborted, true);
  assert.equal(f.sessions.get({ conversationId: f.conversationId }).conversation.messages.every(message => message.role === 'user'), true);
});

test('revocation excludes source-dependent assistant history and derived summaries, but preserves readable history', () => {
  const f = fixture();
  for (let i = 0; i < 101; i += 1) f.turn('A message', i === 0 ? PROPOSAL : null, [SOURCE]);
  const revoked = f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [SOURCE] }).conversation;
  assert.equal(revoked.messages.length, 202);
  assert.equal(revoked.messages.filter(message => message.role === 'assistant').every(message => !message.contextAllowed), true);
  assert.equal(revoked.summaries[0].contextAllowed, false);
  const bounded = buildBoundedContext({ messages: revoked.messages });
  assert.equal(bounded.context.messages.every(message => message.role === 'user'), true);
  assert.equal(bounded.context.messages.at(-1).content, 'A message');
});

test('pause/dispose aborts but never deletes saved sessions; idle time has no destructive TTL', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.turn();
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const active = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'In flight', providerId: PROVIDER, authorizationGeneration: 0 });
  f.setTime(1000 + 16 * 60 * 1000);
  assert.equal(f.sessions.get({ conversationId: f.conversationId }).ok, true);
  assert.equal(f.sessions.dispose().ok, true);
  assert.equal(active.signal.aborted, true);
  const stored = db.repository.load({ ownerId: OWNER, conversationId: f.conversationId });
  assert.equal(stored.ok, true);
  assert.equal(stored.conversation.status, 'paused');
  assert.equal(stored.conversation.messages.length, 3);
  db.close();
});

test('bounded cache evicts only durable snapshots and never deletes authority or loses unsaved messages', () => {
  const db = database();
  const f = fixture({ repository: db.repository, maxCached: 1 });
  f.turn();
  assert.equal(f.sessions.start().reason, 'conversation-cache-full');
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const other = f.sessions.start();
  assert.equal(other.ok, true);
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).ok, true);
  f.sessions.delete({ conversationId: other.conversation.id });
  assert.equal(f.sessions.get({ conversationId: f.conversationId }).conversation.messages.length, 2);
  f.sessions.delete({ conversationId: f.conversationId });
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).reason, 'conversation-not-found');
  db.close();
});

test('closed snapshot validator rejects unknown state and malformed proposal references', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.turn('hello', PROPOSAL);
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const snapshot = db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation;
  assert.equal(validateConversationSnapshot(snapshot), true);
  assert.equal(validateConversationSnapshot({ ...snapshot, execute: 'tasks:add' }), false);
  const malformed = JSON.parse(JSON.stringify(snapshot));
  malformed.messages[1].proposal.confirmed = true;
  assert.equal(validateConversationSnapshot(malformed), false);
  db.close();
});

test('mode switches preserve draft, scroll and history, abort generation, and persist saved snapshot', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.turn('first', PROPOSAL);
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'unfinished', selectedProposalId: PROPOSAL.id, scrollTop: 432.5 });
  const before = f.sessions.get({ conversationId: f.conversationId }).conversation;
  const changed = f.sessions.setMode({ conversationId: f.conversationId, mode: 'plan' });
  assert.equal(changed.conversation.mode, 'plan');
  assert.deepEqual(changed.conversation.messages, before.messages);
  assert.equal(changed.conversation.inputDraft, 'unfinished');
  assert.equal(changed.conversation.scrollTop, 432.5);
  assert.equal(changed.conversation.selectedProposalId, PROPOSAL.id);
  assert.equal(changed.conversation.recoverable, true);
  const active = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'plan this', providerId: PROVIDER, authorizationGeneration: changed.conversation.authGeneration });
  assert.equal(f.sessions.setMode({ conversationId: f.conversationId, mode: 'small-step' }).ok, true);
  assert.equal(active.signal.aborted, true);
  assert.equal(f.sessions.completeTurn({ token: active.token, providerId: PROVIDER, content: 'late plan' }).ok, false);
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation.mode, 'small-step');
  assert.equal(f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'invalid-change', scrollTop: Infinity }).ok, false);
  assert.notEqual(f.sessions.get({ conversationId: f.conversationId }).conversation.inputDraft, 'invalid-change');
  db.close();
});

test('failed-to-save revocation cannot replay source-dependent prior content after restart', () => {
  const db = database();
  let failing = false;
  const repository = { ...db.repository, saveSnapshot: request => failing ? { ok: false, reason: 'synthetic-full-disk' } : db.repository.saveSnapshot(request) };
  const f = fixture({ repository });
  f.turn('first', PROPOSAL, [SOURCE]);
  f.turn('follow up using the authorized prior source', null, [SOURCE]);
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  failing = true;
  const revoked = f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [SOURCE] }).conversation;
  assert.equal(revoked.saveState, 'unsaved');
  assert.equal(revoked.messages.filter(message => message.role === 'assistant').every(message => !message.contextAllowed), true);
  const original = db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation;
  assert.equal(original.messages[1].contextAllowed, true);
  const restarted = fixture({ repository: db.repository }).sessions;
  const restored = restarted.get({ conversationId: f.conversationId }).conversation;
  assert.equal(restored.messages.length, 4);
  assert.equal(restored.messages[1].content, original.messages[1].content);
  assert.equal(restored.messages.filter(message => message.role === 'assistant').every(message => !message.contextAllowed), true);
  assert.equal(restored.requiresAuthorization, true);
  assert.equal(buildBoundedContext({ messages: restored.messages }).context.messages.every(message => message.role === 'user'), true);
  db.close();
});

test('revocation saves valid byte accounting and excludes transitively dependent later assistant replies', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.turn('first', PROPOSAL, [SOURCE]);
  f.turn('second using the same source', null, [SOURCE]);
  f.turn('third using the same source', null, [SOURCE]);
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const revoked = f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [SOURCE] });
  assert.equal(revoked.conversation.recoverable, true);
  assert.equal(revoked.conversation.messages.filter(message => message.role === 'assistant').every(message => !message.contextAllowed), true);
  assert.equal(validateConversationSnapshot(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation), true);
  db.close();
});

test('catalog combines local and durable sessions in bounded pages without leaking full transcripts', () => {
  const db = database();
  const f = fixture({ repository: db.repository, maxCached: 3 });
  f.turn('private local transcript');
  for (let i = 0; i < 5; i += 1) {
    const other = fixture({ repository: db.repository });
    other.sessions.setRetention({ conversationId: other.conversationId, mode: 'saved' });
  }
  const ids = [];
  let cursor = null;
  do {
    const page = f.sessions.list({ limit: 2, cursor });
    assert.equal(page.ok, true);
    assert.equal(page.items.length <= 2, true);
    assert.equal(page.items.every(item => !Object.hasOwn(item, 'messages')), true);
    ids.push(...page.items.map(item => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.equal(f.sessions.list({ cursor: 'arbitrary' }).ok, false);
  db.close();
});

test('assistant provenance persists as inert origin metadata and rejects a forged provider identity', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  const begun = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'hello', providerId: PROVIDER, authorizationGeneration: 0 });
  assert.equal(f.sessions.completeTurn({ token: begun.token, providerId: PROVIDER, content: 'answer',
    provenance: { source: 'provider', providerId: 'wrong-provider', reason: null } }).ok, false);
  assert.equal(f.sessions.completeTurn({ token: begun.token, providerId: PROVIDER, content: 'answer', proposal: PROPOSAL,
    provenance: { source: 'provider', providerId: PROVIDER, reason: null } }).ok, true);
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const stored = db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation;
  assert.deepEqual(stored.messages[1].provenance, { source: 'provider', providerId: PROVIDER, reason: null });
  assert.equal(stored.messages[0].provenance, null);
  assert.equal(Object.hasOwn(stored.messages[1].provenance, 'confirmed'), false);
  const restored = fixture({ repository: db.repository }).sessions.get({ conversationId: f.conversationId }).conversation;
  assert.deepEqual(restored.messages[1].provenance, stored.messages[1].provenance);
  db.close();
});

test('catalog derives a bounded Unicode title and related target for resumable session discovery', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  const opened = f.sessions.start({ purpose: 'stuck', relatedEntity: { kind: 'task', id: 'synthetic-target', version: 'v1' } });
  const conversationId = opened.conversation.id;
  const message = `   ${'😀'.repeat(80)}\nfollow up`;
  f.sessions.beginTurn({ conversationId, message, providerId: PROVIDER, authorizationGeneration: 0 });
  const local = f.sessions.list().items.find(item => item.id === conversationId);
  assert.equal([...local.displayTitle].length, 60);
  assert.deepEqual(local.relatedEntity, { kind: 'task', id: 'synthetic-target', version: 'v1' });
  f.sessions.setRetention({ conversationId, mode: 'saved' });
  const persisted = db.repository.listPage({ ownerId: OWNER }).items.find(item => item.id === conversationId);
  assert.equal(persisted.displayTitle, local.displayTitle);
  assert.equal(Object.hasOwn(persisted, 'messages'), false);
  db.close();
});

test('continuing from a selected older proposal retains selection and rejects an invalid reference atomically', () => {
  const f = fixture();
  f.turn('first', PROPOSAL);
  f.turn('second', { ...PROPOSAL, id: 'draft-2', version: 2 });
  const before = f.sessions.get({ conversationId: f.conversationId }).conversation;
  const invalid = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'discuss missing', providerId: PROVIDER,
    authorizationGeneration: before.authGeneration, selectedProposalId: 'missing-draft' });
  assert.equal(invalid.reason, 'conversation-draft-invalid');
  assert.deepEqual(f.sessions.get({ conversationId: f.conversationId }).conversation, before);
  const chosen = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'return to first', providerId: PROVIDER,
    authorizationGeneration: before.authGeneration, selectedProposalId: PROPOSAL.id });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.conversation.selectedProposalId, PROPOSAL.id);
  assert.equal(chosen.conversation.messages.length, before.messages.length + 1);
});

test('oversized unsent draft survives saved pause and restart without relaxing the message send limit', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const draft = '😀'.repeat(8001);
  assert.equal(f.sessions.beginTurn({ conversationId: f.conversationId, message: draft, providerId: PROVIDER, authorizationGeneration: 0 }).reason, 'message-too-long');
  const paused = f.sessions.pause({ conversationId: f.conversationId, inputDraft: draft });
  assert.equal(paused.conversation.recoverable, true);
  const restarted = fixture({ repository: db.repository }).sessions;
  assert.equal(restarted.get({ conversationId: f.conversationId }).conversation.inputDraft, draft);
  const tooLarge = restarted.pause({ conversationId: f.conversationId, inputDraft: '界'.repeat(64001) });
  assert.equal(tooLarge.reason, 'conversation-draft-invalid');
  assert.equal(restarted.get({ conversationId: f.conversationId }).conversation.inputDraft, draft);
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation.inputDraft, draft);
  db.close();
});

test('delete confirmation binds the exact canonical revision and stale confirmation does not abort or delete', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  const saved = f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' }).conversation;
  const active = f.sessions.beginTurn({ conversationId: f.conversationId, message: 'newer work', providerId: PROVIDER, authorizationGeneration: saved.authGeneration });
  const before = db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation;
  assert.equal(f.sessions.delete({ conversationId: f.conversationId, expectedRevision: saved.revision }).reason, 'conversation-delete-conflict');
  assert.equal(active.signal.aborted, false);
  assert.deepEqual(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).conversation, before);
  assert.equal(f.sessions.delete({ conversationId: f.conversationId, expectedRevision: active.conversation.revision }).ok, true);
  assert.equal(active.signal.aborted, true);
  assert.equal(db.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).ok, false);
  f.sessions.dispose(); db.close();
});

function validStoredProjection(value) {
  const { authGeneration, requiresAuthorization, contextEligibilityPending, savedRevision, recoverable, saveState, saveError, ...record } = value;
  return validateConversationSnapshot(record);
}

test('message identity retries reuse one unanswered user and fence every old attempt', () => {
  const f = fixture();
  const request = { conversationId: f.conversationId, messageId: 'client-message-synthetic', message: 'same text', providerId: PROVIDER, authorizationGeneration: 0 };
  const first = f.sessions.beginTurn(request);
  assert.equal(first.ok, true);
  assert.equal(f.sessions.beginTurn(request).reason, 'conversation-turn-active');
  f.sessions.cancel({ conversationId: f.conversationId });
  const next = f.sessions.beginTurn({ ...request, authorizationGeneration: f.sessions.get(request).conversation.authGeneration });
  assert.equal(next.ok, true);
  assert.equal(next.acceptedMessageId, first.acceptedMessageId);
  assert.notEqual(next.token.attemptId, first.token.attemptId);
  assert.equal(next.conversation.messages.length, 1);
  assert.equal(next.conversation.segment.turns, 1);
  assert.equal(validStoredProjection(next.conversation), true);
  assert.equal(f.sessions.completeTurn({ token: first.token, providerId: PROVIDER, content: 'late' }).reason, 'conversation-turn-stale');
  const complete = f.sessions.completeTurn({ token: next.token, providerId: PROVIDER, content: 'answer' });
  assert.equal(complete.ok, true);
  assert.equal(validStoredProjection(complete.conversation), true);
  const replay = f.sessions.beginTurn({ ...request, authorizationGeneration: next.conversation.authGeneration });
  assert.equal(replay.replayed, true);
  assert.equal(replay.conversation.messages.length, 2);
  assert.equal(replay.conversation.revision, complete.conversation.revision);
});

test('same text with different message identities creates distinct turns; ID conflicts do not write', () => {
  const f = fixture();
  const request = { conversationId: f.conversationId, message: 'same text', providerId: PROVIDER, authorizationGeneration: 0 };
  const first = f.sessions.beginTurn({ ...request, messageId: 'client-first' });
  f.sessions.completeTurn({ token: first.token, providerId: PROVIDER, content: 'answer' });
  const second = f.sessions.beginTurn({ ...request, messageId: 'client-second' });
  assert.equal(second.conversation.messages.length, 3);
  const revision = second.conversation.revision;
  for (const invalid of [{ messageId: 'client-first', message: 'changed' }, { messageId: '' }, { messageId: 'x'.repeat(201) }]) {
    assert.equal(f.sessions.beginTurn({ ...request, ...invalid }).ok, false);
    assert.equal(f.sessions.get(request).conversation.revision, revision);
  }
  const other = f.sessions.start().conversation;
  const conflict = f.sessions.beginTurn({ ...request, conversationId: other.id, messageId: 'client-first' });
  assert.equal(conflict.reason, 'conversation-message-conflict');
  assert.equal(Object.hasOwn(conflict, 'conversation'), false);
  assert.equal(f.sessions.get({ conversationId: other.id }).conversation.messages.length, 0);
});

test('an older unanswered message cannot be retried behind a newer user message', () => {
  const f = fixture();
  const request = { conversationId: f.conversationId, message: 'same text', providerId: PROVIDER, authorizationGeneration: 0 };
  f.sessions.beginTurn({ ...request, messageId: 'client-first' });
  f.sessions.beginTurn({ ...request, messageId: 'client-second' });
  f.sessions.cancel(request);
  const retried = f.sessions.beginTurn({ ...request, messageId: 'client-first', authorizationGeneration: f.sessions.get(request).conversation.authGeneration });
  assert.equal(retried.reason, 'conversation-retry-stale');
  assert.equal(retried.conversation.messages.length, 2);
});

test('saved unanswered message keeps its ID across restart and retry does not erase saved draft', () => {
  const db = database();
  const f = fixture({ repository: db.repository });
  const request = { conversationId: f.conversationId, messageId: 'client-restart', message: 'retained message', providerId: PROVIDER, authorizationGeneration: 0 };
  f.sessions.beginTurn(request);
  f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'next unsent draft' });
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const restarted = fixture({ repository: db.repository }).sessions;
  const loaded = restarted.get(request).conversation;
  const retried = restarted.beginTurn({ ...request, authorizationGeneration: loaded.authGeneration });
  assert.equal(retried.ok, true);
  assert.equal(retried.conversation.messages.length, 1);
  assert.equal(retried.conversation.messages[0].id, request.messageId);
  assert.equal(retried.conversation.inputDraft, 'next unsent draft');
  assert.equal(validStoredProjection(retried.conversation), true);
  db.close();
});

test('ambiguous saved commit is not replayed or labeled saved by message identity retry', () => {
  let writes = 0;
  const f = fixture({ repository: { load: () => ({ ok: false }), pruneRetention: () => ({ ok: true }),
    saveSnapshot: () => { writes++; return { ok: false, durability: 'unknown' }; },
    reconcileSave: () => ({ ok: false, durability: 'unknown' }) } });
  f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved' });
  const request = { conversationId: f.conversationId, messageId: 'client-ambiguous', message: 'text', providerId: PROVIDER, authorizationGeneration: 0 };
  const begun = f.sessions.beginTurn(request);
  assert.equal(begun.ok, true);
  const done = f.sessions.completeTurn({ token: begun.token, providerId: PROVIDER, content: 'answer' });
  assert.equal(done.conversation.saveState, 'unsaved');
  const replay = f.sessions.beginTurn(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.conversation.saveState, 'unsaved');
  assert.equal(replay.conversation.messages.length, 2);
  assert.equal(writes, 1);
});
