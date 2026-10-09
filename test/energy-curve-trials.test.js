'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planningState: v, energyCurveTrials: t, energySelfReports: h } = require('../src/capabilities/guidance');
const { createTrialEnergyCurveWorkflow } = require('../src/application/workflows/trial-energy-curve');
const { buildEnergyCurveView, buildEnergyCurveSource, buildEnergyTrialComparison } = require('../src/application/queries/energy-curve-view');
const { buildEnergyCurve, resolveBaselineParams } = require('../src/core/energy-curve');
const { localDayKey, localDayStart } = require('../src/core/calendar');
const { BASELINE_EDITABLE_BOUNDS } = require('../src/content/energy-effects.mjs');
const { NOW, DAY, planningFixture, repositoryFixture, sourceFor } = require('../test-support/planning-guidance-fixture');
const input = { parameter: 'chronotypeShift', to: 6, scope: '7days' };
function workflowFixture() {
  const f = repositoryFixture(planningFixture({ sufficient: true }));
  const events = [];
  const source = (snapshot, now) => buildEnergyCurveSource({ snapshot, dayKey: localDayKey(now) });
  const comparisonFor = (snapshot, trial, now) => buildEnergyTrialComparison({ snapshot, trial, now,
    dayKey: localDayKey(now), settings: snapshot.settings });
  return { ...f, events, workflow: createTrialEnergyCurveWorkflow({ ...f, sourceFor: source, comparisonFor, publish: event => events.push(event) }) };
}

test('insufficient history is a truthful explicit blocker even with hundreds of legacy observations', () => {
  const state = planningFixture();
  state.energyProfile = { baseline: resolveBaselineParams(), effectScale: {}, observations: 500, updatedAt: NOW, lastResidualMae: 1 };
  let result = t.previewCurveTrial(state, { input, now: NOW, trialId: 'trial-1', source: sourceFor(state) });
  assert.equal(result.reason, 'self-report-consent-required');
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: NOW });
  result = t.previewCurveTrial(state, { input, now: NOW, trialId: 'trial-1', source: sourceFor(state) });
  assert.equal(result.reason, 'self-report-coverage-insufficient');
  assert.equal(result.coverage.sampleCount, 0);
  assert.equal(state.energyProfile.observations, 500);
});

test('only one existing non-drug baseline parameter with strict <=2% editable span is accepted', () => {
  const state = planningFixture({ sufficient: true });
  const source = sourceFor(state);
  for (const proposed of [input, { parameter: 'morningRampMinutes', to: 94, scope: 'today' }]) {
    const result = t.previewCurveTrial(state, { input: proposed, now: NOW, trialId: 'trial-1', source });
    assert.equal(result.ok, true);
    assert.equal(result.changedParameters.length, 1);
    const [min, max] = BASELINE_EDITABLE_BOUNDS[proposed.parameter];
    assert.ok(Math.abs(result.trial.to - result.trial.from) <= (max - min) * 0.02);
  }
  for (const invalid of [
    { ...input, to: 7 }, { parameter: 'morningRampMinutes', to: 95, scope: 'today' },
    { ...input, to: 0 }, { ...input, to: 1.5 }, { ...input, scope: 'saved' },
    { parameter: 'postLunchDipDepth', to: 13, scope: 'today' },
    { parameter: 'wakeHour', to: 9, scope: 'today' },
    { parameter: 'medication', to: 1, scope: 'today' },
    { parameter: 'effectScale:stimulant-default', to: 1.01, scope: 'today' },
    { ...input, medicationDose: 1 }, { ...input, baseline: { wakeHour: 9 } }
  ]) assert.equal(t.previewCurveTrial(state, { input: invalid, now: NOW, trialId: 'trial-1', source }).ok, false);
});

test('curve trial preview compares real 10–90 curves and commits an overlay only after confirmation', () => {
  const f = workflowFixture();
  const before = f.snapshot();
  const preview = f.workflow.preview(input);
  assert.equal(preview.ok, true);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(preview.comparison.current.length, 96);
  assert.equal(preview.comparison.proposed.length, 96);
  assert.equal(preview.coverage.sampleCount, 10);
  assert.equal(preview.coverage.missingPredictionCount, 10);
  assert.equal(preview.comparison.current.every(level => level >= 10 && level <= 90), true);
  assert.equal(preview.comparison.proposed.every(level => level >= 10 && level <= 90), true);
  assert.notDeepEqual(preview.comparison.proposed, preview.comparison.current);
  const result = f.workflow.confirm({ previewId: preview.previewId });
  assert.equal(result.ok, true);
  assert.deepEqual(f.workflow.confirm({ previewId: preview.previewId }), result);
  assert.equal(f.commits(), 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'energy.profile.changed');
  const after = f.snapshot();
  assert.deepEqual({ ...after, energyCurveTrials: before.energyCurveTrials }, before);
  const displayed = buildEnergyCurveView({ snapshot: after, settings: after.settings, now: NOW, dayKey: localDayKey(NOW) });
  assert.deepEqual(displayed.levels, preview.comparison.proposed);
  assert.equal(f.workflow.preview({ ...input, to: 5 }).reason, 'curve-trial-active');
});

test('trial samples are causal and direct reports remain exact anchors through a trial', () => {
  const dayKey = localDayKey(NOW);
  const start = localDayStart(dayKey);
  const baseline = resolveBaselineParams();
  const startsAt = start + 9 * 3600000;
  const expiresAt = start + 16 * 3600000;
  const trial = { baseline: { ...baseline, chronotypeShift: 6 }, startsAt, expiresAt };
  const before = buildEnergyCurve({ dayKey, baseline });
  const after = buildEnergyCurve({ dayKey, baseline, baselineTrial: trial });
  for (let i = 0; i < before.samples.length; i += 1) {
    const at = start + before.samples[i].minute * 60000;
    if (at < startsAt || at >= expiresAt) assert.deepEqual(after.samples[i], before.samples[i]);
  }
  for (const at of [startsAt - 60000, startsAt + 60000, expiresAt + 60000]) {
    const result = buildEnergyCurve({ dayKey, baseline, baselineTrial: trial, now: at, checkIns: [{ at, level: 35 }] });
    assert.equal(result.nowLevel, 35);
  }
});

test('source parameter changes and new evidence reject stale confirmations without any writes', () => {
  for (const change of [state => { state.energyProfile = { baseline: resolveBaselineParams(), effectScale: {}, observations: 1, updatedAt: NOW, lastResidualMae: null }; },
    state => h.appendSelfReport(state, { at: NOW, level: 50 }),
    state => { state.routineLog.days = [{ dayKey: localDayKey(NOW), entries: [] }]; },
    state => h.setSelfReportConsent(state, { enabled: false, expectedVersion: state.energySelfReports.version, now: NOW })]) {
    const f = workflowFixture();
    const preview = f.workflow.preview(input);
    f.mutate(change);
    const before = f.snapshot();
    assert.equal(f.workflow.confirm({ previewId: preview.previewId }).ok, false);
    assert.equal(f.commits(), 0);
    assert.deepEqual(f.snapshot(), before);
  }
});

test('undo and expiration restore underlying curve without changing observations or self-report facts', () => {
  const f = workflowFixture();
  const before = f.snapshot();
  const preview = f.workflow.preview(input);
  const result = f.workflow.confirm({ previewId: preview.previewId });
  const trial = result.trial;
  assert.equal(f.workflow.undo({ trialId: trial.id, expectedVersion: result.version + 1 }).ok, false);
  assert.equal(f.workflow.undo({ trialId: trial.id, expectedVersion: result.version }).ok, true);
  assert.equal(f.snapshot().energyCurveTrials.active, null);
  assert.deepEqual(f.snapshot().energySelfReports, before.energySelfReports);
  assert.deepEqual(f.snapshot().energyCheckIn, before.energyCheckIn);
  assert.deepEqual(f.snapshot().energyProfile, before.energyProfile);
  const next = f.workflow.preview(input);
  f.workflow.confirm({ previewId: next.previewId });
  const applied = f.snapshot();
  const bytes = JSON.stringify(applied.energyCurveTrials);
  const source = buildEnergyCurveSource({ snapshot: applied, dayKey: localDayKey(NOW) });
  assert.equal(t.curveTrialStatus(applied, { source, now: next.trial.expiresAt }).active, false);
  const expiration = buildEnergyCurveView({ snapshot: applied, settings: applied.settings, now: next.trial.expiresAt, dayKey: localDayKey(NOW) });
  const original = buildEnergyCurveView({ snapshot: before, settings: before.settings, now: next.trial.expiresAt, dayKey: localDayKey(NOW) });
  assert.deepEqual(expiration.levels, original.levels);
  assert.equal(JSON.stringify(applied.energyCurveTrials), bytes, 'expiry is a deterministic read, no timer or mutation');
});

test('revoked consent, deleted evidence or changed source immediately disables an active overlay', () => {
  for (const mutate of [state => { state.energySelfReports.consentEnabled = false; },
    state => { state.energySelfReports.events = []; }, state => { state.energyProfile = { observations: 1 }; }]) {
    const f = workflowFixture();
    const preview = f.workflow.preview(input);
    f.workflow.confirm({ previewId: preview.previewId });
    f.mutate(mutate);
    const state = f.snapshot();
    const source = buildEnergyCurveSource({ snapshot: state, dayKey: localDayKey(NOW) });
    assert.equal(t.curveTrialStatus(state, { source, now: NOW }).active, false);
  }
});

test('strict persisted trial validation rejects unknown, inflated, multidimensional and corrupt state', () => {
  const f = workflowFixture();
  const preview = f.workflow.preview(input);
  f.workflow.confirm({ previewId: preview.previewId });
  const value = f.snapshot().energyCurveTrials;
  assert.deepEqual(v.normalizeEnergyCurveTrials(value), value);
  for (const mutation of [value => { delete value.active.sourceVersion; }, value => { value.active.to = 7; },
    value => { value.active.parameter = 'medication'; }, value => { value.active.otherParameter = 1; },
    value => { value.active.coverage.sampleCount = 999; }, value => { value.active.evidenceRefs.pop(); },
    value => { value.active.expiresAt += 8 * DAY; }, value => { value.undo.appliedVersion += 1; }]) {
    const damaged = structuredClone(value); mutation(damaged);
    assert.throws(() => v.normalizeEnergyCurveTrials(damaged), /planning-state-invalid/);
  }
});

test('history consent disabled after confirmation cannot block local undo', () => {
  const f = workflowFixture();
  const preview = f.workflow.preview(input);
  const applied = f.workflow.confirm({ previewId: preview.previewId });
  f.mutate(state => { state.energySelfReports.consentEnabled = false; });
  assert.equal(f.workflow.undo({ trialId: applied.trial.id, expectedVersion: applied.version }).ok, true);
  assert.equal(f.snapshot().energyCurveTrials.active, null);
  assert.equal(f.snapshot().energySelfReports.consentEnabled, false);
  assert.equal(f.snapshot().energySelfReports.events.length, 10);
});

test('the query keeps retained anchors on both sides of a real trial without changing pre-trial samples', () => {
  const f = workflowFixture(), hour = 3600000, dayKey = localDayKey(NOW);
  const { recordEnergyCheckIn } = require('../src/capabilities/guidance');
  const command = recordEnergyCheckIn.createRecordEnergyCheckInCommand(f);
  f.setTime(NOW - hour);
  assert.equal(command.execute({ checkIn: { timestamp: NOW - hour, level: 35, state: 'low' } }).ok, true);
  f.setTime(NOW);
  const before = f.snapshot();
  const beforeView = buildEnergyCurveView({ snapshot: before, settings: before.settings, now: NOW, dayKey });
  const preview = f.workflow.preview(input);
  assert.equal(f.workflow.confirm({ previewId: preview.previewId }).ok, true);
  f.setTime(NOW + hour);
  assert.equal(command.execute({ checkIn: { timestamp: NOW + hour, level: 80, state: 'high' } }).ok, true);
  const saved = f.snapshot(), commits = f.commits();
  const source = buildEnergyCurveSource({ snapshot: saved, dayKey });
  const status = t.curveTrialStatus(saved, { source, now: NOW + hour });
  assert.equal(status.active, true);
  const actual = buildEnergyCurveView({ snapshot: saved, settings: saved.settings, now: NOW + hour, dayKey });
  const expected = buildEnergyCurve({ dayKey, now: NOW + hour, baseline: source.baseline, baselineTrial: status.overlay,
    checkIns: [...saved.energySelfReports.events, { at: saved.energyCheckIn.timestamp, level: saved.energyCheckIn.level }] });
  assert.deepEqual(actual.levels, expected.samples.map(sample => Math.round(sample.level)));
  const startIndex = (NOW - localDayStart(dayKey)) / 60000 / actual.sampleMinutes;
  assert.deepEqual(actual.levels.slice(0, startIndex), beforeView.levels.slice(0, startIndex));
  assert.equal(actual.levels[startIndex - 4], 35);
  assert.equal(actual.levels[startIndex + 4], 80);
  assert.equal(actual.nowLevel, 80);
  assert.deepEqual(f.snapshot(), saved); assert.equal(f.commits(), commits);
});
