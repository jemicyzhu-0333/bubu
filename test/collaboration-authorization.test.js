'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationAuthorization } = require('../src/application/ai/collaboration-authorization');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createConversationAccess } = require('../src/application/ai/conversation-access');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { createMemoryRecall } = require('../src/application/ai/memory-recall');

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const answer = () => ({ type: 'answer', answer: 'Synthetic answer', readRequest: null, changeProposal: null });
function fixture(options = {}) {
  let sequence = 0, clockReads = 0, clockHook = null, saveHook = null, timerHook = null, snapshotHook = null, idHook = null;
  const timers = new Map(), stored = new Map(), events = [], saves = [];
  const calls = { complete: 0, cancel: 0, revoke: 0, completeResults: [] };
  const now = () => { clockReads += 1; if (clockHook) { const hook = clockHook; clockHook = null; hook(); } return 1791417600000; };
  const schedule = callback => { const id = ++sequence; timers.set(id, callback); if (timerHook) { const hook = timerHook; timerHook = null; hook(); } return id; };
  const repository = { load: ({ conversationId }) => stored.has(conversationId)
    ? { ok: true, conversation: structuredClone(stored.get(conversationId)) } : { ok: false, reason: 'conversation-not-found' },
  pruneRetention: () => ({ ok: true }), delete: ({ conversationId }) => { stored.delete(conversationId); return { ok: true }; },
  saveSnapshot(request) {
    saves.push(structuredClone(request));
    stored.set(request.snapshot.id, structuredClone(request.snapshot));
    if (saveHook) { const hook = saveHook; saveHook = null; hook(request); }
    return { ok: true, revision: request.snapshot.revision };
  } };
  const admission = createCollaborationAuthorization({
    capturePrivacyTargets: () => sessions.capturePrivacyTargets().map(target => ({ ...target,
      revoke() { calls.revoke += 1; return target.revoke(); } })), captureScopes: () => access.captureScopes(),
    captureRunOwners: () => turns.captureRunOwners().map(run => ({ ...run,
      markInvalidated(reason) { run.markInvalidated(reason); events.push(`mark:${run.conversationId}`); },
      closeExecution() { events.push(`owner.close:${run.conversationId}`); return run.closeExecution(); } })),
    clearGrants: () => { events.push('clear'); grants.clear(); },
    revokeSession: conversationId => { events.push('lookup'); calls.revoke += 1; return sessions.revoke({ conversationId }); },
    invalidateProposals: () => events.push('proposals'), invalidateRequests: () => events.push('requests')
  });
  const sessions = createCollaborationSessions({ ownerId: 'owner-global', admission, repository, now,
    idFactory(_index, kind) { if (idHook) { const hook = idHook; idHook = null; hook(kind); } return `${kind}-${++sequence}`; },
    maxCached: 20, schedule, cancelSchedule: id => timers.delete(id) });
  const grants = createContextGrants({ ownerId: 'owner-global', admission, now,
    idFactory(kind) { events.push('grant.id'); return `${kind}-${++sequence}`; } });
  const readSnapshot = () => { if (snapshotHook) { const hook = snapshotHook; snapshotHook = null; hook(); }
    return { tasks: [], settings: { aiMemoryEnabled: Boolean(options.contextReader) } }; };
  const memoryRecall = createMemoryRecall({ contextReader: options.contextReader });
  const reads = createContextReads({ grants, readSnapshot, now, memoryRecall });
  const provider = { enabled: true, configured: true, purposeAllowed: true, fingerprint: 'provider', model: 'synthetic', endpoint: 'synthetic',
    client: { run(_name, _payload, controls) { controls.beforeRequest(); return options.reply ? options.reply(controls) : answer(); } } };
  const turnSessions = { ...sessions,
    completeTurn(request) { calls.complete += 1; const result = sessions.completeTurn(request); calls.completeResults.push(result); return result; },
    cancel(request) { calls.cancel += 1; return sessions.cancel(request); },
    revoke(request) { calls.revoke += 1; return sessions.revoke(request); } };
  const turns = createCollaborationTurns({ sessions: turnSessions, grants, reads, admission, now, getProvider: () => provider,
    schedule, cancelSchedule(id) { events.push('close'); options.onClose?.(); timers.delete(id); } });
  const access = createConversationAccess({ sessions, grants, reads, admission, now, getProvider: () => provider, readSnapshot, memoryRecall });
  function open() { const result = access.start({ purpose: 'stuck', mode: 'talk' }); assert.equal(result.ok, true); return result; }
  const run = opened => turns.run({ conversationId: opened.conversation.id, scopeGrantId: opened.scopeGrantId, message: 'Synthetic user' });
  return { admission, sessions, grants, reads, turns, access, events, saves, timers, open, run, provider, repository, calls,
    clock: hook => { clockHook = hook; }, save: hook => { saveHook = hook; }, schedule: hook => { timerHook = hook; },
    snapshot: hook => { snapshotHook = hook; }, id: hook => { idHook = hook; }, clocks: () => clockReads };
}

test('cached, scoped and running targets revoke once with one native membership clear', async () => {
  const entered = deferred(), late = deferred();
  const f = fixture({ reply() { entered.resolve(); return late.promise; } });
  const opened = f.open(), pending = f.run(opened); await entered.promise;
  const before = f.sessions.get({ conversationId: opened.conversation.id }).conversation;
  const result = f.admission.invalidate('credentials-changed');
  assert.deepEqual(result, { ok: true, canceled: 1, conversationIds: [opened.conversation.id], transitionReport: { attemptedConversationIds: [opened.conversation.id], appliedConversationIds: [opened.conversation.id], pendingConversationIds: [] } });
  assert.equal(f.events.filter(value => value === 'clear').length, 1);
  assert.equal(f.events.includes('lookup'), false);
  const after = f.sessions.get({ conversationId: opened.conversation.id }).conversation;
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.authGeneration, before.authGeneration + 1);
  assert.equal((await pending).ok, false); late.resolve(answer());
  assert.equal(f.turns.captureRunOwners().length, 0);
});

test('all captured run owners are marked before first disposal callback', async () => {
  const entered = [deferred(), deferred()], late = deferred(); let index = 0, f, callbacks = [], inspected = false, refused = false;
  f = fixture({ reply(controls) { callbacks.push(controls); entered[index++].resolve(); return late.promise; },
    onClose() { if (inspected) return; inspected = true; try { callbacks[1].beforeRequest(); } catch (_) { refused = true; } } });
  const first = f.open(), second = f.open(), a = f.run(first), b = f.run(second);
  await Promise.all(entered.map(item => item.promise));
  const result = f.admission.invalidate();
  assert.equal(result.canceled, 2);
  assert.equal(inspected, true); assert.equal(refused, true);
  assert.equal(result.authorizationWarning, undefined);
  const firstClose = f.events.findIndex(value => value.startsWith('owner.close:'));
  assert.equal(f.events.slice(0, firstClose).filter(value => value.startsWith('mark:')).length, 2);
  assert.equal((await a).ok, false); assert.equal((await b).ok, false);
  assert.equal(f.events.filter(value => value === 'clear').length, 1);
  late.resolve(answer());
});

test('accepted history remains a privacy target without a pending cancellation count', async () => {
  const f = fixture(), opened = f.open();
  assert.equal((await f.run(opened)).ok, true);
  const result = f.admission.invalidate();
  assert.equal(result.canceled, 0);
  assert.deepEqual(result.conversationIds, [opened.conversation.id]);
});

test('canonical completion survives global transition inside its persistence callback', async () => {
  const f = fixture(), opened = f.open();
  f.sessions.setRetention({ conversationId: opened.conversation.id, mode: 'saved', pinned: true });
  let result; const roles = [];
  f.save(request => {
    // First save accepts the user; arm the assistant save callback.
    roles.push(request.snapshot.messages.at(-1).role);
    f.save(next => { roles.push(next.snapshot.messages.at(-1).role); result = f.admission.invalidate(); });
  });
  const completed = await f.run(opened);
  assert.equal(completed.ok, true);
  assert.deepEqual(roles, ['user', 'assistant']);
  assert.equal(result.canceled, 0);
  assert.equal(f.calls.complete, 1); assert.equal(f.calls.cancel, 0); assert.equal(f.calls.revoke, 1);
  assert.equal(f.calls.completeResults[0].ok, true);
  const final = f.sessions.get({ conversationId: opened.conversation.id }).conversation;
  assert.ok(final.messages.at(-1).sourceRefs.length > 0);
  assert.equal(final.messages.at(-1).contextAllowed, false);
  assert.equal(completed.conversation.messages.filter(item => item.role === 'assistant').length, 1);
  assert.equal(completed.acceptedMessageId, completed.conversation.messages.at(-1).id);
  assert.equal(f.events.filter(value => value === 'clear').length, 1);
});

test('setup-phase global retirement closes the later-returning execution before provider effects', async () => {
  let sent = 0, invalidation;
  const f = fixture({ reply() { sent += 1; return answer(); } }), opened = f.open();
  f.schedule(() => { invalidation = f.admission.invalidate(); });
  const result = await f.run(opened);
  assert.equal(result.ok, false); assert.equal(sent, 0);
  assert.equal(invalidation.canceled, 1);
  assert.equal(invalidation.authorizationWarning.unconfirmedClosures, 1);
  assert.equal(f.timers.size, 0);
});

test('captured privacy marker precedes a failing transition clock and blocks fresh scope', () => {
  const f = fixture(), opened = f.open();
  f.clock(() => { throw new Error('synthetic-clock'); });
  const result = f.admission.invalidate();
  assert.equal(result.authorizationWarning.pendingConversations, 1);
  const local = f.access.open({ conversationId: opened.conversation.id });
  assert.equal(local.localOnly, true); assert.equal(local.scopeGrantId, null);
  assert.equal(local.conversation.contextEligibilityPending, true);
  assert.equal(f.access.setScope({ conversationId: opened.conversation.id }).ok, true);
});

test('grant clock reentrancy cannot issue against a completed newer epoch', () => {
  const f = fixture(), opened = f.open(), ticket = f.admission.captureAdmission();
  const identities = f.events.filter(value => value === 'grant.id').length;
  f.clock(() => f.admission.invalidate());
  const issued = f.grants.issue({ conversationId: opened.conversation.id, purpose: 'stuck', providerId: 'provider',
    authorizationGeneration: 0, admissionTicket: ticket, selection: { tools: [], fromDay: '2026-10-08', toDay: '2026-10-08' } });
  assert.equal(issued.ok, false);
  assert.equal(f.events.filter(value => value === 'grant.id').length, identities);
});

test('start retains its original ticket across session clock and ID callbacks', () => {
  for (const boundary of ['clock', 'id']) {
    const f = fixture(); f[boundary](() => f.admission.invalidate());
    const result = f.access.start({ purpose: 'stuck', mode: 'talk' });
    assert.equal(result.ok, true); assert.equal(result.localOnly, true); assert.equal(result.scopeGrantId, null);
    assert.equal(f.events.filter(value => value === 'grant.id').length, 0);
    assert.equal(f.access.captureScopes().length, 0);
  }
});

test('open does not recapture a fresh admission after nested session lookup retirement', () => {
  const f = fixture(), opened = f.open(), identities = f.events.filter(value => value === 'grant.id').length;
  f.clock(() => f.admission.invalidate());
  const result = f.access.open({ conversationId: opened.conversation.id });
  assert.equal(result.localOnly, true); assert.equal(result.scopeGrantId, null);
  assert.equal(f.events.filter(value => value === 'grant.id').length, identities);
});

test('scope source preparation cannot publish a grant after nested global invalidation', () => {
  for (const boundary of ['snapshot', 'clock']) {
    const f = fixture(), opened = f.open(), before = f.sessions.get({ conversationId: opened.conversation.id }).conversation.revision;
    const identities = f.events.filter(value => value === 'grant.id').length;
    const clockReads = f.clocks();
    f[boundary](() => f.admission.invalidate());
    const result = f.access.setScope({ conversationId: opened.conversation.id });
    if (boundary === 'clock') assert.equal(f.clocks() - clockReads, 3); // owned's two clocks and one privacy timestamp; no later parse clock.
    assert.equal(result.scopeGrantId === null || result.ok === false, true);
    assert.equal(f.events.filter(value => value === 'grant.id').length, identities);
    assert.equal(f.sessions.get({ conversationId: opened.conversation.id }).conversation.revision, before + (boundary === 'clock' ? 1 : 2));
  }
});

test('repeated global transitions are fresh privacy applies, not hidden retry receipts', () => {
  const f = fixture(), opened = f.open();
  const first = f.admission.invalidate(), second = f.admission.invalidate();
  assert.equal(first.canceled, 0); assert.equal(second.canceled, 0);
  assert.equal(f.admission.generation(), 2);
  assert.deepEqual(first.conversationIds, [opened.conversation.id]);
  assert.equal(f.events.filter(value => value === 'clear').length, 2);
});

test('scope memory snapshot retirement wins over successful and throwing callbacks with no later source access', () => {
  for (const throws of [false, true]) {
    let f, calls = 0, receiver, observed;
    const contextReader = { readContextSnapshot(request) {
      receiver = this; observed = request;
      calls += 1; f.admission.invalidate();
      if (throws) throw new Error('SYNTHETIC_PRIVATE_READER_ERROR');
      return { ok: true, items: [{ id: 'memory-1', version: 1, status: 'active', kind: 'preference',
        subject: 'Synthetic subject', body: 'SYNTHETIC_PRIVATE_BODY', source: 'user-confirmed', scope: 'work',
        validFrom: 0, expiresAt: null, contextAllowed: true, updatedAt: 0 }], sampledAt: 1791417600000,
        authority: { ownerId: 'owner-global', ledgerId: 'synthetic-ledger', sequence: 0 } };
    } };
    f = fixture({ contextReader }); const opened = f.open();
    const identities = f.events.filter(value => value === 'grant.id').length;
    const result = f.access.setScope({ conversationId: opened.conversation.id, memoryIds: ['memory-1'] });
    assert.equal(result.reason, 'scope-not-issued'); assert.equal(result.scopeGrantId, null);
    assert.equal(receiver, contextReader); assert.deepEqual(observed, { ids: ['memory-1'] });
    assert.equal(calls, 1); assert.equal(f.access.captureScopes().length, 0);
    assert.equal(f.events.filter(value => value === 'grant.id').length, identities);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE/);
  }
});

test('close refuses admission and clears authority without another canonical privacy save', async () => {
  const f = fixture(), opened = f.open(); await f.run(opened);
  const revision = f.sessions.get({ conversationId: opened.conversation.id }).conversation.revision;
  f.admission.close();
  assert.equal(f.admission.captureAdmission(), null);
  assert.equal(f.sessions.get({ conversationId: opened.conversation.id }).conversation.revision, revision);
  assert.equal(f.events.filter(value => value === 'clear').length, 1);
});

test('shutdown saves once through session disposal and restored source history is masked', async () => {
  const f = fixture(), opened = f.open();
  f.sessions.setRetention({ conversationId: opened.conversation.id, mode: 'saved', pinned: true });
  assert.equal((await f.run(opened)).ok, true);
  const before = f.saves.length;
  f.admission.close(); assert.equal(f.saves.length, before);
  assert.equal(f.sessions.dispose().ok, true);
  assert.equal(f.saves.length, before + 1);
  // Shutdown no longer performs a second canonical revoke/save pass. The
  // durable contextAllowed byte is preserved; restoration masks derived text.
  const persisted = f.repository.load({ conversationId: opened.conversation.id }).conversation;
  assert.equal(persisted.messages.at(-1).contextAllowed, true);
  const restored = createCollaborationSessions({ ownerId: 'owner-global', repository: f.repository,
    now: () => 1791417600000, idFactory: (sequence, kind) => `restored-${kind}-${sequence}`,
    schedule: () => 1, cancelSchedule() {} });
  const result = restored.get({ conversationId: opened.conversation.id });
  assert.equal(result.ok, true); assert.equal(result.conversation.messages.at(-1).contextAllowed, false);
  assert.equal(result.conversation.requiresAuthorization, true);
});
