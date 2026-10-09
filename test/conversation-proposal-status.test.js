'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationProposalStatus } = require('../src/application/queries/conversation-proposal-status');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { planningPreferences } = require('../src/capabilities/guidance');
const { planningFixture, NOW } = require('../test-support/planning-guidance-fixture');
function fixture() {
  const state = planningFixture(); state.aiCollaboration = { receipts: [], outbox: [] };
  const conversation = { id: 'c', ownerId: 'owner', messages: ['change-set', 'memory-candidate', 'planning-preference-candidate']
    .map((kind, n) => ({ role: 'assistant', proposal: { id: `p${n}`, kind, body: 'PRIVATE_BODY' } })) };
  let durable = true, memoryResult = { ok: true, receipt: null }, reads = 0;
  const query = createConversationProposalStatus({ sessions: { get: ({ conversationId }) => conversationId === 'c' ? { ok: true, conversation } : { ok: false } },
    ownerId: 'owner', identityAvailable: true, readSnapshot: () => { reads++; return structuredClone(state); },
    now: () => NOW, durability: { verify: () => ({ ok: durable }) }, memory: { candidateStatus: () => memoryResult } });
  return { state, conversation, query, readCount: () => reads, durable: value => { durable = value; }, memory: value => { memoryResult = value; } };
}
test('status reads exact canonical receipt origins independently and never exposes proposal or receipt detail', () => {
  const f = fixture();
  f.state.aiCollaboration.receipts.push({ ownerId: 'owner', conversationId: 'c', changeSetId: `change-${entityFingerprint({ ownerId: 'owner', conversationId: 'c', proposalId: 'p0' })}`,
    receiptId: 'config-r', status: 'applied', appliedRevision: 3, details: { body: 'PRIVATE_DETAIL' } });
  f.state.aiCollaboration.outbox.push({ receiptId: 'config-r' });
  f.memory({ ok: true, receipt: { receiptId: 'memory-r', memoryId: 'm' }, status: 'removed', currentVersion: 2, historyStatus: 'synced' });
  const preview = planningPreferences.previewPlanningPreference(f.state, { input: { id: null, startMinute: 480, endMinute: 600, demand: 'low', scope: 'saved' }, now: NOW, preferenceId: 'pref' });
  assert.equal(planningPreferences.confirmPlanningPreference(f.state, { preview, now: NOW, receiptId: 'planning-r', origin: { conversationId: 'c', proposalId: 'p2' } }).ok, true);
  assert.equal(planningPreferences.undoPlanningPreference(f.state, { receiptId: 'planning-r', expectedVersion: 1, now: NOW }).ok, true);
  const before = JSON.stringify(f.state), result = f.query({ conversationId: 'c', proposalIds: ['p0', 'p1', 'p2'] });
  assert.deepEqual(result.items.map(item => [item.store, item.status, item.receiptId]), [['config', 'applied', 'config-r'], ['memory', 'removed', 'memory-r'], ['planning', 'reverted', 'planning-r']]);
  assert.equal(result.items[0].historyStatus, 'pending'); assert.equal(result.items[2].historyStatus, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/); assert.equal(JSON.stringify(f.state), before);
});
test('uncertain config proof and unavailable memory remain unavailable rather than unconfirmed proposal or success', () => {
  const f = fixture(); f.durable(false); f.memory({ ok: false });
  assert.deepEqual(f.query({ conversationId: 'c', proposalIds: ['p0', 'p1', 'p2'] }).items.map(item => item.status), ['unavailable', 'unavailable', 'unavailable']);
  f.durable(true);
  assert.deepEqual(f.query({ conversationId: 'c', proposalIds: ['p0', 'p1', 'p2'] }).items.map(item => item.status), ['proposal', 'unavailable', 'proposal']);
});
test('foreign, duplicate, nonassistant and unsupported proposal IDs fail before any store query', () => {
  const f = fixture();
  for (const payload of [{ conversationId: 'other', proposalIds: ['p0'] }, { conversationId: 'c', proposalIds: ['unknown'] },
    { conversationId: 'c', proposalIds: ['p0', 'p0'] }, { conversationId: 'c', proposalIds: Array.from({ length: 51 }, (_, i) => `x${i}`) },
    { conversationId: 'c', proposalIds: ['p0'], ownerId: 'owner' }]) assert.equal(f.query(payload).ok, false);
  f.conversation.messages[0].role = 'user'; assert.equal(f.query({ conversationId: 'c', proposalIds: ['p0'] }).ok, false);
  f.conversation.ownerId = 'other'; assert.equal(f.query({ conversationId: 'c', proposalIds: [] }).ok, false);
  assert.equal(f.readCount(), 0);
});
