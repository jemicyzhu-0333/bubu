'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextGrants, authorizeRead, validateSelection } = require('../src/application/ai/context-grants');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const selection = () => ({ tools: ['task.read', 'activity.distribution'], taskIds: ['task-a'],
  inboxIds: [], memoryIds: [], fromDay: '2026-10-01', toDay: '2026-10-04' });
function fixture() {
  let now = 100, next = 0;
  const grants = createContextGrants({ ownerId: 'profile-1', now: () => now, idFactory: () => `grant-${++next}` });
  const context = { conversationId: 'conv-1', purpose: 'stuck', providerId: 'provider-a', authorizationGeneration: 0 };
  return { grants, context, advance: value => { now += value; } };
}
test('only trusted closed selections grant bounded targets and dates', () => {
  assert.equal(validateSelection({ ...selection(), consent: true }).ok, false);
  assert.equal(validateSelection({ ...selection(), tools: ['state:get'] }).ok, false);
  assert.equal(validateSelection({ ...selection(), fromDay: '2026-02-30' }).ok, false);
  const f = fixture(), grant = f.grants.issue({ ...f.context, selection: selection() }).grant;
  assert.equal(authorizeRead(grant, { name: 'task.read', args: { id: 'task-a' } }).ok, true);
  assert.equal(authorizeRead(grant, { name: 'task.read', args: { id: 'task-b' } }).ok, false);
  assert.equal(authorizeRead(grant, { name: 'task.read', args: { id: 'task-a', sql: 'select *' } }).ok, false);
  assert.equal(authorizeRead(grant, { name: 'memory.search', args: {} }).ok, false);
  assert.equal(authorizeRead(grant, { name: 'activity.distribution', args: { fromDay: '2026-09-30', toDay: '2026-10-04' } }).ok, false);
});
test('provider, generation, expiry and narrower selection invalidate prior grants', () => {
  const f = fixture();
  const one = f.grants.issue({ ...f.context, selection: selection() }).grant;
  const proof = { ...f.context, scopeGrantId: one.id };
  assert.equal(f.grants.resolve(proof).ok, true);
  assert.equal(f.grants.resolve({ ...proof, providerId: 'provider-b' }).ok, false);
  assert.equal(f.grants.resolve({ ...proof, authorizationGeneration: 1 }).ok, false);
  f.grants.issue({ ...f.context, selection: { ...selection(), taskIds: [] } });
  assert.equal(f.grants.resolve(proof).ok, false);
  const two = f.grants.issue({ ...f.context, selection: selection() }).grant;
  f.advance(1800000);
  assert.equal(f.grants.resolve({ ...proof, scopeGrantId: two.id }).ok, false);
});
test('content versions are stable by canonical value and detect same-timestamp edits', () => {
  assert.equal(entityFingerprint({ a: 1, b: 2 }), entityFingerprint({ b: 2, a: 1 }));
  assert.notEqual(entityFingerprint({ title: 'A', updatedAt: 1 }), entityFingerprint({ title: 'B', updatedAt: 1 }));
});


test('a resolved grant cannot be widened by mutating nested target arrays', () => {
  const f = fixture();
  const created = f.grants.issue({ ...f.context, selection: selection() });
  created.grant.selection.taskIds.push('b');
  const grant = f.grants.resolve({ ...f.context, scopeGrantId: created.grant.id }).grant;
  assert.throws(() => grant.selection.taskIds.push('b'), TypeError);
  assert.throws(() => grant.selection.tools.push('memory.search'), TypeError);
  assert.equal(authorizeRead(grant, { name: 'task.read', args: { id: 'b' } }).ok, false);
});


test('scope time fails closed for NaN or backward clocks and cursor 1000 remains legal', () => {
  let at = 100;
  const grants = createContextGrants({ ownerId: 'profile-1', now: () => at, idFactory: () => 'grant-time' });
  const context = { conversationId: 'conv-1', purpose: 'task', providerId: 'p', authorizationGeneration: 0 };
  const result = grants.issue({ ...context, selection: { ...selection(), tools: ['task.search'] } });
  assert.equal(authorizeRead(result.grant, { name: 'task.search', args: { cursor: 'offset:1000' } }).ok, true);
  at = NaN;
  assert.equal(grants.resolve({ ...context, scopeGrantId: result.grant.id }).ok, false);
  at = 99;
  assert.equal(grants.resolve({ ...context, scopeGrantId: result.grant.id }).ok, false);
});
