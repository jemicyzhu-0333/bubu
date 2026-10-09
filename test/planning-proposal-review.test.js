'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { INPUT, planningProposalFixture } = require('../test-support/planning-proposal-fixture');

test('proposal route is closed, popover-only and requires canonical proposal ports', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  assert.deepEqual(allowedSurfacesFor('planning:proposal-preview'), ['popover']);
  const request = f.candidate();
  for (const invalid of [ {}, { ...request, body: INPUT }, { ...request, sourceRefs: [] },
    { ...request, input: { ...INPUT, version: 4 } }, { ...request, input: { ...INPUT, scope: 'forever' } },
    { ...request, replacePreviewId: null }, { ...request, confirmed: true } ]) {
    assert.equal(validateIpcPayload('planning:proposal-preview', invalid).ok, false);
  }
  const routes = new Map();
  createPlanningPreferences({ ...f, readSnapshot: f.snapshot }).register((name, handler) => routes.set(name, handler));
  assert.equal(routes.get('planning:proposal-preview')({}, request).reason, 'planning-proposal-unavailable');
  assert.equal(f.invoke('planning:proposal-preview', { ...request, conversationId: 'someone-else' }).ok, false);
  assert.equal(f.invoke('planning:proposal-preview', { ...request, proposalId: 'not-the-proposal' }).ok, false);
  assert.equal(f.commits(), 0);
});

test('canonical proposal is inert; edited preview preserves provenance and replay cannot duplicate after reopen', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const request = f.candidate();
  const first = f.invoke('planning:proposal-preview', request);
  assert.equal(first.ok, true); assert.equal(f.commits(), 0);
  assert.equal(first.provenance.conversationId, request.conversationId);
  const edited = f.invoke('planning:proposal-preview', { ...request, input: { ...INPUT, demand: 'high', scope: '7days' }, replacePreviewId: first.previewId });
  assert.equal(edited.ok, true); assert.deepEqual(edited.provenance, first.provenance);
  assert.equal(edited.after.id, first.after.id);
  assert.equal(f.invoke('planning:preference-confirm', { previewId: first.previewId }).ok, false);
  const result = f.invoke('planning:preference-confirm', { previewId: edited.previewId });
  assert.equal(result.ok, true); assert.equal(f.commits(), 1);
  assert.equal(f.snapshot().planningPreferences.items[0].demand, 'high');
  assert.equal(f.snapshot().energyProfile, null); assert.equal(f.snapshot().energySelfReports.events.length, 0);
  f.setAllowed(false);
  assert.deepEqual(f.invoke('planning:preference-confirm', { previewId: edited.previewId }), result, 'completed retry preserves outcome after forgetting');
  f.setAllowed(true); f.reopen();
  assert.equal(f.invoke('planning:proposal-preview', request).reason, 'planning-proposal-already-reviewed');
  assert.equal(f.snapshot().planningPreferences.items.length, 1); assert.equal(f.commits(), 1);
});

test('proposal target cannot be switched by edits and an existing target requires exact actually-read source version', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const initial = f.invoke('planning:preference-preview', INPUT);
  f.invoke('planning:preference-confirm', { previewId: initial.previewId });
  const target = f.snapshot().planningPreferences.items[0];
  const unread = f.candidate({ ...INPUT, id: target.id });
  assert.equal(f.invoke('planning:proposal-preview', unread).reason, 'planning-proposal-target-not-read');
  const request = f.candidate({ ...INPUT, id: target.id }, { sourceRefs: [f.reference('planning-preference', target)] });
  assert.equal(f.invoke('planning:proposal-preview', { ...request, input: INPUT }).reason, 'planning-proposal-target-mismatch');
  const preview = f.invoke('planning:proposal-preview', request);
  assert.equal(preview.ok, true);
  f.mutate(state => { state.planningPreferences.items[0].demand = 'high'; state.planningPreferences.items[0].version++; });
  assert.equal(f.invoke('planning:preference-confirm', { previewId: preview.previewId }).reason, 'planning-proposal-source-changed');
  assert.equal(f.commits(), 1);
});

test('changed or forgotten evidence invalidates both proposal preview and pending confirmation', t => {
  for (const invalidate of [f => f.setAllowed(false), f => f.mutate(state => { state.tasks[0].title = 'Changed'; })]) {
    const f = planningProposalFixture(); t.after(f.dispose);
    const request = f.candidate(INPUT, { sourceRefs: [f.reference('task', f.snapshot().tasks[0])] });
    const preview = f.invoke('planning:proposal-preview', request); assert.equal(preview.ok, true);
    invalidate(f);
    assert.equal(f.invoke('planning:proposal-preview', request).reason, 'planning-proposal-source-changed');
    assert.equal(f.invoke('planning:preference-confirm', { previewId: preview.previewId }).reason, 'planning-proposal-source-changed');
    assert.equal(f.commits(), 0);
  }
});

test('replacement only cancels the same canonical proposal and cancellation remains exact', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const a = f.candidate(), b = f.candidate();
  const first = f.invoke('planning:proposal-preview', a);
  assert.equal(f.invoke('planning:proposal-preview', { ...b, replacePreviewId: first.previewId }).reason, 'planning-proposal-preview-conflict');
  assert.equal(f.invoke('planning:preference-confirm', { previewId: first.previewId }).ok, true);
  const second = f.invoke('planning:proposal-preview', b);
  assert.equal(f.invoke('planning:preview-cancel', { kind: 'preference', previewId: second.previewId }).cancelled, true);
  assert.equal(f.invoke('planning:preference-confirm', { previewId: second.previewId }).ok, false);
  assert.equal(f.commits(), 1);
});

test('read existing target updates one version and undo is local after conversation sources are withdrawn', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const initial = f.invoke('planning:preference-preview', INPUT);
  f.invoke('planning:preference-confirm', { previewId: initial.previewId });
  const original = f.snapshot().planningPreferences.items[0];
  const request = f.candidate({ ...INPUT, id: original.id, demand: 'high' }, { sourceRefs: [f.reference('planning-preference', original)] });
  const preview = f.invoke('planning:proposal-preview', request);
  const confirmed = f.invoke('planning:preference-confirm', { previewId: preview.previewId });
  assert.equal(confirmed.ok, true); assert.equal(f.snapshot().planningPreferences.items.length, 1);
  assert.equal(confirmed.after.id, original.id); assert.equal(confirmed.after.version, original.version + 1);
  f.setAllowed(false);
  assert.equal(f.invoke('planning:preference-undo', { receiptId: confirmed.receiptId, expectedVersion: confirmed.version }).ok, true);
  assert.equal(f.snapshot().planningPreferences.items[0].demand, original.demand);
  assert.equal(f.snapshot().energyProfile, null);
});

test('canonical context withdrawal independently blocks a pending ticket even if the privacy port allows it', t => {
  const f = planningProposalFixture(); t.after(f.dispose);
  const refs = [f.reference('task', f.snapshot().tasks[0])];
  const request = f.candidate(INPUT, { sourceRefs: refs });
  const preview = f.invoke('planning:proposal-preview', request); assert.equal(preview.ok, true);
  f.sessions.revoke({ conversationId: request.conversationId, sourceRefs: refs });
  assert.equal(f.invoke('planning:preference-confirm', { previewId: preview.previewId }).reason, 'planning-proposal-source-changed');
  assert.equal(f.commits(), 0);
});
