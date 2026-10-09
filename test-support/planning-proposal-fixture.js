'use strict';
const assert = require('node:assert/strict');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { NOW, repositoryFixture } = require('./planning-guidance-fixture');
const INPUT = Object.freeze({ id: null, startMinute: 780, endMinute: 1020, demand: 'low', scope: 'today' });
function planningProposalFixture() {
  const state = normalizePersistedState({}, { now: NOW });
  state.tasks = [{ id: 'task-a', title: 'Synthetic task', done: false, steps: [] }];
  const f = repositoryFixture(state);
  let sequence = 0, allowed = true, service;
  const sessions = createCollaborationSessions({ ownerId: 'synthetic-owner', now: f.clock.now, idFactory: () => `conversation-${++sequence}` });
  const grants = createContextGrants({ ownerId: 'synthetic-owner', now: f.clock.now,
    idFactory: () => `grant-${++sequence}` });
  const reads = createContextReads({ grants, readSnapshot: f.snapshot, now: f.clock.now });
  const routes = new Map();
  function reopen() {
    service = createPlanningPreferences({ ...f, readSnapshot: f.snapshot, getConversation: sessions.get,
      validateContextVersions: reads.validateContextVersions, isContextMessageAllowed: () => allowed });
    routes.clear(); service.register((channel, handler) => routes.set(channel, handler));
  }
  reopen();
  function invoke(channel, payload) {
    const decoded = validateIpcPayload(channel, payload);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    return routes.get(channel)({}, decoded.value);
  }
  function candidate(input = INPUT, { sourceRefs = [], kind = 'planning-preference-candidate' } = {}) {
    const opened = sessions.start({ purpose: 'planning', mode: 'plan', retentionMode: 'ephemeral' });
    assert.equal(opened.ok, true, opened.reason);
    const begun = sessions.beginTurn({ conversationId: opened.conversation.id, message: 'Plan this time band', providerId: 'synthetic',
      authorizationGeneration: opened.conversation.authGeneration });
    assert.equal(begun.ok, true, begun.reason);
    const proposal = { id: begun.token.requestId, version: 1, kind, body: JSON.stringify({ planningPreference: input }) };
    const done = sessions.completeTurn({ token: begun.token, providerId: 'synthetic', content: 'A flexible planning preference to review.',
      proposal, sourceRefs, provenance: { source: 'provider', reason: null, providerId: 'synthetic' } });
    assert.equal(done.ok, true, done.reason);
    return { conversationId: done.conversation.id, proposalId: proposal.id };
  }
  return { ...f, sessions, reads, invoke, reopen, candidate, routes, setAllowed: value => { allowed = value; },
    reference: (kind, value) => ({ kind, id: value.id, revision: entityFingerprint(value) }), dispose: () => sessions.dispose() };
}
module.exports = { INPUT, planningProposalFixture };
