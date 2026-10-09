'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planningState: v, planningPreferences: p } = require('../src/capabilities/guidance');
const { createPlanEnergyPreferenceWorkflow } = require('../src/application/workflows/plan-energy-preference');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { NOW, DAY, planningFixture, repositoryFixture } = require('../test-support/planning-guidance-fixture');
const { INPUT, planningProposalFixture } = require('../test-support/planning-proposal-fixture');
const keys = ['receiptId', 'preferenceId', 'beforeVersion', 'afterVersion', 'committedAt', 'origin', 'revertedAt', 'revertedVersion'];
function commit(state, count, origin = null) {
  const input = { ...INPUT, scope: 'saved', id: count ? 'preference' : null, demand: count % 2 ? 'high' : 'low' };
  const preview = p.previewPlanningPreference(state, { input, now: NOW + count, preferenceId: 'preference' });
  assert.equal(preview.ok, true, preview.reason);
  const result = p.confirmPlanningPreference(state, { preview, now: NOW + count, receiptId: `receipt-${count}`, origin });
  assert.equal(result.ok, true, result.reason); v.validatePlanningPreferences(state.planningPreferences);
  return result;
}

test('manual and trusted proposal receipts are body-free, committed atomically and readable by exact identity or origin', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const manual = f.invoke('planning:preference-preview', INPUT);
  const appliedManual = f.invoke('planning:preference-confirm', { previewId: manual.previewId });
  assert.equal(appliedManual.receipt.origin, null);
  const origin = f.candidate({ ...INPUT, demand: 'high' });
  const proposed = f.invoke('planning:proposal-preview', origin);
  const applied = f.invoke('planning:preference-confirm', { previewId: proposed.previewId });
  const receipt = applied.receipt;
  assert.deepEqual(Object.keys(receipt), keys);
  assert.deepEqual(receipt, { receiptId: proposed.previewId, preferenceId: proposed.after.id, beforeVersion: null,
    afterVersion: 1, committedAt: NOW, origin, revertedAt: null, revertedVersion: null });
  const service = createPlanningPreferences({ ...f, readSnapshot: f.snapshot });
  const status = service.receipt({ origin });
  assert.deepEqual(status, service.receipt({ receiptId: receipt.receiptId }));
  assert.equal(status.status, 'applied'); assert.equal(status.current, true); assert.equal(status.active, true);
  assert.equal(status.currentVersion, 1); assert.equal(status.storeVersion, 2);
  assert.deepEqual(status.undo, { receiptId: proposed.previewId, expectedVersion: 2, expiresAt: NOW + 7 * DAY });
  status.receipt.origin.proposalId = 'mutated-copy';
  assert.deepEqual(service.receipt({ receiptId: receipt.receiptId }).receipt.origin, origin);
  assert.equal(f.snapshot().planningPreferences.receipts.length, 2);
  assert.equal(f.commits(), 2);
});

test('undo marks persistent receipt, read reports absence, and old canonical proposal stays consumed after reopen', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const origin = f.candidate(), preview = f.invoke('planning:proposal-preview', origin);
  const result = f.invoke('planning:preference-confirm', { previewId: preview.previewId });
  f.setTime(NOW + 1000);
  assert.equal(f.invoke('planning:preference-undo', { receiptId: result.receiptId, expectedVersion: result.version }).ok, true);
  f.reopen();
  assert.equal(f.snapshot().planningPreferences.items.length, 0);
  const status = p.lookupPlanningPreferenceReceipt(f.snapshot(), { origin, now: NOW + 1000 });
  assert.equal(status.status, 'reverted'); assert.equal(status.receipt.revertedAt, NOW + 1000);
  assert.equal(status.receipt.revertedVersion, null); assert.equal(status.currentVersion, null);
  assert.equal(status.current, false); assert.equal(status.active, false); assert.equal(status.undo, null);
  const retry = f.invoke('planning:proposal-preview', origin);
  assert.equal(retry.reason, 'planning-proposal-already-reviewed'); assert.equal(retry.receiptId, result.receiptId);
  assert.equal(retry.status, 'reverted'); assert.equal(f.commits(), 2);
  const newOrigin = f.candidate(); assert.equal(f.invoke('planning:proposal-preview', newOrigin).ok, true);
});

test('existing-target receipts preserve actual before/after versions and show later edits without guessing reversion', () => {
  const state = planningFixture();
  const first = commit(state, 0), second = commit(state, 1, { conversationId: 'c', proposalId: 'p' });
  assert.equal(second.receipt.beforeVersion, 1); assert.equal(second.receipt.afterVersion, 2);
  const old = p.lookupPlanningPreferenceReceipt(state, { receiptId: first.receiptId, now: NOW + 2 });
  assert.equal(old.status, 'applied'); assert.equal(old.currentVersion, 2); assert.equal(old.current, false);
  assert.equal(p.undoPlanningPreference(state, { receiptId: second.receiptId, expectedVersion: 2, now: NOW + 2 }).ok, true);
  const undone = p.lookupPlanningPreferenceReceipt(state, { origin: second.receipt.origin, now: NOW + 2 });
  assert.equal(undone.status, 'reverted'); assert.equal(undone.currentVersion, 3); assert.equal(undone.receipt.revertedVersion, 3);
  assert.equal(state.planningPreferences.receipts.length, 2); v.validatePlanningPreferences(state.planningPreferences);
});

test('receipt limit is fail-closed with no silent drops and undo remains available at full capacity', () => {
  const state = planningFixture();
  for (let i = 0; i < v.MAX_PLANNING_RECEIPTS; i++) commit(state, i);
  const before = structuredClone(state), last = state.planningPreferences.receipts.at(-1);
  assert.equal(state.planningPreferences.receipts.length, 512);
  assert.equal(p.previewPlanningPreference(state, { input: { ...INPUT, id: 'preference' }, now: NOW + 512, preferenceId: 'ignored' }).reason, 'planning-receipts-full');
  const fakeFreshPreview = { ok: true, before: state.planningPreferences.items[0], after: { ...state.planningPreferences.items[0], version: 513 }, sourceVersion: 512 };
  assert.equal(p.confirmPlanningPreference(state, { preview: fakeFreshPreview, now: NOW + 512, receiptId: 'overflow' }).reason, 'planning-receipts-full');
  assert.deepEqual(state, before);
  assert.equal(p.undoPlanningPreference(state, { receiptId: last.receiptId, expectedVersion: 512, now: NOW + 512 }).ok, true);
  assert.equal(state.planningPreferences.receipts.length, 512);
  assert.deepEqual(state.planningPreferences.receipts.slice(0, -1), before.planningPreferences.receipts.slice(0, -1));
  v.validatePlanningPreferences(state.planningPreferences);
});

test('receipt body, duplicate identity/origin, invalid version/reversion and missing receipt collection are strict corruption', () => {
  const state = planningFixture(); commit(state, 0, { conversationId: 'c', proposalId: 'p' });
  const original = state.planningPreferences;
  for (const change of [
    value => { delete value.receipts; }, value => { value.receipts[0].body = 'PRIVATE_HISTORY'; },
    value => { value.receipts[0].origin.sourceRefs = []; }, value => { value.receipts[0].beforeVersion = 2; },
    value => { value.receipts[0].revertedVersion = 3; }, value => { value.receipts[0].revertedAt = NOW - 1; },
    value => { value.receipts.push(structuredClone(value.receipts[0])); },
    value => { value.receipts.push({ ...structuredClone(value.receipts[0]), receiptId: 'different' }); },
    value => { value.receipts = Array(513).fill(value.receipts[0]); },
    value => { value.receipts[0].receiptId = 'not-the-undo-receipt'; }
  ]) { const damaged = structuredClone(original); change(damaged); assert.throws(() => v.normalizePlanningPreferences(damaged), /planning-state-invalid/); }
  assert.deepEqual(v.normalizePlanningPreferences(original), original);
  assert.deepEqual(v.createPlanningPreferences().receipts, []);
});

test('failed UoW write cannot persist a receipt separately from preference state', () => {
  const f = repositoryFixture(); const before = f.snapshot(); let candidate;
  const repository = { snapshot: f.snapshot, revision: () => 0, commit: value => { candidate = structuredClone(value); throw new Error('synthetic-write-failed'); } };
  const workflow = createPlanEnergyPreferenceWorkflow({ ...f, unitOfWork: createUnitOfWork({ repository }) });
  const preview = workflow.preview(INPUT);
  assert.throws(() => workflow.confirm({ previewId: preview.previewId }), /synthetic-write-failed/);
  assert.equal(candidate.planningPreferences.receipts.length, 1); assert.equal(candidate.planningPreferences.items.length, 1);
  assert.deepEqual(f.snapshot(), before);
});

test('receipt lookups do not write, expire, prune or infer success from a deterministic preference ID', () => {
  const state = planningFixture(); const before = structuredClone(state);
  assert.equal(p.lookupPlanningPreferenceReceipt(state, { receiptId: 'missing', now: NOW }).reason, 'planning-receipt-not-found');
  assert.equal(p.lookupPlanningPreferenceReceipt(state, { origin: { conversationId: 'c', proposalId: 'p' }, now: NOW }).reason, 'planning-receipt-not-found');
  for (const query of [{}, { origin: null }, { receiptId: 'x', origin: { conversationId: 'c', proposalId: 'p' } }]) {
    assert.equal(p.lookupPlanningPreferenceReceipt(state, { ...query, now: NOW }).reason, 'planning-receipt-query-invalid');
  }
  assert.deepEqual(state, before);
  const preview = p.previewPlanningPreference(state, { input: INPUT, now: NOW, preferenceId: 'today' });
  p.confirmPlanningPreference(state, { preview, now: NOW, receiptId: 'today-receipt' });
  const bytes = JSON.stringify(state);
  const expired = p.lookupPlanningPreferenceReceipt(state, { receiptId: 'today-receipt', now: NOW + 365 * DAY });
  assert.equal(expired.status, 'applied'); assert.equal(expired.current, true); assert.equal(expired.active, false);
  assert.equal(expired.undo, null); assert.equal(JSON.stringify(state), bytes);
});
