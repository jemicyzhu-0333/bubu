'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationAuthorization } = require('../src/application/ai/collaboration-authorization');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createUpdatePreferencesWorkflow } = require('../src/application/workflows/update-preferences');
const { normalizeSettings } = require('../src/capabilities/preferences');

function fixture(options = {}) {
  let state = { settings: normalizeSettings({ aiBreakdownEnabled: true, aiClarifyEnabled: true, aiModel: 'synthetic' }) }, revision = 0, sequence = 0;
  const events = [], hooks = {};
  const repository = { snapshot() { hooks.snapshot?.(); return structuredClone(state); }, revision: () => revision,
    commit(candidate) { events.push('commit'); hooks.commit?.(); state = structuredClone(candidate); revision += 1; return structuredClone(state); } };
  const admission = createCollaborationAuthorization({ capturePrivacyTargets: () => {
    events.push('capture-session'); if (options.captureFailure) throw new Error('synthetic-capture'); return sessions.capturePrivacyTargets();
  }, captureScopes: () => { events.push('capture-scope'); if (options.scopeCaptureFailure) throw new Error('synthetic-scope-capture'); return []; },
  captureRunOwners: () => { events.push('capture-run'); if (options.runCaptureFailure) throw new Error('synthetic-run-capture'); return options.runs || []; },
  clearGrants() { events.push('clear'); if (options.clearFailure) throw new Error('synthetic-clear'); grants.clear(); },
  revokeSession: conversationId => sessions.revoke({ conversationId }),
  invalidateRequests() { events.push('requests'); if (options.requestFailure) throw new Error('synthetic-request'); },
  invalidateProposals() { events.push('proposals'); }, notifyProviderChanged() { events.push('notify'); } });
  const now = () => 1000;
  const sessions = createCollaborationSessions({ ownerId: 'owner-command', now, admission,
    idFactory: (_index, kind) => `${kind}-${++sequence}`, schedule: () => 1, cancelSchedule() {} });
  const grants = createContextGrants({ ownerId: 'owner-command', now, admission, idFactory: kind => `${kind}-${++sequence}` });
  const conversation = sessions.start({ purpose: 'stuck' }).conversation;
  const ticket = admission.captureAdmission();
  const begun = sessions.beginTurn({ conversationId: conversation.id, message: 'Synthetic user', providerId: 'provider',
    authorizationGeneration: 0, admissionTicket: ticket });
  const grant = grants.issue({ conversationId: conversation.id, purpose: 'stuck', providerId: 'provider', authorizationGeneration: 0,
    selection: { tools: [], fromDay: '2026-10-08', toDay: '2026-10-08' } }).grant;
  const resolve = () => grants.resolve({ scopeGrantId: grant.id, conversationId: conversation.id, providerId: 'provider', authorizationGeneration: 0 });
  const command = createUpdatePreferencesWorkflow({ unitOfWork: createUnitOfWork({ repository }), clock: { now },
    publish(fact) { events.push('publish'); hooks.publish?.(fact); }, reportEffectError: () => events.push('effect-error') });
  const update = patch => admission.runSettings({ patch, readSettings: () => structuredClone(state.settings), command });
  return { admission, sessions, grants, command, update, hooks, events, begun, ticket, resolve,
    settings: () => structuredClone(state.settings), revision: () => revision };
}

test('actual workflow commits then retires authority before publisher with admission held', () => {
  const f = fixture(), observations = [];
  const observe = name => observations.push({ name, grant: f.resolve().ok, aborted: f.begun.signal.aborted, admission: f.admission.captureAdmission() });
  f.hooks.commit = () => observe('commit');
  f.hooks.publish = () => observe('publish');
  const result = f.update({ aiModel: 'next-model' });
  assert.equal(result.ok, true); assert.equal(result.settings.aiModel, 'next-model');
  assert.deepEqual(observations, [{ name: 'commit', grant: true, aborted: false, admission: null },
    { name: 'publish', grant: false, aborted: true, admission: null }]);
  assert.equal(f.events.includes('effect-error'), false);
  assert.ok(f.events.indexOf('commit') < f.events.indexOf('clear'));
  assert.ok(f.events.indexOf('clear') < f.events.indexOf('publish'));
  assert.equal(f.admission.generation(), 1); assert.ok(f.admission.captureAdmission());
});

test('same-value collaboration-key success still retires without a commit or publication', () => {
  const f = fixture(); const result = f.update({ aiModel: 'synthetic' });
  assert.equal(result.ok, true); assert.equal(f.revision(), 0);
  assert.equal(f.events.includes('publish'), false); assert.equal(f.events.includes('requests'), false);
  assert.equal(f.admission.generation(), 1); assert.equal(f.resolve().ok, false);
});

test('invalid settings leave epoch, grant and pending run unchanged', () => {
  const f = fixture();
  const result = f.update({ hydrationEvery: 0 });
  assert.equal(result.ok, false); assert.equal(f.admission.generation(), 0);
  assert.equal(f.resolve().ok, true); assert.equal(f.begun.signal.aborted, false);
  assert.deepEqual(f.events, []);
});

test('throwing commit releases hold without post-success retirement', () => {
  const f = fixture(); f.hooks.commit = () => { throw new Error('synthetic-write-refused'); };
  assert.throws(() => f.update({ aiModel: 'next-model' }), /synthetic-write-refused/);
  assert.equal(f.admission.generation(), 0); assert.equal(f.resolve().ok, true);
  assert.equal(f.begun.signal.aborted, false); assert.ok(f.admission.captureAdmission());
});

test('request-only actual difference invalidates request scope without collaboration retirement', () => {
  const f = fixture();
  const result = f.update({ aiCaptureTriageEnabled: !f.settings().aiCaptureTriageEnabled });
  assert.equal(result.ok, true); assert.equal(f.admission.generation(), 0);
  assert.equal(f.resolve().ok, true); assert.equal(f.events.filter(item => item === 'requests').length, 1);
});

test('submitted unchanged request key is not mistaken for a true difference in a mixed patch', () => {
  const f = fixture();
  const result = f.update({ aiCaptureTriageEnabled: f.settings().aiCaptureTriageEnabled, dnd: !f.settings().dnd });
  assert.equal(result.ok, true); assert.equal(f.revision(), 1);
  assert.equal(f.events.includes('requests'), false); assert.equal(f.admission.generation(), 0);
});

test('request-only invalidation fault remains committed success with a closed warning', () => {
  const f = fixture({ requestFailure: true });
  const result = f.update({ aiCaptureTriageEnabled: !f.settings().aiCaptureTriageEnabled });
  assert.equal(result.ok, true); assert.equal(f.revision(), 1);
  assert.equal(result.authorizationWarning.unconfirmedNotifications, 1);
  assert.equal(result.authorizationWarning.pendingConversations, 0);
  assert.equal(f.events.includes('publish'), true);
});

test('one failed capture does not skip independent captured run closure or membership retirement', () => {
  const closed = [], run = { conversationId: 'uncached', token: {}, markInvalidated: () => closed.push('mark'), closeExecution: () => { closed.push('close'); return { ok: true }; } };
  const f = fixture({ captureFailure: true, runs: [run] });
  const result = f.update({ aiModel: 'next-model' });
  assert.equal(result.ok, true); assert.deepEqual(closed, ['mark', 'close']);
  assert.equal(result.authorizationWarning.pendingConversations, null);
  assert.equal(result.authorizationWarning.authorityUnavailable, true);
  assert.equal(f.events.includes('clear'), true); assert.equal(f.events.includes('publish'), true);
});

test('grant clear fault still retires available sessions and acknowledges settings commit', () => {
  const f = fixture({ clearFailure: true }), result = f.update({ aiModel: 'next-model' });
  assert.equal(result.ok, true); assert.equal(f.begun.signal.aborted, true);
  assert.equal(result.authorizationWarning.authorityUnavailable, true);
  assert.equal(result.authorizationWarning.pendingConversations, 0);
  assert.equal(f.resolve().ok, false); assert.equal(f.admission.captureAdmission(), null);
});

test('every failed target capture keeps all unobserved privacy and save dimensions unknown', () => {
  for (const flag of ['captureFailure', 'scopeCaptureFailure', 'runCaptureFailure']) {
    const f = fixture({ [flag]: true }), result = f.update({ aiModel: 'next-model' });
    assert.equal(result.ok, true);
    for (const key of ['pendingConversations', 'unsavedConversations', 'unknownSaves', 'unconfirmedNotifications']) {
      assert.equal(result.authorizationWarning[key], null);
    }
    assert.equal(f.events.includes('capture-session'), true); assert.equal(f.events.includes('capture-scope'), true);
    assert.equal(f.events.includes('capture-run'), true); assert.equal(f.events.includes('clear'), true);
    assert.equal(f.events.includes('publish'), true);
  }
});

test('nested settings or credential command is refused before its mutation', () => {
  const f = fixture(); let writes = 0;
  f.hooks.commit = () => {
    assert.equal(f.update({ aiModel: 'nested' }).reason, 'authorization-busy');
    assert.equal(f.admission.runCredential({ kind: 'clear', commit() { writes += 1; }, readStatus: () => ({}) }).reason, 'authorization-busy');
  };
  assert.equal(f.update({ aiModel: 'next-model' }).ok, true); assert.equal(writes, 0);
});

test('credential import false is failure and clear false is acknowledged already absent', () => {
  const a = fixture(), b = fixture();
  assert.equal(a.admission.runCredential({ kind: 'import', commit: () => false, readStatus: () => ({ configured: false }) }).ok, false);
  assert.equal(a.admission.generation(), 0); assert.equal(a.resolve().ok, true);
  const cleared = b.admission.runCredential({ kind: 'clear', commit: () => false, readStatus: () => ({ configured: false }) });
  assert.equal(cleared.ok, true); assert.equal(cleared.removed, false); assert.equal(b.admission.generation(), 1);
});

test('committed credential with failed status omits unknown credential booleans', () => {
  const f = fixture(); let writes = 0;
  const result = f.admission.runCredential({ kind: 'import', commit() { writes += 1; return true; },
    readStatus() { throw new Error('SYNTHETIC_PRIVATE_STATUS'); } });
  assert.equal(result.ok, true); assert.equal(result.credentialStatus, 'unavailable');
  assert.equal(Object.hasOwn(result, 'configured'), false); assert.equal(Object.hasOwn(result, 'available'), false);
  assert.equal(writes, 1); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_STATUS/);
});

test('committed credential remains successful through retire capture faults', () => {
  const f = fixture({ captureFailure: true }); let writes = 0;
  const result = f.admission.runCredential({ kind: 'import', commit() { writes += 1; return true; }, readStatus: () => ({ configured: true }) });
  assert.equal(result.ok, true); assert.equal(result.configured, true);
  assert.equal(result.authorizationWarning.authorityUnavailable, true); assert.equal(writes, 1);
});

test('mark failure cannot stop independent execution closure or relabel committed credential', () => {
  let closed = 0;
  const run = { conversationId: 'uncached', token: {}, markInvalidated() { throw new Error('synthetic-mark'); },
    closeExecution() { closed += 1; return { ok: true }; } };
  const f = fixture({ runs: [run] });
  const result = f.admission.runCredential({ kind: 'clear', commit: () => true, readStatus: () => ({ configured: false }) });
  assert.equal(result.ok, true); assert.equal(closed, 1);
  assert.equal(result.authorizationWarning.authorityUnavailable, true);
});

test('execution close exception reports resource uncertainty while privacy application continues', () => {
  const run = { conversationId: 'uncached', token: {}, markInvalidated() {}, closeExecution() { throw new Error('synthetic-close'); } };
  const f = fixture({ runs: [run] }), result = f.update({ aiModel: 'next-model' });
  assert.equal(result.ok, true); assert.equal(result.authorizationWarning.unconfirmedClosures, 1);
  assert.equal(f.begun.signal.aborted, true); assert.equal(f.events.includes('publish'), true);
});

test('workflow hook faults cannot prevent the real publisher or relabel committed success', () => {
  const f = fixture();
  const result = f.command.execute({ patch: { aiModel: 'next-model' } }, { onSuccessBeforePublish() { throw new Error('synthetic-hook'); } });
  assert.equal(result.ok, true); assert.equal(f.revision(), 1);
  assert.deepEqual(f.events, ['commit', 'effect-error', 'publish']);
});
