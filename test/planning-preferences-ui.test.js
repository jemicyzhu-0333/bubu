'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanningPreferences } = require('../src/bootstrap/planning-preferences');
const { createPlanningPreferencesFeature } = require('../src/surfaces/popover/features/planning-preferences.mjs');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { NOW, planningFixture } = require('../test-support/planning-guidance-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));
const BINDINGS = Object.freeze({ getPlanningGuidance: 'planning:get', cancelPlanningPreview: 'planning:preview-cancel', previewPlanningPreference: 'planning:preference-preview',
  confirmPlanningPreference: 'planning:preference-confirm', undoPlanningPreference: 'planning:preference-undo',
  previewEnergyHistoryConsent: 'planning:history-preview', confirmEnergyHistoryConsent: 'planning:history-confirm',
  previewEnergyCurveTrial: 'planning:trial-preview', confirmEnergyCurveTrial: 'planning:trial-confirm', undoEnergyCurveTrial: 'planning:trial-undo' });
function fixture({ sufficient = false, failCommit = false, verified = false } = {}) {
  const source = planningFixture({ sufficient });
  let state = normalizePersistedState({ energyCheckIn: source.energyCheckIn,
    planningPreferences: source.planningPreferences, energySelfReports: source.energySelfReports,
    energyCurveTrials: source.energyCurveTrials, settings: { aiBreakdownEnabled: false, activityMirrorEnabled: false } }, { now: NOW });
  let revision = 0, commits = 0, serial = 0, at = NOW, hiddenHandler = null;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) {
      if (failCommit) throw new Error('fixture write failed before persistence');
      state = normalizePersistedState(candidate, { now: at }); revision++; commits++; return structuredClone(state);
    } };
  const service = createPlanningPreferences({ unitOfWork: createUnitOfWork({ repository }), readSnapshot: repository.snapshot,
    clock: { now: () => at }, idFactory: () => `planning-ui-${++serial}`,
    durability: verified ? { verify: () => ({ ok: true }) } : null });
  const routes = new Map(); service.register((channel, handler) => routes.set(channel, handler));
  const calls = [], overrides = {};
  const bridge = new Proxy({}, { get(_target, name) {
    if (name === 'onPopoverHidden') return callback => { hiddenHandler = callback; return () => { hiddenHandler = null; }; };
    if (!BINDINGS[name]) return () => { throw new Error(`Unexpected fixture method: ${String(name)}`); };
    return async payload => {
      const decoded = validateIpcPayload(BINDINGS[name], payload);
      assert.equal(decoded.ok, true, `${name}: ${JSON.stringify(decoded)}`);
      const result = await (overrides[name] ? overrides[name](payload) : routes.get(BINDINGS[name])({}, decoded.value));
      calls.push({ name, payload: structuredClone(payload), result: structuredClone(result) }); return result;
    };
  } });
  const dom = createCollaborationDom(); dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupPlanning').open = false;
  const feature = createPlanningPreferencesFeature({ document: dom.document, $: dom.$, client: createPopoverSurfaceClient(bridge), now: () => at });
  feature.init(); dom.$('#settingGroupPlanning').open = true;
  return { feature, dom, service, calls, overrides, snapshot: repository.snapshot, commits: () => commits,
    change: mutate => { mutate(state); revision++; }, setTime: value => { at = value; }, hide: () => hiddenHandler?.(),
    invoke(channel, payload) { const decoded = validateIpcPayload(channel, payload); assert.equal(decoded.ok, true); return routes.get(channel)({}, decoded.value); },
    last: name => calls.filter(call => call.name === name).at(-1) };
}

test('planning UI renders real state, previews/edits/commits/undoes without AI or observation mutation', async () => {
  const f = fixture(); await f.feature.reload();
  assert.doesNotMatch(f.dom.$('#planningPreferenceSummary').textContent, /凭据|标识|版本/);
  assert.doesNotMatch(f.dom.$('#planningPreferenceTarget').innerHTML, /版本/);
  assert.equal(f.dom.$('#planningHistoryEnabled').checked, false);
  assert.equal(f.dom.$('#planningTrialPreview').disabled, true);
  f.dom.$('#planningDemand').value = 'high';
  await f.feature.preview('preference');
  assert.equal(f.commits(), 0); assert.equal(f.dom.$('#planningConfirm').disabled, false);
  assert.match(f.dom.$('#planningReviewText').textContent, /13:00–17:00/);
  const firstPreview = f.last('previewPlanningPreference').result;
  f.dom.$('#planningDemand').value = 'low'; f.dom.fire('#planningDemand', 'change');
  await f.feature.confirm(); assert.equal(f.commits(), 0, 'editing invalidates the confirmation target');
  await f.feature.preview('preference');
  assert.notEqual(f.last('previewPlanningPreference').result.previewId, firstPreview.previewId);
  await f.feature.confirm();
  assert.equal(f.snapshot().planningPreferences.items[0].demand, 'low');
  assert.equal(f.snapshot().energyProfile, null);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.equal(f.dom.$('#planningPreferenceUndo').disabled, false);
  await f.feature.undo('preference');
  assert.equal(f.snapshot().planningPreferences.items.length, 0);
  f.feature.dispose();
});

test('history controls preview exact deletion count and require separate confirmation; current self-check survives', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  const original = f.snapshot().energyCheckIn;
  assert.equal(f.dom.$('#planningHistoryEnabled').checked, true);
  assert.match(f.dom.$('#planningCoverage').textContent, /10 条/);
  f.dom.$('#planningHistoryEnabled').checked = false;
  f.dom.$('#planningHistoryClear').checked = true;
  await f.feature.preview('history');
  assert.match(f.dom.$('#planningReviewText').textContent, /清除已有历史：10 条/);
  assert.match(f.dom.$('#planningReviewText').textContent, /不可撤销/);
  assert.equal(f.snapshot().energySelfReports.events.length, 10);
  await f.feature.confirm();
  assert.equal(f.snapshot().energySelfReports.consentEnabled, false);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.deepEqual(f.snapshot().energyCheckIn, original);
  assert.equal(f.dom.$('#planningTrialPreview').disabled, true);
  f.feature.dispose();
});

test('eligible curve UI compares actual curves, confirms one bounded parameter and restores while consent is off', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  assert.equal(f.dom.$('#planningTrialPreview').disabled, false);
  assert.match(f.dom.$('#planningTrialBounds').textContent, /当前 0 分钟.*可选 -6–6 分钟/);
  assert.equal(f.dom.$('#planningTrialValue').min, '-6');
  assert.equal(f.dom.$('#planningTrialValue').max, '6');
  await f.feature.preview('trial');
  assert.equal(f.commits(), 0);
  assert.match(f.dom.$('#planningCurveComparison').innerHTML, /planning-current-curve/);
  assert.match(f.dom.$('#planningCurveComparison').innerHTML, /planning-proposed-curve/);
  const preview = f.last('previewEnergyCurveTrial').result;
  assert.notDeepEqual(preview.comparison.current, preview.comparison.proposed);
  await f.feature.confirm();
  assert.equal(f.snapshot().energyCurveTrials.active.to, 6);
  assert.equal(f.dom.$('#planningTrialPreview').disabled, true);
  assert.equal(f.dom.$('#planningTrialUndo').disabled, false);
  f.change(state => { state.energySelfReports.consentEnabled = false; }); await f.feature.reload();
  await f.feature.undo('trial');
  assert.equal(f.snapshot().energyCurveTrials.active, null);
  assert.equal(f.snapshot().energySelfReports.events.length, 10);
  assert.equal(f.snapshot().energySelfReports.consentEnabled, false);
  f.feature.dispose();
});

test('expired, wrong-target and asynchronously obsolete previews never enable a write', async () => {
  const f = fixture(); await f.feature.reload();
  await f.feature.preview('preference'); f.setTime(NOW + 15 * 60000);
  await f.feature.confirm(); assert.equal(f.commits(), 0); assert.match(f.dom.$('#planningStatus').textContent, /到期/);
  f.setTime(NOW);
  f.overrides.previewPlanningPreference = () => ({ ok: true, previewId: 'wrong-target', confirmationExpiresAt: NOW + 60000,
    before: null, after: { id: 'somewhere-else', startMinute: 1, endMinute: 2, demand: 'high', scope: 'today' } });
  await f.feature.preview('preference');
  assert.equal(f.dom.$('#planningConfirm').disabled, true);
  assert.match(f.dom.$('#planningStatus').textContent, /不一致/);
  delete f.overrides.previewPlanningPreference;
  let finish;
  f.overrides.previewPlanningPreference = payload => new Promise(resolve => { finish = () => resolve({ ...f.service.get(), after: payload }); });
  const pending = f.feature.preview('preference'); await tick();
  f.dom.$('#settingGroupPlanning').open = false; f.dom.fire('#settingGroupPlanning', 'toggle'); finish(); await pending;
  assert.equal(f.dom.$('#planningReview').classList.contains('hidden'), true);
  assert.equal(f.commits(), 0);
  f.feature.dispose();
});

test('repeat click is single-flight, changed backing evidence cannot apply and dismissing never auto-confirms', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  await Promise.all([f.feature.preview('trial'), f.feature.preview('trial')]);
  assert.equal(f.calls.filter(call => call.name === 'previewEnergyCurveTrial').length, 1);
  f.change(state => { state.energyCheckIn.level = 35; });
  await f.feature.confirm();
  assert.equal(f.snapshot().energyCurveTrials.active, null);
  assert.match(f.dom.$('#planningStatus').textContent, /依据已经变化/);
  await f.feature.preview('preference'); f.hide();
  await f.feature.confirm(); assert.equal(f.commits(), 0);
  f.feature.dispose();
});

test('actual UI Cancel invalidates the exact backend ticket for all three planning workflows', async () => {
  for (const kind of ['preference', 'history', 'trial']) {
    const f = fixture({ sufficient: true }); await f.feature.reload();
    if (kind === 'history') { f.dom.$('#planningHistoryEnabled').checked = false; f.dom.$('#planningHistoryClear').checked = true; }
    await f.feature.preview(kind);
    const method = { preference: 'previewPlanningPreference', history: 'previewEnergyHistoryConsent', trial: 'previewEnergyCurveTrial' }[kind];
    const previewId = f.last(method).result.previewId;
    await f.dom.fire('#planningCancel', 'click');
    assert.deepEqual(f.last('cancelPlanningPreview').payload, { kind, previewId });
    const result = f.invoke(`planning:${kind === 'preference' ? 'preference' : kind}-confirm`, { previewId });
    assert.equal(result.ok, false); assert.equal(f.commits(), 0);
    f.feature.dispose();
  }
});

test('edit, refresh, close and replacement preview release backend capacity rather than exhausting 32 slots', async () => {
  const f = fixture(); await f.feature.reload();
  const ids = [];
  for (let index = 0; index < 40; index++) {
    await f.feature.preview('preference');
    const result = f.last('previewPlanningPreference').result; assert.equal(result.ok, true); ids.push(result.previewId);
    if (index % 4 === 0) await f.dom.fire('#planningDemand', 'change');
    else if (index % 4 === 1) await f.feature.reload();
    else if (index % 4 === 2) {
      f.dom.$('#settingGroupPlanning').open = false; await f.dom.fire('#settingGroupPlanning', 'toggle');
      f.dom.$('#settingGroupPlanning').open = true; await f.feature.reload();
    } else {
      await f.feature.preview('preference'); await f.feature.invalidate();
    }
    assert.equal(f.invoke('planning:preference-confirm', { previewId: result.previewId }).ok, false);
  }
  assert.equal(new Set(ids).size, 40); assert.equal(f.commits(), 0);
  f.feature.dispose();
});

test('late preview A cleanup cancels only A while newer preview B remains confirmable', async () => {
  const f = fixture(); await f.feature.reload();
  let releaseA, resultA, requestCount = 0;
  f.overrides.previewPlanningPreference = payload => {
    const result = f.invoke('planning:preference-preview', payload);
    if (++requestCount === 1) { resultA = result; return new Promise(resolve => { releaseA = () => resolve(result); }); }
    return result;
  };
  const requestA = f.feature.preview('preference'); await tick();
  await f.feature.invalidate();
  f.dom.$('#planningDemand').value = 'high';
  await f.feature.preview('preference');
  const resultB = f.last('previewPlanningPreference').result;
  assert.notEqual(resultA.previewId, resultB.previewId);
  releaseA(); await requestA;
  assert.deepEqual(f.last('cancelPlanningPreview').payload, { kind: 'preference', previewId: resultA.previewId });
  assert.equal(f.invoke('planning:preference-confirm', { previewId: resultA.previewId }).ok, false);
  await f.feature.confirm();
  assert.equal(f.snapshot().planningPreferences.items[0].demand, 'high');
  assert.equal(f.last('confirmPlanningPreference').payload.previewId, resultB.previewId);
  assert.equal(f.commits(), 1); f.feature.dispose();
});

test('uncertain confirmation keeps its identity through close, refresh and cancel, then recovers one cached result', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  f.dom.$('#planningHistoryEnabled').checked = false; f.dom.$('#planningHistoryClear').checked = true;
  await f.feature.preview('history');
  const previewId = f.last('previewEnergyHistoryConsent').result.previewId;
  f.overrides.confirmEnergyHistoryConsent = payload => {
    f.invoke('planning:history-confirm', payload); throw new Error('fixture lost IPC reply after commit');
  };
  await f.feature.confirm(); assert.equal(f.commits(), 1);
  await f.feature.invalidate(); await f.feature.reload(); await f.dom.fire('#planningCancel', 'click');
  assert.equal(f.calls.filter(call => call.name === 'cancelPlanningPreview' && call.payload.previewId === previewId).length, 0);
  assert.match(f.dom.$('#planningStatus').textContent, /无法确认|待核对/);
  assert.doesNotMatch(f.dom.$('#planningStatus').textContent, /已有内容未改变|已取消/);
  await f.feature.reload(); delete f.overrides.confirmEnergyHistoryConsent;
  await f.feature.confirm();
  assert.equal(f.last('confirmEnergyHistoryConsent').payload.previewId, previewId);
  assert.equal(f.commits(), 1);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  assert.equal(f.invoke('planning:preview-cancel', { kind: 'history', previewId }).reason, 'guidance-preview-already-confirmed');
  assert.equal(f.invoke('planning:history-confirm', { previewId }).ok, true);
  f.feature.dispose();
});

test('close during an in-flight confirmation never cancels it or reports an unchanged store', async () => {
  const f = fixture(); await f.feature.reload(); await f.feature.preview('preference');
  const previewId = f.last('previewPlanningPreference').result.previewId; let resolveReply;
  f.overrides.confirmPlanningPreference = payload => {
    const result = f.invoke('planning:preference-confirm', payload);
    return new Promise(resolve => { resolveReply = () => resolve(result); });
  };
  const confirming = f.feature.confirm(); await tick();
  f.dom.$('#settingGroupPlanning').open = false; await f.dom.fire('#settingGroupPlanning', 'toggle');
  assert.equal(f.calls.filter(call => call.name === 'cancelPlanningPreview' && call.payload.previewId === previewId).length, 0);
  resolveReply(); await confirming;
  f.dom.$('#settingGroupPlanning').open = true; await f.feature.reload();
  assert.equal(f.snapshot().planningPreferences.items.length, 1); assert.equal(f.commits(), 1);
  assert.equal(f.dom.$('#planningPreferenceUndo').disabled, false);
  f.feature.dispose();
});

test('an explicitly uncertain confirmation response is retained for same-ticket recovery', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  f.dom.$('#planningHistoryEnabled').checked = false;
  await f.feature.preview('history');
  const previewId = f.last('previewEnergyHistoryConsent').result.previewId;
  f.overrides.confirmEnergyHistoryConsent = payload => {
    f.invoke('planning:history-confirm', payload);
    return { ok: false, reason: 'change-durability-uncertain', committed: true, uncertain: true };
  };
  await f.feature.confirm(); await f.feature.invalidate();
  assert.equal(f.calls.filter(call => call.name === 'cancelPlanningPreview' && call.payload.previewId === previewId).length, 0);
  assert.equal(f.commits(), 1);
  delete f.overrides.confirmEnergyHistoryConsent;
  await f.feature.reload(); await f.feature.confirm();
  assert.equal(f.last('confirmEnergyHistoryConsent').payload.previewId, previewId);
  assert.equal(f.commits(), 1);
  f.feature.dispose();
});

test('a never-dispatched confirmation can leave recovery after its known ticket expires', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  f.dom.$('#planningHistoryEnabled').checked = false;
  await f.feature.preview('history');
  f.overrides.confirmEnergyHistoryConsent = () => { throw new Error('fixture IPC failed before dispatch'); };
  await f.feature.confirm();
  delete f.overrides.confirmEnergyHistoryConsent;
  f.setTime(NOW + 15 * 60000 + 1);
  await f.feature.confirm();
  assert.equal(f.commits(), 0);
  assert.equal(f.dom.$('#planningHistoryEnabled').disabled, false);
  assert.equal(f.dom.$('#planningPreferencePreview').disabled, false);
  assert.match(f.dom.$('#planningStatus').textContent, /到期/);
  f.feature.dispose();
});

test('a lost history confirmation reply remains recoverable after preview expiry', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  f.dom.$('#planningHistoryEnabled').checked = false;
  f.dom.$('#planningHistoryClear').checked = true;
  await f.feature.preview('history');
  const previewId = f.last('previewEnergyHistoryConsent').result.previewId;
  f.overrides.confirmEnergyHistoryConsent = payload => {
    f.invoke('planning:history-confirm', payload); throw new Error('fixture lost reply after commit');
  };
  await f.feature.confirm(); delete f.overrides.confirmEnergyHistoryConsent;
  f.setTime(NOW + 15 * 60000 + 1);
  f.invoke('planning:history-preview', { enabled: true, clearHistory: false });
  await f.feature.reload(); await f.feature.confirm();
  assert.equal(f.last('confirmEnergyHistoryConsent').payload.previewId, previewId);
  assert.equal(f.last('confirmEnergyHistoryConsent').result.ok, true);
  assert.equal(f.commits(), 1);
  assert.equal(f.dom.$('#planningHistoryEnabled').disabled, false);
  assert.equal(f.snapshot().energySelfReports.events.length, 0);
  f.feature.dispose();
});

test('retry only exits recovery for an authoritative no-commit result, never generic expiry or uncertainty', async () => {
  for (const response of [{ ok: false, reason: 'guidance-preview-expired' },
    { ok: false, reason: 'self-report-history-changed', committed: false, uncertain: true }]) {
    const f = fixture({ sufficient: true }); await f.feature.reload();
    await f.feature.preview('history');
    f.overrides.confirmEnergyHistoryConsent = () => { throw new Error('fixture unavailable response'); };
    await f.feature.confirm();
    f.overrides.confirmEnergyHistoryConsent = () => response;
    await f.feature.confirm(); await f.feature.reload(); await f.dom.fire('#planningCancel', 'click');
    assert.equal(f.dom.$('#planningHistoryEnabled').disabled, true);
    assert.equal(f.dom.$('#planningPreferencePreview').disabled, true);
    assert.equal(f.commits(), 0);
    f.feature.dispose();
  }
});

test('a lost definite rejection is recovered as the same known zero-write outcome', async () => {
  const f = fixture({ sufficient: true }); await f.feature.reload();
  f.dom.$('#planningHistoryEnabled').checked = false;
  await f.feature.preview('history');
  f.change(state => { state.energySelfReports.version++; });
  f.overrides.confirmEnergyHistoryConsent = payload => {
    f.invoke('planning:history-confirm', payload); throw new Error('fixture lost rejected reply');
  };
  await f.feature.confirm(); delete f.overrides.confirmEnergyHistoryConsent;
  await f.feature.confirm();
  assert.equal(f.last('confirmEnergyHistoryConsent').result.committed, false);
  assert.equal(f.dom.$('#planningHistoryEnabled').disabled, false);
  assert.equal(f.commits(), 0);
  f.feature.dispose();
});

test('an expired failed write unlocks only after the unchanged canonical slice is verified', async () => {
  for (const verified of [false, true]) {
    const f = fixture({ sufficient: true, failCommit: true, verified }); await f.feature.reload();
    f.dom.$('#planningHistoryEnabled').checked = false;
    await f.feature.preview('history'); await f.feature.confirm();
    assert.equal(f.dom.$('#planningHistoryEnabled').disabled, true);
    f.setTime(NOW + 15 * 60000 + 1);
    await f.feature.confirm();
    assert.equal(f.commits(), 0);
    assert.equal(f.dom.$('#planningHistoryEnabled').disabled, !verified);
    assert.equal(f.dom.$('#planningPreferencePreview').disabled, !verified);
    f.feature.dispose();
  }
});
