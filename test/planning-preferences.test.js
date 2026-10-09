'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planningState: v, planningPreferences: p } = require('../src/capabilities/guidance');
const { createPlanEnergyPreferenceWorkflow } = require('../src/application/workflows/plan-energy-preference');
const { buildPlanningGuidanceView } = require('../src/application/queries/planning-guidance-view');
const { START, NOW, DAY, planningFixture, repositoryFixture } = require('../test-support/planning-guidance-fixture');
const input = { id: null, startMinute: 480, endMinute: 1080, demand: 'high', scope: 'today' };

test('planning preview is read-only; explicit confirmation changes only preference state and is retry-idempotent', () => {
  const f = repositoryFixture();
  const events = [];
  const workflow = createPlanEnergyPreferenceWorkflow({ ...f, publish: event => events.push(event) });
  const before = f.snapshot();
  const preview = workflow.preview(input);
  assert.equal(preview.ok, true);
  assert.deepEqual(f.snapshot(), before);
  const result = workflow.confirm({ previewId: preview.previewId });
  assert.equal(result.ok, true);
  assert.deepEqual(workflow.confirm({ previewId: preview.previewId }), result);
  assert.equal(f.commits(), 1);
  assert.equal(events.length, 1);
  const after = f.snapshot();
  assert.deepEqual({ ...after, planningPreferences: before.planningPreferences }, before);
  assert.equal(after.planningPreferences.items[0].demand, 'high');
  const view = buildPlanningGuidanceView({ snapshot: after, now: NOW });
  assert.equal(view.currentDemandPreference.demand, 'high');
  assert.equal(view.currentUserSelfReport.level, 50);
  assert.equal(view.coverage.sampleCount, 0);
});

test('separate versioned today, seven-day and saved scopes expire deterministically and retain stored detail', () => {
  for (const scope of ['today', '7days', 'saved']) {
    const state = planningFixture();
    const preview = p.previewPlanningPreference(state, { input: { ...input, scope }, now: NOW, preferenceId: scope });
    assert.equal(p.confirmPlanningPreference(state, { preview, now: NOW, receiptId: 'receipt' }).ok, true);
    assert.equal(state.planningPreferences.version, 1);
    assert.equal(state.planningPreferences.items[0].version, 1);
    if (scope === 'saved') assert.equal(preview.after.expiresAt, null);
    else {
      assert.equal(p.planningPreferencesAt(state, preview.after.expiresAt - 1).length, 1);
      assert.equal(p.planningPreferencesAt(state, preview.after.expiresAt).length, 0);
    }
    const bytes = JSON.stringify(state.planningPreferences);
    p.planningPreferencesAt(state, NOW + 30 * DAY);
    assert.equal(JSON.stringify(state.planningPreferences), bytes);
    assert.deepEqual(v.normalizePlanningPreferences(state.planningPreferences), state.planningPreferences);
  }
});

test('edit keeps the preference identity and rejects stale preview or undo without clobbering a later version', () => {
  const f = repositoryFixture();
  const workflow = createPlanEnergyPreferenceWorkflow(f);
  const first = workflow.preview(input);
  const stale = workflow.preview(input);
  const added = workflow.confirm({ previewId: first.previewId });
  assert.equal(workflow.confirm({ previewId: stale.previewId }).reason, 'planning-preference-changed');
  const edit = workflow.preview({ ...input, id: added.after.id, demand: 'low', scope: 'saved' });
  const edited = workflow.confirm({ previewId: edit.previewId });
  assert.equal(edited.after.id, added.after.id);
  assert.equal(edited.after.version, 2);
  assert.equal(workflow.undo({ receiptId: added.receiptId, expectedVersion: added.version }).ok, false);
  assert.equal(workflow.undo({ receiptId: edited.receiptId, expectedVersion: edited.version }).ok, true);
  assert.deepEqual(f.snapshot().planningPreferences.items[0], { ...added.after, version: 3, updatedAt: NOW });
  assert.equal(workflow.undo({ receiptId: edited.receiptId, expectedVersion: edited.version }).ok, false);
});

test('one-step undo removes only the confirmed preference and preserves actual self-reports/profile', () => {
  const f = repositoryFixture(planningFixture({ sufficient: true }));
  const before = f.snapshot();
  const workflow = createPlanEnergyPreferenceWorkflow(f);
  const preview = workflow.preview(input);
  const result = workflow.confirm({ previewId: preview.previewId, after: { demand: 'low' } });
  assert.equal(workflow.undo({ receiptId: result.receiptId, expectedVersion: result.version }).ok, true);
  assert.equal(f.snapshot().planningPreferences.items.length, 0);
  assert.deepEqual(f.snapshot().energySelfReports, before.energySelfReports);
  assert.deepEqual(f.snapshot().energyCheckIn, before.energyCheckIn);
  assert.deepEqual(f.snapshot().energyProfile, before.energyProfile);
});

test('closed input, state capacity, preview expiry and failed commits are fail closed', () => {
  const f = repositoryFixture();
  const workflow = createPlanEnergyPreferenceWorkflow(f);
  for (const patch of [{ startMinute: -1 }, { endMinute: 480 }, { scope: 'forever' }, { demand: 'diagnosed-low' }, { observations: 10 }]) {
    assert.equal(workflow.preview({ ...input, ...patch }).ok, false);
  }
  const preview = workflow.preview(input);
  f.setTime(NOW + 15 * 60000);
  assert.equal(workflow.confirm({ previewId: preview.previewId }).reason, 'guidance-preview-expired');
  assert.equal(f.commits(), 0);
  const state = planningFixture();
  for (let i = 0; i < v.MAX_PREFERENCES; i += 1) {
    const prepared = p.previewPlanningPreference(state, { input, now: NOW, preferenceId: `item-${i}` });
    p.confirmPlanningPreference(state, { preview: prepared, now: NOW, receiptId: `receipt-${i}` });
  }
  assert.equal(p.previewPlanningPreference(state, { input, now: NOW, preferenceId: 'overflow' }).reason, 'planning-preferences-full');
  const bad = createPlanEnergyPreferenceWorkflow({ ...f, unitOfWork: { run: () => ({ ok: false, reason: 'disk-error' }) } });
  const valid = bad.preview(input);
  assert.equal(bad.confirm({ previewId: valid.previewId }).reason, 'disk-error');
  assert.equal(f.commits(), 0);
});

test('persistent planning values are closed strict fixed points and retain expired records', () => {
  const state = planningFixture();
  const preview = p.previewPlanningPreference(state, { input, now: START, preferenceId: 'p1' });
  p.confirmPlanningPreference(state, { preview, now: START, receiptId: 'r1' });
  const value = state.planningPreferences;
  assert.deepEqual(v.normalizePlanningPreferences(value), value);
  for (const mutation of [value => { delete value.version; }, value => { value.extra = 1; },
    value => { value.items[0].source = 'model-inferred'; }, value => { value.items[0].endMinute = 1500; },
    value => { value.items.push(structuredClone(value.items[0])); }, value => { value.undo.appliedVersion += 1; }]) {
    const damaged = structuredClone(value); mutation(damaged);
    assert.throws(() => v.normalizePlanningPreferences(damaged), /planning-state-invalid/);
  }
});

test('confirmation tickets have a strict capacity and expiry, with no persistent writes on overflow', () => {
  const f = repositoryFixture();
  const workflow = createPlanEnergyPreferenceWorkflow(f);
  const ids = [];
  for (let i = 0; i < 32; i += 1) {
    const result = workflow.preview(input);
    assert.equal(result.ok, true); ids.push(result.previewId);
  }
  assert.equal(new Set(ids).size, 32);
  assert.equal(workflow.preview(input).reason, 'guidance-preview-capacity');
  assert.equal(f.commits(), 0);
  f.setTime(NOW + 15 * 60000);
  assert.equal(workflow.preview(input).ok, true);
  assert.equal(workflow.confirm({ previewId: ids[0] }).reason, 'guidance-preview-expired');
});

test('history consent commit survives throwing projection and diagnostic reporter without replaying business work', () => {
  const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
  const f = repositoryFixture(), routes = new Map();
  createPlanningPreferences({ ...f, readSnapshot: f.snapshot,
    publishChange() { throw new Error('synthetic publication failure'); },
    reportEffectError() { throw new Error('synthetic reporter failure'); } }).register((channel, handler) => routes.set(channel, handler));
  const preview = routes.get('planning:history-preview')({}, { enabled: true, clearHistory: false });
  for (let n = 0; n < 2; n++) assert.equal(routes.get('planning:history-confirm')({}, { previewId: preview.previewId }).ok, true);
  assert.equal(f.snapshot().energySelfReports.consentEnabled, true); assert.equal(f.commits(), 1);
});
