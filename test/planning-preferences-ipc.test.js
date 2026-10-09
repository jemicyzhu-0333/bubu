'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { createIpcRegistrar } = require('../src/application/ipc');
const { assertIpcPayload, allowedSurfacesFor, validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { guidance } = require('../src/capabilities');
const { NOW, DAY, planningFixture, repositoryFixture } = require('../test-support/planning-guidance-fixture');
const INPUT = { id: null, startMinute: 600, endMinute: 1080, demand: 'high', scope: 'today' };
function fixture({ sufficient = false } = {}) {
  const state = { ...normalizePersistedState({}, { now: NOW }), ...planningFixture({ sufficient }) };
  const f = repositoryFixture(state), handlers = new Map(), facts = [], dirty = [];
  const bootstrap = createPlanningPreferences({ ...f, readSnapshot: f.snapshot, publishFact: fact => facts.push(fact), publishChange: flags => dirty.push(flags) });
  const register = createIpcRegistrar({ ipcHost: { handle: (channel, handler) => handlers.set(channel, handler) },
    senderPage: event => event.page, allowedPagesFor: allowedSurfacesFor,
    validatePayload: (channel, payload) => assertIpcPayload(channel, payload) });
  bootstrap.register(register);
  return { ...f, bootstrap, handlers, facts, dirty,
    invoke: (channel, payload, page = 'popover') => handlers.get(channel)({ page }, payload) };
}

test('planning routes are closed, popover-only and reject model-owned health fields or forged confirmation payloads', async () => {
  const f = fixture();
  assert.equal(f.handlers.size, 11);
  for (const channel of f.handlers.keys()) assert.deepEqual(allowedSurfacesFor(channel), ['popover']);
  await assert.rejects(f.invoke('planning:get', undefined, 'pet'), /not allowed/);
  for (const [channel, payload] of [
    ['planning:get', { includePrivate: true }], ['planning:preview-cancel', { kind: 'all', previewId: 'ticket' }],
    ['planning:preview-cancel', { kind: 'preference', previewId: 'ticket', all: true }], ['planning:preference-preview', { ...INPUT, observations: 10 }],
    ['planning:preference-preview', { ...INPUT, id: '../target' }], ['planning:preference-preview', { ...INPUT, endMinute: 500 }],
    ['planning:preference-confirm', { previewId: 'ticket', after: {} }], ['planning:history-preview', { enabled: 'yes', clearHistory: false }],
    ['planning:history-preview', { enabled: true, clearHistory: false, backfill: true }],
    ['planning:trial-preview', { parameter: 'effectScale:medication-default', to: 1, scope: 'today' }],
    ['planning:trial-preview', { parameter: 'chronotypeShift', to: 6, scope: 'saved' }],
    ['planning:trial-undo', { trialId: 't1', expectedVersion: -1 }]
  ]) assert.equal(validateIpcPayload(channel, payload).ok, false, channel);
  assert.equal(f.commits(), 0);
});

test('real UoW routes keep planning preview separate from confirmation, and can undo with AI disabled', async () => {
  const f = fixture();
  const before = f.snapshot();
  const result = await f.invoke('planning:preference-preview', INPUT);
  assert.equal(result.ok, true);
  assert.equal(f.commits(), 0);
  const confirmed = await f.invoke('planning:preference-confirm', { previewId: result.previewId });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(await f.invoke('planning:preference-confirm', { previewId: result.previewId }), confirmed);
  assert.equal(f.facts.length, 1); assert.equal(f.dirty.length, 1);
  const view = (await f.invoke('planning:get')).view;
  assert.equal(view.storedPreferences[0].demand, 'high');
  assert.equal(view.preferenceUndo.receiptId, confirmed.receiptId);
  assert.equal((await f.invoke('planning:preference-undo', { receiptId: confirmed.receiptId, expectedVersion: confirmed.version })).ok, true);
  assert.deepEqual(f.snapshot().energyCheckIn, before.energyCheckIn);
  assert.equal(f.snapshot().energyProfile, null);
  assert.equal(f.snapshot().planningPreferences.items.length, 0);
});

test('route consent is default-off, previews exact deletion count, and explicit check-ins capture current estimate once', async () => {
  const f = fixture();
  assert.equal((await f.invoke('planning:get')).view.collectionEnabled, false);
  const consent = await f.invoke('planning:history-preview', { enabled: true, clearHistory: false });
  assert.equal(consent.deletionCount, 0);
  assert.equal(f.snapshot().energySelfReports.consentEnabled, false);
  await f.invoke('planning:history-confirm', { previewId: consent.previewId });
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({ ...f,
    capturePlanningEstimate: f.bootstrap.captureEstimate });
  command.execute({ checkIn: { level: 50, state: 'medium', timestamp: NOW } });
  const saved = f.snapshot().energySelfReports.events[0];
  assert.ok(saved.estimate); assert.equal(saved.at, NOW); assert.equal(saved.estimate.modelLevel >= 10, true);
  const deletion = await f.invoke('planning:history-preview', { enabled: false, clearHistory: true });
  assert.equal(deletion.deletionCount, 1); assert.equal(deletion.deletesLegacyLatestCheckIn, false);
  await f.invoke('planning:history-confirm', { previewId: deletion.previewId });
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.equal(f.snapshot().energyCheckIn.timestamp, NOW);
});

test('route trial comparison has real current and suggested curves, exact-source refusal, expiry and consent-independent undo', async () => {
  const f = fixture({ sufficient: true });
  const input = { parameter: 'chronotypeShift', to: 6, scope: '7days' };
  const blocked = fixture();
  assert.equal((await blocked.invoke('planning:trial-preview', input)).reason, 'self-report-consent-required');
  const preview = await f.invoke('planning:trial-preview', input);
  assert.equal(preview.ok, true);
  assert.notDeepEqual(preview.comparison.current, preview.comparison.proposed);
  assert.equal(f.snapshot().energyCurveTrials.active, null);
  assert.equal((await f.invoke('planning:history-confirm', { previewId: preview.previewId })).ok, false, 'ticket cannot cross workflow scope');
  const applied = await f.invoke('planning:trial-confirm', { previewId: preview.previewId });
  assert.equal(applied.ok, true);
  assert.equal((await f.invoke('planning:get')).view.trial.active, true);
  f.mutate(state => { state.energySelfReports.consentEnabled = false; });
  assert.equal((await f.invoke('planning:trial-undo', { trialId: applied.trial.id, expectedVersion: applied.version })).ok, true);
  assert.equal(f.snapshot().energySelfReports.events.length, 10);
  assert.equal(f.snapshot().energyProfile, null);
  f.setTime(NOW + 10 * DAY);
  assert.equal((await f.invoke('planning:get')).view.trial.active, false);
});
