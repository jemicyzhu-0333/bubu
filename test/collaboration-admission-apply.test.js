'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationAuthorization } = require('../src/application/ai/collaboration-authorization');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');

function fixture() {
  let sequence = 0, clockAction = null, idAction = null, saveAction = null, saves = 0, mode = 'saved';
  const stored = new Map(), attempts = [], reconciles = [];
  const admission = createCollaborationAuthorization({ capturePrivacyTargets: () => sessions.capturePrivacyTargets(),
    captureScopes: () => [], captureRunOwners: () => [], clearGrants() {}, revokeSession: conversationId => sessions.revoke({ conversationId }) });
  const repository = { load: ({ conversationId }) => stored.has(conversationId)
    ? { ok: true, conversation: structuredClone(stored.get(conversationId)) } : { ok: false, reason: 'conversation-not-found' },
  pruneRetention: () => ({ ok: true }), delete: ({ conversationId }) => { stored.delete(conversationId); return { ok: true }; },
  saveSnapshot(request) {
    attempts.push(structuredClone(request)); saves += 1;
    if (saveAction) { const action = saveAction; saveAction = null; action(request); }
    if (mode === 'unknown') return { ok: false, durability: 'unknown', reason: 'conversation-save-unknown' };
    stored.set(request.snapshot.id, structuredClone(request.snapshot)); return { ok: true, revision: request.snapshot.revision };
  }, reconcileSave(request) { reconciles.push(structuredClone(request)); return { ok: false, reason: 'conversation-save-unknown' }; } };
  const sessions = createCollaborationSessions({ ownerId: 'owner-apply', admission, repository,
    now() { if (clockAction) { const action = clockAction; clockAction = null; action(); } return 1000; },
    idFactory(_index, kind) { if (idAction) { const action = idAction; idAction = null; action(kind); } return `${kind}-${++sequence}`; },
    schedule: () => 1, cancelSchedule() {} });
  const opened = sessions.start({ purpose: 'stuck' }), conversationId = opened.conversation.id;
  const get = () => sessions.get({ conversationId }).conversation;
  const begin = (ticket = admission.captureAdmission()) => sessions.beginTurn({ conversationId, message: 'Synthetic user',
    providerId: 'provider', authorizationGeneration: get().authGeneration, admissionTicket: ticket });
  const complete = (begun, ticket) => sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'Synthetic answer', admissionTicket: ticket });
  return { admission, sessions, repository, conversationId, get, begin, complete, attempts, reconciles,
    id: action => { idAction = action; }, clock: action => { clockAction = action; }, save: action => { saveAction = action; },
    saved: () => sessions.setRetention({ conversationId, mode: 'saved', pinned: true }),
    unknown: () => { mode = 'unknown'; }, saves: () => saves };
}

test('begin rejects a completed nested epoch at its canonical apply point', () => {
  const f = fixture(), before = f.get();
  f.id(() => f.admission.invalidate());
  assert.equal(f.begin().ok, false);
  assert.equal(f.get().messages.length, before.messages.length);
});

test('complete rejects a nested epoch during response identity preparation', () => {
  const f = fixture(), ticket = f.admission.captureAdmission(), begun = f.begin(ticket);
  f.id(() => f.admission.invalidate());
  assert.equal(f.complete(begun, ticket).ok, false);
  assert.equal(f.get().messages.length, 1);
});

test('precommit hold refuses begin but permits an existing complete when write fails', () => {
  const f = fixture(), ticket = f.admission.captureAdmission(), begun = f.begin(ticket); let completed;
  const result = f.admission.runCredential({ kind: 'import', commit() {
    assert.equal(f.begin(ticket).ok, false);
    completed = f.complete(begun, ticket);
    return false;
  }, readStatus: () => ({ configured: false }) });
  assert.equal(result.ok, false); assert.equal(completed.ok, true);
  assert.equal(f.admission.generation(), 0);
  assert.equal(f.get().messages.length, 2);
});

test('old abort listener can create a newer turn without outer begin overwriting it', () => {
  const f = fixture(), first = f.begin(); let newer;
  first.signal.addEventListener('abort', () => { newer = f.begin(); });
  const middle = f.begin();
  assert.equal(middle.ok, true); assert.equal(newer.ok, true);
  assert.equal(middle.signal.aborted, true); assert.equal(newer.signal.aborted, false);
  assert.equal(middle.acceptedMessageId, f.get().messages[1].id);
  assert.equal(f.complete(newer, f.admission.captureAdmission()).ok, true);
});

test('accepted user is acknowledged even when post-apply persistence retires privacy', () => {
  const f = fixture(); f.saved();
  f.save(() => f.admission.invalidate());
  const result = f.begin();
  assert.equal(result.ok, true); assert.equal(result.signal.aborted, true);
  assert.equal(result.acceptedMessageId, f.get().messages[0].id);
  assert.equal(f.get().messages.length, 1);
});

test('accepted assistant is acknowledged when its persistence invokes global retirement', () => {
  const f = fixture(); f.saved(); const ticket = f.admission.captureAdmission(), begun = f.begin(ticket);
  f.save(() => f.admission.invalidate());
  const result = f.complete(begun, ticket);
  assert.equal(result.ok, true); assert.equal(result.acceptedMessageId, f.get().messages[1].id);
  assert.equal(f.get().messages.length, 2);
});

test('detached accepted assistant reports identity and null current conversation', () => {
  const f = fixture(), ticket = f.admission.captureAdmission(), begun = f.begin(ticket);
  f.saved();
  f.save(request => { f.sessions.delete({ conversationId: f.conversationId, expectedRevision: request.snapshot.revision }); });
  const result = f.complete(begun, ticket);
  assert.equal(result.ok, true); assert.equal(result.conversation, null);
  assert.equal(typeof result.acceptedMessageId, 'string');
});

test('ambiguous save proof remains the same attempt across global privacy application', () => {
  const f = fixture(); f.saved(); f.unknown();
  const begun = f.begin(); assert.equal(begun.ok, true);
  const original = f.attempts.at(-1), count = f.saves();
  const result = f.admission.invalidate();
  assert.equal(result.authorizationWarning.unknownSaves, 1);
  assert.equal(result.authorizationWarning.pendingConversations, 0);
  assert.equal(f.saves(), count);
  assert.deepEqual(f.reconciles.at(-1).snapshot, original.snapshot);
  assert.equal(f.reconciles.at(-1).expectedRevision, original.expectedRevision);
});

test('rotation preparation cannot append or install a summary after nested retirement', () => {
  const f = fixture();
  for (let index = 0; index < 100; index++) {
    const ticket = f.admission.captureAdmission(); assert.equal(f.complete(f.begin(ticket), ticket).ok, true);
  }
  const count = f.get().messages.length;
  function duringSummary(kind) { if (kind === 'summary') f.admission.invalidate(); else f.id(duringSummary); }
  f.id(duringSummary);
  assert.equal(f.begin().ok, false);
  assert.equal(f.get().messages.length, count);
  assert.equal(f.get().summaries.length, 0);
});

test('clock throw before begin apply does not append an accepted message', () => {
  const f = fixture(), before = f.get().messages.length;
  f.id(() => f.clock(() => { throw new Error('synthetic-clock'); }));
  assert.throws(() => f.begin(), /synthetic-clock/);
  assert.equal(f.get().messages.length, before);
});

test('clock throw before complete apply leaves the pending token and transcript unchanged', () => {
  const f = fixture(), ticket = f.admission.captureAdmission(), begun = f.begin(ticket);
  f.id(() => f.clock(() => { throw new Error('synthetic-clock'); }));
  assert.throws(() => f.complete(begun, ticket), /synthetic-clock/);
  assert.equal(f.get().messages.length, 1); assert.equal(begun.signal.aborted, false);
});

test('local owner replacement during complete preparation fails its record witness without an epoch change', () => {
  const f = fixture(), ticket = f.admission.captureAdmission(), begun = f.begin(ticket); let replacement;
  f.id(() => { replacement = f.begin(); });
  assert.equal(f.complete(begun, ticket).ok, false);
  assert.equal(replacement.signal.aborted, false); assert.equal(f.admission.generation(), 0);
  assert.equal(f.get().messages.length, 2);
});
