'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { serializedBytes } = require('../src/application/ai/run-budget');

const copy = value => structuredClone(value);
function fixture({ maxCached = 3 } = {}) {
  let sequence = 0, timer = 0, failAt = 0, nonfinite = false, clockAction = null, actionAt = 0;
  let saveMode = 'success', reconcileMode = 'unknown';
  const stored = new Map(), saves = [], reconciles = [], timers = new Map();
  const repository = {
    load({ conversationId }) { const record = stored.get(conversationId); return record
      ? { ok: true, conversation: copy(record) } : { ok: false, reason: 'conversation-not-found' }; },
    listPage() { return { ok: true, items: [], nextCursor: null }; },
    pruneRetention() { return { ok: true }; },
    delete({ conversationId, expectedRevision }) {
      if (stored.get(conversationId)?.revision !== expectedRevision) return { ok: false, reason: 'conversation-delete-conflict' };
      stored.delete(conversationId); return { ok: true };
    },
    saveSnapshot(request) {
      saves.push(copy(request));
      if ((stored.get(request.snapshot.id)?.revision || 0) !== request.expectedRevision) return { ok: false, reason: 'conversation-save-conflict' };
      if (saveMode === 'throw') throw new Error('synthetic-save-error');
      if (saveMode === 'refuse') return { ok: false, reason: 'conversation-save-unavailable' };
      if (saveMode !== 'unknown-rollback') stored.set(request.snapshot.id, copy(request.snapshot));
      return saveMode.startsWith('unknown') ? { ok: false, reason: 'conversation-save-unknown', durability: 'unknown' }
        : { ok: true, revision: request.snapshot.revision };
    },
    reconcileSave(request) {
      reconciles.push(copy(request));
      if (reconcileMode === 'unknown') return { ok: false, reason: 'conversation-save-unknown' };
      return { ok: true, outcome: reconcileMode, revision: reconcileMode === 'committed'
        ? request.snapshot.revision : request.expectedRevision };
    }
  };
  const ports = { ownerId: 'owner-retiring', repository, now() {
    if (clockAction && --actionAt === 0) { const action = clockAction; clockAction = null; action(); }
    if (failAt && --failAt === 0) { if (nonfinite) return NaN; throw new Error('SYNTHETIC_PRIVATE_CLOCK'); }
    return 1000;
  }, idFactory: (_index, kind) => `${kind}-${++sequence}`, maxCached,
  schedule(callback) { const handle = timer++; timers.set(handle, callback); return handle; },
  cancelSchedule(handle) { timers.delete(handle); } };
  const sessions = createCollaborationSessions(ports);
  const started = sessions.start({ purpose: 'stuck', mode: 'talk' });
  const conversationId = started.conversation.id;
  const get = () => sessions.get({ conversationId }).conversation;
  const begin = message => sessions.beginTurn({ conversationId, message: message || 'Synthetic user', providerId: 'provider',
    authorizationGeneration: get().authGeneration });
  function answer(sourceRefs = []) {
    const begun = begin();
    return sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'Synthetic assistant', sourceRefs });
  }
  return { sessions, ports, repository, stored, saves, reconciles, timers, conversationId, get, begin, answer,
    failPreparation: (invalid = false) => { failAt = 3; nonfinite = invalid; },
    clockAction: (action, after = 1) => { clockAction = action; actionAt = after; },
    saveMode: value => { saveMode = value; }, reconcileMode: value => { reconcileMode = value; },
    save: () => sessions.setRetention({ conversationId, mode: 'saved', pinned: true }) };
}
function canonical(record) {
  const { authGeneration, requiresAuthorization, contextEligibilityPending, savedRevision,
    recoverable, saveState, saveError, ...data } = record;
  return data;
}

test('revoke applies source and dependent-message exclusion before captured abort notification', () => {
  const f = fixture();
  f.answer([{ kind: 'task', id: 'task-1', revision: 'v1' }]);
  const first = f.get().messages.at(-1);
  f.answer([{ kind: 'message', id: first.id, revision: null }]);
  const begun = f.begin();
  const before = f.get();
  let observed;
  begun.signal.addEventListener('abort', () => { observed = f.get(); });
  const result = f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [{ kind: 'task', id: 'task-1', revision: null }] });
  assert.equal(result.ok, true);
  assert.equal(result.transition.applied, true);
  assert.equal(result.transition.notification, 'signal-aborted');
  assert.equal(observed.status, 'paused');
  assert.equal(observed.revision, before.revision + 1);
  assert.equal(observed.authGeneration, before.authGeneration + 1);
  assert.ok(observed.messages.filter(item => item.role === 'assistant').every(item => item.contextAllowed === false));
  assert.equal(observed.segment.bytes, observed.messages.filter(item => item.segment === observed.segment.index)
    .reduce((sum, item) => sum + serializedBytes(item), 0));
});

test('cancel and pause apply validated draft and status before abort', () => {
  for (const name of ['cancel', 'pause']) {
    const f = fixture(), begun = f.begin();
    let observed;
    begun.signal.addEventListener('abort', () => { observed = f.get(); });
    const result = f.sessions[name]({ conversationId: f.conversationId, inputDraft: 'Kept draft', scrollTop: 17 });
    assert.equal(result.ok, true);
    assert.equal(observed.status, name === 'cancel' ? 'canceled' : 'paused');
    assert.equal(observed.inputDraft, 'Kept draft');
    assert.equal(observed.scrollTop, 17);
    assert.equal(result.transition.persistence, 'ephemeral');
  }
});

test('revoke preserves summary source propagation and recomputed current segment bytes', () => {
  const f = fixture();
  for (let index = 0; index < 101; index++) f.answer(index === 0 ? [{ kind: 'task', id: 'task-1', revision: 'v1' }] : []);
  assert.equal(f.get().summaries.length, 1);
  const result = f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [{ kind: 'task', id: 'task-1', revision: null }] });
  assert.equal(result.ok, true);
  assert.equal(result.conversation.summaries[0].contextAllowed, false);
  assert.equal(result.conversation.segment.bytes, result.conversation.messages
    .filter(item => item.segment === result.conversation.segment.index).reduce((sum, item) => sum + serializedBytes(item), 0));
});

test('same mode is a no-op; mode change is visible before old-token abortion', () => {
  const f = fixture(), begun = f.begin(), before = f.get();
  assert.deepEqual(f.sessions.setMode({ conversationId: f.conversationId, mode: 'talk' }).conversation, before);
  assert.equal(begun.signal.aborted, false);
  let observed;
  begun.signal.addEventListener('abort', () => { observed = f.get(); });
  const result = f.sessions.setMode({ conversationId: f.conversationId, mode: 'plan' });
  assert.equal(result.transition.applied, true);
  assert.equal(observed.mode, 'plan');
  assert.equal(observed.status, 'paused');
});

test('invalid draft and mode payloads leave the active owner intact', () => {
  const f = fixture(), begun = f.begin(), before = f.get();
  assert.equal(f.sessions.cancel({ conversationId: f.conversationId, scrollTop: -1 }).ok, false);
  assert.equal(f.sessions.setMode({ conversationId: f.conversationId, mode: 'invalid' }).ok, false);
  assert.equal(begun.signal.aborted, false);
  assert.deepEqual(f.get(), before);
});

test('transition clock failures leave canonical draft/status/mode unchanged', () => {
  for (const invalid of [false, true]) for (const kind of ['cancel', 'pause', 'setMode']) {
    const f = fixture(); f.answer();
    const before = canonical(f.get());
    f.failPreparation(invalid);
    const result = f.sessions[kind]({ conversationId: f.conversationId, inputDraft: 'MUST_NOT_APPLY', mode: 'plan' });
    assert.equal(result.ok, false);
    assert.equal(result.transition.applied, false);
    assert.deepEqual(canonical(f.get()), before);
    assert.equal(f.saves.length, 0);
  }
});

test('failed privacy preparation masks source context, blocks begin and needs successful full revoke', () => {
  const f = fixture(); f.answer([{ kind: 'task', id: 'task-1', revision: 'v1' }]);
  const before = f.get();
  f.failPreparation();
  const result = f.sessions.revoke({ conversationId: f.conversationId });
  assert.equal(result.reason, 'conversation-context-pending');
  assert.equal(result.transition.applied, false);
  assert.equal(result.conversation.revision, before.revision);
  assert.equal(result.conversation.messages.at(-1).content, before.messages.at(-1).content);
  assert.equal(result.conversation.messages.at(-1).contextAllowed, false);
  assert.equal(result.conversation.contextEligibilityPending, true);
  assert.equal(f.begin('Not accepted').reason, 'conversation-context-pending');
  assert.equal(f.get().messages.length, before.messages.length);
  assert.equal(f.sessions.revoke({ conversationId: f.conversationId, sourceRefs: [] }).ok, true);
  assert.equal(f.get().contextEligibilityPending, true);
  assert.equal(f.sessions.revoke({ conversationId: f.conversationId }).ok, true);
  assert.equal(f.get().contextEligibilityPending, false);
  assert.equal(f.begin('Fresh user').ok, true);
});

test('preparation clock supersession refuses old candidate without marking or canceling the new owner', () => {
  for (const kind of ['revoke', 'cancel', 'setMode']) {
    const f = fixture(); f.begin('Old user');
    let newer;
    f.clockAction(() => { newer = f.begin('New clock owner'); }, 3);
    const result = f.sessions[kind]({ conversationId: f.conversationId, inputDraft: 'OLD_DRAFT', mode: 'plan' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'conversation-target-changed');
    assert.equal(result.transition.applied, false);
    assert.equal(newer.signal.aborted, false);
    assert.equal(f.get().messages.at(-1).content, 'New clock owner');
    assert.equal(f.get().inputDraft, '');
    assert.equal(f.get().mode, 'talk');
    assert.equal(f.get().contextEligibilityPending, false);
  }
});

test('abort listener starting a newer turn is not overwritten or saved by the old transition', () => {
  for (const kind of ['cancel', 'pause', 'setMode', 'revoke']) {
    const f = fixture(); f.save(); const begun = f.begin();
    let newer;
    begun.signal.addEventListener('abort', () => { newer = f.begin('New owner user'); });
    const savesBefore = f.saves.length;
    const result = f.sessions[kind]({ conversationId: f.conversationId, mode: 'plan' });
    assert.equal(result.ok, true);
    assert.equal(result.transition.applied, true);
    assert.equal(result.transition.persistence, 'superseded');
    assert.equal(newer.ok, true);
    assert.equal(newer.signal.aborted, false);
    assert.equal(f.get().status, 'generating');
    assert.equal(f.get().messages.at(-1).content, 'New owner user');
    assert.equal(f.saves.length, savesBefore + 1);
  }
});

test('abort listener deletion cannot be resurrected by outer persistence or detached snapshot', () => {
  const f = fixture(); f.save(); const begun = f.begin();
  begun.signal.addEventListener('abort', () => {
    const revision = f.get().revision;
    assert.equal(f.sessions.delete({ conversationId: f.conversationId, expectedRevision: revision }).ok, true);
  });
  const savesBefore = f.saves.length;
  const result = f.sessions.revoke({ conversationId: f.conversationId });
  assert.equal(result.ok, true);
  assert.equal(result.conversation, null);
  assert.equal(result.transition.applied, true);
  assert.equal(result.transition.persistence, 'superseded');
  assert.equal(f.stored.has(f.conversationId), false);
  assert.equal(f.saves.length, savesBefore);
});

test('disposed owner cannot supply a current snapshot or receive outer persistence', () => {
  const f = fixture(), begun = f.begin();
  begun.signal.addEventListener('abort', () => { f.sessions.dispose(); });
  const result = f.sessions.revoke({ conversationId: f.conversationId });
  assert.equal(result.ok, true);
  assert.equal(result.transition.applied, true);
  assert.equal(result.transition.persistence, 'superseded');
  assert.equal(result.conversation, null);
  assert.equal(f.sessions.get({ conversationId: f.conversationId }).reason, 'conversation-sessions-disposed');
});

test('known canonical apply survives refused and throwing saves without a second abort', () => {
  for (const saveMode of ['refuse', 'throw']) {
    const f = fixture(); f.save(); const begun = f.begin();
    let aborted = 0;
    begun.signal.addEventListener('abort', () => { aborted++; });
    const before = f.get(), savesBefore = f.saves.length;
    f.saveMode(saveMode);
    const result = f.sessions.revoke({ conversationId: f.conversationId });
    assert.equal(result.ok, true);
    assert.equal(result.transition.applied, true);
    assert.equal(result.conversation.revision, before.revision + 1);
    assert.equal(result.conversation.saveState, 'unsaved');
    assert.equal(result.transition.persistence, saveMode === 'throw' ? 'unknown' : 'unsaved');
    assert.equal(aborted, 1);
    assert.equal(f.saves.length, savesBefore + 1);
  }
});

test('existing pending save reconciles exact prior bytes without replaying privacy transition', () => {
  for (const outcome of ['unknown', 'committed', 'rolled-back']) {
    const f = fixture(); f.save();
    f.saveMode(outcome === 'rolled-back' ? 'unknown-rollback' : 'unknown-committed');
    f.begin();
    const pending = copy(f.saves.at(-1));
    f.saveMode('success'); f.reconcileMode(outcome);
    const before = f.get(), savesBefore = f.saves.length;
    const result = f.sessions.revoke({ conversationId: f.conversationId });
    assert.equal(result.ok, true);
    assert.equal(result.conversation.revision, before.revision + 1);
    assert.deepEqual(f.reconciles.at(-1).snapshot, pending.snapshot);
    assert.equal(f.reconciles.at(-1).expectedRevision, pending.expectedRevision);
    assert.equal(result.transition.persistence, outcome === 'unknown' ? 'unknown' : 'saved');
    assert.equal(f.saves.length, savesBefore + (outcome === 'unknown' ? 0 : 1));
  }
});

test('privacy preparation failure preserves the exact pending save without reconciliation or resave', () => {
  const f = fixture(); f.save(); f.saveMode('unknown-committed'); f.begin();
  const before = f.get(), pending = copy(f.saves.at(-1)), savesBefore = f.saves.length, reconcilesBefore = f.reconciles.length;
  f.failPreparation();
  const result = f.sessions.revoke({ conversationId: f.conversationId });
  assert.equal(result.transition.applied, false);
  assert.equal(result.transition.persistence, 'unknown');
  assert.equal(result.conversation.revision, before.revision);
  assert.equal(f.saves.length, savesBefore);
  assert.equal(f.reconciles.length, reconcilesBefore);
  assert.deepEqual(f.saves.at(-1), pending);
});

test('residual: initial owned clock failure precedes the captured transition and pending marker', () => {
  const f = fixture(), begun = f.begin();
  f.clockAction(() => { throw new Error('synthetic-owned-clock'); });
  assert.throws(() => f.sessions.revoke({ conversationId: f.conversationId }), /synthetic-owned-clock/);
  assert.equal(begun.signal.aborted, false);
  assert.equal(f.get().contextEligibilityPending, false);
});

test('eviction and restart mask restored sources; original generation zero is rejected after restore', () => {
  const f = fixture({ maxCached: 1 });
  f.answer([{ kind: 'task', id: 'task-1', revision: 'v1' }]); f.save();
  const original = f.get();
  f.failPreparation();
  assert.equal(f.sessions.revoke({ conversationId: f.conversationId }).ok, false);
  assert.equal(f.sessions.start({ purpose: 'task' }).ok, true);
  // The new ephemeral entry must be removed before the saved original can load.
  const transient = f.sessions.list().items[0];
  assert.equal(f.sessions.delete({ conversationId: transient.id, expectedRevision: transient.revision }).ok, true);
  const restored = f.get();
  assert.equal(restored.messages.at(-1).contextAllowed, false);
  assert.equal(f.sessions.beginTurn({ conversationId: f.conversationId, message: 'Old authority', providerId: 'provider',
    authorizationGeneration: original.authGeneration }).ok, false);
  const restarted = createCollaborationSessions(f.ports);
  const reopened = restarted.get({ conversationId: f.conversationId }).conversation;
  assert.equal(reopened.messages.at(-1).contextAllowed, false);
  assert.equal(reopened.requiresAuthorization, true);
});

test('restart guard preserves active work and refuses unsaved or unknown durable conversations', () => {
  const f = fixture(); assert.equal(f.sessions.canRestart(), true);
  const begun = f.begin(); assert.equal(f.sessions.canRestart(), false); assert.equal(begun.signal.aborted, false);
  f.sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'Synthetic answer' });
  assert.equal(f.sessions.canRestart(), true);
  f.saveMode('unknown-rollback'); f.save(); assert.equal(f.sessions.canRestart(), false);
  const before = JSON.stringify(f.get()); assert.equal(f.sessions.canRestart(), false); assert.equal(JSON.stringify(f.get()), before);
  const saved = fixture(); saved.answer(); assert.equal(saved.save().ok, true); assert.equal(saved.sessions.canRestart(), true);
  saved.saveMode('refuse'); saved.sessions.pause({ conversationId: saved.conversationId, inputDraft: 'Keep this draft' });
  assert.equal(saved.sessions.canRestart(), false); saved.sessions.dispose(); assert.equal(saved.sessions.canRestart(), false);
});
