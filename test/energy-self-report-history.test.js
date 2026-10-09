'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../src/capabilities/guidance');
const { energySelfReports: h, planningState: v } = guidance;
const { createConsentEnergyHistoryWorkflow } = require('../src/application/workflows/consent-energy-history');
const { capturePlanningEstimate } = require('../src/application/queries/energy-curve-view');
const { localDayKey } = require('../src/core/calendar');
const { START, DAY, NOW, planningFixture, repositoryFixture } = require('../test-support/planning-guidance-fixture');

test('default-off consent never backfills legacy latest check-in, calibrated observations, routine or inferred data', () => {
  const state = planningFixture();
  state.energyProfile = { observations: 900 };
  assert.equal(h.appendSelfReport(state, { level: 50, at: START }).changed, false);
  assert.equal(h.selfReportCoverage(state, NOW).eligible, false);
  const previous = structuredClone(state.energyCheckIn);
  assert.equal(h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START }).ok, true);
  assert.equal(h.selfReportCoverage(state, NOW).sampleCount, 0);
  assert.deepEqual(state.energyCheckIn, previous);
  guidance.energyCheckIn.recordEnergyCheckIn(state, { level: 35, state: 'low', timestamp: NOW });
  assert.equal(state.energySelfReports.events.length, 0, 'inbox/domain calls do not imply explicit history capture');
});

test('only actual consented explicit self-check commands store before-write estimates and exact source versions', () => {
  const state = planningFixture();
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
  const f = repositoryFixture(state);
  let capturedPrevious = null;
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({ ...f,
    capturePlanningEstimate(snapshot, at) {
      capturedPrevious = structuredClone(snapshot.energyCheckIn);
      return capturePlanningEstimate({ snapshot, settings: snapshot.settings, at, dayKey: localDayKey(at) });
    } });
  assert.equal(command.execute({ checkIn: { level: 65, state: 'medium', timestamp: NOW } }).ok, true);
  const saved = f.snapshot();
  assert.deepEqual(capturedPrevious, state.energyCheckIn);
  assert.equal(saved.energySelfReports.events.length, 1);
  const event = saved.energySelfReports.events[0];
  assert.equal(event.at, NOW); assert.equal(event.dayKey, localDayKey(NOW)); assert.equal(event.level, 65);
  assert.equal(event.source, 'user-self-report');
  assert.equal(event.estimate.modelLevel >= 10 && event.estimate.modelLevel <= 90, true);
  assert.ok(event.estimate.sourceVersion.includes('energy-curve:1'));
  assert.equal(saved.energyProfile, null);
  assert.equal(command.execute({ checkIn: saved.energyCheckIn }).changed, false);
  assert.equal(f.snapshot().energySelfReports.events.length, 1);
  assert.equal(f.commits(), 1);
});

test('relative explicit adjustment records once, but outward adjustment at a hard bound never invents an event', () => {
  const state = planningFixture();
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
  const f = repositoryFixture(state);
  const command = guidance.adjustEnergy.createAdjustEnergyCommand({ ...f, currentLevelFor: () => 90 });
  assert.equal(command.execute({ direction: 'higher' }).changed, false);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.equal(command.execute({ direction: 'same' }).changed, true);
  assert.equal(f.snapshot().energySelfReports.events.length, 1);
  assert.equal(f.snapshot().energySelfReports.events[0].estimate, null, 'unavailable snapshot remains explicitly missing');
});

test('coverage requires ten actual valid events and seven elapsed days with seven local dates', () => {
  const state = planningFixture();
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
  for (let i = 0; i < 10; i += 1) h.appendSelfReport(state, { level: 50, at: START + i * 60000 });
  let coverage = h.selfReportCoverage(state, NOW);
  assert.equal(coverage.sampleCount, 10); assert.equal(coverage.coveredDays, 1); assert.equal(coverage.eligible, false);
  for (let i = 1; i <= 7; i += 1) h.appendSelfReport(state, { level: 50, at: START + i * DAY });
  coverage = h.selfReportCoverage(state, NOW);
  assert.equal(coverage.eligible, true); assert.equal(coverage.sampleCount, 17); assert.equal(coverage.coveredDays, 8);
  assert.equal(coverage.missingPredictionCount, 17);
  assert.equal(h.selfReportCoverage(state, NOW + 40 * DAY).eligible, false);
  assert.equal(state.energySelfReports.events.length, 17, 'query does not delete facts');
  const enough = planningFixture({ sufficient: true });
  enough.energySelfReports.events.pop();
  assert.equal(h.selfReportCoverage(enough, NOW).eligible, false);
});

test('duplicate, future, pre-consent and old backfilled reports do not become samples', () => {
  const state = planningFixture();
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
  for (const args of [{ at: START - 1 }, { at: START + 1, recordedAt: START }, { at: START, recordedAt: NOW }, { at: START, level: 99 }]) {
    assert.equal(h.appendSelfReport(state, { level: 50, ...args }).changed, false);
  }
  h.appendSelfReport(state, { level: 50, at: NOW });
  assert.equal(h.appendSelfReport(state, { level: 65, at: NOW }).changed, false);
  assert.equal(h.appendSelfReport(state, { level: 65, at: NOW - 1 }).changed, false);
  assert.equal(state.energySelfReports.events.length, 1);
});

test('disabling stops collection; deleting existing history requires exact-count preview and confirmation', () => {
  const f = repositoryFixture(planningFixture({ sufficient: true }));
  const workflow = createConsentEnergyHistoryWorkflow(f);
  const before = f.snapshot();
  const preview = workflow.preview({ enabled: false, clearHistory: false });
  assert.equal(preview.deletionCount, 0);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(workflow.confirm({ previewId: preview.previewId }).ok, true);
  const state = f.snapshot();
  assert.equal(h.appendSelfReport(state, { level: 50, at: NOW }).changed, false);
  assert.equal(state.energySelfReports.events.length, 10);
  const clear = workflow.preview({ enabled: false, clearHistory: true });
  assert.equal(clear.deletionCount, 10); assert.equal(clear.deletesLegacyLatestCheckIn, false);
  assert.equal(workflow.confirm({ previewId: clear.previewId }).ok, true);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.deepEqual(f.snapshot().energyCheckIn, before.energyCheckIn);
});

test('history storage is bounded, strict and an idempotent fixed point without timestamp pruning', () => {
  const state = planningFixture();
  h.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
  for (let i = 0; i < 300; i += 1) h.appendSelfReport(state, { level: 50, at: START + i * 60000 });
  const value = state.energySelfReports;
  assert.equal(value.events.length, v.MAX_SELF_REPORTS);
  assert.deepEqual(v.normalizeEnergySelfReports(value), value);
  for (const mutation of [value => { delete value.consentEnabled; }, value => { value.extra = 'hidden'; },
    value => { value.events[0].source = 'curve-prediction'; }, value => { value.events[0].level = 9; },
    value => { value.events[0].estimate = { modelLevel: 100 }; }, value => { value.events.push(value.events[0]); }]) {
    const damaged = structuredClone(value); mutation(damaged);
    assert.throws(() => v.normalizeEnergySelfReports(damaged), /planning-state-invalid/);
  }
});
